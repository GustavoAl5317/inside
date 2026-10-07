import 'server-only'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { companyForBranch } from './interatell-companies'
import { formatCNPJ, formatZipCode } from './utils'
import { BitrixService } from './bitrix-service'
import {
  buildOmiePlan, resolvePaymentCodeForOmie,
  type OmiePlan,
} from './omie-order-plan'

/**
 * Gera a Ordem de Compra em Excel a partir do modelo da Interatell.
 *
 * O modelo (templates/ordem-de-compra.xlsx) e a planilha que o time ja usa, com
 * as macros removidas: cores, bordas, mesclagens, larguras, o logo e as formulas
 * de calculo continuam iguais. O codigo so preenche celulas.
 *
 * O modelo tem UM bloco de fornecedor e UM de cliente, entao cada aba e um par
 * fornecedor x cliente. As formulas de VLOOKUP das abas ocultas sao substituidas
 * por valores: o app ja tem esses dados em memoria.
 */

const TEMPLATE = path.join(process.cwd(), 'templates', 'ordem-de-compra.xlsx')
const ABA = 'Ordem de Compra'

/** Tabela de itens: linha 29 e o cabecalho, 30..49 sao as 20 linhas de item. */
const LINHA_ITENS = 30
const ULTIMA_LINHA_ITEM = 49

/** Colunas de dado da tabela; A guarda a numeracao do item, que fica como esta. */
const COLUNAS_ITEM = ['B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'] as const

export interface OcExcelFile {
  filename: string
  buffer: Buffer
}

const txt = (v: unknown) => String(v ?? '').trim()
const nmb = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** "2026-08-14" ou "14/08/2026" -> Date, para o Excel formatar como data. */
function paraData(v: unknown): Date | null {
  const s = txt(v)
  if (!s) return null
  // Meio-dia UTC: o ExcelJS grava a data em UTC e, com a meia-noite local, um
  // fuso negativo joga a data para o dia anterior na planilha.
  const meioDia = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d, 12, 0, 0))
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return meioDia(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s)
  if (br) return meioDia(Number(br[3]), Number(br[2]), Number(br[1]))
  return null
}

/**
 * Nome do arquivo no padrao que o time ja usa ("OC 8195 26 - Parkshop Brasilia"):
 * numero da proposta, nome do negocio e fornecedor, com espacos e hifen.
 *
 * O nome do negocio vem do Bitrix como "Negocio Fechado: 2026.12483 - CLIENTE -
 * descricao"; o prefixo e o numero repetido sao removidos para nao duplicar.
 */
function nomeArquivo(proposta: string, negocio: string, fornecedor: string): string {
  // Windows recusa \\ / : * ? " < > | em nome de arquivo, e o caminho todo
  // nao pode passar de 260 caracteres — dai os limites de tamanho.
  const limpa = (v: string, max: number) =>
    v.replace(/[\\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .replace(/[\s-]+$/, '')  // corte no meio do texto deixa hifen solto
      .trim()

  // A proposta e do tipo "2026.12483": so o ponto precisa virar literal.
  const escapa = (v: string) => v.replace(/[.]/g, '\\.')
  const semPrefixo = negocio
    .replace(/^\s*neg[oó]cio\s+fechado\s*:\s*/i, '')
    .replace(new RegExp('^\\s*' + escapa(proposta) + '\\s*-\\s*'), '')

  const partes = [proposta || 'sem proposta', limpa(semPrefixo, 55), limpa(fornecedor, 24)]
    .filter(Boolean)
  return `OC ${partes.join(' - ')}.xlsx`
}

/**
 * Condicoes de pagamento: o formulario guarda so o codigo ("S30"), mas a
 * planilha precisa do rotulo completo ("S30 - 30/60/90 Dias"). O mapa e montado
 * uma vez por geracao; se o Bitrix nao responder, o codigo segue como estava.
 */
async function mapaCondicoes(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  const listId = Number(process.env.BITRIX_LIST_PAYMENT_ID)
  if (!listId) return mapa
  try {
    for (const c of await BitrixService.getPaymentConditions(listId)) {
      const cod = String(c.code || '').trim()
      const rotulo = String(c.name || '').trim()
      if (cod && rotulo && !mapa.has(cod)) mapa.set(cod, rotulo)
    }
  } catch (err) {
    console.error('Erro ao carregar condições de pagamento para a planilha:', err)
  }
  return mapa
}

/**
 * Codigo do produto na coluna B da planilha — o SKU do catalogo.
 *
 * partnumber so entra quando nao ha SKU (produto digitado a mao). Antes a
 * coluna saia sempre com o partnumber, que vem do NAME do catalogo Bitrix e
 * costuma ser o texto da descricao — dai codigo e descricao aparecerem iguais.
 * Mesma regra usada no envio ao Omie (codigoProduto em api/omie/send).
 */
function codigoProduto(p: any): string {
  return txt(p?.sku) || txt(p?.partnumber)
}

// ─── Aba "Resumo Omie" ────────────────────────────────────────────────────────

const ABA_RESUMO = 'Resumo Omie'

const AZUL       = 'FF1E40AF'
const CINZA_BG   = 'FFF1F5F9'
const CINZA_LINHA = 'FFCBD5E1'
const MOEDA      = '#,##0.00'

/**
 * Última aba da planilha: tudo que o envio vai gravar no Omie.
 *
 * Existe para o financeiro conferir o pedido contra o Omie sem abrir o payload:
 * um documento por linha no resumo e, abaixo, os itens de cada documento com os
 * campos exatos que vão na chamada da API. Os dados vêm de buildOmiePlan, a
 * mesma função que descreve as regras usadas no envio — a aba e o pedido não
 * podem divergir.
 *
 * O recorte é o do arquivo: cada arquivo é de um distribuidor, então a aba traz
 * a compra dele e as vendas que saem dela, de todos os clientes. A OC aparece
 * inteira, porque é o documento real do Omie; a OV e a OS levam os itens vindos
 * deste fornecedor e, quando o documento no Omie é maior do que isso, a linha
 * "Atenção" diz quantos itens ficaram de fora.
 */
function montaAbaResumo(wb: ExcelJS.Workbook, plan: OmiePlan) {
  const ws = wb.addWorksheet(ABA_RESUMO, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = [
    { width: 6 }, { width: 22 }, { width: 46 }, { width: 12 }, { width: 8 },
    { width: 10 }, { width: 8 }, { width: 9 }, { width: 15 }, { width: 15 },
    { width: 18 },
  ]

  let l = 0
  const linha = () => ++l

  const titulo = (texto: string) => {
    const r = ws.getRow(linha())
    r.getCell(1).value = texto
    r.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    r.height = 20
    for (let c = 1; c <= 11; c++) {
      r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
      r.getCell(c).alignment = { vertical: 'middle' }
    }
    ws.mergeCells(l, 1, l, 11)
  }

  const campo = (rotulo: string, valor: unknown, opts: { moeda?: boolean; largo?: boolean } = {}) => {
    const r = ws.getRow(linha())
    r.getCell(1).value = rotulo
    r.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF475569' } }
    ws.mergeCells(l, 1, l, 2)
    const c = r.getCell(3)
    c.value = (valor as any) ?? ''
    c.font = { size: 9 }
    if (opts.moeda) c.numFmt = MOEDA
    if (opts.largo) {
      c.alignment = { wrapText: true, vertical: 'top' }
      ws.mergeCells(l, 3, l, 11)
      // Textarea longa: o Excel não cresce a linha sozinho em célula mesclada.
      const linhas = Math.min(8, Math.max(1, Math.ceil(String(valor ?? '').length / 90)))
      r.height = 13 * linhas
    } else {
      ws.mergeCells(l, 3, l, 6)
    }
  }

  const cabecalhoTabela = (colunas: string[], larguraTotal: number) => {
    const r = ws.getRow(linha())
    colunas.forEach((t, i) => {
      const c = r.getCell(i + 1)
      c.value = t
      c.font = { bold: true, size: 9 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_BG } }
      c.border = { bottom: { style: 'thin', color: { argb: CINZA_LINHA } } }
      c.alignment = { wrapText: true, vertical: 'middle' }
    })
    for (let c = colunas.length + 1; c <= larguraTotal; c++) {
      r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_BG } }
    }
    r.height = 24
  }

  const branco = () => { linha() }

  // ── Negócio ────────────────────────────────────────────────────────────────
  titulo('RESUMO DO QUE SERÁ ENVIADO AO OMIE')
  campo('Negócio', plan.negocio)
  if (plan.escopoFornecedor) campo('Distribuidor deste arquivo', plan.escopoFornecedor)
  campo('Nº do negócio / proposta', plan.proposta)
  campo('Processo (id no app)', plan.dealId ?? 'rascunho ainda sem id')
  campo('Data da OC', plan.dataOc)
  campo('Prazo de entrega', plan.prazoEntrega)
  if (plan.previsaoFaturamento) campo('Previsão de faturamento', plan.previsaoFaturamento)
  campo('Cond. pagamento compra', `${plan.condicaoCompra} — ${plan.condicaoCompraLabel}`)
  // Sem venda (compra para estoque) nao ha condicao de venda nem faturamento.
  if (plan.condicaoVendaLabel) campo('Cond. pagamento venda', `${plan.condicaoVenda} — ${plan.condicaoVendaLabel}`)
  campo('Observação externa (sai na NF)', plan.obsExterna, { largo: true })
  campo('Observação interna', plan.obsInterna, { largo: true })
  branco()

  // ── Documentos ─────────────────────────────────────────────────────────────
  titulo(`DOCUMENTOS NO OMIE (${plan.docs.length})`)
  cabecalhoTabela(
    ['Tipo', 'Código de integração', 'Empresa emissora (Omie)', 'CNPJ emissor',
     'Conta cor.', 'Etapa', 'Cond. pgto', 'Previsão', 'Fornecedor / Cliente',
     'CNPJ da parte', 'Total (R$)'],
    11,
  )
  for (const d of plan.docs) {
    const r = ws.getRow(linha())
    const vals: unknown[] = [
      d.natureza ? `${d.tipo} ${d.natureza}` : d.tipo,
      d.codigoIntegracao, d.empresaEmissora, formatCNPJ(d.cnpjEmissor),
      d.contaCorrente, d.etapa || '—', d.condicaoPagamento, d.dataPrevisao,
      d.parteNome, d.parteCnpj, d.total,
    ]
    vals.forEach((v, i) => {
      const c = r.getCell(i + 1)
      c.value = (v as any) ?? ''
      c.font = { size: 9 }
      c.alignment = { vertical: 'top', wrapText: i === 2 || i === 8 }
      c.border = { bottom: { style: 'hair', color: { argb: CINZA_LINHA } } }
    })
    r.getCell(1).font = { size: 9, bold: true }
    r.getCell(11).numFmt = MOEDA
  }
  branco()

  // ── Itens por documento ────────────────────────────────────────────────────
  for (const d of plan.docs) {
    titulo(`${d.natureza ? `${d.tipo} ${d.natureza}` : d.tipo} · ${d.codigoIntegracao} · ${d.parteNome}`)
    campo('Chamada no Omie', d.chamada)
    campo('Empresa emissora', `${d.empresaEmissora} · ${formatCNPJ(d.cnpjEmissor)}`)
    campo(d.parteTipo, `${d.parteNome} · ${d.parteCnpj}`)
    campo('Condição de pagamento', `${d.condicaoPagamento} — ${d.condicaoPagamentoLabel}`)
    campo('Previsão', d.dataPrevisao)
    if (d.numeroPedidoCliente) campo('Nº do pedido do cliente', d.numeroPedidoCliente)
    // Frete zerado nao e enviado (frete_upsert so vai com valor), entao a aba
    // diz que nao ha frete em vez de mostrar um campo com 0.
    if (d.tipo === 'OC') {
      if (d.valorFrete > 0) campo('Valor do frete (frete_upsert.nValFrete)', d.valorFrete, { moeda: true })
      else campo('Valor do frete', 'sem frete — o campo não é enviado')
    }
    if (d.recorte) campo('Atenção', d.recorte, { largo: true })
    campo(`Obs. externa (${d.campoObsExterna})`, d.obsExterna, { largo: true })
    campo(`Obs. interna (${d.campoObsInterna})`, d.obsInterna, { largo: true })

    cabecalhoTabela(
      ['Item', d.tipo === 'OS' ? 'Cód. serviço' : 'Cód. produto', 'Descrição',
       'NCM', 'CFOP', 'Natureza', 'Unid.', 'Qtd', 'Valor unit. (R$)', 'Total (R$)'],
      10,
    )
    for (const it of d.itens) {
      const r = ws.getRow(linha())
      const vals: unknown[] = [
        it.seq, it.codigo, it.descricao, it.ncm || '—', it.cfop || '—',
        it.natureza, it.unidade, it.quantidade, it.valorUnitario, it.valorTotal,
      ]
      vals.forEach((v, i) => {
        const c = r.getCell(i + 1)
        c.value = (v as any) ?? ''
        c.font = { size: 9 }
        c.alignment = { vertical: 'top', wrapText: i === 2 }
        c.border = { bottom: { style: 'hair', color: { argb: CINZA_LINHA } } }
      })
      r.getCell(9).numFmt = MOEDA
      r.getCell(10).numFmt = MOEDA
    }

    const r = ws.getRow(linha())
    r.getCell(9).value = 'Total'
    r.getCell(9).font = { bold: true, size: 9 }
    r.getCell(9).alignment = { horizontal: 'right' }
    const totalDoc = d.tipo === 'OC' ? d.total + d.valorFrete : d.total
    r.getCell(10).value = totalDoc
    r.getCell(10).numFmt = MOEDA
    r.getCell(10).font = { bold: true, size: 9, color: { argb: AZUL } }
    if (d.tipo === 'OC' && d.valorFrete > 0) {
      const f = ws.getRow(linha())
      f.getCell(9).value = 'Itens + frete'
      f.getCell(9).font = { size: 8, italic: true }
      f.getCell(9).alignment = { horizontal: 'right' }
      f.getCell(10).value = `${d.total.toFixed(2)} + ${d.valorFrete.toFixed(2)}`
      f.getCell(10).font = { size: 8, italic: true }
    }
    branco()
  }

  if (!plan.docs.length) {
    campo('Atenção', 'Nenhum documento a enviar — nenhum produto alocado a cliente.')
  }
  return ws
}

/** Itens que este cliente recebe deste grupo de fornecedor. */
function itensDoPar(group: any, customer: any) {
  const itens: any[] = []
  for (const alloc of (customer?.productAllocations ?? [])) {
    if (alloc?.groupLocalId !== group?.localId) continue
    if (!(Number(alloc.quantity) > 0)) continue
    const p = group?.products?.[alloc.productIndex]
    if (!p) continue
    itens.push({ ...p, quantity: Number(alloc.quantity), unitSale: Number(alloc.unitSale ?? 0) })
  }
  return itens
}

/**
 * Servico Interatell nao tem fornecedor: e da Interatell para o cliente. Na
 * planilha o bloco do fornecedor sai com a propria Interatell Barueri, que e por
 * onde esse servico e sempre faturado.
 */
function grupoServicoInteratell() {
  const itl = companyForBranch('barueri')
  return {
    branch: 'barueri',
    supplier: {
      name: itl.label, cnpj: formatCNPJ(itl.cnpj), stateRegistration: itl.stateRegistration,
      zipCode: formatZipCode(itl.zipCode), city: itl.city, state: itl.state,
      neighborhood: itl.neighborhood, address: itl.address, number: itl.number,
      complement: itl.complement, contactName: itl.contactName, phone: itl.phone, email: itl.email,
    },
  }
}

/** Codigo do servico Interatell no Omie (SERVICO_MAP em api/omie/send). */
const CODIGO_SERVICO_INTERATELL = 'SRV00001'
/** Familia "Outros", a mesma que o formulario usa para servico (SRV_FAMILY_CODE). */
const FAMILIA_SERVICO = '2164790403'

/** Itens do servico Interatell no formato da tabela de itens — sem custo de compra. */
function itensDoServico(entry: any) {
  return (entry?.items ?? [])
    .filter((i: any) => txt(i?.description) && Number(i?.quantity) > 0)
    .map((i: any) => ({
      sku: CODIGO_SERVICO_INTERATELL, partnumber: '', description: txt(i.description),
      nature: 'SVI', ncm: '0000.00.00', family: FAMILIA_SERVICO, cfop: '',
      quantity: Number(i.quantity), unitCost: 0, unitSale: Number(i.unitSale ?? 0),
    }))
}

/**
 * Preenche uma aba ja formatada com os dados de um par fornecedor x cliente.
 *
 * As referencias seguem o modelo OC_JUN_25 (templates/ordem-de-compra.xlsx), que
 * tem a coluna PARTNUMBER entre SKU e Descricao — por isso tudo a partir de C
 * anda uma coluna em relacao ao modelo antigo.
 */
function preencheAba(
  ws: ExcelJS.Worksheet, values: any, group: any, entry: any, itens: any[],
  condicoes: Map<string, string>, gerenteDeContas: string,
) {
  const business = values?.business ?? {}
  const forn = group?.supplier ?? {}
  const cli = entry?.customer ?? {}
  const filialES = group?.branch === 'es'

  const set = (ref: string, v: unknown) => { ws.getCell(ref).value = (v as any) ?? null }

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  set('K2', txt(business.commercialProposal))
  set('K3', paraData(business.purchaseOrderDate))
  // Prazo deste fornecedor. business.deliveryDeadline e o mais distante entre
  // todos e fica de reserva para rascunho gravado antes do campo por fornecedor.
  set('K4', paraData(group?.deliveryDeadline || business.deliveryDeadline))
  set('O4', paraData(business.expectedBillingDate))
  const condicao = (v: unknown) => { const c = txt(v); return condicoes.get(c) || c }
  set('K6', condicao(business.purchasePaymentCondition))
  set('O6', condicao(business.salePaymentCondition))

  // ── Distribuidor / Fornecedor ──────────────────────────────────────────────
  // O bloco inteiro vinha de VLOOKUP em Fornecedores_Pasta, que vira #NOME?
  // porque o nome aponta para uma tabela que nao sobrevive ao round-trip.
  set('A9',  txt(forn.name))
  set('H9',  txt(forn.cnpj))
  set('H10', txt(forn.stateRegistration))
  set('C10', txt(forn.zipCode))
  set('C11', txt(forn.city));         set('E11', txt(forn.state))
  set('C12', txt(forn.neighborhood))
  set('C13', txt(forn.address));      set('E13', txt(forn.number))
  set('C14', txt(forn.complement))
  set('H11', txt(forn.contactName))
  set('H12', txt(forn.phone))
  set('H14', txt(forn.email))

  // ── Interatell ─────────────────────────────────────────────────────────────
  // O bloco vinha de =VLOOKUP($I$9,INTERATELL,...) e caia em #N/D. Os dados das
  // duas empresas ja estao no codigo, entao vao como valor.
  const itl = companyForBranch(filialES ? 'es' : 'barueri')
  // I9 e a razao social. Era so "BARUERI"/"SERRA" porque no modelo essa celula
  // servia de chave do VLOOKUP; sem a formula, ela traz o nome inteiro.
  set('I9',  txt(itl.label))
  // CNPJ e CEP saem pontuados, como na tabela INTERATELL do modelo.
  set('O9',  formatCNPJ(txt(itl.cnpj)))
  set('J10', formatZipCode(txt(itl.zipCode))); set('O10', txt(itl.stateRegistration))
  set('J11', txt(itl.city));          set('L11', txt(itl.state))
  set('J12', txt(itl.neighborhood))
  set('J13', txt(itl.address));       set('L13', txt(itl.number))
  set('J14', txt(itl.complement))
  // Contato, telefones e e-mail: as colunas 5, 6, 7 e 4 da tabela INTERATELL.
  set('O11', txt(itl.contactName))
  set('O12', txt(itl.phone))
  set('O13', txt(itl.phone2))
  set('O14', txt(itl.email))
  // AK9 e a celula auxiliar "FORMULA PROCV", fora da area visivel, com o mesmo
  // VLOOKUP. Nao aparece na tela, mas guardaria um #N/D no arquivo.
  set('AK9', '')

  // ── Cliente final ──────────────────────────────────────────────────────────
  set('A16', txt(cli.name))
  set('C17', txt(cli.zipCode))
  set('C18', txt(cli.city));          set('E18', txt(cli.state))
  set('C19', txt(cli.neighborhood))
  set('C20', txt(cli.address));       set('E20', txt(cli.number))
  set('C21', txt(cli.complement))
  // A22 e o rotulo "P.O :"; C22 leva so a PO informada pelo cliente. Caindo
  // para o numero do negocio, a planilha mostrava um numero que nao e PO nenhuma.
  set('C22', txt(cli.purchaseOrder))
  set('C23', gerenteDeContas)
  set('H16', txt(cli.cnpj))
  set('H17', cli.isTaxpayer ? 'SIM' : 'NÃO')
  set('H18', txt(cli.stateRegistration))
  set('H19', txt(cli.contactName))
  set('H20', txt(cli.phone))
  set('H22', txt(cli.email))

  // ── Observações ────────────────────────────────────────────────────────────
  set('I16', txt(values?.notes?.externalNotes))
  set('I22', txt(values?.notes?.internalNotes))

  // ── Itens ──────────────────────────────────────────────────────────────────
  // Limpa o bloco inteiro antes de escrever. O modelo traz VLOOKUPs como formula
  // compartilhada; apagar so algumas linhas deixaria clones apontando para uma
  // celula-mestre que nao existe mais, e o ExcelJS recusa o arquivo. A formatacao
  // das celulas nao e afetada.
  for (let l = LINHA_ITENS; l <= ULTIMA_LINHA_ITEM; l++) {
    for (const col of COLUNAS_ITEM) ws.getCell(`${col}${l}`).value = null
  }

  itens.forEach((p, i) => {
    const l = LINHA_ITENS + i
    set(`B${l}`, codigoProduto(p))
    set(`C${l}`, txt(p.partnumber))
    set(`D${l}`, txt(p.description))
    set(`G${l}`, filialES ? 'ES' : 'SP')
    set(`H${l}`, txt(p.cfop))
    set(`I${l}`, txt(p.nature))
    set(`J${l}`, txt(p.family))
    set(`K${l}`, txt(p.ncm))
    set(`L${l}`, nmb(p.quantity))
    set(`M${l}`, nmb(p.unitCost))
    set(`O${l}`, nmb(p.unitSale))
    // N e P sao os totais; o modelo ja traz =M*L e =O*L nas primeiras linhas.
    // Nas demais a formula e escrita aqui para a planilha continuar recalculando.
    ws.getCell(`N${l}`).value = { formula: `M${l}*L${l}` } as any
    ws.getCell(`P${l}`).value = { formula: `O${l}*L${l}` } as any
  })
}

/**
 * Gerente de contas do negocio — o responsavel pelo card no Bitrix.
 *
 * Vai na celula "Gerente de Contas" do bloco do cliente. Uma consulta por
 * geracao; se o Bitrix nao responder, a celula fica vazia em vez de derrubar a
 * planilha inteira.
 */
async function gerenteDoNegocio(values: any): Promise<string> {
  const id = Number(values?.bitrixDealId)
  if (!Number.isFinite(id) || id <= 0) return ''
  try {
    const item = await BitrixService.getFullInsideSalesItem(id)
    const assigned = Number(item?.assignedById ?? item?.assignedById ?? 0)
    if (!assigned) return ''
    const user = await BitrixService.getBitrixUser(assigned)
    return String(user?.fullName ?? '').trim()
  } catch (err) {
    console.error('Erro ao buscar o gerente de contas do negocio:', err)
    return ''
  }
}

/**
 * Nome da aba: o cliente (filial) que recebe a compra, no limite de 31
 * caracteres do Excel. O distribuidor ja identifica o arquivo.
 *
 * O Excel tambem recusa : \ / ? * [ ] no nome e nao aceita duas abas iguais,
 * entao nomes repetidos ganham um sufixo numerico.
 */
function nomeAba(cliente: string, indice: number, usados: Set<string>): string {
  const limpa = (v: string, max: number) =>
    v.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()

  const base = limpa(cliente, 31) || `OC ${indice + 1}`
  let nome = base
  for (let n = 2; usados.has(nome.toLowerCase()); n++) {
    const sufixo = ` (${n})`
    nome = base.slice(0, 31 - sufixo.length) + sufixo
  }
  usados.add(nome.toLowerCase())
  return nome
}

/**
 * Um arquivo por distribuidor (uma OC) e, dentro dele, uma aba por cliente que
 * recebe o que se compra dele. Servico Interatell nao tem distribuidor: sai num
 * arquivo proprio, com uma aba por cliente de servico.
 *
 * Cada arquivo parte do modelo; as abas alem da primeira sao clonadas de um
 * retrato dela tirado antes de qualquer preenchimento. O clone leva estilos,
 * larguras, formulas e o logo; as mesclagens nao vao no model e sao reaplicadas
 * na mao. Os arquivos sao montados um de cada vez, para nao manter varios
 * workbooks em memoria ao mesmo tempo.
 *
 * A ultima aba de cada arquivo e o "Resumo Omie": o pedido como ele vai para o
 * ERP, para o financeiro conferir. `dealId` entra nos codigos de integracao que
 * a aba mostra; sem ele os codigos saem com "?" no lugar do numero.
 */
export async function generateOcExcelFiles(values: any, dealId?: number | null): Promise<OcExcelFile[]> {
  type Aba = { group: any; entry: any; itens: any[] }
  type Arquivo = { fornecedor: string; abas: Aba[]; groupLocalId?: string; servico?: boolean }
  const arquivos: Arquivo[] = []

  for (const group of (values?.supplierGroups ?? [])) {
    const abas: Aba[] = []
    for (const entry of (values?.customers ?? [])) {
      const itens = itensDoPar(group, entry)
      if (itens.length) abas.push({ group, entry, itens })
    }
    if (abas.length) {
      arquivos.push({ fornecedor: txt(group?.supplier?.name), abas, groupLocalId: group?.localId })
    }
  }

  const servico = grupoServicoInteratell()
  const abasServico: Aba[] = []
  for (const entry of (values?.serviceCustomers ?? [])) {
    const itens = itensDoServico(entry)
    if (itens.length) abasServico.push({ group: servico, entry, itens })
  }
  if (abasServico.length) arquivos.push({ fornecedor: 'SERVIÇO INTERATELL', abas: abasServico, servico: true })

  if (!arquivos.length) return []

  const [condicoes, gerente] = await Promise.all([mapaCondicoes(), gerenteDoNegocio(values)])
  const business = values?.business ?? {}

  // Os codigos que o Omie recebe ("A28", "S30"): o formulario guarda o rotulo ou
  // o codigo do Bitrix, e a resolucao e a mesma do envio. Se falhar, a aba mostra
  // o que esta no formulario em vez de derrubar a planilha.
  const codigoCond = async (raw: unknown, kind: 'purchase' | 'sale') => {
    try { return await resolvePaymentCodeForOmie(txt(raw), kind) } catch { return txt(raw) || '—' }
  }
  const condicoesOmie = {
    condicaoCompra: await codigoCond(business.purchasePaymentCondition, 'purchase'),
    condicaoVenda:  await codigoCond(business.salePaymentCondition, 'sale'),
    rotulo: (v: unknown) => { const c = txt(v); return condicoes.get(c) || c },
  }
  const saida: OcExcelFile[] = []
  const nomesUsados = new Set<string>()

  for (const { fornecedor, abas, groupLocalId, servico } of arquivos) {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(TEMPLATE)
    const modelo = wb.getWorksheet(ABA)
    if (!modelo) throw new Error(`Aba "${ABA}" não encontrada no modelo`)

    const limpo = structuredClone(modelo.model)
    const merges = [...(modelo.model.merges ?? [])]

    const usados = new Set<string>()
    abas.forEach(({ group, entry, itens }, i) => {
      let ws = modelo
      if (i > 0) {
        ws = wb.addWorksheet(`__oc${i}`)
        ws.model = { ...structuredClone(limpo), name: ws.name, id: ws.id } as any
        for (const m of merges) {
          try { ws.mergeCells(m) } catch { /* mesclagem ja existente */ }
        }
      }
      ws.name = nomeAba(txt(entry?.customer?.name) || txt(fornecedor), i, usados)
      preencheAba(ws, values, group, entry, itens, condicoes, gerente)
    })

    // Ultima aba: o pedido como ele vai para o Omie, recortado neste arquivo.
    montaAbaResumo(wb, buildOmiePlan(values, dealId ?? null, condicoesOmie,
      servico ? { servicoInteratell: true } : { groupLocalId }))

    // O mesmo distribuidor faturado por Barueri e por ES sao duas OCs, e dois
    // arquivos com o mesmo nome: o navegador sobrescreveria um com o outro.
    const base = nomeArquivo(txt(business.commercialProposal), txt(business.name), fornecedor)
    let filename = base
    for (let n = 2; nomesUsados.has(filename.toLowerCase()); n++) {
      filename = base.replace(/\.xlsx$/, ` (${n}).xlsx`)
    }
    nomesUsados.add(filename.toLowerCase())

    saida.push({ filename, buffer: Buffer.from(await wb.xlsx.writeBuffer()) })
  }
  return saida
}
