import { type NextRequest, NextResponse } from 'next/server'
import { consultOmieOrderByNumero, type OmieOrderKind } from '@/lib/omie-order-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const KINDS = new Set<OmieOrderKind>(['OC', 'OV', 'OS', 'SW', 'LC', 'LIC', 'ST', 'SRV'])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const dealId = Number(body.dealId) || 0
    const branch = body.branch === 'es' ? 'es' : 'barueri'
    const orderKind = String(body.orderKind ?? '').toUpperCase() as OmieOrderKind
    const numero = String(body.numero ?? '').trim()

    if (!KINDS.has(orderKind)) return NextResponse.json({ success: false, error: 'Tipo de pedido inválido' }, { status: 400 })
    if (!numero) return NextResponse.json({ success: false, error: 'Número do pedido é obrigatório' }, { status: 400 })

    const order = await consultOmieOrderByNumero({ dealId, branch, orderKind, numero })
    return NextResponse.json({ success: true, order })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? 'Erro ao consultar pedido' }, { status: 500 })
  }
}
