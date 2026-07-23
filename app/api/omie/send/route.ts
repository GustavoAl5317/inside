/**
 * POST /api/omie/send
 *
 * Envia um deal para o Omie gerando:
 *   - 1 OC  por grupo de fornecedor
 *   - 1 OV  por cliente (itens HW dos grupos que ele recebe)
 *   - 1 OS  por cliente × natureza (SW | LC | ST | SRV)
 *
 * Body:
 *   { dealId: number }
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { type NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { addOmieRawLog } from '@/lib/unified-log-service'
import { BitrixService } from '@/lib/bitrix-service'
import {
  paymentConditionMatches,
  resolveDefaultOmiePaymentCode,
  resolveOmiePaymentCode,
  tryParseOmiePaymentCode,
  type PaymentConditionKind,
} from '@/lib/payment-condition-utils'

// ─── Endpoints Omie ───────────────────────────────────────────────────────────
const OMIE_URL = {
  CLIENTES:       'https://app.omie.com.br/api/v1/geral/clientes/',
  FORNECEDORES:   'https://app.omie.com.br/api/v1/geral/fornecedores/',
  PRODUTOS:       'https://app.omie.com.br/api/v1/geral/produtos/',
  PEDIDOS_VENDA:  'https://app.omie.com.br/api/v1/produtos/pedido/',
  PEDIDOS_COMPRA: 'https://app.omie.com.br/api/v1/produtos/pedidocompra/',
  ORDEM_SERVICO:  'https://app.omie.com.br/api/v1/servicos/os/',
  SERVICOS:       'https://app.omie.com.br/api/v1/servicos/servico/',
}

const CC_BARUERI  = '1807556622'
const CC_ES       = '5097263320'
const CNPJ_ES     = '03969530000211'
const CNPJ_BARUERI = '03969530000130'

const BITRIX_BASE = 'https://interatell.bitrix24.com.br'
const BITRIX_ENTITY_TYPE_ID = 129

function dealLink(bitrixDealId: unknown): string {
  const id = String(bitrixDealId ?? '').trim()
  if (!id) return ''
  return `${BITRIX_BASE}/crm/type/${BITRIX_ENTITY_TYPE_ID}/details/${id}/`
}

/** Prefixa a observação interna com o link do negócio (sem duplicar se já estiver lá). */
function withDealLink(interna: string, bitrixDealId: unknown): string {
  const link = dealLink(bitrixDealId)
  if (!link) return interna
  if (interna.includes(link)) return interna
  return [`Negócio: ${link}`, interna].filter(Boolean).join('\n')
}

function getBranchCnpj(branch: string | undefined, fallbackCnpj: string): string {
  if (branch === 'es') return CNPJ_ES
  if (branch === 'barueri') return CNPJ_BARUERI
  return fallbackCnpj || CNPJ_BARUERI
}

type Natureza = 'HW' | 'SW' | 'LC' | 'ST' | 'SRV'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const digits = (v: any) => String(v ?? '').replace(/\D/g, '')

async function resolvePaymentCodeForOmie(raw: string, kind: PaymentConditionKind): Promise<string> {
  const value = String(raw ?? '').trim()
  if (!value) throw new Error('Condição de pagamento não informada.')

  const direct = tryParseOmiePaymentCode(value)
  if (direct) return direct

  const fromDefault = resolveDefaultOmiePaymentCode(value, kind)
  if (fromDefault) return fromDefault

  const listId = process.env.BITRIX_LIST_PAYMENT_ID
  if (listId) {
    try {
      const tipoFilter = kind === 'purchase' ? 'compra' : 'venda'
      const all = await BitrixService.getPaymentConditions(Number(listId), tipoFilter)
      for (const item of all) {
        if (item.code && paymentConditionMatches(raw, item.name, item.code)) {
          return item.code.toUpperCase()
        }
      }
    } catch {
      /* fallback para tabela padrão / erro acima */
    }
  }

  return resolveOmiePaymentCode(raw, kind)
}

function omieFaultMessage(res: any): string | null {
  if (!res?.faultstring) return null
  return String(res.faultstring)
}

function assertNoOmieErrors(results: any[], label: string): void {
  const faults = results
    .map(r => omieFaultMessage(r))
    .filter(Boolean) as string[]
  if (faults.length) {
    throw new Error(`${label}: ${faults.join(' | ')}`)
  }
}

function toOmieDate(input: any): string {
  const today = () => { const dt = new Date(); return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}` }
  if (!input) return today()
  let s = String(input).split('T')[0].split(' ')[0].trim()
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y,m,d]=s.split('-'); return `${d}/${m}/${y}` }
  return today()
}

function normalizeNatureza(raw: any): Natureza {
  const s = String(raw ?? '').toUpperCase().trim()
  if (['HW','HARDWARE'].includes(s)) return 'HW'
  if (['SW','SOFTWARE'].includes(s)) return 'SW'
  if (['LC','LICENSE','LICENCA'].includes(s)) return 'LC'
  if (['ST','SERV_TER','TERCEIRO'].includes(s)) return 'ST'
  if (['SRV','SERV','SERVICO'].includes(s)) return 'SRV'
  return 'HW'
}

function normalizeNCM(ncm: any): string {
  const d = String(ncm ?? '').replace(/\D/g, '')
  return d.length === 8 ? d : String(ncm ?? '')
}

function getCredentials(interatellCnpj: string) {
  return digits(interatellCnpj) === digits(CNPJ_ES)
    ? { app_key: process.env.OMIE_APP_KEY_2!, app_secret: process.env.OMIE_APP_SECRET_2! }
    : { app_key: process.env.OMIE_APP_KEY_1!, app_secret: process.env.OMIE_APP_SECRET_1! }
}

function contaCorrente(interatellCnpj: string) {
  return digits(interatellCnpj) === digits(CNPJ_ES) ? CC_ES : CC_BARUERI
}

/** Formata número de pedido Omie — API retorna com zeros à esquerda (ex: 000002601020200). */
function omiePedidoNumero(raw: unknown, fallback = '?'): string {
  const s = String(raw ?? '').trim()
  if (!s) return fallback
  const d = s.replace(/\D/g, '')
  if (!d) return s
  return d.replace(/^0+/, '') || d
}

function omiePedidoNumeroPadded(raw: unknown, fallback = '?'): string {
  const s = String(raw ?? '').trim()
  if (!s) return fallback
  const d = s.replace(/\D/g, '')
  if (!d) return s
  return d.length >= 15 ? d : d.padStart(15, '0')
}

function ovResultMeta(res: any, found: { cab: any; intCode: string } | null, baseCode: string) {
  const rawNum = res?.numero_pedido ?? found?.cab?.numero_pedido
  return {
    _numero: omiePedidoNumeroPadded(rawNum, baseCode),
    _numeroCurto: omiePedidoNumero(rawNum, baseCode),
    _codigoPedido: res?.codigo_pedido ?? found?.cab?.codigo_pedido,
    _intCode: found?.intCode ?? baseCode,
  }
}

// ─── Chamada Omie ─────────────────────────────────────────────────────────────
async function omieCall(interatellCnpj: string, url: string, call: string, param: object, dealId: number, step: string) {
  const { app_key, app_secret } = getCredentials(interatellCnpj)
  const body = { call, app_key, app_secret, param: [param] }

  console.log(`[Omie][deal=${dealId}][${step}] → ${call}`, JSON.stringify(param))

  await addOmieRawLog({ transactionId: dealId, step: step as any, level: 'info', message: `${step}: ${call}`, runId: ctx().runId,
    raw: { endpoint: url, httpStatus: 0, requestBodyRaw: JSON.stringify(body), responseBodyRaw: '' } }).catch(() => {})

  await new Promise(r => setTimeout(r, Number(process.env.OMIE_SLEEP_MS ?? 260)))

  let httpStatus = 0, responseText = ''
  try {
    const resp = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), cache: 'no-store' })
    httpStatus = resp.status
    responseText = await resp.text()
    const data = responseText ? JSON.parse(responseText) : null

    // Passos de verificação (check*) retornam 500 com "não cadastrado" quando o pedido
    // simplesmente ainda não existe — isso é esperado e não é um erro de fato.
    const isCheckStep = step.startsWith('check')
    const isNotFound = typeof data?.faultstring === 'string' &&
      /não cadastrado|nao cadastrado|not found/i.test(data.faultstring)
    const level: 'success' | 'info' | 'error' =
      httpStatus >= 200 && httpStatus < 300 ? 'success'
      : (isCheckStep && isNotFound) ? 'info'
      : 'error'

    if (level === 'error') {
      console.error(`[Omie][deal=${dealId}][${step}] ← HTTP ${httpStatus}`, responseText.slice(0, 1000))
    } else {
      console.log(`[Omie][deal=${dealId}][${step}] ← HTTP ${httpStatus}`, responseText.slice(0, 500))
    }

    await addOmieRawLog({ transactionId: dealId, step: step as any, level, message: `${step}: HTTP ${httpStatus}`, runId: ctx().runId,
      raw: { endpoint: url, httpStatus, requestBodyRaw: JSON.stringify(body), responseBodyRaw: responseText } }).catch(() => {})
    return data
  } catch (err: any) {
    console.error(`[Omie][deal=${dealId}][${step}] ✗ Erro de rede: ${err?.message}`)
    await addOmieRawLog({ transactionId: dealId, step: step as any, level: 'error', message: `${step}: ${err?.message}`, runId: ctx().runId,
      raw: { endpoint: url, httpStatus, requestBodyRaw: JSON.stringify(body), responseBodyRaw: responseText } }).catch(() => {})
    return { faultstring: err?.message, faultcode: 'NETWORK_ERROR' }
  }
}

// ─── Contexto por requisição ──────────────────────────────────────────────────
// Caches e runId ficam em AsyncLocalStorage para que envios simultâneos não
// compartilhem estado (antes eram variáveis de módulo, sujeitas a race condition).
type ServicoInfo = { nCodServ?: number; cCodServLC116: string; cCodServMun: string; cIdTrib: string } | null
type RunCtx = {
  runId: string | null
  clienteCache: Map<string, number>
  fornecedorCache: Map<string, number>
  produtoCache: Map<string, number | undefined>
  servicoCache: Map<string, ServicoInfo>
}
const runStore = new AsyncLocalStorage<RunCtx>()
const newRunCtx = (runId: string | null): RunCtx => ({
  runId,
  clienteCache: new Map(),
  fornecedorCache: new Map(),
  produtoCache: new Map(),
  servicoCache: new Map(),
})
const ctx = (): RunCtx => runStore.getStore() ?? newRunCtx(null)

async function ensureCliente(interatellCnpj: string, company: any, dealId: number): Promise<number> {
  const cnpj = digits(company?.cnpj ?? '')
  const key  = `${digits(interatellCnpj)}:${cnpj}`
  const cache = ctx().clienteCache
  if (cache.has(key)) return cache.get(key)!

  const check = await omieCall(interatellCnpj, OMIE_URL.CLIENTES, 'ListarClientes',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N', clientesFiltro: { cnpj_cpf: cnpj } },
    dealId, 'checkCliente')

  let codigo: number
  if (check?.clientes_cadastro?.length) {
    codigo = check.clientes_cadastro[0].codigo_cliente_omie
  } else {
    const created = await omieCall(interatellCnpj, OMIE_URL.CLIENTES, 'IncluirCliente', {
      cnpj_cpf: cnpj, razao_social: company.name, nome_fantasia: company.name,
      email: company.email ?? '', endereco: company.address ?? '',
      endereco_numero: company.number ?? 'S/N', bairro: company.neighborhood ?? '',
      cidade: company.city ?? '', estado: company.state ?? '',
      cep: digits(company.zipCode ?? ''),
      telefone1_ddd: digits(company.phone ?? '').slice(0,2),
      telefone1_numero: digits(company.phone ?? '').slice(2),
      pessoa_fisica: cnpj.length === 11 ? 'S' : 'N',
      dadosBancarios: { codigo_banco: '001', agencia: '0000000001', conta_corrente: '0000000001' },
    }, dealId, 'createCliente')
    codigo = Number(created?.codigo_cliente_omie)
    if (!codigo) {
      throw new Error(`Cliente "${company?.name ?? cnpj}": ${created?.faultstring ?? 'não foi possível cadastrar no Omie.'}`)
    }
  }
  cache.set(key, codigo)
  return codigo
}

async function ensureFornecedor(interatellCnpj: string, supplier: any, dealId: number): Promise<number> {
  const cnpj = digits(supplier?.cnpj ?? '')
  const key  = `${digits(interatellCnpj)}:${cnpj}`
  const cache = ctx().fornecedorCache
  if (cache.has(key)) return cache.get(key)!

  // Fornecedores são registrados como clientes no Omie (conta sem módulo Compras)
  const check = await omieCall(interatellCnpj, OMIE_URL.CLIENTES, 'ListarClientes',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N',
      clientesFiltro: { cnpj_cpf: cnpj } },
    dealId, 'checkFornecedor')

  let codigo: number
  if (check?.clientes_cadastro?.length) {
    codigo = check.clientes_cadastro[0].codigo_cliente_omie
  } else {
    const created = await omieCall(interatellCnpj, OMIE_URL.CLIENTES, 'IncluirCliente', {
      cnpj_cpf: cnpj, razao_social: supplier.name, nome_fantasia: supplier.name,
      email: supplier.email ?? '', endereco: supplier.address ?? '',
      endereco_numero: supplier.number ?? 'S/N', bairro: supplier.neighborhood ?? '',
      cidade: supplier.city ?? '', estado: supplier.state ?? '',
      cep: digits(supplier.zipCode ?? ''),
      telefone1_ddd: digits(supplier.phone ?? '').slice(0, 2),
      telefone1_numero: digits(supplier.phone ?? '').slice(2),
      pessoa_fisica: cnpj.length === 11 ? 'S' : 'N',
      dadosBancarios: { codigo_banco: '001', agencia: '0000000001', conta_corrente: '0000000001' },
    }, dealId, 'createFornecedor')
    codigo = Number(created?.codigo_cliente_omie)
    if (!codigo) {
      throw new Error(`Fornecedor "${supplier?.name ?? cnpj}": ${created?.faultstring ?? 'não foi possível cadastrar no Omie.'}`)
    }
  }
  cache.set(key, codigo)
  return codigo
}

async function ensureProduto(interatellCnpj: string, item: any, dealId: number): Promise<number | undefined> {
  if (normalizeNatureza(item.nature) === 'SRV') return undefined
  const sku = String(item.partnumber ?? '')
  const key = `${digits(interatellCnpj)}:${sku}`
  const cache = ctx().produtoCache
  if (cache.has(key)) return cache.get(key)

  const check = await omieCall(interatellCnpj, OMIE_URL.PRODUTOS, 'ConsultarProduto', { codigo: sku }, dealId, 'checkProduto')
  let cod: number | undefined
  if (check?.codigo_produto) {
    cod = check.codigo_produto
  } else {
    // Garante NCM: usa o do deal; se vazio, busca no banco local pelo partnumber
    let ncm = normalizeNCM(item.ncm)
    if (!ncm || ncm.length < 8) {
      const [local] = await sql`SELECT ncm, cfop, family FROM products WHERE partnumber = ${sku} LIMIT 1`
      if (local?.ncm) ncm = normalizeNCM(local.ncm)
      if (!item.cfop && local?.cfop) item.cfop = local.cfop
      if (!item.family && local?.family) item.family = local.family
    }

    const created = await omieCall(interatellCnpj, OMIE_URL.PRODUTOS, 'IncluirProduto', {
      codigo: sku, descricao: item.description, unidade: 'UN',
      ncm, cfop: item.cfop ?? '',
      codigo_produto_integracao: sku,
      codigo_familia: item.family || '',
    }, dealId, 'createProdutoResult')
    cod = created?.codigo_produto
    if (!cod) {
      throw new Error(`Produto "${sku}": ${created?.faultstring ?? 'não foi possível cadastrar no Omie.'}`)
    }
  }
  cache.set(key, cod)
  return cod
}

/** Resolve um serviço cadastrado no Omie (cCodigo → código interno + dados fiscais). */
async function ensureServico(interatellCnpj: string, codigo: string, dealId: number): Promise<ServicoInfo> {
  const key = `${digits(interatellCnpj)}:${codigo}`
  const cache = ctx().servicoCache
  if (cache.has(key)) return cache.get(key)!

  const res = await omieCall(interatellCnpj, OMIE_URL.SERVICOS, 'ListarCadastroServico',
    { cCodigo: codigo, nPagina: 1, nRegPorPagina: 20 }, dealId, 'checkServico')

  let info: ServicoInfo = null
  const cad = res?.cadastros?.find((c: any) => c?.cabecalho?.cCodigo === codigo) ?? res?.cadastros?.[0]
  if (cad?.cabecalho) {
    info = {
      nCodServ: Number(cad.intListar?.nCodServ ?? 0) || undefined,
      cCodServLC116: String(cad.cabecalho.cCodLC116 ?? ''),
      cCodServMun: String(cad.cabecalho.cCodServMun ?? ''),
      cIdTrib: String(cad.cabecalho.cIdTrib ?? ''),
    }
  }
  cache.set(key, info)
  return info
}

// Build list of integration codes to lookup (base first, then retry variants)
function integrationLookupCodes(baseCode: string, retryCount: number): string[] {
  const codes = [baseCode]
  for (let r = 1; r <= retryCount; r++) codes.push(`${baseCode}-R${r}`)
  return [...new Set(codes)]
}

function parseOCConsultResponse(existing: any, intCode: string) {
  if (!existing || existing.faultstring) return null
  const wrapped = Array.isArray(existing.pedidos_pesquisa)
    ? existing.pedidos_pesquisa[0]
    : undefined
  const cab = existing.cabecalho_consulta
    ?? existing.cabecalho
    ?? wrapped?.cabecalho_consulta
  const nCodPed = cab?.nCodPed ?? existing.nCodPed
  if (!nCodPed) return null
  return {
    cab: { ...cab, nCodPed },
    intCode: cab?.cCodIntPed ?? intCode,
  }
}

async function findExistingOC(interatellCnpj: string, dealId: number, baseCode: string, retryCount: number) {
  for (const cCodIntPed of integrationLookupCodes(baseCode, retryCount)) {
    const existing = await omieCall(interatellCnpj, OMIE_URL.PEDIDOS_COMPRA, 'ConsultarPedCompra',
      { cCodIntPed }, dealId, 'checkOC')
    const parsed = parseOCConsultResponse(existing, cCodIntPed)
    if (parsed) return parsed
  }
  return null
}

async function findExistingOV(interatellCnpj: string, dealId: number, baseCode: string, retryCount: number) {
  for (const codigo_pedido_integracao of integrationLookupCodes(baseCode, retryCount)) {
    const existing = await omieCall(interatellCnpj, OMIE_URL.PEDIDOS_VENDA, 'ConsultarPedido',
      { codigo_pedido_integracao }, dealId, 'checkOV')
    const pvp = existing?.pedido_venda_produto
    const cab = pvp?.cabecalho
    if (cab?.codigo_pedido && !existing?.faultstring) {
      return { cab, intCode: codigo_pedido_integracao, det: pvp?.det ?? [] }
    }
  }
  return null
}

async function findExistingOS(interatellCnpj: string, dealId: number, baseCode: string, retryCount: number) {
  for (const cCodIntOS of integrationLookupCodes(baseCode, retryCount)) {
    const existing = await omieCall(interatellCnpj, OMIE_URL.ORDEM_SERVICO, 'ConsultarOS',
      { cCodIntOS }, dealId, 'checkOS')
    const cab = existing?.Cabecalho ?? existing?.cabecalho
    if (cab?.nCodOS && !existing?.faultstring) {
      const puRaw = existing?.produtosUtilizados ?? existing?.ProdutosUtilizados ?? existing?.produtos_utilizados
      const produtosUtilizados = (puRaw?.produtoUtilizado ?? puRaw?.ProdutoUtilizado ?? (Array.isArray(puRaw) ? puRaw : [])) as any[]
      return {
        cab,
        intCode: cCodIntOS,
        servicos: (existing?.ServicosPrestados ?? existing?.servicosPrestados ?? []) as any[],
        produtosUtilizados,
      }
    }
  }
  return null
}

// ─── Upsert OC (busca pelo código de integração → atualiza ou cria) ──────────
async function upsertOC(
  interatellCnpj: string, codDistribuidor: number, items: any[], business: any,
  obs: { externa: string; interna: string },
  dealId: number, groupIdx: number, opts: { isUpdate: boolean; retryCount: number },
  codParc: string,
) {
  const ocItems = items.filter(i => normalizeNatureza(i.nature) !== 'SRV')
  if (!ocItems.length || !codDistribuidor) return null
  const baseCode = `OC-${dealId}-G${groupIdx}`
  const createCode = opts.isUpdate ? baseCode : `${baseCode}${opts.retryCount > 0 ? `-R${opts.retryCount}` : ''}`

  const produtosUpsert = ocItems.map((e, i) => ({
    cCodIntItem: String(i + 1),
    ...(e.codigoProdutoOmie
      ? { nCodProd: e.codigoProdutoOmie }
      : { cCodIntProd: String(e.partnumber ?? '') }),
    cDescricao: e.description,
    cNCM: normalizeNatureza(e.nature) === 'HW' ? normalizeNCM(e.ncm) : '00000000',
    cUnidade: 'UN', nQtde: Number(e.quantity ?? 1),
    nValUnit: Number(e.unitCost ?? 0), nPesoLiq: 0, nPesoBruto: 0,
  }))

  const lookupRetry = opts.isUpdate ? Math.max(opts.retryCount, 5) : opts.retryCount
  const found = await findExistingOC(interatellCnpj, dealId, baseCode, lookupRetry)
  const intCode = found?.intCode ?? (opts.isUpdate ? baseCode : createCode)

  const res = await omieCall(interatellCnpj, OMIE_URL.PEDIDOS_COMPRA, 'UpsertPedCompra', {
    cabecalho_upsert: {
      cCodIntPed: intCode,
      nCodFor: codDistribuidor,
      cCodParc: codParc,
      dDtPrevisao: toOmieDate(business?.deliveryDeadline),
      // cObs = observação do pedido; cObsInt = observação interna (só quem consulta vê).
      cObs: obs.externa,
      cObsInt: obs.interna,
    },
    produtos_upsert: produtosUpsert,
  }, dealId, 'createOCResult')

  const action = found || opts.isUpdate ? 'updated' : 'created'
  return {
    ...res,
    _action: action,
    _numero: res?.cNumero ?? res?.nCodPed ?? found?.cab?.cNumero ?? found?.cab?.nCodPed ?? intCode,
    _codigo: res?.nCodPed ?? found?.cab?.nCodPed,
  }
}

// ─── Upsert OV (busca pelo código de integração → atualiza ou cria) ──────────
async function upsertOV(
  interatellCnpj: string, codCliente: number, items: any[], business: any,
  obs: { externa: string; interna: string },
  dealId: number, customerIdx: number, opts: { isUpdate: boolean; retryCount: number },
  codParc: string,
) {
  const hwItems = items.filter(i => normalizeNatureza(i.nature) === 'HW' && normalizeNCM(i.ncm) !== '00000000')
  if (!hwItems.length || !codCliente) return null
  // obs_venda NÃO sai na Nota Fiscal → recebe a interna (com o link do negócio).
  // A externa vai em informacoes_adicionais.dados_adicionais_nf, que sai na NF
  // (o Omie usa pipe "|" como separador de linha nesse campo).
  const obsVenda = obs.interna
  const dadosAdicNF = obs.externa.replace(/\r?\n/g, '|')
  const baseCode = `OV-${dealId}-C${customerIdx}`
  const createCode = opts.isUpdate ? baseCode : `${baseCode}${opts.retryCount > 0 ? `-R${opts.retryCount}` : ''}`

  const buildDet = (existingLines: any[] = []) => hwItems.map((e, i) => {
    const intItem = String(i + 1)
    const existingLine = existingLines.find((d: any) => d.ide?.codigo_item_integracao === intItem)
      ?? existingLines[i]
    return {
      ide: {
        codigo_item_integracao: intItem,
        ...(existingLine?.ide?.codigo_item ? { codigo_item: existingLine.ide.codigo_item } : {}),
      },
      produto: {
        ...(e.codigoProdutoOmie
          ? { codigo_produto: e.codigoProdutoOmie }
          : { codigo_produto_integracao: String(e.partnumber ?? '') }),
        cfop: e.cfop ?? '', ncm: normalizeNCM(e.ncm), descricao: e.description,
        quantidade: Number(e.quantity ?? 1), unidade: 'UN',
        valor_unitario: Number(e.unitSale ?? 0), tipo_desconto: 'V', valor_desconto: 0,
      },
    }
  })

  const cabecalhoCreate = {
    codigo_cliente: codCliente, codigo_pedido_integracao: createCode,
    data_previsao: toOmieDate(business?.deliveryDeadline ?? business?.expectedBillingDate),
    etapa: '10', numero_pedido: createCode,
    codigo_parcela: codParc,
    quantidade_itens: hwItems.length,
  }
  const informacoes_adicionais = {
    codigo_categoria: '1.01.03', codigo_conta_corrente: contaCorrente(interatellCnpj),
    consumidor_final: 'S', enviar_email: 'N', numero_pedido_cliente: createCode,
    ...(dadosAdicNF ? { dados_adicionais_nf: dadosAdicNF } : {}),
  }

  const lookupRetry = opts.isUpdate ? Math.max(opts.retryCount, 5) : opts.retryCount
  const found = await findExistingOV(interatellCnpj, dealId, baseCode, lookupRetry)
  if (found) {
    const res = await omieCall(interatellCnpj, OMIE_URL.PEDIDOS_VENDA, 'AlterarPedidoVenda', {
      cabecalho: {
        codigo_cliente: codCliente,
        codigo_pedido_integracao: found.intCode,
        codigo_pedido: found.cab.codigo_pedido,
        data_previsao: toOmieDate(business?.deliveryDeadline ?? business?.expectedBillingDate),
        etapa: '10',
        codigo_parcela: codParc,
        quantidade_itens: hwItems.length,
      },
      informacoes_adicionais,
      observacoes: { obs_venda: obsVenda },
      det: buildDet(found.det),
    }, dealId, 'createOVResult')
    return { ...res, _action: 'updated', ...ovResultMeta(res, found, baseCode) }
  }

  const res = await omieCall(interatellCnpj, OMIE_URL.PEDIDOS_VENDA, 'IncluirPedido', {
    cabecalho: cabecalhoCreate, informacoes_adicionais,
    observacoes: { obs_venda: obsVenda },
    det: buildDet(),
  }, dealId, 'createOVResult')

  if (res?.faultstring && /j[aá] cadastrado|already registered/i.test(String(res.faultstring))) {
    const retryFound = await findExistingOV(interatellCnpj, dealId, baseCode, Math.max(opts.retryCount, 5))
    if (retryFound) {
      const retryRes = await omieCall(interatellCnpj, OMIE_URL.PEDIDOS_VENDA, 'AlterarPedidoVenda', {
        cabecalho: {
          codigo_cliente: codCliente,
          codigo_pedido_integracao: retryFound.intCode,
          codigo_pedido: retryFound.cab.codigo_pedido,
          data_previsao: toOmieDate(business?.deliveryDeadline ?? business?.expectedBillingDate),
          etapa: '10',
          codigo_parcela: codParc,
          quantidade_itens: hwItems.length,
        },
        informacoes_adicionais,
        observacoes: { obs_venda: obsVenda },
        det: buildDet(retryFound.det),
      }, dealId, 'createOVResult')
      return { ...retryRes, _action: 'updated', ...ovResultMeta(retryRes, retryFound, baseCode) }
    }
  }

  return {
    ...res,
    _action: 'created',
    ...ovResultMeta(res, null, baseCode),
    _codigoPedido: res?.codigo_pedido,
  }
}

/**
 * O Omie exige a cidade da prestação de serviço (cCidPrestServ) no formato do
 * cadastro de municípios: "Nome (UF)", ex.: "Campos dos Goytacazes (RJ)". Se a
 * cidade vier sem a UF, o Omie rejeita a OS com "Cidade não cadastrada".
 * Anexa a UF do cliente quando a cidade ainda não tem o sufixo "(XX)".
 */
function cidadePrestServ(city: unknown, state: unknown): string {
  const nome = String(city ?? '').trim()
  if (!nome) return ''
  if (/\([A-Za-z]{2}\)\s*$/.test(nome)) return nome // já tem "(UF)"
  const uf = String(state ?? '').trim().toUpperCase().slice(0, 2)
  return uf.length === 2 ? `${nome} (${uf})` : nome
}

// ─── Upsert OS (busca pelo código de integração → atualiza ou cria) ──────────
async function upsertOS(
  interatellCnpj: string, codCliente: number, cliente: any, items: any[], nat: Natureza,
  business: any, obs: { externa: string; interna: string },
  dealId: number, customerIdx: number, opts: { isUpdate: boolean; retryCount: number },
  codParc: string,
) {
  if (!items.length || !codCliente) return null
  const SERVICO_MAP: Record<Natureza, string> = { SW:'SRV00007', LC:'SRV00007', ST:'SRV00016', SRV:'SRV00001', HW:'' }
  // cObsOS é a observação interna da OS; a externa vai em cDadosAdicNF (sai na NF).
  const obsOS = obs.interna
  const baseCode = `OS-${dealId}-C${customerIdx}-${nat}`
  const createCode = opts.isUpdate ? baseCode : `${baseCode}${opts.retryCount > 0 ? `-R${opts.retryCount}` : ''}`

  const Cabecalho = {
    cCodIntOS: createCode, nCodCli: codCliente, cEtapa: '20',
    dDtPrevisao: toOmieDate(business?.deliveryDeadline ?? business?.expectedBillingDate),
    cCodParc: codParc, nQtdeParc: 1,
  }
  const InformacoesAdicionais = {
    cCidPrestServ: cidadePrestServ(cliente?.city, cliente?.state), cCodCateg: '1.01.02',
    cNumPedido: createCode, nCodCC: contaCorrente(interatellCnpj),
    cDadosAdicNF: obs.externa,
  }

  // Resolve o serviço no cadastro do Omie (código interno numérico + dados fiscais).
  // Sem isso o Omie rejeita o item (cTribServ/cCodServMun/cCodServLC116 são
  // obrigatórios quando nCodServico não é o código interno).
  const buildServicos = async (existingLines: any[] = []) => {
    const out: Record<string, unknown>[] = []
    for (let i = 0; i < items.length; i++) {
      const e = items[i]
      const codigoServ = SERVICO_MAP[nat] || String(e.partnumber ?? '')
      const info = codigoServ ? await ensureServico(interatellCnpj, codigoServ, dealId) : null
      const existing = existingLines[i]
      out.push({
        ...(info?.nCodServ ? { nCodServico: info.nCodServ } : { nCodServico: codigoServ }),
        ...(info ? { cCodServLC116: info.cCodServLC116, cCodServMun: info.cCodServMun } : {}),
        cDescServ: e.description, cDadosAdicItem: e.description,
        nQtde: Number(e.quantity ?? 1), nValUnit: Number(e.unitSale ?? 0),
        cRetemISS: 'N', cTribServ: info?.cIdTrib || '01',
        // AlterarOS exige nSeqItem para identificar o item existente
        ...(existing ? { nSeqItem: Number(existing.nSeqItem ?? i + 1), nIdItem: existing.nIdItem, cAcaoItem: 'A' } : {}),
      })
    }
    return out
  }
  // Como o código de referência: amarra o produto de revenda (SW/LC/ST) na OS via
  // "Produtos Utilizados" (dá baixa de estoque — cAcaoProdUtilizados "EST"). Só entra
  // item com produto resolvido (codigoProdutoOmie); SRV (serviço próprio, sem produto
  // comprado) não amarra nada.
  const produtoUtilizado = items
    .filter((e: any) => e.codigoProdutoOmie)
    .map((e: any) => ({ cAcaoItemPU: 'I', nCodProdutoPU: Number(e.codigoProdutoOmie), nQtdePU: Number(e.quantity ?? 1) }))
  const produtosUtilizados = { cAcaoProdUtilizados: 'EST', cCodCategRem: '', produtoUtilizado }

  const lookupRetry = opts.isUpdate ? Math.max(opts.retryCount, 5) : opts.retryCount
  const found = await findExistingOS(interatellCnpj, dealId, baseCode, lookupRetry)
  if (found) {
    // Idempotente: na atualização só INCLUI o produto que a OS ainda não tem, evitando
    // baixa de estoque em duplicidade a cada reenvio. Produtos já presentes ficam intactos.
    const jaPresentes = new Set(
      (found.produtosUtilizados ?? [])
        .map((p: any) => Number(p.nCodProdutoPU ?? p.nCodProduto ?? p.codigo_produto ?? 0))
        .filter(Boolean),
    )
    const produtoUtilizadoNovo = produtoUtilizado.filter(p => !jaPresentes.has(Number(p.nCodProdutoPU)))
    const produtosUtilizadosUpdate = { cAcaoProdUtilizados: 'EST', cCodCategRem: '', produtoUtilizado: produtoUtilizadoNovo }
    const res = await omieCall(interatellCnpj, OMIE_URL.ORDEM_SERVICO, 'AlterarOS', {
      Cabecalho: { ...Cabecalho, cCodIntOS: found.intCode, nCodOS: found.cab.nCodOS },
      InformacoesAdicionais,
      Observacoes: { cObsOS: obsOS },
      Departamentos: [],
      ServicosPrestados: await buildServicos(found.servicos),
      produtosUtilizados: produtosUtilizadosUpdate,
    }, dealId, 'createOSResult')
    return { ...res, _action: 'updated', _numero: found.cab.cNumOS ?? found.cab.nCodOS, _codigo: found.cab.nCodOS }
  }

  const res = await omieCall(interatellCnpj, OMIE_URL.ORDEM_SERVICO, 'IncluirOS', {
    Cabecalho, InformacoesAdicionais,
    Observacoes: { cObsOS: obsOS },
    Departamentos: [],
    ServicosPrestados: await buildServicos(),
    produtosUtilizados,
  }, dealId, 'createOSResult')
  return { ...res, _action: 'created', _numero: res?.cNumOS ?? res?.nCodOS, _codigo: res?.nCodOS }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let dealId = 0
  try {
    const body = await request.json()
    dealId = Number(body.dealId)
    const runId = body.runId ? String(body.runId) : null
    if (!dealId) return NextResponse.json({ success: false, error: 'dealId é obrigatório' }, { status: 400 })

    if (!process.env.OMIE_APP_KEY_1 || !process.env.OMIE_APP_SECRET_1) {
      return NextResponse.json({ success: false, error: 'Credenciais Omie não configuradas.' }, { status: 500 })
    }

    // Todo o processamento roda dentro de um contexto isolado por requisição
    return await runStore.run(newRunCtx(runId), () => processDeal(body, dealId))
  } catch (err: any) {
    console.error('omie/send error:', err)
    await addOmieRawLog({
      transactionId: dealId, step: 'result', level: 'error', runId: ctx().runId,
      message: `result: Erro — ${err?.message ?? 'Erro inesperado'}`,
      raw: { endpoint: '', httpStatus: 500, requestBodyRaw: '', responseBodyRaw: err?.message ?? '' },
    }).catch(() => {})
    if (dealId) await sql`UPDATE deals SET status = 'failed', error_message = ${err?.message ?? String(err)}, updated_at = NOW() WHERE id = ${dealId}`.catch(() => {})
    return NextResponse.json({ success: false, error: err?.message ?? 'Erro inesperado' }, { status: 500 })
  }
}

async function processDeal(body: any, dealId: number) {
  try {
    console.log(`[Omie] Iniciando envio do deal=${dealId}${body.update ? ' (atualização)' : ''}`)

    // Carregar deal do banco
    const [deal] = await sql`SELECT * FROM deals WHERE id = ${dealId}`
    if (!deal) return NextResponse.json({ success: false, error: 'Deal não encontrado' }, { status: 404 })

    const payload = typeof deal.payload === 'string' ? JSON.parse(deal.payload) : deal.payload
    const { interatell, supplierGroups = [], customers = [], serviceCustomers = [], business, notes } = payload
    // A observação interna sempre carrega o link do negócio no Bitrix, para quem
    // consultar o pedido no Omie conseguir voltar ao card de origem.
    const obs = {
      externa: String(notes?.externalNotes ?? '').trim(),
      interna: withDealLink(String(notes?.internalNotes ?? '').trim(), deal.bitrix_deal_id),
    }
    const retryCount: number = payload._retryCount ?? 0
    const isUpdate = body.update === true || deal.status === 'sent'
    const alteracoes = Array.isArray(body.changes) ? body.changes : []
    const upsertOpts = { isUpdate, retryCount: isUpdate ? 0 : retryCount }
    // fallbackCnpj: backward compat for old payloads that stored a single interatell.cnpj
    const fallbackCnpj = digits(interatell?.cnpj ?? '')

    // Resolve códigos Omie (aceita "A28", "A28 - Para 28 Dias" ou só "Para 28 Dias")
    const purchaseCodParc = await resolvePaymentCodeForOmie(business?.purchasePaymentCondition ?? '', 'purchase')
    const saleCodParc = await resolvePaymentCodeForOmie(business?.salePaymentCondition ?? '', 'sale')

    // 1a) Garantir FORNECEDORES no Omie — usa credenciais da filial do grupo
    for (const group of supplierGroups) {
      const branchCnpj = getBranchCnpj(group.branch, fallbackCnpj)
      await ensureFornecedor(branchCnpj, group.supplier, dealId)
    }

    // 1b) Garantir CLIENTES no Omie — usa credenciais da filial do cliente
    for (const entry of customers) {
      const branchCnpj = getBranchCnpj(entry.branch, fallbackCnpj)
      await ensureCliente(branchCnpj, entry.customer, dealId)
    }

    // 1c) Clientes de serviço Interatell (SRV) — não passam por fornecedor,
    // mas também precisam existir no Omie da filial que vai faturar.
    for (const entry of serviceCustomers) {
      const branchCnpj = getBranchCnpj(entry.branch, fallbackCnpj)
      await ensureCliente(branchCnpj, entry.customer, dealId)
    }

    // 2) Garantir produtos no Omie (por grupo de fornecedor, na filial correta)
    for (const group of supplierGroups) {
      const branchCnpj = getBranchCnpj(group.branch, fallbackCnpj)
      for (const product of group.products ?? []) {
        product.codigoProdutoOmie = await ensureProduto(branchCnpj, product, dealId)
      }
    }

    // 3) OC: 1 por grupo de fornecedor
    const ocResults: any[] = []
    for (let gIdx = 0; gIdx < supplierGroups.length; gIdx++) {
      const group = supplierGroups[gIdx]
      const branchCnpj = getBranchCnpj(group.branch, fallbackCnpj)
      const codDistribuidor = ctx().fornecedorCache.get(`${branchCnpj}:${digits(group.supplier?.cnpj)}`)
      if (!codDistribuidor) continue
      const res = await upsertOC(branchCnpj, codDistribuidor, group.products ?? [], business, obs, dealId, gIdx, upsertOpts, purchaseCodParc)
      if (res) ocResults.push({ ...res, _supplier: group.supplier?.name })
    }

    // 4) OV + OS: 1 por cliente
    const ovResults: any[] = [], osResults: any[] = []
    for (let cIdx = 0; cIdx < customers.length; cIdx++) {
      const entry = customers[cIdx]
      const branchCnpj = getBranchCnpj(entry.branch, fallbackCnpj)
      const codCliente = ctx().clienteCache.get(`${branchCnpj}:${digits(entry.customer?.cnpj)}`)
      if (!codCliente) continue

      const allItems: any[] = (entry.productAllocations ?? [])
        .filter((alloc: any) => Number(alloc.quantity) > 0)
        .map((alloc: any) => {
          const group = supplierGroups.find((g: any) => g.localId === alloc.groupLocalId)
          if (!group) return null
          const product = group.products?.[alloc.productIndex]
          if (!product) return null
          // unitSale vem da alocação do cliente (preço de venda definido por cliente)
          return {
            ...product,
            quantity: Number(alloc.quantity),
            unitSale: Number(alloc.unitSale ?? 0),
          }
        })
        .filter(Boolean)

      const ov = await upsertOV(branchCnpj, codCliente, allItems, business, obs, dealId, cIdx, upsertOpts, saleCodParc)
      if (ov) ovResults.push({ ...ov, _customer: entry.customer?.name })

      for (const nat of ['SW','LC','ST','SRV'] as Natureza[]) {
        const natItems = allItems.filter(i => normalizeNatureza(i.nature) === nat)
        if (!natItems.length) continue
        const os = await upsertOS(branchCnpj, codCliente, entry.customer, natItems, nat, business, obs, dealId, cIdx, upsertOpts, saleCodParc)
        if (os) osResults.push({ ...os, _customer: entry.customer?.name, _nat: nat })
      }
    }

    // 4b) Serviço Interatell (SRV): sem fornecedor e sem OV — só OS, na filial do cliente.
    // O índice é deslocado por customers.length para não colidir com o código de
    // integração das OS dos clientes normais (OS-{deal}-C{idx}-{nat}).
    for (let sIdx = 0; sIdx < serviceCustomers.length; sIdx++) {
      const entry = serviceCustomers[sIdx]
      const items = (entry.items ?? []).filter((i: any) => String(i.description ?? '').trim())
      if (!items.length) continue

      const branchCnpj = getBranchCnpj(entry.branch, fallbackCnpj)
      const codCliente = ctx().clienteCache.get(`${branchCnpj}:${digits(entry.customer?.cnpj)}`)
      if (!codCliente) continue

      const os = await upsertOS(
        branchCnpj, codCliente, entry.customer, items, 'SRV',
        business, obs, dealId, customers.length + sIdx, upsertOpts, saleCodParc,
      )
      if (os) osResults.push({ ...os, _customer: entry.customer?.name, _nat: 'SRV', _interatellService: true })
    }

    // 5) Resumo com números dos pedidos
    const pickNumero = (r: any, intCode: string) =>
      r?.cNumero || r?.cNumPed || r?.nCodPed || r?.numero_pedido ||
      r?.cabecalho_consulta?.cNumero || r?.pedido_venda_produto?.cabecalho?.numero_pedido ||
      r?.cabecalho_alterar?.cNumero || r?.pedido_venda_produto_response?.cabecalho?.numero_pedido ||
      r?.Cabecalho?.cNumOS || r?.nCodOS || intCode || '?'

    assertNoOmieErrors(ocResults, 'OC')
    assertNoOmieErrors(ovResults, 'OV')
    assertNoOmieErrors(osResults, 'OS')

    const resumo = {
      oc: ocResults.map((r, i) => ({
        numero: r._numero ?? pickNumero(r, `OC-${dealId}-G${i}`),
        codigoIntegracao: `OC-${dealId}-G${i}`,
        codigoPedido: r._codigo ?? r?.nCodPed,
        acao: r._action ?? 'created',
        fornecedor: r._supplier,
        erro: omieFaultMessage(r) ?? undefined,
      })),
      ov: ovResults.map((r, i) => ({
        numero: r._numero ?? pickNumero(r, `OV-${dealId}-C${i}`),
        numeroCurto: r._numeroCurto,
        codigoIntegracao: r._intCode ?? `OV-${dealId}-C${i}`,
        codigoPedido: r._codigoPedido ?? r._codigo ?? r?.codigo_pedido,
        acao: r._action ?? 'created',
        cliente: r._customer,
        erro: omieFaultMessage(r) ?? undefined,
      })),
      os: osResults.map((r, i) => ({
        numero: r._numero ?? pickNumero(r, r.cCodIntOS || '?'),
        acao: r._action ?? 'created',
        cliente: r._customer,
        nat: r._nat,
        // Serviço próprio Interatell (não veio de fornecedor) — o PDF é separado.
        interatellService: r._interatellService ?? undefined,
        erro: omieFaultMessage(r) ?? undefined,
      })),
      alteracoes,
    }

    // 6) Log final de resultado — marca conclusão no modal de logs
    const verbo = (a: string) => (a === 'updated' ? 'atualizada' : 'criada')
    const resumoMsg = [
      isUpdate && alteracoes.length
        ? `${alteracoes.length} ${alteracoes.length === 1 ? 'alteração aplicada' : 'alterações aplicadas'}`
        : '',
      resumo.oc.length ? `OC: ${resumo.oc.map(x => `${x.numero} (${verbo(x.acao)})`).join(', ')}` : '',
      resumo.ov.length ? `OV: ${resumo.ov.map(x => `${x.numero} (${verbo(x.acao)})`).join(', ')}` : '',
      resumo.os.length ? `OS: ${resumo.os.map(x => `${x.numero}(${x.nat}, ${verbo(x.acao)})`).join(', ')}` : '',
    ].filter(Boolean).join(' | ')

    await addOmieRawLog({
      transactionId: dealId, step: 'result', level: 'success', runId: ctx().runId,
      message: `result: Processamento concluído — ${resumoMsg || 'sem pedidos criados'}`,
      raw: { endpoint: '', httpStatus: 200, requestBodyRaw: '', responseBodyRaw: JSON.stringify(resumo) },
    }).catch(() => {})

    // 7) Atualizar status do deal
    await sql`UPDATE deals SET status = 'sent', omie_response = ${JSON.stringify({ ocResults, ovResults, osResults, resumo })}, updated_at = NOW() WHERE id = ${dealId}`

    console.log(`[Omie] deal=${dealId} enviado com sucesso —`, resumoMsg || 'sem pedidos criados')
    return NextResponse.json({ success: true, dealId, resumo })

  } catch (err: any) {
    console.error('omie/send error:', err)
    await addOmieRawLog({
      transactionId: dealId, step: 'result', level: 'error', runId: ctx().runId,
      message: `result: Erro — ${err?.message ?? 'Erro inesperado'}`,
      raw: { endpoint: '', httpStatus: 500, requestBodyRaw: '', responseBodyRaw: err?.message ?? '' },
    }).catch(() => {})
    if (dealId) await sql`UPDATE deals SET status = 'failed', error_message = ${err?.message ?? String(err)}, updated_at = NOW() WHERE id = ${dealId}`.catch(() => {})
    return NextResponse.json({ success: false, error: err?.message ?? 'Erro inesperado' }, { status: 500 })
  }
}
