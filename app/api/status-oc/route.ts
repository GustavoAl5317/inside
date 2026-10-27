import { type NextRequest, NextResponse } from 'next/server'
import { montaStatusOc } from '@/lib/status-oc'
import { geraStatusOcExcel } from '@/lib/status-oc-excel'

/**
 * Status das Ordens de Compra do período, montado na hora a partir do Omie e do
 * Bitrix. `formato=xlsx` devolve a planilha no layout que o time já usa.
 *
 * Datas em dd/mm/aaaa, como o Omie espera.
 */
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const de = searchParams.get('de') ?? ''
  const ate = searchParams.get('ate') ?? ''
  const formato = searchParams.get('formato') ?? 'json'

  const valida = (v: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(v)
  if (!valida(de) || !valida(ate)) {
    return NextResponse.json(
      { success: false, error: 'Informe o período em dd/mm/aaaa nos parâmetros de e ate.' },
      { status: 400 },
    )
  }

  try {
    const resultado = await montaStatusOc(de, ate)

    if (formato === 'xlsx') {
      const buffer = await geraStatusOcExcel(resultado.linhas)
      const nome = `STATUS OC - ${de.replace(/\//g, '-')} a ${ate.replace(/\//g, '-')}.xlsx`
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`,
        },
      })
    }

    return NextResponse.json({ success: true, ...resultado })
  } catch (error) {
    console.error('status-oc:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    )
  }
}
