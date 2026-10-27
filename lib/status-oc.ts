import 'server-only'
import { BitrixService } from './bitrix-service'
import { apelidoFornecedor } from './fornecedor-apelido'
import { aguardaFreio, freioDepois } from './omie-freio'


/**
 * Planilha "STATUS OC - DETALHADO": uma linha por item de Ordem de Compra, com
 * as notas fiscais de entrada e de saída.
 *
 * De onde vem cada coluna:
 *   - Omie, PesquisarPedCompra: número da OC, fornecedor, itens, quantidade,
 *     custo unitário e data do pedido.
 *   - Omie, ListarNF: NF do distribuidor (tpNF 0) e NF da Interatell (tpNF 1).
 *     A de entrada liga à OC por ConsultarRecebimento; a de saída traz o id do
 *     Pedido de Venda em compl.nIdPedido.
 *   - Bitrix, card de Inside Sales: cliente, proposta, Account e o Número de
 *     Ordem de Compra da lista #35 ("3187/25"). O card guarda esses números em
 *     texto ("OC 9174/26 - 2602010345 - HW"), e é por ele que a OC do Omie se
 *     liga ao Pedido de Venda, de onde sai o valor de venda.
 *   - Faturamento direto: não existe em nenhum dos dois; fica em branco para o
 *     time preencher.
 */

const OMIE_URL = {
  PEDIDOS_COMPRA: 'https://app.omie.com.br/api/v1/produtos/pedidocompra/',
  PEDIDOS_VENDA:  'https://app.omie.com.br/api/v1/produtos/pedido/',
  NOTAS:          'https://app.omie.com.br/api/v1/produtos/nfconsultar/',
  RECEBIMENTO:    'https://app.omie.com.br/api/v1/produtos/recebimentonfe/',
  CLIENTES:       'https://app.omie.com.br/api/v1/geral/clientes/',
}

type Filial = 'barueri' | 'es'

export interface StatusOcLinha {
  filial: Filial
  cliente: string
  proposta: string
  pedido: string            // número da OC no Omie
  oc: string                // Número de Ordem de Compra (lista #35 do Bitrix)
  account: string
  partNumber: string
  descricao: string
  qtde: number
  custoUnitario: number
  custoTotal: number
  vendaUnitario: number
  vendaTotal: number
  natureza: string
  nfDistribuidor: string
  dataFatFornecedor: string
  nfInteratell: string
  dataFatInteratell: string
  fornecedor: string
  faturamentoDireto: string // sempre vazio: preenchido à mão
  envioPedido: string
  statusDistribuidor: string
}

export interface StatusOcResultado {
  linhas: StatusOcLinha[]
  avisos: string[]
  chamadasOmie: number
}

function credenciais(filial: Filial) {
  const n = filial === 'es' ? '2' : '1'
  return {
    app_key: process.env[`OMIE_APP_KEY_${n}`] ?? '',
    app_secret: process.env[`OMIE_APP_SECRET_${n}`] ?? '',
  }
}

const texto = (v: unknown) => String(v ?? '').trim()
const numero = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
/** "000002601020276" → "2601020276": o Omie devolve o número com zeros à esquerda. */
const semZeros = (v: unknown) => texto(v).replace(/^0+(?=\d)/, '')

/** dd/mm/aaaa → aaaa-mm-dd, que é como a planilha guarda data. */
function paraISO(data: unknown): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(texto(data))
  return m ? `${m[3]}-${m[2]}-${m[1]}` : texto(data)
}

/**
 * Natureza pelo SKU do catálogo ("ARU-SVT-0001" → "SVT"). O Pedido de Compra do
 * Omie não guarda a natureza; o SKU carrega ela no bloco do meio.
 */
function naturezaDoCodigo(codigo: string): string {
  return /-(HDW|SFW|LIC|SVI|SVT)-/i.exec(codigo)?.[1]?.toUpperCase() ?? ''
}

export class StatusOcError extends Error {}

/**
 * Chamada ao Omie com o mesmo freio do envio: a varredura faz muitas consultas
 * seguidas, e o Omie bloqueia a chave por 30 minutos na 10ª resposta com erro.
 */
async function chamada(
  filial: Filial, url: string, call: string, param: object, ctx: { chamadas: number },
): Promise<any> {
  const { app_key, app_secret } = credenciais(filial)
  if (!app_key || !app_secret) throw new StatusOcError(`Credenciais do Omie da filial ${filial} não configuradas.`)

  await aguardaFreio(app_key, call, motivo => console.warn(`[StatusOC][${filial}] ${motivo}`))
  await new Promise(r => setTimeout(r, Number(process.env.OMIE_SLEEP_MS ?? 260)))
  ctx.chamadas++

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
    cache: 'no-store',
  })
  const txt = await resp.text()
  let data: any = null
  try { data = txt ? JSON.parse(txt) : null } catch { /* resposta fora do padrão */ }
  freioDepois(app_key, call, resp.status, data?.faultstring)
  return data
}

/** "Não existem registros" é fim de paginação, não falha. */
const semRegistros = (data: any) =>
  /n[ãa]o existem registros/i.test(String(data?.faultstring ?? ''))

/** Ordens de Compra do período, com os itens. */
async function buscaOCs(filial: Filial, de: string, ate: string, ctx: { chamadas: number }) {
  const pedidos: any[] = []
  for (let pagina = 1; ; pagina++) {
    const d = await chamada(filial, OMIE_URL.PEDIDOS_COMPRA, 'PesquisarPedCompra', {
      nPagina: pagina, nRegsPorPagina: 100,
      lApenasImportadoApi: 'F', lApenasAlterados: 'F',
      // Sem os sete "T" o Omie devolve vazio: nenhuma situação fica marcada.
      lExibirPedidosPendentes: 'T', lExibirPedidosFaturados: 'T', lExibirPedidosRecebidos: 'T',
      lExibirPedidosCancelados: 'T', lExibirPedidosEncerrados: 'T',
      lExibirPedidosRecParciais: 'T', lExibirPedidosFatParciais: 'T',
      dDataInicial: de, dDataFinal: ate,
    }, ctx)
    if (semRegistros(d)) break
    if (d?.faultstring) throw new StatusOcError(`Omie (${filial}): ${d.faultstring}`)
    pedidos.push(...(d?.pedidos_pesquisa ?? []))
    if (pagina >= Number(d?.nTotalPaginas ?? 1)) break
  }
  return pedidos
}

/** Notas fiscais do período, separadas por entrada (distribuidor) e saída (Interatell). */
async function buscaNotas(filial: Filial, de: string, ate: string, ctx: { chamadas: number }) {
  const entrada: any[] = [], saida: any[] = []
  for (let pagina = 1; ; pagina++) {
    const d = await chamada(filial, OMIE_URL.NOTAS, 'ListarNF', {
      pagina, registros_por_pagina: 50, apenas_importado_api: 'N',
      dEmiInicial: de, dEmiFinal: ate,
    }, ctx)
    if (semRegistros(d)) break
    if (d?.faultstring) throw new StatusOcError(`Omie (${filial}): ${d.faultstring}`)
    for (const nf of (d?.nfCadastro ?? [])) {
      ;(texto(nf?.ide?.tpNF) === '1' ? saida : entrada).push(nf)
    }
    if (pagina >= Number(d?.total_de_paginas ?? 1)) break
  }
  return { entrada, saida }
}

/**
 * NF de entrada por Ordem de Compra.
 *
 * A nota não aponta para a OC: aponta para o recebimento, e é o recebimento que
 * guarda o id do pedido em cada item. Uma consulta por nota.
 */
async function notasPorOC(filial: Filial, entrada: any[], ctx: { chamadas: number }) {
  const porPedido = new Map<number, { nf: string; data: string }>()
  for (const nf of entrada) {
    const idReceb = Number(nf?.compl?.nIdReceb ?? 0)
    if (!idReceb) continue
    const d = await chamada(filial, OMIE_URL.RECEBIMENTO, 'ConsultarRecebimento', { nIdReceb: idReceb }, ctx)
    if (d?.faultstring) continue
    const dados = { nf: semZeros(nf?.ide?.nNF), data: paraISO(nf?.ide?.dEmi) }
    for (const item of (d?.itensRecebimento ?? [])) {
      const idPedido = Number(item?.nIdPedido ?? 0)
      if (idPedido && !porPedido.has(idPedido)) porPedido.set(idPedido, dados)
    }
  }
  return porPedido
}

/** Razão social do fornecedor, uma consulta por código distinto. */
async function razaoSocial(filial: Filial, codigo: number, cache: Map<string, string>, ctx: { chamadas: number }) {
  const chave = `${filial}:${codigo}`
  if (cache.has(chave)) return cache.get(chave)!
  const d = await chamada(filial, OMIE_URL.CLIENTES, 'ConsultarCliente', { codigo_cliente_omie: codigo }, ctx)
  const nome = texto(d?.razao_social || d?.nome_fantasia)
  cache.set(chave, nome)
  return nome
}

interface PedidoDeVenda {
  /** Valor unitário de venda por código de produto. */
  precos: Map<string, number>
  /** `codigo_pedido`, por onde a NF de saída aponta para o pedido. */
  codigoPedido: number
}

/**
 * Pedido de Venda do Omie: preços por produto e o id interno do pedido.
 *
 * As duas informações saem da mesma resposta, então basta uma consulta por
 * pedido, guardada em cache porque várias Ordens de Compra podem apontar para a
 * mesma venda.
 */
async function pedidoDeVenda(
  filial: Filial, numeroOV: string, cache: Map<string, PedidoDeVenda>, ctx: { chamadas: number },
): Promise<PedidoDeVenda> {
  const chave = `${filial}:${numeroOV}`
  const emCache = cache.get(chave)
  if (emCache) return emCache

  const precos = new Map<string, number>()
  const d = await chamada(filial, OMIE_URL.PEDIDOS_VENDA, 'ConsultarPedido', { numero_pedido: numeroOV }, ctx)
  for (const linha of (d?.pedido_venda_produto?.det ?? [])) {
    const p = linha?.produto ?? {}
    const codigo = texto(p.codigo_produto_integracao || p.codigo || p.codigo_produto).toUpperCase()
    if (codigo) precos.set(codigo, numero(p.valor_unitario))
  }
  const resultado: PedidoDeVenda = {
    precos,
    codigoPedido: Number(d?.pedido_venda_produto?.cabecalho?.codigo_pedido ?? 0),
  }
  cache.set(chave, resultado)
  return resultado
}

type DadosDoCard = { cliente: string; proposta: string; account: string; oc: string; ovs: string[] }

/**
 * Índice do Bitrix: número da OC no Omie → dados do negócio.
 *
 * Os campos "Sistema Financeiro (Omie)" do card guardam linhas no formato
 * "OC 9174/26 - 2602010345 - HW": o primeiro número é o da lista #35 e o
 * segundo é o do pedido no Omie. É o único vínculo entre os dois sistemas.
 */
async function indicePorPedidoOmie(avisos: string[]): Promise<Map<string, DadosDoCard>> {
  const indice = new Map<string, DadosDoCard>()
  try {
    const cards = await BitrixService.listInsideSalesCardsComFinanceiro()
    for (const card of cards) {
      const dados: DadosDoCard = {
        cliente: texto(card.cliente), proposta: texto(card.proposta),
        account: texto(card.account), oc: '', ovs: [],
      }
      const lerLinhas = (campo: unknown) =>
        texto(campo).split(/\r?\n/).map(l => l.trim()).filter(Boolean)

      for (const linha of [...lerLinhas(card.compra), ...lerLinhas(card.compraServico)]) {
        const m = /OC\s*([\d]+\/\d{2})\s*-\s*(\d+)/i.exec(linha)
        if (!m) continue
        indice.set(semZeros(m[2]), { ...dados, oc: m[1] })
      }
      for (const linha of [...lerLinhas(card.venda), ...lerLinhas(card.ordemServico)]) {
        const m = /OC\s*([\d]+\/\d{2})\s*-\s*(\d+)/i.exec(linha)
        if (!m) continue
        // A venda carrega o número da OC de onde saíram os itens: é assim que a
        // OC do Omie encontra o Pedido de Venda do mesmo negócio.
        for (const [pedido, d] of indice) {
          if (d.oc === m[1] && !d.ovs.includes(m[2])) indice.set(pedido, { ...d, ovs: [...d.ovs, m[2]] })
        }
      }
    }
  } catch (err) {
    avisos.push(`Bitrix não respondeu: cliente, proposta, Account, OC e venda ficam em branco. (${err instanceof Error ? err.message : err})`)
  }
  return indice
}

/**
 * Monta as linhas do período. `de` e `ate` no formato dd/mm/aaaa.
 *
 * Período longo custa muitas consultas ao Omie: uma por nota de entrada e uma
 * por Pedido de Venda, além das páginas de pedidos. O freio segura o ritmo.
 */
export async function montaStatusOc(de: string, ate: string): Promise<StatusOcResultado> {
  const ctx = { chamadas: 0 }
  const avisos: string[] = []
  const linhas: StatusOcLinha[] = []
  const cacheFornecedor = new Map<string, string>()
  const cacheVenda = new Map<string, PedidoDeVenda>()

  const indiceBitrix = await indicePorPedidoOmie(avisos)

  for (const filial of ['barueri', 'es'] as Filial[]) {
    let ocs: any[] = []
    try {
      ocs = await buscaOCs(filial, de, ate, ctx)
    } catch (err) {
      avisos.push(`Filial ${filial}: ${err instanceof Error ? err.message : err}`)
      continue
    }

    let notaEntradaPorPedido = new Map<number, { nf: string; data: string }>()
    let notasSaida: any[] = []
    try {
      const notas = await buscaNotas(filial, de, ate, ctx)
      notaEntradaPorPedido = await notasPorOC(filial, notas.entrada, ctx)
      notasSaida = notas.saida
    } catch (err) {
      avisos.push(`Filial ${filial}, notas fiscais: ${err instanceof Error ? err.message : err}`)
    }

    // NF de saída pelo id do Pedido de Venda, que é o vínculo que a própria nota traz.
    const notaSaidaPorPedidoId = new Map<number, { nf: string; data: string }>()
    for (const nf of notasSaida) {
      const id = Number(nf?.compl?.nIdPedido ?? 0)
      if (id && !notaSaidaPorPedidoId.has(id)) {
        notaSaidaPorPedidoId.set(id, { nf: semZeros(nf?.ide?.nNF), data: paraISO(nf?.ide?.dEmi) })
      }
    }

    for (const pedido of ocs) {
      const cab = pedido?.cabecalho_consulta ?? {}
      const numeroOC = semZeros(cab.cNumero)
      const doCard = indiceBitrix.get(numeroOC)
      const entrada = notaEntradaPorPedido.get(Number(cab.nCodPed ?? 0))

      const fornecedor = apelidoFornecedor(
        await razaoSocial(filial, Number(cab.nCodFor ?? 0), cacheFornecedor, ctx),
      )

      // Venda: o card diz qual Pedido de Venda nasceu desta OC.
      let vendas = new Map<string, number>()
      let saida: { nf: string; data: string } | undefined
      for (const ov of (doCard?.ovs ?? [])) {
        try {
          const venda = await pedidoDeVenda(filial, ov, cacheVenda, ctx)
          for (const [k, v] of venda.precos) if (!vendas.has(k)) vendas.set(k, v)
          saida ??= notaSaidaPorPedidoId.get(venda.codigoPedido)
        } catch { /* venda fica em branco */ }
      }

      for (const item of (pedido?.produtos_consulta ?? [])) {
        const codigo = texto(item.cCodIntProd || item.cProduto).toUpperCase()
        const qtde = numero(item.nQtde)
        const custoUnit = numero(item.nValUnit)
        const vendaUnit = vendas.get(codigo) ?? 0
        linhas.push({
          filial,
          cliente: doCard?.cliente ?? '',
          proposta: doCard?.proposta ?? '',
          pedido: numeroOC,
          oc: doCard?.oc ?? '',
          account: doCard?.account ?? '',
          partNumber: texto(item.cProduto || item.cCodIntProd),
          descricao: texto(item.cDescricao),
          qtde,
          custoUnitario: custoUnit,
          custoTotal: custoUnit * qtde,
          vendaUnitario: vendaUnit,
          vendaTotal: vendaUnit * qtde,
          natureza: naturezaDoCodigo(codigo),
          nfDistribuidor: entrada?.nf ?? '',
          dataFatFornecedor: entrada?.data ?? '',
          nfInteratell: saida?.nf ?? '',
          dataFatInteratell: saida?.data ?? '',
          fornecedor,
          faturamentoDireto: '',
          // FATURADO quando a nota do distribuidor chegou; o resto do time
          // preenche (prazo em dias, COMODATO), como já fazia na planilha.
          statusDistribuidor: entrada ? 'FATURADO' : '',
          envioPedido: paraISO(cab.dDtPrevEnt || cab.dDtRegistro),
        })
      }
    }
  }

  return { linhas, avisos, chamadasOmie: ctx.chamadas }
}
