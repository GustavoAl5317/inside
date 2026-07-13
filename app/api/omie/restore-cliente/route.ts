import { type NextRequest, NextResponse } from 'next/server'
import {
  MARFRIG_5271878606_SNAPSHOT,
  restoreOmieClienteFromSnapshot,
} from '@/lib/omie-order-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const dealId = Number(body.dealId) || 0
    const branch = body.branch === 'es' ? 'es' : 'barueri'
    const codigoCliente = Number(body.codigoCliente ?? MARFRIG_5271878606_SNAPSHOT.codigo_cliente_omie)
    const snapshot = body.snapshot ?? MARFRIG_5271878606_SNAPSHOT

    const cliente = await restoreOmieClienteFromSnapshot({
      dealId,
      branch,
      codigoCliente,
      snapshot,
    })

    return NextResponse.json({
      success: true,
      message: `Cliente ${codigoCliente} restaurado no Omie.`,
      cliente,
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? 'Erro ao restaurar cliente' }, { status: 500 })
  }
}
