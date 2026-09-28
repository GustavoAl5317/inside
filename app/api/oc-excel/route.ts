import { type NextRequest, NextResponse } from 'next/server'
import { generateOcExcelFiles } from '@/lib/generate-oc-excel'

/**
 * Gera as planilhas de Ordem de Compra do negócio.
 *
 * Devolve a lista em base64 em vez de um arquivo só porque sai uma planilha por
 * par fornecedor × cliente — o mesmo comportamento do gerador de PDF, que baixa
 * um arquivo por documento.
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
