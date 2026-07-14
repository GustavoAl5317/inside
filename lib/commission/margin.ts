import 'server-only'
import { sql } from '@/lib/db'
import type { CommissionTier } from './types'

/** Fração do lucro bruto que vira "Empresa Líquida" no bp-49 (margem = líq/venda). */
const LIQ_FACTOR = 0.415

/**
 * Margem % no mesmo critério do processo bp-49 do Bitrix:
 *   Empresa Líquida = (Venda − Custo) × 0,415
 *   Margem %        = Empresa Líquida ÷ Venda × 100
 */
export function marginFromSaleCost(totalSale: number, totalCost: number): number | null {
  if (!(totalSale > 0)) return null
  const liquida = (totalSale - totalCost) * LIQ_FACTOR
  return (liquida / totalSale) * 100
}

/** Extrai venda/custo totais de um payload de deal (mesma montagem do /api/omie/send). */
export function computeDealMargin(payload: any): number | null {
  try {
    const supplierGroups: any[] = payload?.supplierGroups ?? []
    const customers: any[] = payload?.customers ?? []
    let totalSale = 0
    let totalCost = 0
    for (const entry of customers) {
      for (const alloc of entry?.productAllocations ?? []) {
        const qty = Number(alloc?.quantity ?? 0)
        if (!(qty > 0)) continue
        const group = supplierGroups.find((g: any) => g?.localId === alloc?.groupLocalId)
        const product = group?.products?.[alloc?.productIndex]
        totalSale += qty * Number(alloc?.unitSale ?? 0)
        totalCost += qty * Number(product?.unitCost ?? 0)
      }
    }
    return marginFromSaleCost(totalSale, totalCost)
  } catch {
    return null
  }
}

/**
 * Tenta achar o negócio local ligado a um recebimento (pelo número do pedido/OS
 * gravado em deals.omie_response) e devolve a margem calculada. Best-effort.
 */
export async function findDealMargin(pedido: string | null): Promise<{ margin: number | null; dealId: number | null }> {
  if (!pedido) return { margin: null, dealId: null }
  const digits = pedido.replace(/\D/g, '').replace(/^0+/, '')
  if (!digits) return { margin: null, dealId: null }
  try {
    const rows = await sql`
      SELECT id, payload
      FROM deals
      WHERE omie_response::text LIKE ${'%' + digits + '%'}
      ORDER BY updated_at DESC
      LIMIT 1`
    if (!rows.length) return { margin: null, dealId: null }
    const deal = rows[0]
    const payload = typeof deal.payload === 'string' ? JSON.parse(deal.payload) : deal.payload
    return { margin: computeDealMargin(payload), dealId: Number(deal.id) }
  } catch {
    return { margin: null, dealId: null }
  }
}

/** Taxa (fração) da faixa de margem. Aplica o portão de margem mínima. */
export function resolveRate(margin: number | null, tiers: CommissionTier[], gate: number): number {
  if (margin == null) return 0
  if (margin < gate) return 0
  const active = tiers.filter(t => t.active)
  for (const t of active) {
    const okMin = margin >= Number(t.min_margin)
    const okMax = t.max_margin == null || margin <= Number(t.max_margin)
    if (okMin && okMax) return Number(t.rate)
  }
  return 0
}
