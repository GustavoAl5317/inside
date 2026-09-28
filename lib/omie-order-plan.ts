import { companyForBranch } from './interatell-companies'
import { BitrixService } from './bitrix-service'
import {
  paymentConditionMatches,
  resolveDefaultOmiePaymentCode,
  resolveOmiePaymentCode,
  tryParseOmiePaymentCode,
  type PaymentConditionKind,
} from './payment-condition-utils'

/**
 * O que um negócio vai gerar no Omie, calculado a partir do payload do formulário.
 *
 * Estas são as regras que decidem quais documentos nascem e com que dados —
 * antes viviam só dentro de app/api/omie/send/route.ts. Ficaram aqui porque a
 * aba "Resumo Omie" da planilha precisa descrever exatamente o mesmo pedido que
 * o envio cria; com duas cópias das regras, a conferência do financeiro
 * passaria a comparar a planilha com um pedido diferente do que foi enviado.
 *
 * Só cálculo: nada aqui chama a API do Omie.
 */

export type Filial = 'barueri' | 'es'
export type Natureza = 'HW' | 'SW' | 'LC' | 'ST' | 'SRV'

export const CC_BARUERI   = '1807556622'
export const CC_ES        = '5097263320'
export const CNPJ_ES      = '03969530000211'
export const CNPJ_BARUERI = '03969530000130'

/** Código do serviço no Omie por natureza. HW não vira OS. */
export const SERVICO_MAP: Record<Natureza, string> = {
  SW: 'SRV00007', LC: 'SRV00007', ST: 'SRV00016', SRV: 'SRV00001', HW: '',
}

export const digits = (v: any) => String(v ?? '').replace(/\D/g, '')

export function normalizeNatureza(raw: any): Natureza {
  const s = String(raw ?? '').toUpperCase().trim()
  if (['HW','HARDWARE'].includes(s)) return 'HW'
  if (['SW','SOFTWARE'].includes(s)) return 'SW'
  if (['LC','LICENSE','LICENCA'].includes(s)) return 'LC'
  if (['ST','SERV_TER','TERCEIRO'].includes(s)) return 'ST'
  if (['SRV','SERV','SERVICO'].includes(s)) return 'SRV'
  return 'HW'
}

export function normalizeNCM(ncm: any): string {
  const d = String(ncm ?? '').replace(/\D/g, '')
  return d.length === 8 ? d : String(ncm ?? '')
}

export function toOmieDate(input: any): string {
  const today = () => { const dt = new Date(); return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}` }
  if (!input) return today()
  const s = String(input).split('T')[0].split(' ')[0].trim()
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y,m,d] = s.split('-'); return `${d}/${m}/${y}` }
  return today()
}

/**
 * Código do produto no Omie: o SKU do catálogo.
 *
 * partnumber só entra quando não há SKU (produto digitado à mão). Antes o código
 * era sempre o partnumber, que vem do NAME do catálogo Bitrix e costuma trazer o
 * texto da descrição — daí código e descrição saírem iguais no pedido.
 */
export function codigoProduto(item: any): string {
  return String(item?.sku ?? '').trim() || String(item?.partnumber ?? '').trim()
}

/** Filial do grupo de fornecedor — é ela que decide onde a compra acontece. */
export function filialDoGrupo(group: any): Filial {
  return group?.branch === 'es' ? 'es' : 'barueri'
}

export function getBranchCnpj(branch: string | undefined, fallbackCnpj: string): string {
  if (branch === 'es') return CNPJ_ES
  if (branch === 'barueri') return CNPJ_BARUERI
  return fallbackCnpj || CNPJ_BARUERI
}

export function contaCorrente(interatellCnpj: string) {
  return digits(interatellCnpj) === digits(CNPJ_ES) ? CC_ES : CC_BARUERI
}

/**
 * Agrupa as alocações de um cliente pela filial do fornecedor de origem.
 *
 * Regra do negócio: a venda segue a compra. Comprou por ES, vende por ES. Um
 * mesmo cliente pode receber itens comprados nas duas filiais (ex.: importados
 * por ES e nacionais por Barueri) — nesse caso saem duas OVs, uma por empresa.
 */
export function itensPorFilial(entry: any, supplierGroups: any[]): Map<Filial, any[]> {
  const porFilial = new Map<Filial, any[]>()
  for (const alloc of (entry?.productAllocations ?? [])) {
    if (!(Number(alloc.quantity) > 0)) continue
    const group = supplierGroups.find((g: any) => g.localId === alloc.groupLocalId)
    if (!group) continue
    const product = group.products?.[alloc.productIndex]
    if (!product) continue
    const filial = filialDoGrupo(group)
    const lista = porFilial.get(filial) ?? []
    // unitSale vem da alocação do cliente (preço de venda definido por cliente).
    // _groupLocalId guarda a origem da compra, para a planilha poder recortar o
    // resumo pelo fornecedor do arquivo; o payload do Omie ignora o campo.
    lista.push({
      ...product, _groupLocalId: group.localId,
      quantity: Number(alloc.quantity), unitSale: Number(alloc.unitSale ?? 0),
    })
    porFilial.set(filial, lista)
  }
  return porFilial
}

export function branchesDoCliente(entry: any, supplierGroups: any[]): Filial[] {
  const porFilial = itensPorFilial(entry, supplierGroups)
  const filiais = new Set<Filial>(porFilial.keys())

  // SRV é sempre faturado por Barueri. Se o cliente tem item SRV comprado só
  // por ES, ele precisa existir também no Omie de Barueri — senão a OS de
  // serviço não encontra o cliente e some sem erro.
  for (const [, lista] of porFilial) {
    if (lista.some(i => normalizeNatureza(i.nature) === 'SRV')) { filiais.add('barueri'); break }
  }

  // Sem alocação ainda: mantém o comportamento antigo para não quebrar o cadastro.
  if (!filiais.size) filiais.add(entry?.branch === 'es' ? 'es' : 'barueri')
  return [...filiais]
}

/** Resolve o código de condição de pagamento aceito pelo Omie ("A28", "S30"...). */
export async function resolvePaymentCodeForOmie(raw: string, kind: PaymentConditionKind): Promise<string> {
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

// ─── Plano de documentos ──────────────────────────────────────────────────────

export interface OmiePlanItem {
  seq: number
  /** cCodIntProd (OC), codigo_produto_integracao (OV) ou nCodServico (OS). */
  codigo: string
  descricao: string
  ncm: string
  cfop: string
  natureza: Natureza
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
}

export interface OmiePlanDoc {
  tipo: 'OC' | 'OV' | 'OS'
  /** Natureza da OS; vazio em OC e OV. */
  natureza: '' | Natureza
  /** Endpoint e chamada do Omie que criam o documento. */
  chamada: string
  codigoIntegracao: string
  filial: Filial
  empresaEmissora: string
  cnpjEmissor: string
  contaCorrente: string
  parteTipo: 'Fornecedor' | 'Cliente'
  parteNome: string
  parteCnpj: string
  /** Código enviado ao Omie. */
  condicaoPagamento: string
  /** Rótulo completo, para o financeiro ler sem decorar código. */
  condicaoPagamentoLabel: string
  etapa: string
  dataPrevisao: string
  /** numero_pedido_cliente (OV) / cNumPedido (OS); vazio na OC. */
  numeroPedidoCliente: string
  valorFrete: number
  /** Campo do Omie que recebe a observação externa, e o texto. */
  campoObsExterna: string
  obsExterna: string
  campoObsInterna: string
  obsInterna: string
  itens: OmiePlanItem[]
  total: number
  /**
   * Preenchido quando o documento no Omie é maior do que o que a planilha
   * mostra — a OV de um cliente junta os itens de todos os fornecedores da
   * mesma filial, e este arquivo é de um fornecedor só.
   */
  recorte: string
}

export interface OmiePlan {
  /** id do processo no banco; entra nos códigos de integração. */
  dealId: number | null
  /** Fornecedor e cliente a que este recorte se refere; vazio no plano inteiro. */
  escopoFornecedor: string
  escopoCliente: string
  proposta: string
  negocio: string
  dataOc: string
  prazoEntrega: string
  previsaoFaturamento: string
  condicaoCompra: string
  condicaoCompraLabel: string
  condicaoVenda: string
  condicaoVendaLabel: string
  obsExterna: string
  obsInterna: string
  docs: OmiePlanDoc[]
}

const soma = (itens: OmiePlanItem[]) => itens.reduce((s, i) => s + i.valorTotal, 0)

function itemDeProduto(e: any, seq: number, valor: number, ncmZeradoParaServico: boolean): OmiePlanItem {
  const nat = normalizeNatureza(e.nature)
  const quantidade = Number(e.quantity ?? 1)
  return {
    seq,
    codigo: codigoProduto(e),
    descricao: String(e.description ?? ''),
    ncm: ncmZeradoParaServico && nat !== 'HW' ? '00000000' : normalizeNCM(e.ncm),
    cfop: String(e.cfop ?? ''),
    natureza: nat,
    unidade: 'UN',
    quantidade,
    valorUnitario: valor,
    valorTotal: valor * quantidade,
  }
}

/**
 * Monta a lista de documentos que o envio vai criar no Omie.
 *
 * Espelha processDeal em app/api/omie/send/route.ts: 1 OC por grupo de
 * fornecedor, 1 OV por cliente × filial de compra, 1 OS por cliente × natureza
 * (SW | LC | ST), e SRV sempre por Barueri. `dealId` é o id do processo; sem ele
 * os códigos de integração saem com "?" no lugar do número.
 *
 * `escopo` recorta o plano para um par fornecedor × cliente, que é como a
 * planilha usa: cada arquivo é de um fornecedor, então mostrar as compras dos
 * outros só atrapalharia a conferência. A OC sai inteira (é o documento real do
 * Omie); a OV e a OS saem com os itens vindos deste fornecedor, e `recorte`
 * avisa quando o documento no Omie é maior do que isso.
 */
export function buildOmiePlan(
  values: any,
  dealId: number | null,
  opts: { condicaoCompra: string; condicaoVenda: string; rotulo: (v: string) => string },
  escopo?: { groupLocalId?: string; customerLocalId?: string },
): OmiePlan {
  const business = values?.business ?? {}
  const todosGrupos: any[] = values?.supplierGroups ?? []
  const todosClientes: any[] = values?.customers ?? []
  // Os índices dos códigos de integração são a posição na lista inteira, não na
  // recortada — o envio numera sobre o payload completo.
  const supplierGroups = escopo?.groupLocalId
    ? todosGrupos.filter(g => g.localId === escopo.groupLocalId)
    : todosGrupos
  const customers = escopo?.customerLocalId
    ? todosClientes.filter(c => c.localId === escopo.customerLocalId)
    : todosClientes
  // Serviço Interatell não passa por fornecedor, então fica fora do recorte de
  // um arquivo de OC.
  const serviceCustomers: any[] = escopo?.groupLocalId ? [] : (values?.serviceCustomers ?? [])
  const soDoGrupo = (lista: any[]) => (escopo?.groupLocalId
    ? lista.filter(i => i._groupLocalId === escopo.groupLocalId)
    : lista)
  const fallbackCnpj = digits(values?.interatell?.cnpj ?? '')
  const id = dealId ?? '?'

  const obsExterna = String(values?.notes?.externalNotes ?? '').trim()
  // O link do card Bitrix é prefixado no envio, onde o id interno do item já foi
  // resolvido. Aqui sai só o texto digitado.
  const obsInterna = String(values?.notes?.internalNotes ?? '').trim()

  const pedidoCliente = String(business?.commercialProposal ?? '').trim()
  const dtPrevisao = toOmieDate(business?.deliveryDeadline ?? business?.expectedBillingDate)

  const emissor = (filial: Filial) => {
    const cnpj = getBranchCnpj(filial, fallbackCnpj)
    return {
      filial,
      cnpjEmissor: cnpj,
      empresaEmissora: `${companyForBranch(filial).name} — ${filial === 'es' ? 'ES' : 'Barueri'}`,
      contaCorrente: contaCorrente(cnpj),
    }
  }

  const docs: OmiePlanDoc[] = []

  // ── OC: 1 por grupo de fornecedor, com os produtos do grupo (exceto SRV) ────
  supplierGroups.forEach(group => {
    const gIdx = todosGrupos.indexOf(group)
    const ocItems = (group.products ?? []).filter((i: any) => normalizeNatureza(i.nature) !== 'SRV')
    if (!ocItems.length) return
    const itens = ocItems.map((e: any, i: number) => itemDeProduto(e, i + 1, Number(e.unitCost ?? 0), true))
    docs.push({
      tipo: 'OC', natureza: '',
      chamada: 'produtos/pedidocompra → UpsertPedCompra',
      codigoIntegracao: `OC-${id}-G${gIdx}`,
      ...emissor(filialDoGrupo(group)),
      parteTipo: 'Fornecedor',
      parteNome: String(group.supplier?.name ?? ''),
      parteCnpj: String(group.supplier?.cnpj ?? ''),
      condicaoPagamento: opts.condicaoCompra,
      condicaoPagamentoLabel: opts.rotulo(business.purchasePaymentCondition),
      etapa: '',
      dataPrevisao: toOmieDate(business?.deliveryDeadline),
      numeroPedidoCliente: '',
      valorFrete: group.hasFreight ? Number(group.freightValue ?? 0) : 0,
      campoObsExterna: 'cObs', obsExterna,
      campoObsInterna: 'cObsInt', obsInterna,
      itens, total: soma(itens), recorte: '',
    })
  })

  // ── OV + OS por cliente × filial ───────────────────────────────────────────
  customers.forEach(entry => {
    const cIdx = todosClientes.indexOf(entry)
    const porFilial = itensPorFilial(entry, todosGrupos)
    const cliente = entry.customer ?? {}
    const parte = {
      parteTipo: 'Cliente' as const,
      parteNome: String(cliente.name ?? ''),
      parteCnpj: String(cliente.cnpj ?? ''),
      condicaoPagamento: opts.condicaoVenda,
      condicaoPagamentoLabel: opts.rotulo(business.salePaymentCondition),
      numeroPedidoCliente: pedidoCliente,
      valorFrete: 0,
    }

    // SRV sai do agrupamento por filial: é sempre faturado por Barueri.
    const itensSRV: any[] = []
    for (const [, lista] of porFilial) {
      for (const item of soDoGrupo(lista)) if (normalizeNatureza(item.nature) === 'SRV') itensSRV.push(item)
    }

    for (const [filial, itensDaFilial] of porFilial) {
      const daFilial = itensDaFilial.filter(i => normalizeNatureza(i.nature) !== 'SRV')
      const doFilial = soDoGrupo(daFilial)
      if (!doFilial.length) continue
      const sufixo = filial === 'es' ? 'ES' : 'BAR'
      // Quantos itens o documento tem no Omie contra quantos esta planilha mostra.
      const recorte = (dentro: number, total: number) => (dentro === total ? '' :
        `A planilha mostra ${dentro} de ${total} itens: no Omie este documento junta os itens de todos os fornecedores que faturam por ${filial === 'es' ? 'ES' : 'Barueri'}.`)

      // OV leva só HW com NCM real — serviço e licença vão por OS.
      const ehHW = (i: any) => normalizeNatureza(i.nature) === 'HW' && normalizeNCM(i.ncm) !== '00000000'
      const hw = doFilial.filter(ehHW)
      if (hw.length) {
        const itens = hw.map((e, i) => itemDeProduto(e, i + 1, Number(e.unitSale ?? 0), false))
        docs.push({
          tipo: 'OV', natureza: '',
          chamada: 'produtos/pedido → IncluirPedido / AlterarPedidoVenda',
          codigoIntegracao: `OV-${id}-C${cIdx}-${sufixo}`,
          ...emissor(filial), ...parte,
          etapa: '10',
          dataPrevisao: dtPrevisao,
          campoObsExterna: 'informacoes_adicionais.dados_adicionais_nf', obsExterna,
          campoObsInterna: 'observacoes.obs_venda', obsInterna,
          itens, total: soma(itens),
          recorte: recorte(hw.length, daFilial.filter(ehHW).length),
        })
      }

      for (const nat of ['SW','LC','ST'] as Natureza[]) {
        const natItems = doFilial.filter(i => normalizeNatureza(i.nature) === nat)
        if (!natItems.length) continue
        const itens = natItems.map((e, i) => ({
          ...itemDeProduto(e, i + 1, Number(e.unitSale ?? 0), false),
          codigo: SERVICO_MAP[nat] || codigoProduto(e),
        }))
        docs.push({
          tipo: 'OS', natureza: nat,
          chamada: 'servicos/os → IncluirOS / AlterarOS',
          codigoIntegracao: `OS-${id}-C${cIdx}-${nat}-${sufixo}`,
          ...emissor(filial), ...parte,
          etapa: '20',
          dataPrevisao: dtPrevisao,
          campoObsExterna: 'cDadosAdicNF', obsExterna,
          campoObsInterna: 'cObsOS', obsInterna,
          itens, total: soma(itens),
          recorte: recorte(natItems.length, daFilial.filter(i => normalizeNatureza(i.nature) === nat).length),
        })
      }
    }

    if (itensSRV.length) {
      const itens = itensSRV.map((e, i) => ({
        ...itemDeProduto(e, i + 1, Number(e.unitSale ?? 0), false),
        codigo: SERVICO_MAP.SRV,
      }))
      docs.push({
        tipo: 'OS', natureza: 'SRV',
        chamada: 'servicos/os → IncluirOS / AlterarOS',
        codigoIntegracao: `OS-${id}-C${cIdx}-SRV-BAR`,
        ...emissor('barueri'), ...parte,
        etapa: '20',
        dataPrevisao: dtPrevisao,
        campoObsExterna: 'cDadosAdicNF', obsExterna,
        campoObsInterna: 'cObsOS', obsInterna,
        itens, total: soma(itens), recorte: '',
      })
    }
  })

  // ── Serviço Interatell: sem fornecedor e sem OV, só OS por Barueri ─────────
  // O índice continua de customers.length para não colidir com os códigos de
  // integração das OS dos clientes normais.
  serviceCustomers.forEach((entry, sIdx) => {
    const items = (entry.items ?? []).filter((i: any) => String(i.description ?? '').trim())
    if (!items.length) return
    const cliente = entry.customer ?? {}
    const itens: OmiePlanItem[] = items.map((e: any, i: number) => ({
      seq: i + 1,
      codigo: SERVICO_MAP.SRV,
      descricao: String(e.description ?? ''),
      ncm: '', cfop: '', natureza: 'SRV' as Natureza, unidade: 'UN',
      quantidade: Number(e.quantity ?? 1),
      valorUnitario: Number(e.unitSale ?? 0),
      valorTotal: Number(e.unitSale ?? 0) * Number(e.quantity ?? 1),
    }))
    docs.push({
      tipo: 'OS', natureza: 'SRV',
      chamada: 'servicos/os → IncluirOS / AlterarOS',
      codigoIntegracao: `OS-${id}-C${todosClientes.length + sIdx}-SRV-BAR`,
      ...emissor('barueri'),
      parteTipo: 'Cliente',
      parteNome: String(cliente.name ?? ''),
      parteCnpj: String(cliente.cnpj ?? ''),
      condicaoPagamento: opts.condicaoVenda,
      condicaoPagamentoLabel: opts.rotulo(business.salePaymentCondition),
      etapa: '20',
      dataPrevisao: dtPrevisao,
      numeroPedidoCliente: pedidoCliente,
      valorFrete: 0,
      campoObsExterna: 'cDadosAdicNF', obsExterna,
      campoObsInterna: 'cObsOS', obsInterna,
      itens, total: soma(itens), recorte: '',
    })
  })

  return {
    dealId,
    escopoFornecedor: escopo?.groupLocalId ? String(supplierGroups[0]?.supplier?.name ?? '') : '',
    escopoCliente: escopo?.customerLocalId ? String(customers[0]?.customer?.name ?? '') : '',
    proposta: pedidoCliente,
    negocio: String(business?.name ?? ''),
    dataOc: toOmieDate(business?.purchaseOrderDate),
    prazoEntrega: toOmieDate(business?.deliveryDeadline),
    previsaoFaturamento: toOmieDate(business?.expectedBillingDate),
    condicaoCompra: opts.condicaoCompra,
    condicaoCompraLabel: opts.rotulo(business?.purchasePaymentCondition),
    condicaoVenda: opts.condicaoVenda,
    condicaoVendaLabel: opts.rotulo(business?.salePaymentCondition),
    obsExterna, obsInterna,
    docs,
  }
}
