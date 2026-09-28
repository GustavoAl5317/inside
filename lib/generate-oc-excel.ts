import 'server-only'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { companyForBranch } from './interatell-companies'
import { formatCNPJ } from './utils'
import { BitrixService } from './bitrix-service'
import {
  buildOmiePlan, resolvePaymentCodeForOmie,
  type OmiePlan, type OmiePlanDoc,
} from './omie-order-plan'

/**
 * Gera a Ordem de Compra em Excel a partir do modelo da Interatell.
 *
 * O modelo (templates/ordem-de-compra.xlsx) e a planilha que o time ja usa, com
 * as macros removidas: cores, bordas, mesclagens, larguras, o logo e as formulas
 * de calculo continuam iguais. O codigo so preenche celulas.
 *
 * O modelo tem UM bloco de fornecedor e UM de cliente, entao sai um arquivo por
 * par fornecedor x cliente. As formulas de VLOOKUP das abas ocultas sao
 * substituidas por valores: o app ja tem esses dados em memoria.
 */

const TEMPLATE = path.join(process.cwd(), 'templates', 'ordem-de-compra.xlsx')
const ABA = 'Ordem de Compra'

/** Tabela de itens: linha 29 e o cabecalho, 30..49 sao as 20 linhas de item. */
const LINHA_ITENS = 30
const ULTIMA_LINHA_ITEM = 49

/** Colunas de dado da tabela; A guarda a numeracao do item, que fica como esta. */
const COLUNAS_ITEM = ['B','C','D','E','F','G','H','I','J','K','L','M','N','O'] as const

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
 * O recorte é o do arquivo: só a compra deste fornecedor e as vendas que saem
 * dela. A OC aparece inteira, porque é o documento real do Omie; a OV e a OS
 * levam os itens vindos deste fornecedor e, quando o documento no Omie é maior
 * do que isso, a linha "Atenção" diz quantos itens ficaram de fora.
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
  if (plan.escopoFornecedor) campo('Fornecedor desta OC', plan.escopoFornecedor)
  if (plan.escopoCliente) campo('Cliente desta OC', plan.escopoCliente)
  campo('Nº do negócio / proposta', plan.proposta)
  campo('Processo (id no app)', plan.dealId ?? 'rascunho ainda sem id')
  campo('Data da OC', plan.dataOc)
  campo('Prazo de entrega', plan.prazoEntrega)
  campo('Previsão de faturamento', plan.previsaoFaturamento)
  campo('Cond. pagamento compra', `${plan.condicaoCompra} — ${plan.condicaoCompraLabel}`)
  campo('Cond. pagamento venda', `${plan.condicaoVenda} — ${plan.condicaoVendaLabel}`)
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
    campo('Data de previsão', d.dataPrevisao)
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

async function montaArquivo(values: any, group: any, entry: any, condicoes: Map<string, string>, plan: OmiePlan): Promise<OcExcelFile | null> {
  const itens = itensDoPar(group, entry)
  if (!itens.length) return null

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(TEMPLATE)
  const ws = wb.getWorksheet(ABA)
  if (!ws) throw new Error(`Aba "${ABA}" não encontrada no modelo`)

  const business = values?.business ?? {}
  const forn = group?.supplier ?? {}
  const cli = entry?.customer ?? {}
  const filialES = group?.branch === 'es'

  const set = (ref: string, v: unknown) => { ws.getCell(ref).value = (v as any) ?? null }

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  set('J2', txt(business.commercialProposal))
  set('J3', paraData(business.purchaseOrderDate))
  set('J4', paraData(business.deliveryDeadline))
  set('N4', paraData(business.expectedBillingDate))
  const condicao = (v: unknown) => { const c = txt(v); return condicoes.get(c) || c }
  set('J6', condicao(business.purchasePaymentCondition))
  set('N6', condicao(business.salePaymentCondition))

  // ── Distribuidor / Fornecedor ──────────────────────────────────────────────
  // G9 e G10 traziam =VLOOKUP(...Fornecedores_Pasta...), que vira #NOME? porque
  // o nome aponta para uma tabela que nao sobrevive ao round-trip. Sao escritos
  // como valor, igual ao resto do bloco.
  set('A9',  txt(forn.name))
  set('G9',  txt(forn.cnpj))
  set('G10', txt(forn.stateRegistration))
  set('B10', txt(forn.zipCode))
  set('B11', txt(forn.city));         set('D11', txt(forn.state))
  set('B12', txt(forn.neighborhood))
  set('B13', txt(forn.address));      set('D13', txt(forn.number))
  set('B14', txt(forn.complement))
  set('G11', txt(forn.contactName))
  set('G12', txt(forn.phone))
  set('G14', txt(forn.email))

  // ── Interatell ─────────────────────────────────────────────────────────────
  // O bloco inteiro vinha de =VLOOKUP($H$9,INTERATELL,...) e caia em #N/D. Os
  // dados das duas empresas ja estao no codigo, entao vao como valor.
  const itl = companyForBranch(filialES ? 'es' : 'barueri')
  // H9 e a celula da razao social — no modelo ela vinha com
  // "INTERATELL INTEGRACOES E TELECOMUNICACOES LTDA- ES". Estava saindo
  // "BARUERI"/"SERRA", que e a coluna NATUREZA da tabela auxiliar e mora em AJ9.
  set('H9',  txt(itl.name))
  // O CNPJ fica sem mascara no cadastro porque multi-step-form compara por
  // digitos; a mascara e so na planilha, para casar com o bloco do fornecedor.
  set('N9',  formatCNPJ(txt(itl.cnpj)))
  set('I10', txt(itl.zipCode));       set('N10', txt(itl.stateRegistration))
  set('I11', txt(itl.city));          set('K11', txt(itl.state))
  set('I12', txt(itl.neighborhood))
  set('I13', txt(itl.address));       set('K13', txt(itl.number))
  set('I14', txt(itl.complement))
  // Ordem das colunas da tabela INTERATELL do modelo: N11 contato (col 5),
  // N12 telefone 1 (col 6), N13 telefone 2 (col 7) e N14 e-mail (col 4).
  // Ha um unico telefone no cadastro, entao N13 fica vazio em vez de repeti-lo.
  set('N11', txt(itl.contactName))
  set('N12', txt(itl.phone))
  set('N13', '')
  set('N14', txt(itl.email))
  // AJ9 e uma celula auxiliar rotulada "FORMULA PROCV" fora da area visivel, com
  // o mesmo VLOOKUP (coluna 14, "NATUREZA"). Fica de fora da tela, mas guardaria
  // um #N/D no arquivo; recebe o valor que o modelo espera.
  set('AJ9', filialES ? 'SERRA' : 'BARUERI')

  // ── Cliente final ──────────────────────────────────────────────────────────
  set('A16', txt(cli.name))
  set('B17', txt(cli.zipCode))
  set('B18', txt(cli.city));          set('D18', txt(cli.state))
  set('B19', txt(cli.neighborhood))
  set('B20', txt(cli.address));       set('D20', txt(cli.number))
  set('B21', txt(cli.complement))
  // A22 no modelo e o rotulo "P.O :"; B22 leva so a PO informada pelo cliente.
  // Antes caia para o numero do negocio quando a PO estava vazia, e ai a
  // planilha mostrava um numero que nao era PO nenhuma.
  set('B22', txt(cli.purchaseOrder))
  set('G16', txt(cli.cnpj))
  set('G17', cli.isTaxpayer ? 'SIM' : 'NÃO')
  set('G18', txt(cli.stateRegistration))
  set('G19', txt(cli.contactName))
  set('G20', txt(cli.phone))
  set('G22', txt(cli.email))

  // ── Observações ────────────────────────────────────────────────────────────
  set('H16', txt(values?.notes?.externalNotes))
  set('H22', txt(values?.notes?.internalNotes))

  // ── Itens ──────────────────────────────────────────────────────────────────
  // Limpa o bloco inteiro antes de escrever. O modelo traz VLOOKUPs como formula
  // compartilhada (C, G, H, I, J nas linhas 32..49); apagar so algumas linhas
  // deixaria clones apontando para uma celula-mestre que nao existe mais, e o
  // ExcelJS recusa o arquivo. A formatacao das celulas nao e afetada.
  for (let l = LINHA_ITENS; l <= ULTIMA_LINHA_ITEM; l++) {
    for (const col of COLUNAS_ITEM) ws.getCell(`${col}${l}`).value = null
  }

  itens.forEach((p, i) => {
    const l = LINHA_ITENS + i
    const codigo = codigoProduto(p)
    const descricao = txt(p.description)
    set(`B${l}`, codigo)
    // Sem descricao propria no catalogo, o partnumber ao menos identifica o
    // item; repetir o codigo nas duas colunas nao acrescenta nada.
    set(`C${l}`, descricao === codigo ? txt(p.partnumber) : descricao)
    set(`F${l}`, filialES ? 'ES' : 'SP')
    set(`G${l}`, txt(p.cfop))
    set(`H${l}`, txt(p.nature))
    set(`I${l}`, txt(p.family))
    set(`J${l}`, txt(p.ncm))
    set(`K${l}`, nmb(p.quantity))
    set(`L${l}`, nmb(p.unitCost))
    set(`N${l}`, nmb(p.unitSale))
    // M e O sao os totais; o modelo ja traz =L*K e =N*K nas primeiras linhas.
    // Nas demais a formula e escrita aqui para a planilha continuar recalculando.
    ws.getCell(`M${l}`).value = { formula: `L${l}*K${l}` } as any
    ws.getCell(`O${l}`).value = { formula: `N${l}*K${l}` } as any
  })

  // Ultima aba: o pedido como ele vai para o Omie, para o financeiro conferir.
  montaAbaResumo(wb, plan)

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return {
    filename: nomeArquivo(txt(business.commercialProposal), txt(business.name), txt(forn.name)),
    buffer,
  }
}

/**
 * Um arquivo por par fornecedor x cliente que tenha item alocado.
 * A coluna NATUREZA distingue HW, SW, LC, ST e SRV dentro do mesmo arquivo.
 */
export async function generateOcExcelFiles(values: any, dealId?: number | null): Promise<OcExcelFile[]> {
  const arquivos: OcExcelFile[] = []
  const condicoes = await mapaCondicoes()
  const rotulo = (v: unknown) => { const c = txt(v); return condicoes.get(c) || c }

  // Os codigos que o Omie recebe ("A28", "S30"): o formulario guarda o rotulo ou
  // o codigo do Bitrix, e a resolucao e a mesma do envio. Se falhar, a aba mostra
  // o que esta no formulario em vez de derrubar a planilha inteira.
  const codigoCond = async (raw: unknown, kind: 'purchase' | 'sale') => {
    try { return await resolvePaymentCodeForOmie(txt(raw), kind) } catch { return txt(raw) || '—' }
  }
  const condicoesOmie = {
    condicaoCompra: await codigoCond(values?.business?.purchasePaymentCondition, 'purchase'),
    condicaoVenda:  await codigoCond(values?.business?.salePaymentCondition, 'sale'),
    rotulo,
  }

  for (const group of (values?.supplierGroups ?? [])) {
    for (const entry of (values?.customers ?? [])) {
      // Um plano por arquivo: cada planilha resume a compra do seu fornecedor.
      const plan = buildOmiePlan(values, dealId ?? null, condicoesOmie, {
        groupLocalId: group.localId, customerLocalId: entry.localId,
      })
      const f = await montaArquivo(values, group, entry, condicoes, plan)
      if (f) arquivos.push(f)
    }
  }
  return arquivos
}
