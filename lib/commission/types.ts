// Tipos compartilhados do módulo de comissionamento (client + server).
// Não importa nada de 'server-only' para poder ser usado em componentes client.

export type PeriodStatus = 'open' | 'closed' | 'approved'
export type BaseMode = 'received' | 'invoiced'

export interface CommissionTier {
  id: number
  min_margin: number
  max_margin: number | null
  rate: number
  label: string
  sort: number
  active: boolean
}

export interface CommissionSettings {
  base_mode: BaseMode
  min_margin_gate: number
  default_margin: number
  updated_at?: string
  updated_by?: string | null
}

export interface CommissionVendor {
  id: number
  omie_vendor_code: string
  omie_vendor_name: string | null
  branch: string | null
  app_user_bitrix_id: string | null
  canonical_name: string | null
  active: boolean
  am_name?: string | null // nome do AM (join app_users) — preenchido na leitura
}

export interface CommissionReceipt {
  id: number
  period_id: number
  omie_key: string
  branch: string | null
  omie_vendor_code: string | null
  omie_vendor_name: string | null
  app_user_bitrix_id: string | null
  am_name?: string | null
  client_name: string | null
  client_cnpj: string | null
  nf: string | null
  pedido: string | null
  parcela: string | null
  paid_at: string | null
  paid_value: number
  margin: number | null
  rate: number | null
  commission_value: number
  deal_id: number | null
}

export interface CommissionPeriod {
  id: number
  year: number
  month: number
  status: PeriodStatus
  synced_at: string | null
  closed_at: string | null
  closed_by: string | null
  approved_at: string | null
  approved_by: string | null
  totals: PeriodTotals | null
}

export interface PeriodTotals {
  receipts: number
  paidTotal: number
  commissionTotal: number
  amCount: number
  unmapped: number // recebimentos sem AM mapeado
}

/** Comissão consolidada por AM dentro de um período. */
export interface AmCommissionSummary {
  app_user_bitrix_id: string | null
  am_name: string
  vendorNames: string[]
  receipts: number
  paidTotal: number
  commissionTotal: number
  mapped: boolean
}

export interface CommissionAudit {
  id: number
  period_id: number | null
  action: string
  actor: string | null
  actor_name: string | null
  detail: string | null
  created_at: string
}

export const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export function periodLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1] ?? '?'} / ${year}`
}

export function formatBRL(v: number | null | undefined): string {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatPct(rate: number | null | undefined): string {
  if (rate == null) return '—'
  return `${(Number(rate) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%`
}
