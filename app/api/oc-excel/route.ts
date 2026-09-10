import { type NextRequest, NextResponse } from 'next/server'
import { generateOcExcelFiles } from '@/lib/generate-oc-excel'

/**
 * Gera a planilha de Ordem de Compra do negócio.
 *
 * Sai um arquivo só, com uma aba por par fornecedor × cliente. A resposta segue
 * sendo uma lista em base64 — o front já itera sobre ela, e a lista deixa espaço
 * para voltar a quebrar em vários arquivos se algum dia for preciso.
 */
export async function POST(req: NextRequest) {
  try {
    const values = await req.json()
    const arquivos = await generateOcExcelFiles(values)
    return NextResponse.json({
      success: true,
      files: arquivos.map(a => ({ filename: a.filename, base64: a.buffer.toString('base64') })),
    })
  } catch (error) {
    console.error('Erro ao gerar Excel da OC:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    )
  }
}
