import 'server-only'
import ExcelJS from 'exceljs'
import type { PayloadChange } from './deal-payload-diff'

/**
 * Planilha das alterações de um Deal Completo, na tela de Atualizações.
 *
 * Substitui o PDF que o botão baixava ali: o que o time precisa levar da
 * atualização é a lista de "campo, antes, depois" para conferir contra o Omie,
 * e isso é tabela, não documento.
 *
 * Montada do zero com ExcelJS — não usa o modelo da OC, que é a planilha de
 * compra e não tem onde encaixar um diff.
 */

const AZUL        = 'FF1E40AF'
const CINZA_BG    = 'FFF1F5F9'
const CINZA_LINHA = 'FFCBD5E1'

/** Cores por tipo de alteração, as mesmas do painel de alterações no app. */
const CORES: Record<PayloadChange['kind'], { fundo: string; texto: string; rotulo: string }> = {
  changed: { fundo: 'FFFEF9C3', texto: 'FF854D0E', rotulo: 'Alterado' },
  added:   { fundo: 'FFDCFCE7', texto: 'FF166534', rotulo: 'Incluído' },
  removed: { fundo: 'FFFEE2E2', texto: 'FF991B1B', rotulo: 'Removido' },
}

export interface AlteracoesExcelFile {
  filename: string
  buffer: Buffer
}

export interface DealIdentificacao {
  id?: number | null
  proposal?: string | null
  businessName?: string | null
  customerName?: string | null
  supplierName?: string | null
}

const txt = (v: unknown) => String(v ?? '').trim()

/** Windows recusa \ / : * ? " < > | em nome de arquivo. */
function nomeArquivo(deal: DealIdentificacao): string {
  const limpa = (v: string, max: number) =>
    v.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
      .replace(/[\s-]+$/, '').trim()

  const partes = [
    txt(deal.proposal) || (deal.id ? `Deal ${deal.id}` : 'sem proposta'),
    limpa(txt(deal.businessName), 55),
  ].filter(Boolean)
  return `Alteracoes ${partes.join(' - ')}.xlsx`
}

export async function generateAlteracoesExcel(
  deal: DealIdentificacao,
  changes: PayloadChange[],
): Promise<AlteracoesExcelFile> {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet('Alterações', {
    views: [{ state: 'frozen', ySplit: 0 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = [{ width: 46 }, { width: 42 }, { width: 42 }, { width: 13 }]

  let l = 0
  const linha = () => ++l

  const titulo = (texto: string) => {
    const r = ws.getRow(linha())
    r.getCell(1).value = texto
    r.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    r.height = 20
    for (let c = 1; c <= 4; c++) {
      r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
      r.getCell(c).alignment = { vertical: 'middle' }
    }
    ws.mergeCells(l, 1, l, 4)
  }

  const campo = (rotulo: string, valor: unknown) => {
    const r = ws.getRow(linha())
    r.getCell(1).value = rotulo
    r.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF475569' } }
    const c = r.getCell(2)
    c.value = (valor as any) ?? ''
    c.font = { size: 9 }
    ws.mergeCells(l, 2, l, 4)
  }

  // ── Identificação ──────────────────────────────────────────────────────────
  titulo('ALTERAÇÕES DO DEAL COMPLETO')
  if (deal.proposal)     campo('Proposta', txt(deal.proposal))
  if (deal.businessName) campo('Negócio', txt(deal.businessName))
  if (deal.id != null)   campo('Processo (id no app)', deal.id)
  if (deal.customerName) campo('Cliente', txt(deal.customerName))
  if (deal.supplierName) campo('Fornecedor', txt(deal.supplierName))
  campo('Gerada em', new Date().toLocaleString('pt-BR'))
  linha()

  // ── Alterações ─────────────────────────────────────────────────────────────
  titulo(
    changes.length === 1
      ? '1 ALTERAÇÃO'
      : `${changes.length} ALTERAÇÕES`,
  )

  const cab = ws.getRow(linha())
  ;['Campo', 'Antes', 'Depois', 'Tipo'].forEach((t, i) => {
    const c = cab.getCell(i + 1)
    c.value = t
    c.font = { bold: true, size: 9 }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_BG } }
    c.border = { bottom: { style: 'thin', color: { argb: CINZA_LINHA } } }
    c.alignment = { vertical: 'middle' }
  })
  cab.height = 20
  // Congela cabeçalho e identificação: a lista pode ser longa.
  ws.views = [{ state: 'frozen', ySplit: l }]

  if (!changes.length) {
    const r = ws.getRow(linha())
    r.getCell(1).value = 'Nenhuma alteração em relação ao que está gravado.'
    r.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF64748B' } }
    ws.mergeCells(l, 1, l, 4)
  }

  for (const ch of changes) {
    const r = ws.getRow(linha())
    const cor = CORES[ch.kind] ?? CORES.changed
    const vals = [ch.label, ch.before, ch.after, cor.rotulo]
    vals.forEach((v, i) => {
      const c = r.getCell(i + 1)
      c.value = v
      c.font = { size: 9 }
      c.alignment = { vertical: 'top', wrapText: i < 3 }
      c.border = { bottom: { style: 'hair', color: { argb: CINZA_LINHA } } }
    })
    r.getCell(1).font = { size: 9, bold: true }
    const tipo = r.getCell(4)
    tipo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor.fundo } }
    tipo.font = { size: 9, bold: true, color: { argb: cor.texto } }
    tipo.alignment = { horizontal: 'center', vertical: 'top' }
  }

  // Autofiltro na tabela, para o financeiro filtrar por tipo de alteração.
  if (changes.length) {
    ws.autoFilter = { from: { row: l - changes.length, column: 1 }, to: { row: l, column: 4 } }
  }

  return {
    filename: nomeArquivo(deal),
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  }
}
