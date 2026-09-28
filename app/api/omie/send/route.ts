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
import { descricaoOmie } from '@/lib/omie-descricao'
import { camposFinanceirosCard, naturezaInterna } from '@/lib/oc-numbers'
import { garanteNumerosOc } from '@/lib/oc-numbers-bitrix'
import { aguardaFreio, freioDepois } from '@/lib/omie-freio'
import { companyForBranch } from '@/lib/interatell-companies'
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

/**
 * Monta o link do card no Bitrix.
 *
 * bitrix_deal_id guarda ora o xmlId (numero da proposta, ex.: 12579), ora o ID
 * interno do item, dependendo do card. A URL /crm/type/129/details/ so aceita o
 * ID interno; com o xmlId o link aponta para um item inexistente. getDeal aceita
 * os dois formatos e devolve o ID real.
 */
async function dealLink(bitrixDealId: unknown): Promise<string> {
  const raw = String(bitrixDealId ?? '').trim()
  if (!raw) return ''
  try {
    const deal = await BitrixService.getDeal(raw)
    const id = String(deal?.id ?? '').trim()
    if (!id) return ''
    return `${BITRIX_BASE}/crm/type/${BITRIX_ENTITY_TYPE_ID}/details/${id}/`
  } catch {
    return ''
  }
}

/** Prefixa a observação interna com o link do negócio (sem duplicar se já estiver lá). */
function prefixDealLink(texto: string, link: string): string {
  if (!link) return texto
  if (texto.includes(link)) return texto
  return [`Negocio: ${link}`, texto].filter(Boolean).join('\n')
}

type Filial = 'barueri' | 'es'

/** Filial do grupo de fornecedor — e ela que decide onde a compra acontece. */
function filialDoGrupo(group: any): Filial {
  return group?.branch === 'es' ? 'es' : 'barueri'
}

/**
 * Agrupa as alocacoes de um cliente pela filial do fornecedor de origem.
 *
 * Regra do negocio: a venda segue a compra. Comprou por ES, vende por ES. Um
 * mesmo cliente pode receber itens comprados nas duas filiais (ex.: importados
 * por ES e nacionais por Barueri) — nesse caso saem duas OVs, uma por empresa.
 */
function itensPorFilial(entry: any, supplierGroups: any[]): Map<Filial, any[]> {
  const porFilial = new Map<Filial, any[]>()
  for (const alloc of (entry?.productAllocations ?? [])) {
    if (!(Number(alloc.quantity) > 0)) continue
    const group = supplierGroups.find((g: any) => g.localId === alloc.groupLocalId)
    if (!group) continue
    const product = group.products?.[alloc.productIndex]
    if (!product) continue
    const filial = filialDoGrupo(group)
    const lista = porFilial.get(filial) ?? []
    // unitSale vem da alocação do cliente (preço de venda definido por cliente)
    lista.push({ ...product, quantity: Number(alloc.quantity), unitSale: Number(alloc.unitSale ?? 0) })
    porFilial.set(filial, lista)
  }
  return porFilial
}

function branchesDoCliente(entry: any, supplierGroups: any[]): Filial[] {
  const porFilial = itensPorFilial(entry, supplierGroups)
  const filiais = new Set<Filial>(porFilial.keys())

  // SRV e sempre faturado por Barueri. Se o cliente tem item SRV comprado so
  // por ES, ele precisa existir tambem no Omie de Barueri — senao a OS de
  // servico nao encontra o cliente e some sem erro.
  for (const [, lista] of porFilial) {
    if (lista.some(i => normalizeNatureza(i.nature) === 'SRV')) { filiais.add('barueri'); break }
  }

  // Sem alocacao ainda: mantem o comportamento antigo para nao quebrar o cadastro.
  if (!filiais.size) filiais.add(entry?.branch === 'es' ? 'es' : 'barueri')
  return [...filiais]
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

/**
 * Natureza usada internamente no envio ao Omie.
 *
 * O catalogo do Bitrix passou a guardar HDW/SFW/LIC/SVI/SVT, que e o que o app
 * exibe e escreve na planilha. Aqui eles viram os codigos internos de sempre —
 * os antigos continuam aceitos porque negocios e rascunhos ja gravados usam
 * HW/SW/LC/ST/SRV.
 */
function normalizeNatureza(raw: any): Natureza {
  // A regra mora em lib/oc-numbers, que também monta os campos do card do Bitrix.
  return naturezaInterna(raw)
}

/**
 * CFOP enviado ao Omie. Produto sem CFOP no catálogo do Bitrix chega como "0" (a
 * propriedade é numérica), e o Omie recusava o Pedido de Venda com "CFOP não
 * cadastrada [0.]" — foi o que derrubou todas as OVs do #114. Vazio, "0" ou sem 4
 * dígitos vira 5104, o CFOP de todos os hardwares que passaram nos envios
 * anteriores. CFOP válido que vier do catálogo é mantido.
 */
const CFOP_PADRAO = '5104'
function cfopOmie(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D/g, '')
  return d.length === 4 && d !== '0000' ? d : CFOP_PADRAO
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
  // Espera do freio vai para o log como aviso: a tela de processamento mostra o
  // motivo em amarelo enquanto o envio aguarda.
  const avisaEspera = (motivo: string) => {
    console.warn(`[Omie][deal=${dealId}][${step}] ${motivo}`)
    return addOmieRawLog({ transactionId: dealId, step: step as any, level: 'warning', message: `${step}: ${motivo}`,
      runId: ctx().runId, raw: { endpoint: url, httpStatus: 0, requestBodyRaw: '', responseBodyRaw: '' } }).catch(() => {})
  }

  console.log(`[Omie][deal=${dealId}][${step}] → ${call}`, JSON.stringify(param))

  await addOmieRawLog({ transactionId: dealId, step: step as any, level: 'info', message: `${step}: ${call}`, runId: ctx().runId,
    raw: { endpoint: url, httpStatus: 0, requestBodyRaw: JSON.stringify(body), responseBodyRaw: '' } }).catch(() => {})

  // Quando o próprio Omie responde com bloqueio (por erros de outro sistema na
  // mesma chave, ou de antes de um restart), o freio espera o prazo informado e a
  // mesma chamada é repetida — o envio termina inteiro em vez de parar no meio.
  for (let tentativa = 1; ; tentativa++) {
    // Espera antes de o Omie bloquear a chave, ou enquanto ele ainda bloqueia:
    // ver lib/omie-freio.
    await aguardaFreio(app_key, call, avisaEspera)
    await new Promise(r => setTimeout(r, Number(process.env.OMIE_SLEEP_MS ?? 260)))

    let httpStatus = 0, responseText = ''
    try {
      const resp = await fetch(url, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body), cache: 'no-store' })
      httpStatus = resp.status
      responseText = await resp.text()
      const data = responseText ? JSON.parse(responseText) : null
      freioDepois(app_key, call, httpStatus, data?.faultstring)

      if (isOmieRateLimitFault(data?.faultstring) && tentativa < 4) {
        await avisaEspera(`O Omie respondeu com bloqueio (${String(data.faultstring).slice(0, 160)}). A chamada será repetida quando ele liberar.`)
        continue
      }

      // Passos de verificação (check*) retornam 500 com "não cadastrado" quando o pedido
      // simplesmente ainda não existe — isso é esperado e não é um erro de fato.
      const isCheckStep = step.startsWith('check')
      // "Não existem registros" é a resposta do ListarClientes quando o CNPJ ainda
      // não está no Omie — o cadastro é criado logo em seguida. Sem esta linha o
      // passo aparecia vermelho na tela de processamento, como se fosse falha.
      const isNotFound = typeof data?.faultstring === 'string' &&
        /não cadastrado|nao cadastrado|not found|n[ãa]o existem registros/i.test(data.faultstring)
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
  /** Cidade do cliente como o Omie a tem cadastrada ("SAO PAULO (SP)"): ver cidadeDaOS. */
  clienteCidade: Map<string, string>
  /** Produtos que já existem no Omie, por CNPJ da filial: ver mapaProdutosExistentes. */
  produtosExistentes: Map<string, Map<string, any>>
  /**
   * Procurar OC/OV/OS antes de criar — só na atualização de negócio já enviado.
   * Fora dela o app cria direto e busca só se o Omie disser que já existe.
   */
  buscarPedidos: boolean
  /** Maior sufixo -Rn já usado nos códigos de integração deste negócio. */
  retryMax: number
}
const runStore = new AsyncLocalStorage<RunCtx>()
const newRunCtx = (runId: string | null): RunCtx => ({
  runId,
  clienteCache: new Map(),
  fornecedorCache: new Map(),
  produtoCache: new Map(),
  servicoCache: new Map(),
  clienteCidade: new Map(),
  produtosExistentes: new Map(),
  buscarPedidos: false,
  retryMax: 0,
})
const ctx = (): RunCtx => runStore.getStore() ?? newRunCtx(null)

/** Faltas de limite/bloqueio do Omie — NÃO significam "registro não encontrado". */
function isOmieRateLimitFault(faultstring: unknown): boolean {
  const s = String(faultstring ?? '').toUpperCase()
  return s.includes('REDUNDANT')
    || s.includes('MISUSE_API_PROCESS')
    || s.includes('CONSUMO REDUNDANTE')
    || s.includes('BLOQUEADA')
}

/**
 * Avisa que um cadastro não existe no Omie e está sendo criado agora.
 *
 * Sai como log 'warning' no passo de verificação, e é isso que a tela de
 * processamento pinta de amarelo — sem ele o operador não tinha como saber
 * que o fornecedor/cliente foi cadastrado na hora e precisa de conferência.
 */
async function avisaCadastroNovo(
  dealId: number, step: 'checkFornecedor' | 'checkCliente',
  tipo: 'Fornecedor' | 'Cliente', nome: string, cnpj: string, interatellCnpj: string,
) {
  const empresa = digits(interatellCnpj) === digits(CNPJ_ES) ? 'Interatell ES' : 'Interatell Barueri'
  await addOmieRawLog({
    transactionId: dealId, step, level: 'warning', runId: ctx().runId,
    message: `${tipo} "${nome || cnpj}" não existe na ${empresa} — sendo criado no Omie agora.`,
    raw: { endpoint: OMIE_URL.CLIENTES, httpStatus: 200, requestBodyRaw: '', responseBodyRaw: '' },
  }).catch(() => {})
}

async function ensureCliente(interatellCnpj: string, company: any, dealId: number): Promise<number> {
  const cnpj = digits(company?.cnpj ?? '')
  const key  = `${digits(interatellCnpj)}:${cnpj}`
  const cache = ctx().clienteCache
  if (cache.has(key)) return cache.get(key)!

  const check = await omieCall(interatellCnpj, OMIE_URL.CLIENTES, 'ListarClientes',
    { pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N', clientesFiltro: { cnpj_cpf: cnpj } },
    dealId, 'checkCliente')
  // Rate-limit na consulta NÃO é "não encontrado" — abortar evita cadastrar duplicado.
  if (check?.faultstring && isOmieRateLimitFault(check.faultstring)) {
    throw new Error(`Omie temporariamente bloqueado por excesso de chamadas — aguarde alguns minutos e reenvie. (${check.faultstring})`)
  }

  let codigo: number
  if (check?.clientes_cadastro?.length) {
    codigo = check.clientes_cadastro[0].codigo_cliente_omie
    // A cidade do cadastro do Omie já vem como "SAO PAULO (SP)", o formato que a
    // OS exige — ver cidadeDaOS.
    ctx().clienteCidade.set(key, String(check.clientes_cadastro[0].cidade ?? '').trim())
  } else {
    await avisaCadastroNovo(dealId, 'checkCliente', 'Cliente', company?.name, cnpj, interatellCnpj)
    const created = await omieCall(interatellCnpj, OMIE_URL.CLIENTES, 'IncluirCliente', {
      // Obrigatório no IncluirCliente; o CNPJ garante um código estável e único.
      codigo_cliente_integracao: `CLI-${cnpj}`,
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
  // Rate-limit na consulta NÃO é "não encontrado" — abortar evita cadastrar duplicado.
  if (check?.faultstring && isOmieRateLimitFault(check.faultstring)) {
    throw new Error(`Omie temporariamente bloqueado por excesso de chamadas — aguarde alguns minutos e reenvie. (${check.faultstring})`)
  }

  let codigo: number
  if (check?.clientes_cadastro?.length) {
    codigo = check.clientes_cadastro[0].codigo_cliente_omie
  } else {
    await avisaCadastroNovo(dealId, 'checkFornecedor', 'Fornecedor', supplier?.name, cnpj, interatellCnpj)
    const created = await omieCall(interatellCnpj, OMIE_URL.CLIENTES, 'IncluirCliente', {
      // Obrigatório no IncluirCliente; o CNPJ garante um código estável e único.
      codigo_cliente_integracao: `FORN-${cnpj}`,
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

/**
 * Código do produto no Omie: o SKU do catálogo.
 *
 * partnumber entra só como alternativa — é o que existe quando o produto foi
 * digitado à mão, sem SKU. Antes o partnumber era sempre o código, e como ele
 * vem do NAME do catálogo Bitrix (que costuma ser a descrição inteira), o
 * pedido saía com código e descrição repetindo o mesmo texto.
 */
function codigoProduto(item: any): string {
  return String(item?.sku ?? '').trim() || String(item?.partnumber ?? '').trim()
}

/**
 * Descrição do produto no Omie: "Part Number / Descrição", em 120 caracteres.
 *
 * Vale para o cadastro do produto e para as linhas do Pedido de Compra e do
 * Pedido de Venda — os três precisam bater, senão o Omie mostra um texto no
 * cadastro e outro no pedido.
 */
function descricaoProduto(item: any): string {
  return descricaoOmie(item?.partnumber, item?.description)
}

/**
 * Alinha um produto ja cadastrado no Omie ao padrao atual: codigo = SKU e
 * descricao = "Part Number / Descricao".
 *
 * So chama a API quando algo de fato diverge. Descricao, codigo, unidade e NCM
 * sao obrigatorios no cadastro do Omie, entao os quatro vao sempre — os que nao
 * estao mudando repetem o valor que o produto ja tem, para o AlterarProduto nao
 * esvaziar nada.
 *
 * Falha aqui nao interrompe o envio: o produto existente continua valendo, e
 * duplicar o cadastro seria pior que ficar com o texto antigo. O erro fica no
 * log da transacao. O passo e o mesmo da criacao para o log ja saber exibi-lo;
 * o corpo da requisicao mostra que a chamada foi AlterarProduto.
 */
async function alinhaProduto(
  interatellCnpj: string, atual: any, codigo: string, descricao: string, dealId: number,
): Promise<void> {
  const codigoAtual = String(atual?.codigo ?? '')
  const descricaoAtual = String(atual?.descricao ?? '')
  const mudaCodigo = !!codigo && codigo !== codigoAtual
  const mudaDescricao = !!descricao && descricao !== descricaoAtual
  if (!mudaCodigo && !mudaDescricao) return

  const res = await omieCall(interatellCnpj, OMIE_URL.PRODUTOS, 'AlterarProduto', {
    codigo_produto: atual.codigo_produto,
    codigo: mudaCodigo ? codigo : codigoAtual,
    descricao: mudaDescricao ? descricao : descricaoAtual,
    unidade: String(atual?.unidade ?? '') || 'UN',
    ncm: String(atual?.ncm ?? ''),
  }, dealId, 'createProdutoResult')

  if (res?.faultstring && isOmieRateLimitFault(res.faultstring)) {
    throw new Error(`Omie temporariamente bloqueado por excesso de chamadas — aguarde alguns minutos e reenvie. (${res.faultstring})`)
  }
}

/**
 * Produtos que já existem no Omie, numa chamada só por filial.
 *
 * Consultar produto por produto (ConsultarProduto) dá erro "não cadastrado" para
 * cada um que ainda não existe, e o Omie bloqueia a chave na 10ª resposta com
 * erro no mesmo método. Com os SKUs novos do catálogo quase todo produto é novo:
 * pelo SKU e depois pelo partnumber eram 2 erros por produto, e 5 produtos já
 * bloqueavam. ListarProdutos com a lista de códigos devolve só os que existem,
 * sem erro; se nenhum existir, é um erro só.
 */
async function mapaProdutosExistentes(interatellCnpj: string, codigos: string[], dealId: number): Promise<Map<string, any>> {
  const mapa = new Map<string, any>()
  const unicos = [...new Set(codigos.map(c => String(c ?? '').trim()).filter(Boolean))]
  for (let i = 0; i < unicos.length; i += 50) {
    const res = await omieCall(interatellCnpj, OMIE_URL.PRODUTOS, 'ListarProdutos', {
      pagina: 1, registros_por_pagina: 50, apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N',
      produtosPorCodigo: unicos.slice(i, i + 50).map(codigo => ({ codigo })),
    }, dealId, 'checkProduto')
    if (res?.faultstring && isOmieRateLimitFault(res.faultstring)) {
      throw new Error(`Omie temporariamente bloqueado por excesso de chamadas — aguarde alguns minutos e reenvie. (${res.faultstring})`)
    }
    for (const p of res?.produto_servico_cadastro ?? []) {
      const cod = String(p?.codigo ?? '').trim().toUpperCase()
      if (cod && p?.codigo_produto) mapa.set(cod, p)
    }
  }
  return mapa
}

async function ensureProduto(interatellCnpj: string, item: any, dealId: number): Promise<number | undefined> {
  if (normalizeNatureza(item.nature) === 'SRV') return undefined
  const sku = codigoProduto(item)
  if (!sku) return undefined
  const partnumber = String(item.partnumber ?? '').trim()
  const key = `${digits(interatellCnpj)}:${sku}`
  const cache = ctx().produtoCache
  if (cache.has(key)) return cache.get(key)

  // Existência vem da consulta em lote feita antes do laço de produtos.
  const existentes = ctx().produtosExistentes.get(digits(interatellCnpj))
    ?? await mapaProdutosExistentes(interatellCnpj, [sku, partnumber], dealId)
  // Produtos cadastrados antes de o código passar a ser o SKU estão no Omie com
  // o partnumber como código. Reaproveita esse cadastro em vez de duplicar.
  const achado: any = existentes.get(sku.toUpperCase())
    ?? (partnumber && partnumber !== sku ? existentes.get(partnumber.toUpperCase()) : undefined)

  let cod: number | undefined = achado?.codigo_produto
  if (achado) await alinhaProduto(interatellCnpj, achado, sku, descricaoProduto(item), dealId)

  if (!cod) {
    // Garante NCM: usa o do deal; se vazio, busca no banco local pelo partnumber
    let ncm = normalizeNCM(item.ncm)
    if (!ncm || ncm.length < 8) {
      const [local] = await sql`SELECT ncm, cfop, family FROM products WHERE partnumber = ${partnumber || sku} LIMIT 1`
      if (local?.ncm) ncm = normalizeNCM(local.ncm)
      if (!item.cfop && local?.cfop) item.cfop = local.cfop
      if (!item.family && local?.family) item.family = local.family
    }

    const created = await omieCall(interatellCnpj, OMIE_URL.PRODUTOS, 'IncluirProduto', {
      codigo: sku, descricao: descricaoProduto(item), unidade: 'UN',
      ncm, cfop: cfopOmie(item.cfop),
      codigo_produto_integracao: sku,
      codigo_familia: item.family || '',
    }, dealId, 'createProdutoResult')
    cod = created?.codigo_produto
    if (!cod) {
      const fault = String(created?.faultstring ?? '')
      if (isOmieRateLimitFault(fault)) {
        throw new Error(`Omie temporariamente bloqueado por excesso de chamadas — aguarde alguns minutos e reenvie. (${fault})`)
      }
      // "A descrição já está sendo utilizada pelo produto com código X" (Client-143):
      // o produto já existe com OUTRO código — recupera pelo código informado no erro.
      const outroCodigo = fault.match(/produto com c[oó]digo\s+([^\s.]+)/i)?.[1]
      if (outroCodigo) {
        const again = await omieCall(interatellCnpj, OMIE_URL.PRODUTOS, 'ConsultarProduto', { codigo: outroCodigo }, dealId, 'checkProduto')
        if (again?.codigo_produto) cod = again.codigo_produto
      }
      // "Produto já cadastrado ... (ID: N)": aproveita o ID do próprio erro.
      if (!cod) {
        const idMatch = fault.match(/ID:\s*(\d+)/i)
        if (idMatch) cod = Number(idMatch[1])
      }
      // Última tentativa: consultar pelo código de integração.
      if (!cod) {
        const byInt = await omieCall(interatellCnpj, OMIE_URL.PRODUTOS, 'ConsultarProduto', { codigo_produto_integracao: sku }, dealId, 'checkProduto')
        if (byInt?.codigo_produto) cod = byInt.codigo_produto
      }
      if (!cod) {
        throw new Error(`Produto "${sku}": ${created?.faultstring ?? 'não foi possível cadastrar no Omie.'}`)
      }
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

async function findExistingOC(interatellCnpj: string, dealId: number, baseCode: string, retryCount: number, forcar = false) {
  if (!ctx().buscarPedidos && !forcar) return null
  for (const cCodIntPed of integrationLookupCodes(baseCode, retryCount)) {
    const existing = await omieCall(interatellCnpj, OMIE_URL.PEDIDOS_COMPRA, 'ConsultarPedCompra',
      { cCodIntPed }, dealId, 'checkOC')
    const parsed = parseOCConsultResponse(existing, cCodIntPed)
    if (parsed) return parsed
  }
  return null
}

async function findExistingOV(interatellCnpj: string, dealId: number, baseCode: string, retryCount: number, legacyBase?: string, forcar = false) {
  if (!ctx().buscarPedidos && !forcar) return null
  // legacyBase: codigo usado antes da OV passar a ser por filial. Sem ele, um
  // negocio ja enviado criaria uma OV nova em vez de atualizar a existente.
  const codigos = [
    ...integrationLookupCodes(baseCode, retryCount),
    ...(legacyBase ? integrationLookupCodes(legacyBase, retryCount) : []),
  ]
  for (const codigo_pedido_integracao of [...new Set(codigos)]) {
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

async function findExistingOS(interatellCnpj: string, dealId: number, baseCode: string, retryCount: number, forcar = false) {
  if (!ctx().buscarPedidos && !forcar) return null
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
  codParc: string, valorFrete: number,
) {
  const ocItems = items.filter(i => normalizeNatureza(i.nature) !== 'SRV')
  if (!ocItems.length || !codDistribuidor) return null
  const baseCode = `OC-${dealId}-G${groupIdx}`
  const createCode = opts.isUpdate ? baseCode : `${baseCode}${opts.retryCount > 0 ? `-R${opts.retryCount}` : ''}`

  const produtosUpsert = ocItems.map((e, i) => ({
    cCodIntItem: String(i + 1),
    ...(e.codigoProdutoOmie
      ? { nCodProd: e.codigoProdutoOmie }
      : { cCodIntProd: codigoProduto(e) }),
    cDescricao: descricaoProduto(e),
    cNCM: normalizeNatureza(e.nature) === 'HW' ? normalizeNCM(e.ncm) : '00000000',
    cUnidade: 'UN', nQtde: Number(e.quantity ?? 1),
    nValUnit: Number(e.unitCost ?? 0), nPesoLiq: 0, nPesoBruto: 0,
  }))

  const lookupRetry = ctx().retryMax
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
    // "Adicionar Frete?" no card do fornecedor. Só vai quando tem valor: mandar
    // frete_upsert zerado sobrescreveria um frete lançado à mão no Omie.
    ...(valorFrete > 0 ? { frete_upsert: { nValFrete: valorFrete } } : {}),
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
  codParc: string, filial: Filial,
) {
  // Numero do pedido do cliente = numero do negocio (ex.: 2026.12345), que e o
  // que o time procura no Omie para achar a origem do pedido.
  const pedidoCliente = String(business?.commercialProposal ?? '').trim()
  const hwItems = items.filter(i => normalizeNatureza(i.nature) === 'HW' && normalizeNCM(i.ncm) !== '00000000')
  if (!hwItems.length || !codCliente) return null
  // O Pedido de Venda tem um unico campo de observacao (observacoes.obs_venda),
  // entao a externa vai para dados_adicionais_nf — que e o texto que sai na nota —
  // e obs_venda fica so com a interna e o link do negocio. Antes as duas iam
  // juntas em obs_venda e apareciam misturadas no Omie.
  const obsVenda = obs.interna
  // O codigo carrega a filial porque o mesmo cliente pode ter uma OV em cada
  // empresa quando os produtos vieram de compras em filiais diferentes.
  const legacyBase = `OV-${dealId}-C${customerIdx}`
  const baseCode = `${legacyBase}-${filial === 'es' ? 'ES' : 'BAR'}`
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
          : { codigo_produto_integracao: codigoProduto(e) }),
        cfop: cfopOmie(e.cfop), ncm: normalizeNCM(e.ncm), descricao: descricaoProduto(e),
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
    consumidor_final: 'S', enviar_email: 'N',
    // Numero do pedido de compra do cliente. Sem ele o Omie ficava com o codigo
    // de integracao do app (OV-123-C0), que nao diz nada para quem consulta.
    numero_pedido_cliente: pedidoCliente || createCode,
    dados_adicionais_nf: obs.externa,
  }

  const lookupRetry = ctx().retryMax
  const found = await findExistingOV(interatellCnpj, dealId, baseCode, lookupRetry, legacyBase)
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
    const retryFound = await findExistingOV(interatellCnpj, dealId, baseCode, ctx().retryMax, legacyBase, true)
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

/**
 * Cidade da prestação do serviço na OS, sempre como "CIDADE (UF)".
 *
 * Na ordem: a cidade que o próprio Omie tem no cadastro do cliente (já vem nesse
 * formato), a do formulário e, por último, a da filial que fatura. O Omie recusa
 * a OS com "Cidade não cadastrada para o Código [SAO PAULO]" quando falta a UF, e
 * foi isso que derrubou a OS de um cliente cadastrado sem UF no formulário.
 */
function cidadeDaOS(interatellCnpj: string, cliente: any, filial: Filial): { cidade: string; doFilial: boolean } {
  const temUF = (v: string) => /\([A-Za-z]{2}\)\s*$/.test(v)
  const candidatos = [
    ctx().clienteCidade.get(`${digits(interatellCnpj)}:${digits(cliente?.cnpj ?? '')}`) ?? '',
    cidadePrestServ(cliente?.city, cliente?.state),
  ].map(v => String(v).trim())

  const escolhido = candidatos.find(temUF)
  if (escolhido) return { cidade: escolhido, doFilial: false }

  const itl = companyForBranch(filial === 'es' ? 'es' : 'barueri')
  return { cidade: `${itl.city} (${itl.state})`, doFilial: true }
}

// ─── Upsert OS (busca pelo código de integração → atualiza ou cria) ──────────
async function upsertOS(
  interatellCnpj: string, codCliente: number, cliente: any, items: any[], nat: Natureza,
  business: any, obs: { externa: string; interna: string },
  dealId: number, customerIdx: number, opts: { isUpdate: boolean; retryCount: number },
  codParc: string, filial: Filial,
) {
  if (!items.length || !codCliente) return null
  // Numero do pedido do cliente = numero do negocio (ex.: 2026.12345).
  const pedidoCliente = String(business?.commercialProposal ?? '').trim()
  const SERVICO_MAP: Record<Natureza, string> = { SW:'SRV00007', LC:'SRV00007', ST:'SRV00016', SRV:'SRV00001', HW:'' }
  // A externa ja vai em cDadosAdicNF (sai na NF), entao cObsOS fica so com a
  // interna e o link. Antes cObsOS levava tudo junto e o texto externo aparecia
  // duplicado, misturado com o interno.
  const obsOS = obs.interna
  const legacyBase = `OS-${dealId}-C${customerIdx}-${nat}`
  const baseCode = `${legacyBase}-${filial === 'es' ? 'ES' : 'BAR'}`
  const createCode = opts.isUpdate ? baseCode : `${baseCode}${opts.retryCount > 0 ? `-R${opts.retryCount}` : ''}`

  const Cabecalho = {
    cCodIntOS: createCode, nCodCli: codCliente, cEtapa: '20',
    dDtPrevisao: toOmieDate(business?.deliveryDeadline ?? business?.expectedBillingDate),
    cCodParc: codParc, nQtdeParc: 1,
  }
  // Cidade da prestação: sem UF o Omie recusa a OS inteira. Quando nem o cadastro
  // do Omie nem o formulário têm a UF, vai a cidade da Interatell — e isso muda o
  // município da prestação, então fica avisado no log.
  const { cidade: cidadePrestacao, doFilial: cidadeDaFilial } = cidadeDaOS(interatellCnpj, cliente, filial)
  if (cidadeDaFilial) {
    await addOmieRawLog({
      transactionId: dealId, step: 'createOSResult', level: 'warning', runId: ctx().runId,
      message: `createOSResult: cliente "${cliente?.name ?? ''}" sem cidade com UF — a OS vai com ${cidadePrestacao}, a cidade da Interatell. Confira a UF do cliente.`,
      raw: { endpoint: OMIE_URL.ORDEM_SERVICO, httpStatus: 0, requestBodyRaw: '', responseBodyRaw: '' },
    }).catch(() => {})
  }

  const InformacoesAdicionais = {
    cCidPrestServ: cidadePrestacao, cCodCateg: '1.01.02',
    // Numero do pedido do cliente; cai no codigo de integracao so quando o
    // cliente nao informou o dele.
    cNumPedido: pedidoCliente || createCode, nCodCC: contaCorrente(interatellCnpj),
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

  const alteraOS = async (found: any) => {
    // Idempotente: na atualização só INCLUI o produto que a OS ainda não tem, evitando
    // baixa de estoque em duplicidade a cada reenvio. Produtos já presentes ficam intactos.
    const jaPresentes = new Set(
      (found.produtosUtilizados ?? [])
        .map((p: any) => Number(p.nCodProdutoPU ?? p.nCodProduto ?? p.codigo_produto ?? 0))
        .filter(Boolean),
    )
    const produtoUtilizadoNovo = produtoUtilizado.filter(p => !jaPresentes.has(Number(p.nCodProdutoPU)))
    const produtosUtilizadosUpdate = { cAcaoProdUtilizados: 'EST', cCodCategRem: '', produtoUtilizado: produtoUtilizadoNovo }
    // AlterarOS identifica a OS só pelo nCodOS. Com o cCodIntOS junto o Omie
    // recusa com "Informe a Tag [nCodOS] ou [cCodIntOS] na alteração!" — foi o
    // que derrubou o #111. É a mesma regra que a atualização parcial
    // (lib/omie-order-api) já seguia, com o bloco Email presente.
    const { cCodIntOS: _codigoIntegracao, ...cabecalhoAlteracao } = Cabecalho
    const res = await omieCall(interatellCnpj, OMIE_URL.ORDEM_SERVICO, 'AlterarOS', {
      Cabecalho: { ...cabecalhoAlteracao, nCodOS: found.cab.nCodOS },
      InformacoesAdicionais,
      Email: { cEnvBoleto: 'N', cEnvLink: 'N', cEnvPix: 'N', cEnviarPara: '' },
      Observacoes: { cObsOS: obsOS },
      Departamentos: [],
      ServicosPrestados: await buildServicos(found.servicos),
      produtosUtilizados: produtosUtilizadosUpdate,
    }, dealId, 'createOSResult')
    return { ...res, _action: 'updated', _numero: found.cab.cNumOS ?? found.cab.nCodOS, _codigo: found.cab.nCodOS, _intCode: found.intCode }
  }

  const found = await findExistingOS(interatellCnpj, dealId, baseCode, ctx().retryMax)
  if (found) return alteraOS(found)

  const res = await omieCall(interatellCnpj, OMIE_URL.ORDEM_SERVICO, 'IncluirOS', {
    Cabecalho, InformacoesAdicionais,
    Observacoes: { cObsOS: obsOS },
    Departamentos: [],
    ServicosPrestados: await buildServicos(),
    produtosUtilizados,
  }, dealId, 'createOSResult')

  // Fora da atualização o app cria direto, sem procurar antes. Se a OS já existe
  // com este código — envio anterior que falhou depois de criá-la —, busca e
  // atualiza em vez de falhar.
  if (res?.faultstring && /j[aá] cadastrad|j[aá] existe|already registered/i.test(String(res.faultstring))) {
    const existente = await findExistingOS(interatellCnpj, dealId, baseCode, ctx().retryMax, true)
    if (existente) return alteraOS(existente)
  }
  return { ...res, _action: 'created', _numero: res?.cNumOS ?? res?.nCodOS, _codigo: res?.nCodOS, _intCode: createCode }
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

    // Todo o processamento roda dentro de um contexto isolado por requisição, e em
    // segundo plano: o freio pode esperar minutos para o Omie não bloquear a
    // chave, e uma requisição aberta esse tempo todo caía por timeout (o fetch do
    // Node desiste depois de 5 min sem resposta). Andamento e resultado seguem
    // pelos logs, que a tela de processamento acompanha; processDeal grava o
    // status do negócio e o erro, se houver.
    void runStore.run(newRunCtx(runId), () => processDeal(body, dealId))
      .catch(err => console.error(`[Omie] deal=${dealId} erro fora do envio:`, err))
    return NextResponse.json({ success: true, started: true, dealId }, { status: 202 })
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

/** Número do pedido na resposta do Omie — cada método devolve num lugar. */
function pickNumero(r: any, intCode: string) {
  return r?.cNumero || r?.cNumPed || r?.nCodPed || r?.numero_pedido ||
    r?.cabecalho_consulta?.cNumero || r?.pedido_venda_produto?.cabecalho?.numero_pedido ||
    r?.cabecalho_alterar?.cNumero || r?.pedido_venda_produto_response?.cabecalho?.numero_pedido ||
    r?.Cabecalho?.cNumOS || r?.nCodOS || intCode || '?'
}

/**
 * Resumo dos pedidos de um envio. Vai para o log final (que a tela de
 * processamento mostra), para omie_response e para os campos do card do Bitrix —
 * também quando o envio falha no meio, com o que chegou a ser criado.
 */
function montaResumo(dealId: number, ocResults: any[], ovResults: any[], osResults: any[], alteracoes: any[]) {
  return {
    oc: ocResults.map((r, i) => ({
      numero: r._numero ?? pickNumero(r, `OC-${dealId}-G${i}`),
      codigoIntegracao: r._intCode ?? `OC-${dealId}-G${r._groupIdx ?? i}`,
      codigoPedido: r._codigo ?? r?.nCodPed,
      acao: r._action ?? 'created',
      fornecedor: r._supplier,
      // De qual fornecedor saiu a OC — os campos do card do Bitrix usam para
      // achar o Número de Ordem de Compra.
      grupoIdx: r._groupIdx,
      erro: omieFaultMessage(r) ?? undefined,
    })),
    ov: ovResults.map((r, i) => ({
      numero: r._numero ?? pickNumero(r, `OV-${dealId}-C${i}`),
      numeroCurto: r._numeroCurto,
      codigoIntegracao: r._intCode ?? `OV-${dealId}-C${i}`,
      codigoPedido: r._codigoPedido ?? r._codigo ?? r?.codigo_pedido,
      acao: r._action ?? 'created',
      cliente: r._customer,
      clienteIdx: r._clienteIdx,
      filial: r._filial,
      erro: omieFaultMessage(r) ?? undefined,
    })),
    os: osResults.map((r) => ({
      numero: r._numero ?? pickNumero(r, r.cCodIntOS || '?'),
      codigoIntegracao: r._intCode ?? r.cCodIntOS,
      acao: r._action ?? 'created',
      cliente: r._customer,
      nat: r._nat,
      // Serviço próprio Interatell (não veio de fornecedor) — o PDF é separado.
      interatellService: r._interatellService ?? undefined,
      clienteIdx: r._clienteIdx,
      servicoIdx: r._servicoIdx,
      filial: r._filial,
      erro: omieFaultMessage(r) ?? undefined,
    })),
    alteracoes,
  }
}

/**
 * Soma o resumo de uma tentativa ao das anteriores, pelo código de integração.
 * Um envio que falha no meio grava o que criou até ali; o seguinte não pode
 * apagar isso, nem trocar um pedido criado pela resposta de erro de uma nova
 * tentativa.
 */
function juntaResumos(anterior: any, novo: any) {
  const junta = (a: any[] = [], b: any[] = []) => {
    const chave = (x: any) => String(x?.codigoIntegracao ?? x?.numero ?? '')
    const m = new Map<string, any>(a.map(x => [chave(x), x]))
    for (const x of b) {
      const atual = m.get(chave(x))
      if (x?.erro && atual && !atual.erro) continue
      m.set(chave(x), x)
    }
    return [...m.values()]
  }
  return { ...novo, oc: junta(anterior?.oc, novo?.oc), ov: junta(anterior?.ov, novo?.ov), os: junta(anterior?.os, novo?.os) }
}

/** Só os pedidos que existem no Omie — sem as tentativas que voltaram com erro. */
function soCriados(resumo: any) {
  const ok = (l: any[] = []) => l.filter(x => !x?.erro)
  return { ...resumo, oc: ok(resumo?.oc), ov: ok(resumo?.ov), os: ok(resumo?.os) }
}

async function processDeal(body: any, dealId: number) {
  // Fora do try: se o envio falhar no meio, o catch ainda sabe o que foi criado.
  const ocResults: any[] = [], ovResults: any[] = [], osResults: any[] = []
  try {
    console.log(`[Omie] Iniciando envio do deal=${dealId}${body.update ? ' (atualização)' : ''}`)

    // Carregar deal do banco
    const [deal] = await sql`SELECT * FROM deals WHERE id = ${dealId}`
    if (!deal) return NextResponse.json({ success: false, error: 'Deal não encontrado' }, { status: 404 })

    const payload = typeof deal.payload === 'string' ? JSON.parse(deal.payload) : deal.payload

    // Número de Ordem de Compra (lista #35 do Bitrix) do que ainda não tem, antes
    // de qualquer pedido, para o card sair com "OC 9178/26 - ...". Aqui, e não na
    // action, porque os reenvios da tela de processamento chamam esta rota direto.
    // Falha aqui não segura o envio: o card só fica sem o prefixo naquela linha.
    try {
      const { criados, erros } = await garanteNumerosOc(payload)
      if (criados) await sql`UPDATE deals SET payload = ${JSON.stringify(payload)}, updated_at = NOW() WHERE id = ${dealId}`
      if (erros.length) console.error(`[OC] deal=${dealId} sem Número de Ordem de Compra:`, erros.join(' | '))
    } catch (err) {
      console.error(`[OC] deal=${dealId} erro ao garantir Número de Ordem de Compra:`, err)
    }

    const { interatell, supplierGroups = [], customers = [], serviceCustomers = [], business, notes } = payload
    // A observação interna sempre carrega o link do negócio no Bitrix, para quem
    // consultar o pedido no Omie conseguir voltar ao card de origem.
    const externaRaw = String(notes?.externalNotes ?? '').trim()
    const internaRaw = String(notes?.internalNotes ?? '').trim()
    // Resolve o link uma vez so — evita duas idas ao Bitrix pelo mesmo card.
    const linkNegocio = await dealLink(deal.bitrix_deal_id)
    const obs = {
      externa: externaRaw,
      interna: prefixDealLink(internaRaw, linkNegocio),
    }
    const retryCount: number = payload._retryCount ?? 0
    const isUpdate = body.update === true || deal.status === 'sent'
    const alteracoes = Array.isArray(body.changes) ? body.changes : []
    const upsertOpts = { isUpdate, retryCount: isUpdate ? 0 : retryCount }
    // Procurar pedido antes de criar dá um erro "não cadastrado" por pedido que
    // ainda não existe (dois por OV, com o código antigo), e erro conta para o
    // bloqueio do Omie — num reenvio com 13 clientes o freio esperava 30 min a
    // cada 8. Fora da atualização o app cria direto: a OC é upsert pelo código, e
    // OV/OS que já existam (envio anterior que falhou no meio) voltam "já
    // cadastrado", e só então são buscadas e atualizadas.
    ctx().buscarPedidos = isUpdate
    // Os pedidos só podem ter sido criados com o código base ou com -R1..-Rn até
    // o retry atual. Antes a busca testava sempre até -R5 (e mais seis códigos
    // antigos na OV), mesmo sem retry nenhum.
    ctx().retryMax = retryCount
    // fallbackCnpj: backward compat for old payloads that stored a single interatell.cnpj
    const fallbackCnpj = digits(interatell?.cnpj ?? '')

    // Resolve códigos Omie (aceita "A28", "A28 - Para 28 Dias" ou só "Para 28 Dias")
    // A condição de compra só existe quando há fornecedor — é usada apenas na OC.
    // Negócio só de serviço Interatell não tem compra, o campo fica vazio, e
    // resolvê-la aqui derrubava o envio com "Condição de pagamento não informada."
    const purchaseCodParc = supplierGroups.length
      ? await resolvePaymentCodeForOmie(business?.purchasePaymentCondition ?? '', 'purchase')
      : ''
    const saleCodParc = await resolvePaymentCodeForOmie(business?.salePaymentCondition ?? '', 'sale')

    // 1a) Garantir FORNECEDORES no Omie — usa credenciais da filial do grupo
    for (const group of supplierGroups) {
      const branchCnpj = getBranchCnpj(group.branch, fallbackCnpj)
      await ensureFornecedor(branchCnpj, group.supplier, dealId)
    }

    // 1b) Garantir CLIENTES no Omie. A venda segue a compra: o cliente precisa
    // existir na conta de CADA filial de onde vem produto alocado para ele, o
    // que pode ser as duas ao mesmo tempo.
    for (const entry of customers) {
      for (const branch of branchesDoCliente(entry, supplierGroups)) {
        await ensureCliente(getBranchCnpj(branch, fallbackCnpj), entry.customer, dealId)
      }
    }

    // 1c) Serviço Interatell (SRV) é sempre faturado por Barueri, independente
    // de onde a compra aconteceu.
    for (const entry of serviceCustomers) {
      await ensureCliente(CNPJ_BARUERI, entry.customer, dealId)
    }

    // 2) Garantir produtos no Omie (por grupo de fornecedor, na filial correta).
    //    Antes, uma consulta em lote por filial: ver mapaProdutosExistentes.
    const codigosPorFilial = new Map<string, string[]>()
    for (const group of supplierGroups) {
      const branchCnpj = getBranchCnpj(group.branch, fallbackCnpj)
      const lista = codigosPorFilial.get(branchCnpj) ?? []
      for (const p of group.products ?? []) {
        if (normalizeNatureza(p.nature) === 'SRV') continue
        lista.push(codigoProduto(p), String(p.partnumber ?? '').trim())
      }
      codigosPorFilial.set(branchCnpj, lista)
    }
    for (const [branchCnpj, codigos] of codigosPorFilial) {
      if (!codigos.some(Boolean)) continue
      ctx().produtosExistentes.set(digits(branchCnpj), await mapaProdutosExistentes(branchCnpj, codigos, dealId))
    }

    for (const group of supplierGroups) {
      const branchCnpj = getBranchCnpj(group.branch, fallbackCnpj)
      for (const product of group.products ?? []) {
        product.codigoProdutoOmie = await ensureProduto(branchCnpj, product, dealId)
      }
    }

    // 3) OC: 1 por grupo de fornecedor
    for (let gIdx = 0; gIdx < supplierGroups.length; gIdx++) {
      const group = supplierGroups[gIdx]
      const branchCnpj = getBranchCnpj(group.branch, fallbackCnpj)
      const codDistribuidor = ctx().fornecedorCache.get(`${branchCnpj}:${digits(group.supplier?.cnpj)}`)
      if (!codDistribuidor) continue
      const valorFrete = group.hasFreight ? Number(group.freightValue ?? 0) : 0
      const res = await upsertOC(branchCnpj, codDistribuidor, group.products ?? [], business, obs, dealId, gIdx, upsertOpts, purchaseCodParc, valorFrete)
      if (res) ocResults.push({ ...res, _supplier: group.supplier?.name, _groupIdx: gIdx })
    }

    // 4) OV + OS: 1 por cliente E por filial de compra. O mesmo cliente gera
    //    dois pedidos quando recebe itens comprados em filiais diferentes.
    for (let cIdx = 0; cIdx < customers.length; cIdx++) {
      const entry = customers[cIdx]
      const porFilial = itensPorFilial(entry, supplierGroups)

      // SRV e sempre faturado por Barueri, venha de onde vier a compra. Sai do
      // agrupamento por filial e e tratado uma vez so, no fim.
      const itensSRV: any[] = []
      for (const [, lista] of porFilial) {
        for (const item of lista) {
          if (normalizeNatureza(item.nature) === 'SRV') itensSRV.push(item)
        }
      }

      for (const [filial, itensDaFilial] of porFilial) {
        const itens = itensDaFilial.filter(i => normalizeNatureza(i.nature) !== 'SRV')
        if (!itens.length) continue

        const branchCnpj = getBranchCnpj(filial, fallbackCnpj)
        const codCliente = ctx().clienteCache.get(`${branchCnpj}:${digits(entry.customer?.cnpj)}`)
        if (!codCliente) continue

        const ov = await upsertOV(branchCnpj, codCliente, itens, business, obs, dealId, cIdx, upsertOpts, saleCodParc, filial)
        if (ov) ovResults.push({ ...ov, _customer: entry.customer?.name, _filial: filial, _clienteIdx: cIdx })

        for (const nat of ['SW','LC','ST'] as Natureza[]) {
          const natItems = itens.filter(i => normalizeNatureza(i.nature) === nat)
          if (!natItems.length) continue
          const os = await upsertOS(branchCnpj, codCliente, entry.customer, natItems, nat, business, obs, dealId, cIdx, upsertOpts, saleCodParc, filial)
          if (os) osResults.push({ ...os, _customer: entry.customer?.name, _nat: nat, _filial: filial, _clienteIdx: cIdx })
        }
      }

      if (itensSRV.length) {
        const codCliente = ctx().clienteCache.get(`${CNPJ_BARUERI}:${digits(entry.customer?.cnpj)}`)
        if (codCliente) {
          const os = await upsertOS(CNPJ_BARUERI, codCliente, entry.customer, itensSRV, 'SRV', business, obs, dealId, cIdx, upsertOpts, saleCodParc, 'barueri')
          if (os) osResults.push({ ...os, _customer: entry.customer?.name, _nat: 'SRV', _filial: 'barueri', _clienteIdx: cIdx })
        }
      }
    }

    // 4b) Serviço Interatell (SRV): sem fornecedor e sem OV — só OS, na filial do cliente.
    // O índice é deslocado por customers.length para não colidir com o código de
    // integração das OS dos clientes normais (OS-{deal}-C{idx}-{nat}).
    for (let sIdx = 0; sIdx < serviceCustomers.length; sIdx++) {
      const entry = serviceCustomers[sIdx]
      const items = (entry.items ?? []).filter((i: any) => String(i.description ?? '').trim())
      if (!items.length) continue

      // Servico Interatell e sempre faturado por Barueri.
      const codCliente = ctx().clienteCache.get(`${CNPJ_BARUERI}:${digits(entry.customer?.cnpj)}`)
      if (!codCliente) continue

      const os = await upsertOS(
        CNPJ_BARUERI, codCliente, entry.customer, items, 'SRV',
        business, obs, dealId, customers.length + sIdx, upsertOpts, saleCodParc, 'barueri',
      )
      if (os) osResults.push({ ...os, _customer: entry.customer?.name, _nat: 'SRV', _interatellService: true, _filial: 'barueri', _servicoIdx: sIdx })
    }

    // 5) Resumo com números dos pedidos
    assertNoOmieErrors(ocResults, 'OC')
    assertNoOmieErrors(ovResults, 'OV')
    assertNoOmieErrors(osResults, 'OS')

    const resumo = montaResumo(dealId, ocResults, ovResults, osResults, alteracoes)

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

    // 8) Números nos campos "Sistema Financeiro (Omie)" do card do Bitrix. Aqui, e
    // não na action que dispara o envio, porque o envio roda em segundo plano.
    // Best-effort: falha aqui não desfaz os pedidos, mas fica no log do servidor.
    try {
      if (deal.bitrix_deal_id) {
        await BitrixService.updateCardFinanceFields(String(deal.bitrix_deal_id), camposFinanceirosCard(payload, resumo))
      }
    } catch (err) {
      console.error(`[Bitrix] deal=${dealId} números do Omie não gravados no card:`, err)
    }

    console.log(`[Omie] deal=${dealId} enviado com sucesso —`, resumoMsg || 'sem pedidos criados')
    return NextResponse.json({ success: true, dealId, resumo })

  } catch (err: any) {
    console.error('omie/send error:', err)
    const mensagem = err?.message ?? 'Erro inesperado'

    // Pedidos criados antes da falha. Sem isto eles existiam no Omie mas não
    // apareciam no app nem no card do Bitrix. Soma com as tentativas anteriores.
    let dealRow: any = null
    let resumoParcial: any = null
    if (dealId) {
      try {
        ;[dealRow] = await sql`SELECT payload, omie_response, bitrix_deal_id FROM deals WHERE id = ${dealId}`
        const anterior = typeof dealRow?.omie_response === 'string' ? JSON.parse(dealRow.omie_response) : dealRow?.omie_response
        resumoParcial = juntaResumos(anterior?.resumo, montaResumo(dealId, ocResults, ovResults, osResults, []))
      } catch (e) {
        console.error(`[Omie] deal=${dealId} resumo parcial não montado:`, e)
      }
    }
    const criados = resumoParcial ? soCriados(resumoParcial) : null
    const temPedido = !!criados && criados.oc.length + criados.ov.length + criados.os.length > 0

    // O log final leva o resumo parcial: a tela de processamento mostra os
    // pedidos criados junto com o erro.
    await addOmieRawLog({
      transactionId: dealId, step: 'result', level: 'error', runId: ctx().runId,
      message: `result: Erro — ${mensagem}`,
      raw: { endpoint: '', httpStatus: 500, requestBodyRaw: '', responseBodyRaw: resumoParcial ? JSON.stringify(resumoParcial) : mensagem },
    }).catch(() => {})

    if (dealId && temPedido) {
      await sql`UPDATE deals SET status = 'failed', error_message = ${mensagem}, omie_response = ${JSON.stringify({ parcial: true, resumo: resumoParcial })}, updated_at = NOW() WHERE id = ${dealId}`.catch(() => {})
      if (dealRow?.bitrix_deal_id) {
        const payloadDeal = typeof dealRow.payload === 'string' ? JSON.parse(dealRow.payload) : dealRow.payload
        await BitrixService.updateCardFinanceFields(String(dealRow.bitrix_deal_id), camposFinanceirosCard(payloadDeal, criados))
          .catch(e => console.error(`[Bitrix] deal=${dealId} números parciais não gravados no card:`, e))
      }
    } else if (dealId) {
      await sql`UPDATE deals SET status = 'failed', error_message = ${mensagem}, updated_at = NOW() WHERE id = ${dealId}`.catch(() => {})
    }
    return NextResponse.json({ success: false, error: mensagem }, { status: 500 })
  }
}
