import { type NextRequest, NextResponse } from 'next/server'
import { generateOcExcelFiles } from '@/lib/generate-oc-excel'

/**
 * Gera a planilha de Ordem de Compra do negócio.
 *
 * Sai um arquivo por distribuidor (uma OC), com uma aba por cliente, e um para o
 * serviço Interatell. A resposta é uma lista em base64 e o front baixa um por um.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    // O corpo novo e { values, dealId }; payloads antigos mandavam values na raiz.
    const values = body?.values ?? body
    const dealId = Number(body?.dealId) || null
    const arquivos = await generateOcExcelFiles(values, dealId)
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
