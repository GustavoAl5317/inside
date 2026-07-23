import 'server-only'
import { sql } from '@/lib/db'
import { addOmieRawLog } from '@/lib/unified-log-service'

const OMIE_URL = {
  PEDIDOS_VENDA:  'https://app.omie.com.br/api/v1/produtos/pedido/',
  PEDIDOS_COMPRA: 'https://app.omie.com.br/api/v1/produtos/pedidocompra/',
  ORDEM_SERVICO:  'https://app.omie.com.br/api/v1/servicos/os/',
  CLIENTES:       'https://app.omie.com.br/api/v1/geral/clientes/',
  PRODUTOS:       'https://app.omie.com.br/api/v1/geral/produtos/',
}

const CNPJ_ES = '03969530000211'
const CNPJ_BARUERI = '03969530000130'

export type OmieOrderKind = 'OC' | 'OV' | 'OS' | 'SW' | 'LC' | 'LIC' | 'ST' | 'SRV'

export type OmieOrderItemView = {
  key: string
  codigo: string
  descricao: string
  quantidade: number
  valorUnitario: number
  ncm?: string
  cfop?: string
}

export type OmieClienteView = {
  codigoOmie: number
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  inscricaoEstadual: string
  email: string
  contato: string
  telefone: string
  endereco: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  estado: string
  cep: string
}

export type OmieOrderView = {
  orderKind: OmieOrderKind
  orderLabel: string
  numero: string
  intCode: string
  internalId: number
  branch: 'barueri' | 'es'
  header: {
    observacaoExterna: string
    observacaoInterna: string
    dataPrevisao: string
    condicaoPagamento: string
    parceiro: string
  }
  cliente?: OmieClienteView
  fornecedor?: OmieClienteView
  items: OmieOrderItemView[]
  meta: Record<string, unknown>
}

export type OmieOrderPatch = {
  dealId: number
  branch: 'barueri' | 'es'
  orderKind: OmieOrderKind
  meta: Record<string, unknown>
  patch: {
    header?: Partial<OmieOrderView['header']>
    cliente?: Partial<OmieClienteView>
    fornecedor?: Partial<OmieClienteView>
    items?: Array<Partial<OmieOrderItemView> & { key: string }>
    /** Lista completa de itens — usada ao adicionar/remover linhas (substitui o pedido no Omie). */
    itemsReplace?: OmieOrderItemView[]
  }
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

const BITRIX_BASE = 'https://interatell.bitrix24.com.br'
const BITRIX_ENTITY_TYPE_ID = 129

/**
 * A observação interna sempre carrega o link do negócio no Bitrix, para quem
 * consultar o pedido no Omie conseguir voltar ao card de origem.
 * Busca o bitrix_deal_id pelo id interno do deal; se não achar, devolve o texto puro.
 */
async function withDealLinkForDeal(interna: string, dealId: number): Promise<string> {
  const texto = String(interna ?? '')
  if (!dealId) return texto
  try {
    const [row] = await sql`SELECT bitrix_deal_id FROM deals WHERE id = ${dealId}`
    const bitrixId = String(row?.bitrix_deal_id ?? '').trim()
    if (!bitrixId) return texto
    const link = `${BITRIX_BASE}/crm/type/${BITRIX_ENTITY_TYPE_ID}/details/${bitrixId}/`
    if (texto.includes(link)) return texto
    return [`Negócio: ${link}`, texto].filter(Boolean).join('\n')
  } catch {
    return texto
  }
}

export function branchToCnpj(branch: 'barueri' | 'es') {
  return branch === 'es' ? CNPJ_ES : CNPJ_BARUERI
}

function getCredentials(interatellCnpj: string) {
  return digits(interatellCnpj) === digits(CNPJ_ES)
    ? { app_key: process.env.OMIE_APP_KEY_2!, app_secret: process.env.OMIE_APP_SECRET_2! }
    : { app_key: process.env.OMIE_APP_KEY_1!, app_secret: process.env.OMIE_APP_SECRET_1! }
}

function toIsoDate(input: unknown): string {
  if (!input) return ''
  const s = String(input).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/')
    return `${y}-${m}-${d}`
  }
  return ''
}

function toOmieDate(input: unknown): string {
  const iso = toIsoDate(input)
  if (iso) {
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  const dt = new Date()
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
}

function onlyCode(v: unknown) {
  return String(v ?? '').split('-')[0].trim()
}

function normalizeNcm(ncm: unknown) {
  const d = String(ncm ?? '').replace(/\D/g, '')
  return d.length === 8 ? d : String(ncm ?? '')
}

function normalizeCfop(cfop: unknown) {
  const d = String(cfop ?? '').replace(/\D/g, '')
  return d || String(cfop ?? '')
}

function parseOmieProductCode(codigo: unknown): number | null {
  const n = Number(String(codigo ?? '').replace(/\D/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

// Chave estável de um item já existente no Omie — DEVE espelhar exatamente a
// mesma lógica usada em mapOCView/mapOVView/mapOSView, senão a linha do
// formulário não casa com a linha do Omie e o item é tratado como novo (duplica).
const ocItemKey = (p: any, i: number) => String(p.cCodIntItem ?? p.nCodItem ?? i + 1)
const ovItemKey = (d: any, i: number) => String(d.ide?.codigo_item_integracao ?? d.ide?.codigo_item ?? i + 1)
const osItemKey = (s: any, i: number) => String(s.nSeqItem ?? s.cCodIntServ ?? i + 1)

/** Gera códigos de integração novos e únicos para linhas adicionadas, sem colidir com os existentes. */
function makeNewCodeFactory(usedCodes: Iterable<string>) {
  const used = new Set(usedCodes)
  let seq = 0
  return () => {
    let code: string
    do { seq += 1; code = `n${Date.now().toString(36)}${seq}` } while (used.has(code))
    used.add(code)
    return code
  }
}

async function buildOCProdutosFromItems(cnpj: string, dealId: number, items: OmieOrderItemView[], currentProdutos: any[]) {
  const current = currentProdutos ?? []
  // Mantém a linha existente sempre com o MESMO cCodIntItem original (item.key já é
  // essa chave). Só linhas novas ganham um código inédito — assim o UpsertPedCompra
  // atualiza no lugar em vez de inserir uma cópia, e os itens omitidos são removidos.
  const nextNewCode = makeNewCodeFactory(current.map((p, i) => ocItemKey(p, i)))
  const out: Record<string, unknown>[] = []

  for (const item of items) {
    const existing = current.find((p, i) => ocItemKey(p, i) === String(item.key))
    // Compara na mesma base que o mapOCView exibe (part number/cCodIntProd primeiro),
    // senão um item inalterado pareceria "trocado" e re-resolveria o produto à toa.
    const existingCodigo = String(existing?.cCodIntProd ?? existing?.cProduto ?? existing?.nCodProd ?? '')
    const codeChanged = !!item.codigo && String(item.codigo) !== existingCodigo

    let ref: Record<string, unknown> = {}
    if (existing?.nCodProd && !codeChanged) {
      // mesmo produto: mantém o código interno atual do item
      ref = { nCodProd: existing.nCodProd }
    } else if (item.codigo) {
      // produto novo ou trocado: resolve o SKU no catálogo (cria se não existir) e usa o código interno
      ref = { nCodProd: await resolveOrCreateProduto(cnpj, dealId, item) }
    }

    out.push({
      cCodIntItem: existing ? String(item.key) : nextNewCode(),
      ...(existing?.nCodItem ? { nCodItem: existing.nCodItem } : {}),
      ...ref,
      cDescricao: item.descricao,
      cNCM: normalizeNcm(item.ncm ?? existing?.cNCM ?? ''),
      cUnidade: existing?.cUnidade ?? 'UN',
      nQtde: Number(item.quantidade ?? 1),
      nValUnit: Number(item.valorUnitario ?? 0),
      nPesoLiq: existing?.nPesoLiq ?? 0,
      nPesoBruto: existing?.nPesoBruto ?? 0,
    })
  }
  return out
}

async function buildOVDetFromItems(cnpj: string, dealId: number, items: OmieOrderItemView[], currentDet: any[]) {
  const current = currentDet ?? []
  const nextNewCode = makeNewCodeFactory(current.map((d, i) => ovItemKey(d, i)))
  const keptKeys = new Set(items.map(it => String(it.key)))
  const out: Record<string, unknown>[] = []

  for (const item of items) {
    const existing = current.find((d, i) => ovItemKey(d, i) === String(item.key))
    const existingCodigo = String(existing?.produto?.codigo ?? existing?.produto?.codigo_produto ?? '')
    const codeChanged = !!item.codigo && String(item.codigo) !== existingCodigo
    const produto: Record<string, unknown> = {
      cfop: normalizeCfop(item.cfop ?? existing?.produto?.cfop ?? ''),
      ncm: normalizeNcm(item.ncm ?? existing?.produto?.ncm ?? ''),
      descricao: item.descricao,
      quantidade: Number(item.quantidade ?? 1),
      unidade: existing?.produto?.unidade ?? 'UN',
      valor_unitario: Number(item.valorUnitario ?? 0),
      tipo_desconto: 'V',
      valor_desconto: 0,
    }
    if (existing?.produto?.codigo_produto && !codeChanged) {
      // mesmo produto: mantém o código interno atual do item
      produto.codigo_produto = existing.produto.codigo_produto
    } else if (item.codigo) {
      // produto novo ou trocado: resolve o SKU no catálogo (cria se não existir) e usa o código interno
      produto.codigo_produto = await resolveOrCreateProduto(cnpj, dealId, item)
    }
    out.push({
      ide: {
        // Linha existente conserva o código de integração original (item.key);
        // linha nova recebe um código inédito. Nunca reatribuir por posição.
        codigo_item_integracao: existing ? String(item.key) : nextNewCode(),
        ...(existing?.ide?.codigo_item ? { codigo_item: existing.ide.codigo_item } : {}),
      },
      produto,
    })
  }

  // Itens que o usuário removeu do formulário: o Omie só exclui de fato quando a
  // linha é reenviada com acao_item = "E" (identificada pelo código original).
  current.forEach((d, i) => {
    const key = ovItemKey(d, i)
    if (keptKeys.has(key)) return
    out.push({
      ide: {
        codigo_item_integracao: key,
        ...(d.ide?.codigo_item ? { codigo_item: d.ide.codigo_item } : {}),
        acao_item: 'E',
      },
      produto: {
        ...(d.produto?.codigo_produto ? { codigo_produto: d.produto.codigo_produto } : {}),
      },
    })
  })

  return out
}

function buildOSServicosFromItems(items: OmieOrderItemView[], currentServicos: any[]) {
  const current = currentServicos ?? []
  const keptKeys = new Set(items.map(it => String(it.key)))
  // Item novo não pode reaproveitar um nSeqItem já usado (senão o Omie sobrescreve
  // ou duplica) — parte do maior sequencial existente e segue incrementando.
  let nextSeq = current.reduce((m, s) => Math.max(m, Number(s.nSeqItem ?? 0)), 0)

  const out: Record<string, unknown>[] = items.map((item) => {
    const existing = current.find((s, i) => osItemKey(s, i) === String(item.key))
    const codigoNum = parseOmieProductCode(item.codigo)
    const seq = existing ? Number(existing.nSeqItem) : (nextSeq += 1)
    const row: Record<string, unknown> = {
      nSeqItem: seq,
      cAcaoItem: existing ? 'A' : 'I',
      ...(existing?.nIdItem ? { nIdItem: existing.nIdItem } : {}),
      nCodServico: existing?.nCodServico ?? codigoNum ?? undefined,
      cCodServLC116: existing?.cCodServLC116,
      cCodServMun: existing?.cCodServMun,
      cDescServ: item.descricao,
      cDadosAdicItem: item.descricao,
      nQtde: Number(item.quantidade ?? 1),
      nValUnit: Number(item.valorUnitario ?? 0),
      cRetemISS: existing?.cRetemISS ?? 'N',
      cTribServ: existing?.cTribServ ?? '01',
    }
    if (existing?.impostos) row.impostos = existing.impostos
    return row
  })

  // Serviços removidos pelo usuário: reenviados com cAcaoItem "E" para o Omie excluir.
  current.forEach((s, i) => {
    const key = osItemKey(s, i)
    if (keptKeys.has(key)) return
    out.push({
      nSeqItem: Number(s.nSeqItem ?? i + 1),
      cAcaoItem: 'E',
      ...(s.nIdItem ? { nIdItem: s.nIdItem } : {}),
      nCodServico: s.nCodServico,
      cCodServLC116: s.cCodServLC116,
      cCodServMun: s.cCodServMun,
      cDescServ: s.cDescServ,
      nQtde: Number(s.nQtde ?? 1),
      nValUnit: Number(s.nValUnit ?? 0),
      cRetemISS: s.cRetemISS ?? 'N',
      cTribServ: s.cTribServ ?? '01',
    })
  })

  return out
}

function numeroMatches(a: unknown, b: unknown) {
  const da = digits(a)
  const db = digits(b)
  if (!da || !db) return false
  return da === db || da.endsWith(db) || db.endsWith(da)
}

async function omieRequest(
  interatellCnpj: string,
  url: string,
  call: string,
  param: object,
  dealId: number,
  step: string,
) {
  const { app_key, app_secret } = getCredentials(interatellCnpj)
  const body = { call, app_key, app_secret, param: [param] }
  await new Promise(r => setTimeout(r, Number(process.env.OMIE_SLEEP_MS ?? 260)))

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const text = await resp.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch {
    data = { faultstring: `Resposta inválida do Omie (HTTP ${resp.status})`, faultcode: 'INVALID_RESPONSE' }
  }
  const level = resp.ok && !data?.faultstring ? 'success' : 'error'

  await addOmieRawLog({
    transactionId: dealId,
    step: step as any,
    level: level === 'success' ? 'success' : 'error',
    message: `${step}: HTTP ${resp.status}`,
    raw: { endpoint: url, httpStatus: resp.status, requestBodyRaw: JSON.stringify(body), responseBodyRaw: text },
  }).catch(() => {})

  return data
}

function kindLabel(kind: OmieOrderKind) {
  const map: Record<OmieOrderKind, string> = {
    OC: 'Ordem de Compra (OC)',
    OV: 'Ordem de Venda (OV)',
    OS: 'Ordem de Serviço (OS)',
    SW: 'Ordem de Serviço — Software (SW)',
    LC: 'Ordem de Serviço — Licença (LC)',
    LIC: 'Ordem de Serviço — Licença (LIC)',
    ST: 'Ordem de Serviço — Terceiro (ST)',
    SRV: 'Ordem de Serviço — Serviço (SRV)',
  }
  return map[kind] ?? kind
}

function resolveKind(kind: OmieOrderKind): 'OC' | 'OV' | 'OS' {
  if (kind === 'OC') return 'OC'
  if (kind === 'OV') return 'OV'
  return 'OS'
}

function mapClienteView(c: Record<string, unknown>): OmieClienteView {
  const ddd = String(c.telefone1_ddd ?? '')
  const tel = String(c.telefone1_numero ?? '')
  const telefone = [ddd, tel].filter(Boolean).join(' ').trim() || String(c.telefone ?? '')
  return {
    codigoOmie: Number(c.codigo_cliente_omie ?? 0),
    razaoSocial: String(c.razao_social ?? ''),
    nomeFantasia: String(c.nome_fantasia ?? ''),
    cnpj: String(c.cnpj_cpf ?? ''),
    inscricaoEstadual: String(c.inscricao_estadual ?? ''),
    email: String(c.email ?? ''),
    contato: String(c.contato ?? ''),
    telefone,
    endereco: String(c.endereco ?? ''),
    numero: String(c.endereco_numero ?? ''),
    complemento: String(c.complemento ?? ''),
    bairro: String(c.bairro ?? ''),
    cidade: String(c.cidade ?? ''),
    estado: String(c.estado ?? ''),
    cep: String(c.cep ?? ''),
  }
}

async function consultClienteFull(interatellCnpj: string, dealId: number, codigoCliente: number) {
  if (!codigoCliente) return null
  const res = await omieRequest(interatellCnpj, OMIE_URL.CLIENTES, 'ConsultarCliente', {
    codigo_cliente_omie: codigoCliente,
  }, dealId, 'checkCliente')
  if (!res || res.faultstring) return null
  const c = res.clientes_cadastro ?? res
  if (!c?.codigo_cliente_omie) return null
  return c as Record<string, unknown>
}

/** Faltas do Omie que indicam limite/bloqueio de uso — NÃO significam "produto inexistente". */
function isOmieRateLimitFault(faultstring: unknown): boolean {
  const s = String(faultstring ?? '').toUpperCase()
  return s.includes('REDUNDANT')
    || s.includes('MISUSE_API_PROCESS')
    || s.includes('CONSUMO REDUNDANTE')
    || s.includes('API BLOQUEADA')
    || s.includes('BLOQUEADA POR CONSUMO')
}

function rateLimitError(faultstring: unknown): Error {
  return new Error(
    `Omie temporariamente bloqueado por excesso de chamadas — aguarde alguns minutos e tente de novo. (${String(faultstring ?? '')})`,
  )
}

/**
 * Resolve um part number (SKU) no catálogo do Omie e devolve o código interno (codigo_produto).
 * Tenta por `codigo` (SKU) e por `codigo_produto_integracao` (ex.: "B5NH6AA#AC4", cujo código
 * real pode ser outro, tipo "AA36022"). Só tenta `codigo_produto` quando o valor é numérico —
 * mandar texto nessa tag só gera erro "tag obrigatória" e desperdiça chamada.
 * Devolve null quando o produto realmente não está cadastrado; lança se a API estiver bloqueada.
 */
async function resolveProdutoByCodigo(
  cnpj: string,
  dealId: number,
  codigo: unknown,
): Promise<{ codigoProduto: number; codigo: string } | null> {
  const sku = String(codigo ?? '').trim()
  if (!sku) return null

  const attempts: Record<string, unknown>[] = [
    { codigo: sku },
    { codigo_produto_integracao: sku },
  ]
  const numeric = sku.replace(/\D/g, '')
  if (numeric && numeric === sku) attempts.push({ codigo_produto: Number(numeric) })

  for (const param of attempts) {
    const res = await omieRequest(cnpj, OMIE_URL.PRODUTOS, 'ConsultarProduto', param, dealId, 'checkProduto')
    if (res?.faultstring) {
      // Rate-limit/bloqueio: aborta em vez de fingir que o produto não existe e cadastrar duplicado.
      if (isOmieRateLimitFault(res.faultstring)) throw rateLimitError(res.faultstring)
      continue // "não cadastrado" → tenta o próximo critério
    }
    const prod = res?.produto_servico_cadastro ?? res
    const codigoProduto = Number(prod?.codigo_produto ?? 0)
    if (codigoProduto) return { codigoProduto, codigo: String(prod?.codigo ?? sku) }
  }
  return null
}

/**
 * Cadastra um produto novo no catálogo do Omie a partir do item do pedido.
 * Usado quando o part number informado ainda não existe — assim o usuário não cadastra na mão.
 */
async function createProdutoByCodigo(cnpj: string, dealId: number, item: OmieOrderItemView): Promise<number | null> {
  const sku = String(item.codigo ?? '').trim()
  if (!sku) return null

  const params: Record<string, unknown> = {
    codigo: sku,
    codigo_produto_integracao: sku,
    descricao: String(item.descricao ?? '').trim() || sku,
    unidade: 'UN',
    ncm: normalizeNcm(item.ncm ?? ''),
    valor_unitario: Number(item.valorUnitario ?? 0),
  }
  const res = await omieRequest(cnpj, OMIE_URL.PRODUTOS, 'IncluirProduto', params, dealId, 'createProduto')

  if (res?.faultstring) {
    if (isOmieRateLimitFault(res.faultstring)) throw rateLimitError(res.faultstring)
    // O produto já existe pelo código de integração: o Omie devolve o ID no próprio erro,
    // ex.: "Produto já cadastrado ... (ID: 5822707631 / Código: AA36022)". Aproveita o ID.
    const jaCad = String(res.faultstring).match(/ID:\s*(\d+)/i)
    if (jaCad) return Number(jaCad[1])
    // Corrida/duplicidade sem ID na mensagem: tenta resolver de novo.
    const again = await resolveProdutoByCodigo(cnpj, dealId, sku)
    if (again) return again.codigoProduto
    throw new Error(`Não foi possível cadastrar o part number "${sku}" no Omie: ${res.faultstring}`)
  }
  const codigoProduto = Number(res?.codigo_produto ?? 0)
  return codigoProduto || null
}

/** Resolve o part number no catálogo Omie; se não existir, cadastra e devolve o código interno. */
async function resolveOrCreateProduto(cnpj: string, dealId: number, item: OmieOrderItemView): Promise<number> {
  const resolved = await resolveProdutoByCodigo(cnpj, dealId, item.codigo)
  if (resolved) return resolved.codigoProduto
  const created = await createProdutoByCodigo(cnpj, dealId, item)
  if (created) return created
  throw new Error(`Não foi possível resolver nem cadastrar o part number "${item.codigo}" no Omie.`)
}

async function attachCliente(view: OmieOrderView, cnpj: string, dealId: number): Promise<OmieOrderView> {
  const codigoCliente = Number(view.meta.codigoCliente ?? view.meta.nCodCli ?? 0)
  if (!codigoCliente) return view
  const raw = await consultClienteFull(cnpj, dealId, codigoCliente)
  if (!raw) return view
  const cliente = mapClienteView(raw)
  return {
    ...view,
    header: { ...view.header, parceiro: cliente.razaoSocial || cliente.nomeFantasia || view.header.parceiro },
    cliente,
    meta: { ...view.meta, codigoCliente: cliente.codigoOmie },
  }
}

/** Fornecedores no Omie (sem módulo Compras) ficam no cadastro de clientes. */
async function attachFornecedor(view: OmieOrderView, cnpj: string, dealId: number): Promise<OmieOrderView> {
  const nCodFor = Number(view.meta.nCodFor ?? 0)
  if (!nCodFor) return view
  const raw = await consultClienteFull(cnpj, dealId, nCodFor)
  if (!raw) return view
  const fornecedor = mapClienteView(raw)
  return {
    ...view,
    header: { ...view.header, parceiro: fornecedor.razaoSocial || fornecedor.nomeFantasia || view.header.parceiro },
    fornecedor,
    meta: { ...view.meta, nCodFor: fornecedor.codigoOmie },
  }
}

async function resolveClienteForOrder(
  interatellCnpj: string,
  dealId: number,
  orderNumero: string,
  target: OmieClienteView,
): Promise<number> {
  const cnpj = digits(target.cnpj)
  if (!cnpj) throw new Error('CNPJ do cliente é obrigatório.')

  const list = await omieRequest(interatellCnpj, OMIE_URL.CLIENTES, 'ListarClientes', {
    pagina: 1,
    registros_por_pagina: 10,
    apenas_importado_api: 'N',
    clientesFiltro: { cnpj_cpf: cnpj },
  }, dealId, 'checkCliente')

  const rows: any[] = list?.clientes_cadastro ?? []
  const found = rows.find(r => digits(r.cnpj_cpf) === cnpj)
  if (found?.codigo_cliente_omie) return Number(found.codigo_cliente_omie)

  // A empresa não existe no Omie e precisará ser cadastrada. O Omie exige UF + cidade
  // para resolver o código do município; sem isso o cadastro falha com erro genérico.
  const estado = (target.estado ?? '').trim().toUpperCase().slice(0, 2)
  const cidade = (target.cidade ?? '').trim()
  if (!estado || estado.length !== 2 || !cidade) {
    throw new Error(
      `Para cadastrar "${target.razaoSocial || target.nomeFantasia || 'a empresa'}" no Omie é obrigatório informar a cidade e o estado (UF). Preencha esses campos e tente novamente.`,
    )
  }

  const created = await omieRequest(interatellCnpj, OMIE_URL.CLIENTES, 'IncluirCliente', {
    codigo_cliente_integracao: `PED-${orderNumero}-${cnpj.slice(-6)}`,
    cnpj_cpf: target.cnpj,
    razao_social: target.razaoSocial || target.nomeFantasia,
    nome_fantasia: target.nomeFantasia || target.razaoSocial,
    inscricao_estadual: target.inscricaoEstadual ?? '',
    contato: target.contato ?? '',
    email: target.email ?? '',
    endereco: target.endereco ?? '',
    endereco_numero: target.numero || 'S/N',
    bairro: target.bairro ?? '',
    complemento: target.complemento ?? '',
    cidade,
    estado,
    cep: digits(target.cep),
    pessoa_fisica: cnpj.length === 11 ? 'S' : 'N',
    dadosBancarios: { codigo_banco: '001', agencia: '0000000001', conta_corrente: '0000000001' },
  }, dealId, 'createCliente')

  const codigo = Number(created?.codigo_cliente_omie)
  if (!codigo) throw new Error(created?.faultstring || 'Não foi possível cadastrar o cliente no Omie.')
  return codigo
}

function mergeClientePatch(current: OmieClienteView, patch: Partial<OmieClienteView>): OmieClienteView {
  return { ...current, ...patch }
}

/** Snapshot Marfrig antes da alteração acidental em 08/06/2026 (cod. Omie 5271878606) */
export const MARFRIG_5271878606_SNAPSHOT: Record<string, unknown> = {
  codigo_cliente_omie: 5271878606,
  razao_social: 'MARFRIG GLOBAL FOODS S.A.',
  cnpj_cpf: '03.853.896/0068-57',
  nome_fantasia: 'MARFRIG',
  telefone1_ddd: '65',
  telefone1_numero: '3311-3800',
  endereco: 'ALAMEDA JULIO MULLER (RES ALAMEDA)',
  endereco_numero: '1650',
  bairro: 'PONTE NOVA',
  complemento: 'ALA 2 SALA 2',
  estado: 'MT',
  cidade: 'VARZEA GRANDE (MT)',
  cep: '78115200',
  email: 'recebe_nfe@marfrig.com.br,adm.ti@marfrig.com.br',
  pessoa_fisica: 'N',
}

/** Restaura cadastro global do cliente no Omie (usar só para desfazer alteração acidental). */
export async function restoreOmieClienteFromSnapshot(params: {
  dealId: number
  branch: 'barueri' | 'es'
  codigoCliente: number
  snapshot: Record<string, unknown>
}) {
  const cnpj = branchToCnpj(params.branch)
  const current = await consultClienteFull(cnpj, params.dealId, params.codigoCliente)
  if (!current) throw new Error(`Cliente ${params.codigoCliente} não encontrado no Omie.`)

  const body: Record<string, unknown> = { ...current, ...params.snapshot, codigo_cliente_omie: params.codigoCliente }
  const res = await omieRequest(cnpj, OMIE_URL.CLIENTES, 'AlterarCliente', body, params.dealId, 'createCliente')
  if (res?.faultstring) throw new Error(res.faultstring)
  return mapClienteView((res.clientes_cadastro ?? body) as Record<string, unknown>)
}

// ─── Consult OC ────────────────────────────────────────────────────────────────
async function consultOCFull(interatellCnpj: string, dealId: number, param: object) {
  const res = await omieRequest(interatellCnpj, OMIE_URL.PEDIDOS_COMPRA, 'ConsultarPedCompra', param, dealId, 'checkOC')
  if (!res || res.faultstring) return null
  const wrapped = Array.isArray(res.pedidos_pesquisa) ? res.pedidos_pesquisa[0] : undefined
  const cab = res.cabecalho_consulta ?? res.cabecalho ?? wrapped?.cabecalho_consulta
  const produtos = res.produtos_consulta ?? wrapped?.produtos_consulta ?? []
  if (!cab?.nCodPed) return null
  return { cab, produtos, intCode: cab.cCodIntPed ?? '' }
}

async function findOCByNumero(interatellCnpj: string, dealId: number, numero: string) {
  const trimmed = numero.trim()
  const n = digits(trimmed)
  if (!trimmed && !n) return null

  for (const candidate of [trimmed, n].filter((v, i, a) => v && a.indexOf(v) === i)) {
    const byNumero = await consultOCFull(interatellCnpj, dealId, { cNumero: candidate })
    if (byNumero) return byNumero
  }

  if (/[A-Za-z-]/.test(trimmed)) {
    const byInt = await consultOCFull(interatellCnpj, dealId, { cCodIntPed: trimmed })
    if (byInt) return byInt
  }

  const numInt = Number(n)
  if (numInt > 0) {
    const byId = await consultOCFull(interatellCnpj, dealId, { nCodPed: numInt })
    if (byId) return byId
  }

  return null
}

function mapOCView(kind: OmieOrderKind, branch: 'barueri' | 'es', data: NonNullable<Awaited<ReturnType<typeof findOCByNumero>>>) {
  const items: OmieOrderItemView[] = (data.produtos ?? []).map((p: any, i: number) => ({
    key: String(p.cCodIntItem ?? p.nCodItem ?? i + 1),
    // Mostra o part number (código de integração) e não o SKU interno do Omie
    // (ex.: "C9200L-48P-4X-E" em vez de "AA39915"). Cai para o cProduto se não houver.
    codigo: String(p.cCodIntProd ?? p.cProduto ?? ''),
    descricao: String(p.cDescricao ?? ''),
    quantidade: Number(p.nQtde ?? 1),
    valorUnitario: Number(p.nValUnit ?? 0),
    ncm: String(p.cNCM ?? ''),
  }))
  return {
    orderKind: kind,
    orderLabel: kindLabel(kind),
    numero: String(data.cab.cNumero ?? data.cab.cNumPedido ?? data.cab.nCodPed),
    intCode: String(data.intCode ?? data.cab.cCodIntPed ?? ''),
    internalId: Number(data.cab.nCodPed),
    branch,
    header: {
      observacaoExterna: String(data.cab.cObs ?? ''),
      observacaoInterna: String(data.cab.cObsInt ?? ''),
      dataPrevisao: toIsoDate(data.cab.dDtPrevisao),
      condicaoPagamento: String(data.cab.cCodParc ?? ''),
      parceiro: String(data.cab.cCodIntFor ?? data.cab.nCodFor ?? ''),
    },
    items,
    meta: {
      orderKind: kind,
      intCode: data.intCode ?? data.cab.cCodIntPed,
      internalId: data.cab.nCodPed,
      nCodFor: data.cab.nCodFor,
      itemKeys: items.map(i => i.key),
    },
  } satisfies OmieOrderView
}

// ─── Consult OV ────────────────────────────────────────────────────────────────
async function consultOVFull(interatellCnpj: string, dealId: number, param: object) {
  const res = await omieRequest(interatellCnpj, OMIE_URL.PEDIDOS_VENDA, 'ConsultarPedido', param, dealId, 'checkOV')
  if (!res || res.faultstring) return null
  const pvp = res.pedido_venda_produto
  const cab = pvp?.cabecalho
  if (!cab?.codigo_pedido) return null
  return {
    cab,
    det: pvp?.det ?? [],
    obs: pvp?.observacoes?.obs_venda ?? '',
    informacoes_adicionais: pvp?.informacoes_adicionais ?? {},
    intCode: cab.codigo_pedido_integracao ?? '',
  }
}

async function findOVByNumero(interatellCnpj: string, dealId: number, numero: string) {
  const trimmed = numero.trim()
  const n = digits(trimmed)
  if (!trimmed && !n) return null

  for (const candidate of [trimmed, n].filter((v, i, a) => v && a.indexOf(v) === i)) {
    const byNumero = await consultOVFull(interatellCnpj, dealId, { numero_pedido: candidate })
    if (byNumero) return byNumero
  }

  if (/[A-Za-z-]/.test(trimmed)) {
    const byInt = await consultOVFull(interatellCnpj, dealId, { codigo_pedido_integracao: trimmed })
    if (byInt) return byInt
  }

  const numInt = Number(n)
  if (numInt > 0) {
    const list = await omieRequest(interatellCnpj, OMIE_URL.PEDIDOS_VENDA, 'ListarPedidos', {
      pagina: 1,
      registros_por_pagina: 50,
      apenas_importado_api: 'N',
      numero_pedido_de: numInt,
      numero_pedido_ate: numInt,
    }, dealId, 'checkOV')
    const rows = list?.pedido_venda_produto ?? list?.pedidos_venda ?? []
    const flat = Array.isArray(rows) ? rows : []
    for (const row of flat) {
      const cab = row.cabecalho ?? row
      if (cab?.codigo_pedido && numeroMatches(cab.numero_pedido ?? cab.cNumero, numero)) {
        return consultOVFull(interatellCnpj, dealId, { codigo_pedido: cab.codigo_pedido })
      }
    }
    const first = flat[0]?.cabecalho ?? flat[0]
    if (first?.codigo_pedido && flat.length === 1) {
      return consultOVFull(interatellCnpj, dealId, { codigo_pedido: first.codigo_pedido })
    }

    const byId = await consultOVFull(interatellCnpj, dealId, { codigo_pedido: numInt })
    if (byId) return byId
  }

  return null
}

function mapOVView(kind: OmieOrderKind, branch: 'barueri' | 'es', data: NonNullable<Awaited<ReturnType<typeof findOVByNumero>>>) {
  const items: OmieOrderItemView[] = (data.det ?? []).map((d: any, i: number) => ({
    key: String(d.ide?.codigo_item_integracao ?? d.ide?.codigo_item ?? i + 1),
    codigo: String(d.produto?.codigo ?? d.produto?.codigo_produto ?? ''),
    descricao: String(d.produto?.descricao ?? ''),
    quantidade: Number(d.produto?.quantidade ?? 1),
    valorUnitario: Number(d.produto?.valor_unitario ?? 0),
    ncm: String(d.produto?.ncm ?? ''),
    cfop: String(d.produto?.cfop ?? ''),
  }))
  return {
    orderKind: kind,
    orderLabel: kindLabel(kind),
    numero: String(data.cab.numero_pedido ?? data.cab.codigo_pedido),
    intCode: String(data.intCode ?? data.cab.codigo_pedido_integracao ?? ''),
    internalId: Number(data.cab.codigo_pedido),
    branch,
    header: {
      // obs_venda não sai na NF → é a interna. A externa é dados_adicionais_nf.
      observacaoExterna: String(data.informacoes_adicionais?.dados_adicionais_nf ?? '').replace(/\|/g, '\n'),
      observacaoInterna: String(data.obs ?? data.cab.obs_venda ?? ''),
      dataPrevisao: toIsoDate(data.cab.data_previsao),
      condicaoPagamento: String(data.cab.codigo_parcela ?? ''),
      parceiro: String(data.cab.codigo_cliente ?? ''),
    },
    items,
    meta: {
      orderKind: kind,
      intCode: data.intCode ?? data.cab.codigo_pedido_integracao,
      internalId: data.cab.codigo_pedido,
      codigoCliente: data.cab.codigo_cliente,
      itemKeys: items.map(i => i.key),
    },
  } satisfies OmieOrderView
}

// ─── Consult OS ──────────────────────────────────────────────────────────────
async function consultOSFull(interatellCnpj: string, dealId: number, param: object) {
  const res = await omieRequest(interatellCnpj, OMIE_URL.ORDEM_SERVICO, 'ConsultarOS', param, dealId, 'checkOS')
  if (!res || res.faultstring) return null
  const cab = res.Cabecalho ?? res.cabecalho
  if (!cab?.nCodOS) return null
  return {
    cab,
    servicos: res.ServicosPrestados ?? res.servicos_prestados ?? [],
    intCode: cab.cCodIntOS ?? '',
    raw: res,
  }
}

async function findOSByNumero(interatellCnpj: string, dealId: number, numero: string) {
  const trimmed = numero.trim()
  const n = digits(trimmed)
  if (!trimmed && !n) return null

  for (const candidate of [trimmed, n].filter((v, i, a) => v && a.indexOf(v) === i)) {
    const byNumero = await consultOSFull(interatellCnpj, dealId, { cNumOS: candidate })
    if (byNumero) return byNumero
  }

  if (/[A-Za-z-]/.test(trimmed)) {
    const byInt = await consultOSFull(interatellCnpj, dealId, { cCodIntOS: trimmed })
    if (byInt) return byInt
  }

  const numInt = Number(n)
  if (numInt > 0) {
    const byId = await consultOSFull(interatellCnpj, dealId, { nCodOS: numInt })
    if (byId) return byId
  }

  return null
}

function mapOSView(kind: OmieOrderKind, branch: 'barueri' | 'es', data: NonNullable<Awaited<ReturnType<typeof findOSByNumero>>>) {
  const items: OmieOrderItemView[] = (data.servicos ?? []).map((s: any, i: number) => ({
    key: String(s.nSeqItem ?? s.cCodIntServ ?? i + 1),
    codigo: String(s.nCodServico ?? s.cCodServ ?? ''),
    descricao: String(s.cDescServ ?? s.cDescricao ?? ''),
    quantidade: Number(s.nQtde ?? 1),
    valorUnitario: Number(s.nValUnit ?? 0),
  }))
  return {
    orderKind: kind,
    orderLabel: kindLabel(kind),
    numero: String(data.cab.cNumOS ?? data.cab.nCodOS),
    intCode: String(data.intCode ?? data.cab.cCodIntOS ?? ''),
    internalId: Number(data.cab.nCodOS),
    branch,
    header: {
      // cObsOS é a interna da OS; a externa (que sai na NF) é cDadosAdicNF.
      observacaoExterna: String(
        (data as any).raw?.InformacoesAdicionais?.cDadosAdicNF
        ?? (data as any).raw?.informacoesAdicionais?.cDadosAdicNF
        ?? '',
      ),
      observacaoInterna: String(data.cab.cObsOS ?? ''),
      dataPrevisao: toIsoDate(data.cab.dDtPrevisao),
      condicaoPagamento: String(data.cab.cCodParc ?? ''),
      parceiro: String(data.cab.nCodCli ?? ''),
    },
    items,
    meta: {
      orderKind: kind,
      intCode: data.intCode ?? data.cab.cCodIntOS,
      internalId: data.cab.nCodOS,
      nCodCli: data.cab.nCodCli,
      itemKeys: items.map(i => i.key),
    },
  } satisfies OmieOrderView
}

export async function consultOmieOrderByNumero(params: {
  dealId: number
  branch: 'barueri' | 'es'
  orderKind: OmieOrderKind
  numero: string
}): Promise<OmieOrderView> {
  const numero = params.numero.trim()
  if (!numero) throw new Error('Informe o número do pedido Omie.')

  const branches: ('barueri' | 'es')[] = params.branch === 'es' ? ['es', 'barueri'] : ['barueri', 'es']
  let lastError = ''

  for (const branch of branches) {
    try {
      const view = await consultOmieOrderInBranch({ ...params, branch, numero })
      if (branch !== params.branch) {
        view.branch = branch
      }
      return view
    } catch (err: any) {
      lastError = err?.message ?? 'Pedido não encontrado'
    }
  }

  throw new Error(
    lastError.includes('não encontrad')
      ? `${lastError} Verifique o tipo (OC/OV/OS), o número e a filial.`
      : lastError,
  )
}

async function consultOmieOrderInBranch(params: {
  dealId: number
  branch: 'barueri' | 'es'
  orderKind: OmieOrderKind
  numero: string
}): Promise<OmieOrderView> {
  const cnpj = branchToCnpj(params.branch)
  const base = resolveKind(params.orderKind)
  const numero = params.numero.trim()

  if (base === 'OC') {
    const data = await findOCByNumero(cnpj, params.dealId, numero)
    if (!data) throw new Error('OC não encontrada no Omie com este número.')
    return attachFornecedor(mapOCView(params.orderKind, params.branch, data), cnpj, params.dealId)
  }
  if (base === 'OV') {
    const data = await findOVByNumero(cnpj, params.dealId, numero)
    if (!data) throw new Error('OV não encontrada no Omie com este número.')
    return attachCliente(mapOVView(params.orderKind, params.branch, data), cnpj, params.dealId)
  }
  const data = await findOSByNumero(cnpj, params.dealId, numero)
  if (!data) throw new Error('OS não encontrada no Omie com este número.')
  return attachCliente(mapOSView(params.orderKind, params.branch, data), cnpj, params.dealId)
}

// ─── Patch (só campos enviados no patch; resto vem da consulta atual) ─────────
export async function patchOmieOrder(input: OmieOrderPatch) {
  const cnpj = branchToCnpj(input.branch)
  const base = resolveKind(input.orderKind)
  const meta = input.meta ?? {}
  const internalId = Number(meta.internalId)
  const intCode = String(meta.intCode ?? '')
  if (!internalId) throw new Error('Meta do pedido inválida. Busque o pedido novamente.')

  if (base === 'OC') {
    const current = await consultOCFull(cnpj, input.dealId, { nCodPed: internalId })
    if (!current) throw new Error('Não foi possível recarregar a OC antes de atualizar.')

    const cab = { ...current.cab }
    if (input.patch.header?.observacaoExterna !== undefined) cab.cObs = input.patch.header.observacaoExterna
    if (input.patch.header?.observacaoInterna !== undefined) {
      cab.cObsInt = await withDealLinkForDeal(input.patch.header.observacaoInterna, input.dealId)
    }
    if (input.patch.header?.dataPrevisao) cab.dDtPrevisao = toOmieDate(input.patch.header.dataPrevisao)
    if (input.patch.header?.condicaoPagamento) cab.cCodParc = onlyCode(input.patch.header.condicaoPagamento)

    let nCodFor = Number(cab.nCodFor)
    const hasFornecedorPatch = !!(input.patch.fornecedor && Object.keys(input.patch.fornecedor).length)

    if (hasFornecedorPatch) {
      const codigoAtual = Number(meta.nCodFor ?? cab.nCodFor ?? 0)
      const rawFornecedor = codigoAtual
        ? await consultClienteFull(cnpj, input.dealId, codigoAtual)
        : null
      const baseView = rawFornecedor
        ? mapClienteView(rawFornecedor)
        : {
            codigoOmie: 0,
            razaoSocial: '',
            nomeFantasia: '',
            cnpj: '',
            inscricaoEstadual: '',
            email: '',
            contato: '',
            telefone: '',
            endereco: '',
            numero: '',
            complemento: '',
            bairro: '',
            cidade: '',
            estado: '',
            cep: '',
          }
      const merged = mergeClientePatch(baseView, input.patch.fornecedor!)
      nCodFor = await resolveClienteForOrder(
        cnpj,
        input.dealId,
        String(cab.cNumero ?? cab.cNumPedido ?? internalId),
        merged,
      )
      cab.nCodFor = nCodFor
    }

    const produtos = input.patch.itemsReplace?.length
      ? await buildOCProdutosFromItems(cnpj, input.dealId, input.patch.itemsReplace, current.produtos ?? [])
      : (current.produtos ?? []).map((p: any) => {
        const key = String(p.cCodIntItem ?? p.nCodItem ?? '')
        const ch = input.patch.items?.find(i => i.key === key)
        return {
          cCodIntItem: String(p.cCodIntItem ?? key),
          nCodProd: p.nCodProd,
          cCodIntProd: p.cCodIntProd,
          cDescricao: ch?.descricao ?? p.cDescricao,
          cNCM: ch?.ncm !== undefined ? ch.ncm : p.cNCM,
          cUnidade: p.cUnidade ?? 'UN',
          nQtde: ch?.quantidade !== undefined ? Number(ch.quantidade) : Number(p.nQtde ?? 1),
          nValUnit: ch?.valorUnitario !== undefined ? Number(ch.valorUnitario) : Number(p.nValUnit ?? 0),
          nPesoLiq: p.nPesoLiq ?? 0,
          nPesoBruto: p.nPesoBruto ?? 0,
        }
      })

    const hasOrderChanges = hasFornecedorPatch
      || !!(input.patch.header && Object.keys(input.patch.header).length)
      || !!(input.patch.items?.length)
      || !!(input.patch.itemsReplace?.length)
    if (!hasOrderChanges) {
      return {
        success: true as const,
        numero: cab.cNumero ?? cab.cNumPedido ?? internalId,
        response: { noop: true },
      }
    }

    const upsertBody: Record<string, unknown> = {
      cabecalho_upsert: {
        cCodIntPed: intCode || cab.cCodIntPed,
        nCodFor: cab.nCodFor,
        cCodParc: cab.cCodParc,
        dDtPrevisao: cab.dDtPrevisao,
        cObs: cab.cObs ?? '',
        cObsInt: cab.cObsInt ?? '',
      },
    }
    if (input.patch.items?.length || input.patch.itemsReplace?.length) upsertBody.produtos_upsert = produtos

    const res = await omieRequest(cnpj, OMIE_URL.PEDIDOS_COMPRA, 'UpsertPedCompra', upsertBody, input.dealId, 'createOCResult')

    if (res?.faultstring) throw new Error(res.faultstring)
    if (res?.status === 'error') throw new Error(res.message ?? 'Erro ao atualizar OC no Omie.')
    const numero = res?.cNumero ?? res?.nCodPed ?? cab.cNumero ?? String(internalId)
    return { success: true as const, numero, response: res }
  }

  if (base === 'OV') {
    const current = await consultOVFull(cnpj, input.dealId, { codigo_pedido: internalId })
    if (!current) throw new Error('Não foi possível recarregar a OV antes de atualizar.')

    let codigoCliente = Number(current.cab.codigo_cliente)
    const hasClientePatch = !!(input.patch.cliente && Object.keys(input.patch.cliente).length)

    if (hasClientePatch) {
      const codigoAtual = Number(meta.codigoCliente ?? current.cab.codigo_cliente)
      const rawCliente = await consultClienteFull(cnpj, input.dealId, codigoAtual)
      if (!rawCliente) throw new Error('Cliente do pedido não encontrado no Omie.')
      const merged = mergeClientePatch(mapClienteView(rawCliente), input.patch.cliente!)
      codigoCliente = await resolveClienteForOrder(
        cnpj,
        input.dealId,
        String(current.cab.numero_pedido ?? internalId),
        merged,
      )
    }

    const hasOrderChanges = hasClientePatch
      || !!(input.patch.header && Object.keys(input.patch.header).length)
      || !!(input.patch.items?.length)
      || !!(input.patch.itemsReplace?.length)
    if (!hasOrderChanges) {
      return {
        success: true as const,
        numero: current.cab.numero_pedido ?? internalId,
        response: { noop: true },
      }
    }

    const cab = { ...current.cab, codigo_cliente: codigoCliente }
    // obs_venda = interna (não sai na NF); dados_adicionais_nf = externa (sai na NF).
    let obsVenda = current.obs ?? ''
    if (input.patch.header?.observacaoInterna !== undefined) {
      obsVenda = await withDealLinkForDeal(input.patch.header.observacaoInterna, input.dealId)
    }
    let dadosAdicNF = current.informacoes_adicionais?.dados_adicionais_nf ?? ''
    if (input.patch.header?.observacaoExterna !== undefined) {
      dadosAdicNF = input.patch.header.observacaoExterna.replace(/\r?\n/g, '|')
    }
    if (input.patch.header?.dataPrevisao) cab.data_previsao = toOmieDate(input.patch.header.dataPrevisao)
    if (input.patch.header?.condicaoPagamento) cab.codigo_parcela = onlyCode(input.patch.header.condicaoPagamento)

    const det = input.patch.itemsReplace?.length
      ? await buildOVDetFromItems(cnpj, input.dealId, input.patch.itemsReplace, current.det ?? [])
      : (current.det ?? []).map((d: any, i: number) => {
        const key = String(d.ide?.codigo_item_integracao ?? d.ide?.codigo_item ?? i + 1)
        const ch = input.patch.items?.find(x => x.key === key)
        return {
          ide: {
            codigo_item_integracao: key,
            ...(d.ide?.codigo_item ? { codigo_item: d.ide.codigo_item } : {}),
          },
          produto: {
            codigo_produto: d.produto?.codigo_produto,
            cfop: normalizeCfop(ch?.cfop ?? d.produto?.cfop),
            ncm: normalizeNcm(ch?.ncm ?? d.produto?.ncm),
            descricao: ch?.descricao ?? d.produto?.descricao,
            quantidade: ch?.quantidade !== undefined ? Number(ch.quantidade) : Number(d.produto?.quantidade ?? 1),
            unidade: d.produto?.unidade ?? 'UN',
            valor_unitario: ch?.valorUnitario !== undefined ? Number(ch.valorUnitario) : Number(d.produto?.valor_unitario ?? 0),
            tipo_desconto: 'V',
            valor_desconto: 0,
          },
        }
      })

    const informacoes_adicionais = {
      ...(current.informacoes_adicionais ?? {}),
      codigo_categoria: current.informacoes_adicionais?.codigo_categoria ?? '1.01.03',
      ...(dadosAdicNF ? { dados_adicionais_nf: dadosAdicNF } : {}),
    }

    const res = await omieRequest(cnpj, OMIE_URL.PEDIDOS_VENDA, 'AlterarPedidoVenda', {
      cabecalho: {
        codigo_cliente: codigoCliente,
        codigo_pedido_integracao: intCode || cab.codigo_pedido_integracao,
        codigo_pedido: internalId,
        data_previsao: cab.data_previsao,
        etapa: cab.etapa ?? '10',
        codigo_parcela: cab.codigo_parcela,
        // Conta só os itens ativos — linhas de exclusão (acao_item "E") não entram.
        quantidade_itens: det.filter((d: any) => d?.ide?.acao_item !== 'E').length,
      },
      informacoes_adicionais,
      observacoes: { obs_venda: obsVenda },
      det,
    }, input.dealId, 'createOVResult')
    if (res?.faultstring) throw new Error(res.faultstring)
    return { success: true as const, numero: cab.numero_pedido ?? internalId, response: res }
  }

  const currentOS = await consultOSFull(cnpj, input.dealId, { nCodOS: internalId })
  if (!currentOS) throw new Error('Não foi possível recarregar a OS antes de atualizar.')

  let nCodCli = Number(currentOS.cab.nCodCli)
  const hasClientePatchOS = !!(input.patch.cliente && Object.keys(input.patch.cliente).length)

  if (hasClientePatchOS) {
    const codigoAtual = Number(meta.codigoCliente ?? meta.nCodCli ?? currentOS.cab.nCodCli)
    const rawCliente = await consultClienteFull(cnpj, input.dealId, codigoAtual)
    if (!rawCliente) throw new Error('Cliente do pedido não encontrado no Omie.')
    const merged = mergeClientePatch(mapClienteView(rawCliente), input.patch.cliente!)
    nCodCli = await resolveClienteForOrder(
      cnpj,
      input.dealId,
      String(currentOS.cab.cNumOS ?? internalId),
      merged,
    )
  }

  const hasOrderChangesOS = hasClientePatchOS
    || !!(input.patch.header && Object.keys(input.patch.header).length)
    || !!(input.patch.items?.length)
    || !!(input.patch.itemsReplace?.length)
  if (!hasOrderChangesOS) {
    return {
      success: true as const,
      numero: currentOS.cab.cNumOS ?? internalId,
      response: { noop: true },
    }
  }

  const cab = { ...currentOS.cab, nCodCli }
  if (input.patch.header?.dataPrevisao) cab.dDtPrevisao = toOmieDate(input.patch.header.dataPrevisao)
  if (input.patch.header?.condicaoPagamento) cab.cCodParc = onlyCode(input.patch.header.condicaoPagamento)

  const servicos = input.patch.itemsReplace?.length
    ? buildOSServicosFromItems(input.patch.itemsReplace, currentOS.servicos ?? [])
    : (currentOS.servicos ?? []).map((s: any, i: number) => {
    const key = String(s.nSeqItem ?? s.cCodIntServ ?? i + 1)
    const ch = input.patch.items?.find(x => x.key === key)
    const item: Record<string, unknown> = {
      // Obrigatórios no AlterarOS para identificar o item existente.
      nSeqItem: Number(s.nSeqItem ?? i + 1),
      nIdItem: s.nIdItem,
      cAcaoItem: 'A',
      nCodServico: s.nCodServico,
      cCodServLC116: s.cCodServLC116,
      cCodServMun: s.cCodServMun,
      cDescServ: ch?.descricao ?? s.cDescServ,
      cDadosAdicItem: ch?.descricao ?? s.cDadosAdicItem ?? s.cDescServ,
      nQtde: ch?.quantidade !== undefined ? Number(ch.quantidade) : Number(s.nQtde ?? 1),
      nValUnit: ch?.valorUnitario !== undefined ? Number(ch.valorUnitario) : Number(s.nValUnit ?? 0),
      cRetemISS: s.cRetemISS ?? 'N',
      cTribServ: s.cTribServ ?? '01',
    }
    if (s.impostos) item.impostos = s.impostos
    return item
  })

  // AlterarOS: nCodOS só no Cabecalho (sem cCodIntOS), InformacoesAdicionais enxuto,
  // Email presente, ServicosPrestados com nSeqItem/nIdItem — conforme doc oficial Omie.
  const raw: any = (currentOS as any).raw ?? {}
  const infoRaw = raw.InformacoesAdicionais ?? raw.informacoesAdicionais ?? {}
  const obsAtual = raw.Observacoes ?? raw.observacoes ?? {}
  const emailRaw = raw.Email ?? raw.email ?? {}

  const payload: Record<string, unknown> = {
    Cabecalho: {
      nCodOS: internalId,
      nCodCli,
      cEtapa: cab.cEtapa ?? '20',
      dDtPrevisao: cab.dDtPrevisao,
      cCodParc: cab.cCodParc,
      nQtdeParc: cab.nQtdeParc ?? 1,
    },
    InformacoesAdicionais: {
      cCidPrestServ: infoRaw.cCidPrestServ ?? '',
      cCodCateg: infoRaw.cCodCateg ?? '1.01.02',
      // cDadosAdicNF sai na Nota Fiscal → recebe a observação externa.
      cDadosAdicNF: input.patch.header?.observacaoExterna !== undefined
        ? input.patch.header.observacaoExterna
        : (infoRaw.cDadosAdicNF ?? ''),
      nCodCC: infoRaw.nCodCC,
      cNumPedido: infoRaw.cNumPedido,
    },
    Email: {
      cEnvBoleto: emailRaw.cEnvBoleto ?? 'N',
      cEnvLink: emailRaw.cEnvLink ?? 'N',
      cEnvPix: emailRaw.cEnvPix ?? 'N',
      cEnviarPara: emailRaw.cEnviarPara ?? '',
    },
    Observacoes: {
      // cObsOS é a observação interna da OS (leva o link do negócio).
      cObsOS: input.patch.header?.observacaoInterna !== undefined
        ? await withDealLinkForDeal(input.patch.header.observacaoInterna, input.dealId)
        : (obsAtual.cObsOS ?? cab.cObsOS ?? ''),
    },
    Departamentos: [],
    ServicosPrestados: servicos,
    produtosUtilizados: raw.produtosUtilizados ?? {
      cAcaoProdUtilizados: 'EST',
      cCodCategRem: '',
      produtoUtilizado: [],
    },
  }

  const res = await omieRequest(cnpj, OMIE_URL.ORDEM_SERVICO, 'AlterarOS', payload, input.dealId, 'createOSResult')
  if (res?.faultstring) throw new Error(res.faultstring)
  return { success: true as const, numero: cab.cNumOS ?? internalId, response: res }
}

export async function loadDealId(dealId: number) {
  const [deal] = await sql`SELECT id, payload FROM deals WHERE id = ${dealId}`
  if (!deal) throw new Error('Deal não encontrado')
  const payload = typeof deal.payload === 'string' ? JSON.parse(deal.payload) : deal.payload
  return { dealId: deal.id, payload }
}
