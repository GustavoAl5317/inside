import 'server-only'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { companyForBranch } from './interatell-companies'
import { formatCNPJ, formatZipCode } from './utils'
import { BitrixService } from './bitrix-service'

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
 * Preenche uma aba ja formatada com os dados de um par fornecedor x cliente.
 *
 * As referencias seguem o modelo OC_JUN_25 (templates/ordem-de-compra.xlsx), que
 * tem a coluna PARTNUMBER entre SKU e Descricao — por isso tudo a partir de C
 * anda uma coluna em relacao ao modelo antigo.
 */
function preencheAba(
  ws: ExcelJS.Worksheet, values: any, group: any, entry: any,
  condicoes: Map<string, string>, gerenteDeContas: string,
) {
  const itens = itensDoPar(group, entry)

  const business = values?.business ?? {}
  const forn = group?.supplier ?? {}
  const cli = entry?.customer ?? {}
  const filialES = group?.branch === 'es'

  const set = (ref: string, v: unknown) => { ws.getCell(ref).value = (v as any) ?? null }

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  set('K2', txt(business.commercialProposal))
  set('K3', paraData(business.purchaseOrderDate))
  set('K4', paraData(business.deliveryDeadline))
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
  set('C22', txt(cli.purchaseOrder) || txt(business.commercialProposal))
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
 * Nome da aba: fornecedor x cliente, no limite de 31 caracteres do Excel.
 *
 * O Excel tambem recusa : \ / ? * [ ] no nome e nao aceita duas abas iguais,
 * entao nomes repetidos ganham um sufixo numerico.
 */
function nomeAba(fornecedor: string, cliente: string, indice: number, usados: Set<string>): string {
  const limpa = (v: string, max: number) =>
    v.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()

  const base = limpa(`${limpa(fornecedor, 14)} x ${limpa(cliente, 12)}`, 31) || `OC ${indice + 1}`
  let nome = base
  for (let n = 2; usados.has(nome.toLowerCase()); n++) {
    const sufixo = ` (${n})`
    nome = base.slice(0, 31 - sufixo.length) + sufixo
  }
  usados.add(nome.toLowerCase())
  return nome
}

/**
 * Uma aba por par fornecedor x cliente que tenha item alocado, tudo num arquivo
 * so. A coluna NATUREZA distingue HW, SW, LC, ST e SRV dentro da mesma aba.
 *
 * O modelo tem uma aba de Ordem de Compra so, entao as demais sao clonadas a
 * partir de um retrato dela tirado antes de qualquer preenchimento. O clone leva
 * estilos, larguras, formulas e o logo; as mesclagens nao vao no model e sao
 * reaplicadas na mao.
 */
export async function generateOcExcelFiles(values: any): Promise<OcExcelFile[]> {
  const pares: Array<{ group: any; entry: any }> = []
  for (const group of (values?.supplierGroups ?? [])) {
    for (const entry of (values?.customers ?? [])) {
      if (itensDoPar(group, entry).length) pares.push({ group, entry })
    }
  }
  if (!pares.length) return []

  const [condicoes, gerente] = await Promise.all([mapaCondicoes(), gerenteDoNegocio(values)])
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(TEMPLATE)
  const modelo = wb.getWorksheet(ABA)
  if (!modelo) throw new Error(`Aba "${ABA}" não encontrada no modelo`)

  const limpo = structuredClone(modelo.model)
  const merges = [...(modelo.model.merges ?? [])]

  const usados = new Set<string>()
  pares.forEach(({ group, entry }, i) => {
    let ws = modelo
    if (i > 0) {
      ws = wb.addWorksheet(`__oc${i}`)
      ws.model = { ...structuredClone(limpo), name: ws.name, id: ws.id } as any
      for (const m of merges) {
        try { ws.mergeCells(m) } catch { /* mesclagem ja existente */ }
      }
    }
    ws.name = nomeAba(txt(group?.supplier?.name), txt(entry?.customer?.name), i, usados)
    preencheAba(ws, values, group, entry, condicoes, gerente)
  })

  const business = values?.business ?? {}
  // Com uma aba so, o fornecedor ainda cabe no nome do arquivo; com varias ele
  // deixa de identificar o conteudo.
  const fornecedor = pares.length === 1 ? txt(pares[0].group?.supplier?.name) : ''
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return [{
    filename: nomeArquivo(txt(business.commercialProposal), txt(business.name), fornecedor),
    buffer,
  }]
}
