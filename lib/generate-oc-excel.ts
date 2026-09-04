import 'server-only'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { companyForBranch } from './interatell-companies'
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

async function montaArquivo(values: any, group: any, entry: any, condicoes: Map<string, string>): Promise<OcExcelFile | null> {
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
  set('H9',  filialES ? 'SERRA' : 'BARUERI')
  set('N9',  txt(itl.cnpj))
  set('I10', txt(itl.zipCode));       set('N10', txt(itl.stateRegistration))
  set('I11', txt(itl.city));          set('K11', txt(itl.state))
  set('I12', txt(itl.neighborhood))
  set('I13', txt(itl.address));       set('K13', txt(itl.number))
  set('I14', txt(itl.complement))
  // N11/N12 sao os dois telefones e N13/N14 contato e e-mail no modelo; sem
  // esses dados no cadastro, ficam vazios em vez de #N/D.
  for (const ref of ['N11', 'N12', 'N13', 'N14']) set(ref, '')
  // AJ9 e uma celula auxiliar rotulada "FORMULA PROCV" fora da area visivel, com
  // o mesmo VLOOKUP. Fica de fora da tela, mas guardaria um #N/D no arquivo.
  set('AJ9', '')

  // ── Cliente final ──────────────────────────────────────────────────────────
  set('A16', txt(cli.name))
  set('B17', txt(cli.zipCode))
  set('B18', txt(cli.city));          set('D18', txt(cli.state))
  set('B19', txt(cli.neighborhood))
  set('B20', txt(cli.address));       set('D20', txt(cli.number))
  set('B21', txt(cli.complement))
  set('B22', txt(cli.purchaseOrder) || txt(business.commercialProposal))
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
    set(`B${l}`, txt(p.sku) || txt(p.partnumber))
    set(`C${l}`, txt(p.description))
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
export async function generateOcExcelFiles(values: any): Promise<OcExcelFile[]> {
  const arquivos: OcExcelFile[] = []
  const condicoes = await mapaCondicoes()
  for (const group of (values?.supplierGroups ?? [])) {
    for (const entry of (values?.customers ?? [])) {
      const f = await montaArquivo(values, group, entry, condicoes)
      if (f) arquivos.push(f)
    }
  }
  return arquivos
}
