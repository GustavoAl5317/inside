import { type NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-actions'
import { sql } from '@/lib/db'
import { patchOmieOrder, type OmieOrderKind, type OmieOrderPatch } from '@/lib/omie-order-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as OmieOrderPatch & { numero?: string }
    const dealId = Number(body.dealId) || 0
    if (!body.meta?.internalId) {
      return NextResponse.json({ success: false, error: 'Busque o pedido antes de atualizar' }, { status: 400 })
    }
    if (!body.patch || (!body.patch.header && !body.patch.items?.length && !body.patch.cliente && !body.patch.fornecedor)) {
      return NextResponse.json({ success: false, error: 'Nenhum campo para atualizar' }, { status: 400 })
    }

    const sessionUser = await getSessionUser()
    let approvalId: number | null = null

    // Só admin atualiza direto. Demais papéis exigem aprovação vigente do PEDIDO (por número).
    const isAdmin = sessionUser?.role === 'admin'
    if (!isAdmin) {
      if (!sessionUser) {
        return NextResponse.json({
          success: false,
          error: 'Sessão não identificada. Reconecte ao Bitrix24 e tente novamente.',
        }, { status: 401 })
      }
      const numero = String(body.numero ?? (body.meta?.numero as string) ?? '')
      const kind = String(body.orderKind ?? '')
      const branch = body.branch === 'es' ? 'es' : 'barueri'
      if (!numero) {
        return NextResponse.json({
          success: false,
          error: 'Busque o pedido novamente antes de solicitar aprovação.',
        }, { status: 400 })
      }
      const [appr] = await sql`
        SELECT id FROM update_requests
        WHERE order_numero = ${numero} AND order_kind = ${kind} AND order_branch = ${branch}
          AND status = 'approved' AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `
      if (!appr) {
        return NextResponse.json({
          success: false,
          error: 'Esta atualização precisa de aprovação do financeiro. Solicite aprovação antes de salvar.',
        }, { status: 403 })
      }
      approvalId = Number(appr.id)
    }

    const result = await patchOmieOrder({
      dealId,
      branch: body.branch === 'es' ? 'es' : 'barueri',
      orderKind: body.orderKind as OmieOrderKind,
      meta: body.meta,
      patch: body.patch,
    })

    if (approvalId) {
      await sql`UPDATE update_requests SET consumed_at = NOW() WHERE id = ${approvalId}`
    }

    return NextResponse.json({ ...result, success: true })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? 'Erro ao atualizar pedido' }, { status: 500 })
  }
}
