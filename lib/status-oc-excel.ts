import 'server-only'
import ExcelJS from 'exceljs'
import type { StatusOcLinha } from './status-oc'

/**
 * Planilha de status no mesmo layout da "STATUS OC - DETALHADO": uma aba por
 * ano, colunas A..U na ordem que o time já usa, para continuar valendo as
 * tabelas dinâmicas montadas em cima dela.
 */
const COLUNAS: Array<{ titulo: string; largura: number; campo: keyof StatusOcLinha; tipo?: 'num' | 'data' }> = [
  { titulo: 'CLIENTE',               largura: 34, campo: 'cliente' },
  { titulo: 'PROPOSTA',              largura: 14, campo: 'proposta' },
  { titulo: 'PEDIDO',                largura: 14, campo: 'pedido' },
  { titulo: 'OC',                    largura: 11, campo: 'oc' },
  { titulo: 'ACCOUNT',               largura: 16, campo: 'account' },
  { titulo: 'PART. NUMBER',          largura: 24, campo: 'partNumber' },
  { titulo: 'DESCRIÇÃO DO PRODUTO',  largura: 46, campo: 'descricao' },
  { titulo: 'QTDE',                  largura: 8,  campo: 'qtde', tipo: 'num' },
  { titulo: 'CUSTO\nUNITÁRIO',       largura: 13, campo: 'custoUnitario', tipo: 'num' },
  { titulo: 'CUSTO\nTOTAL',          largura: 13, campo: 'custoTotal', tipo: 'num' },
  { titulo: 'VENDA\nUNITÁRIO',       largura: 13, campo: 'vendaUnitario', tipo: 'num' },
  { titulo: 'VENDA\nTOTAL',          largura: 13, campo: 'vendaTotal', tipo: 'num' },
  { titulo: 'NATUREZA',              largura: 10, campo: 'natureza' },
  { titulo: 'NF DISTRIBUIDOR',       largura: 15, campo: 'nfDistribuidor' },
  { titulo: 'DATA FAT. FORNECEDOR',  largura: 17, campo: 'dataFatFornecedor', tipo: 'data' },
  { titulo: 'NF INTERATELL',         largura: 14, campo: 'nfInteratell' },
  { titulo: 'DATA FAT INTERATELL',   largura: 17, campo: 'dataFatInteratell', tipo: 'data' },
  { titulo: 'FORNECEDOR',            largura: 16, campo: 'fornecedor' },
  { titulo: 'FATURAMENTO\nDIRETO',   largura: 13, campo: 'faturamentoDireto' },
  { titulo: 'ENVIO DO\nPEDIDO',      largura: 13, campo: 'envioPedido', tipo: 'data' },
  { titulo: 'STATUS DISTRIBUIDOR',   largura: 22, campo: 'statusDistribuidor' },
]

/** "2026-01-08" → Date ao meio-dia UTC, para o fuso não jogar para o dia anterior. */
function paraData(v: unknown): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '').trim())
  if (!m) return String(v ?? '')
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
}

export async function geraStatusOcExcel(linhas: StatusOcLinha[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Inside Sales'

  // Uma aba por ano do envio do pedido, como na planilha atual.
  const porAno = new Map<string, StatusOcLinha[]>()
  for (const l of linhas) {
    const ano = /^(\d{4})/.exec(l.envioPedido)?.[1] ?? 'SEM DATA'
    porAno.set(ano, [...(porAno.get(ano) ?? []), l])
  }
  if (!porAno.size) porAno.set(String(new Date().getFullYear()), [])

  for (const ano of [...porAno.keys()].sort()) {
    const ws = wb.addWorksheet(ano)
    ws.columns = COLUNAS.map(c => ({ width: c.largura }))

    const cabecalho = ws.addRow(COLUNAS.map(c => c.titulo))
    cabecalho.height = 30
    cabecalho.eachCell(cell => {
      cell.font = { bold: true, size: 10 }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
      cell.border = { bottom: { style: 'thin' } }
    })
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS.length } }

    for (const linha of porAno.get(ano) ?? []) {
      const valores = COLUNAS.map(c => {
        const v = linha[c.campo]
        if (c.tipo === 'data') return paraData(v)
        if (c.tipo === 'num') return Number(v) || 0
        return v
      })
      const row = ws.addRow(valores)
      COLUNAS.forEach((c, i) => {
        const cell = row.getCell(i + 1)
        if (c.tipo === 'data') cell.numFmt = 'dd/mm/yyyy'
        if (c.tipo === 'num' && c.campo !== 'qtde') cell.numFmt = '#,##0.00'
      })
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
