import { type NextRequest, NextResponse } from 'next/server'
import { generateAlteracoesExcel } from '@/lib/generate-alteracoes-excel'

/**
 * Gera a planilha com as alterações de um Deal Completo.
 *
 * Roda no servidor porque depende do ExcelJS; o front só dispara o download.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const arquivo = await generateAlteracoesExcel(body?.deal ?? {}, body?.changes ?? [])
    return NextResponse.json({
      success: true,
      filename: arquivo.filename,
      base64: arquivo.buffer.toString('base64'),
    })
  } catch (error) {
    console.error('Erro ao gerar Excel das alterações:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    )
  }
}
