'use server'

import { sql } from '@/lib/db'
import { getSessionUser } from '@/lib/auth-actions'
import type { SessionUser } from '@/lib/auth-types'
import { ensureCommissionSchema } from '@/lib/commission/schema'
import { fetchMonthReceipts, fetchOmieVendors, SALES_DOC_TYPES } from '@/lib/commission/omie-financas'
import { findDealMargin, resolveRate } from '@/lib/commission/margin'
import { getBitrixDealInfoById, getBitrixUserName, parseNumCtrDealId } from '@/lib/bitrix-service'
import type {
  CommissionTier, CommissionSettings, CommissionVendor, CommissionReceipt,
  CommissionPeriod, AmCommissionSummary, CommissionAudit, PeriodTotals,
} from '@/lib/commission/types'

type Ok<T> = { success: true } & T
type Err = { success: false; error: string }
type Res<T = {}> = Ok<T> | Err

const ok = <T,>(data: T): Ok<T> => ({ success: true, ...data })
const err = (e: unknown): Err => ({ success: false, error: e instanceof Error ? e.message : 'Erro desconhecido' })

// ─── Guards de permissão ────────────────────────────────────────────────────────
async function requireView(): Promise<SessionUser> {
  const u = await getSessionUser()
  if (!u || !u.active) throw new Error('Sessão inválida')
  if (!['am', 'financeiro', 'admin'].includes(u.role)) throw new Error('Acesso negado')
  return u
}
async function requireFinance(): Promise<SessionUser> {
  const u = await getSessionUser()
  if (!u || !u.active || !['financeiro', 'admin'].includes(u.role)) throw new Error('Acesso negado: requer Financeiro')
  return u
}
async function requireAdmin(): Promise<SessionUser> {
  const u = await getSessionUser()
  if (!u || !u.active || u.role !== 'admin') throw new Error('Acesso negado: requer Administrador')
  return u
}

async function audit(periodId: number | null, action: string, actor: SessionUser, detail?: string) {
  await sql`
    INSERT INTO commission_audit (period_id, action, actor, actor_name, detail)
    VALUES (${periodId}, ${action}, ${actor.bitrixUserId}, ${actor.name}, ${detail ?? null})`.catch(() => {})
}

// ─── Configuração (admin) ───────────────────────────────────────────────────────
export async function getCommissionConfigAction(): Promise<Res<{ settings: CommissionSettings; tiers: CommissionTier[] }>> {
  try {
    await ensureCommissionSchema()
    await requireView()
    const [settings] = await sql`SELECT * FROM commission_settings WHERE id = 1`
    const tiers = await sql`SELECT * FROM commission_tiers ORDER BY sort, min_margin`
    return ok({ settings: settings as CommissionSettings, tiers: tiers as CommissionTier[] })
  } catch (e) { return err(e) }
}

export async function updateCommissionSettingsAction(input: Partial<CommissionSettings>): Promise<Res> {
  try {
    await ensureCommissionSchema()
    const admin = await requireAdmin()
    await sql`
      UPDATE commission_settings SET
        base_mode = COALESCE(${input.base_mode ?? null}, base_mode),
        min_margin_gate = COALESCE(${input.min_margin_gate ?? null}, min_margin_gate),
        default_margin = COALESCE(${input.default_margin ?? null}, default_margin),
        use_bitrix_margin = COALESCE(${input.use_bitrix_margin ?? null}, use_bitrix_margin),
        ignore_unmapped = COALESCE(${input.ignore_unmapped ?? null}, ignore_unmapped),
        updated_at = NOW(), updated_by = ${admin.bitrixUserId}
      WHERE id = 1`
    await audit(null, 'config', admin, 'Configurações gerais alteradas')
    return ok({})
  } catch (e) { return err(e) }
}

export async function upsertTierAction(t: Partial<CommissionTier>): Promise<Res> {
  try {
    await ensureCommissionSchema()
    const admin = await requireAdmin()
    if (t.id) {
      await sql`
        UPDATE commission_tiers SET
          min_margin = ${t.min_margin ?? 0}, max_margin = ${t.max_margin ?? null},
          rate = ${t.rate ?? 0}, label = ${t.label ?? ''}, sort = ${t.sort ?? 0},
          active = ${t.active ?? true}
        WHERE id = ${t.id}`
    } else {
      await sql`
        INSERT INTO commission_tiers (min_margin, max_margin, rate, label, sort, active)
        VALUES (${t.min_margin ?? 0}, ${t.max_margin ?? null}, ${t.rate ?? 0}, ${t.label ?? ''}, ${t.sort ?? 0}, ${t.active ?? true})`
    }
    await audit(null, 'config', admin, `Faixa de comissão salva: ${t.label ?? ''}`)
    return ok({})
  } catch (e) { return err(e) }
}

export async function deleteTierAction(id: number): Promise<Res> {
  try {
    await ensureCommissionSchema()
    const admin = await requireAdmin()
    await sql`DELETE FROM commission_tiers WHERE id = ${id}`
    await audit(null, 'config', admin, `Faixa removida (#${id})`)
    return ok({})
  } catch (e) { return err(e) }
}

// ─── De-para de vendedores (admin) ──────────────────────────────────────────────
export async function listVendorsAction(): Promise<Res<{ vendors: CommissionVendor[] }>> {
  try {
    await ensureCommissionSchema()
    await requireFinance()
    const vendors = await sql`
      SELECT v.*, u.name AS am_name
      FROM commission_vendors v
      LEFT JOIN app_users u ON u.bitrix_user_id = v.app_user_bitrix_id
      ORDER BY COALESCE(v.canonical_name, v.omie_vendor_name), v.omie_vendor_code`
    return ok({ vendors: vendors as CommissionVendor[] })
  } catch (e) { return err(e) }
}

/** Importa/atualiza o cadastro de vendedores do Omie (sem mexer no mapeamento já feito). */
export async function importVendorsFromOmieAction(): Promise<Res<{ imported: number }>> {
  try {
    await ensureCommissionSchema()
    const admin = await requireAdmin()
    const vendors = await fetchOmieVendors()
    let imported = 0
    for (const v of vendors) {
      await sql`
        INSERT INTO commission_vendors (omie_vendor_code, omie_vendor_name, branch, canonical_name, active)
        VALUES (${v.code}, ${v.name}, ${v.branch}, ${v.name}, ${!v.inactive})
        ON CONFLICT (omie_vendor_code) DO UPDATE
          SET omie_vendor_name = EXCLUDED.omie_vendor_name,
              branch = EXCLUDED.branch,
              updated_at = NOW()`
      imported++
    }
    await audit(null, 'config', admin, `Importados ${imported} vendedores do Omie`)
    return ok({ imported })
  } catch (e) { return err(e) }
}

export async function updateVendorAction(input: {
  code: string; appUserBitrixId?: string | null; canonicalName?: string | null; active?: boolean
}): Promise<Res> {
  try {
    await ensureCommissionSchema()
    const admin = await requireAdmin()
    await sql`
      UPDATE commission_vendors SET
        app_user_bitrix_id = ${input.appUserBitrixId ?? null},
        canonical_name = COALESCE(${input.canonicalName ?? null}, canonical_name),
        active = COALESCE(${input.active ?? null}, active),
        updated_at = NOW()
      WHERE omie_vendor_code = ${input.code}`
    await audit(null, 'config', admin, `Vendedor ${input.code} mapeado`)
    return ok({})
  } catch (e) { return err(e) }
}

/** Consolida vários códigos de vendedor (duplicados) no mesmo AM + nome canônico. */
export async function mergeVendorsAction(input: {
  codes: string[]; appUserBitrixId: string | null; canonicalName: string
}): Promise<Res> {
  try {
    await ensureCommissionSchema()
    const admin = await requireAdmin()
    for (const code of input.codes) {
      await sql`
        UPDATE commission_vendors SET
          app_user_bitrix_id = ${input.appUserBitrixId},
          canonical_name = ${input.canonicalName},
          updated_at = NOW()
        WHERE omie_vendor_code = ${code}`
    }
    await audit(null, 'config', admin, `${input.codes.length} códigos consolidados em "${input.canonicalName}"`)
    return ok({})
  } catch (e) { return err(e) }
}

/**
 * Auto-agrupa vendedores duplicados:
 *  - nomes iguais após normalização (acentos/caixa/espaços) viram um só;
 *  - nome de 1 palavra (ex.: "ALINE") entra no grupo de nome composto cujo
 *    primeiro nome bate ("ALINE GOMES") quando há só 1 candidato (sem ambiguidade).
 * O AM mapeado de qualquer código do grupo é propagado para os demais.
 */
export async function autoConsolidateVendorsAction(): Promise<Res<{ groups: number; merged: number }>> {
  try {
    await ensureCommissionSchema()
    const admin = await requireAdmin()
    const rows = await sql`SELECT omie_vendor_code, omie_vendor_name, canonical_name, app_user_bitrix_id FROM commission_vendors`
    const norm = (s: unknown) => String(s ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim()

    const groups = new Map<string, any[]>()
    for (const v of rows) {
      const key = norm(v.canonical_name ?? v.omie_vendor_name)
      if (!key || /ENVIADO VIA API/.test(key)) continue // genérico não agrupa
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(v)
    }

    // nome de 1 palavra → único grupo composto com o mesmo primeiro nome
    const multiKeys = [...groups.keys()].filter(k => k.includes(' '))
    for (const key of [...groups.keys()]) {
      if (key.includes(' ')) continue
      const candidates = multiKeys.filter(mk => mk.split(' ')[0] === key)
      if (candidates.length === 1) {
        groups.get(candidates[0])!.push(...groups.get(key)!)
        groups.delete(key)
      }
    }

    let mergedGroups = 0, mergedRows = 0
    for (const members of groups.values()) {
      if (members.length < 2) continue
      const withAm = members.find(m => m.app_user_bitrix_id)
      const canonicalRow = withAm ?? members.reduce((a, b) =>
        norm(b.canonical_name ?? b.omie_vendor_name).length > norm(a.canonical_name ?? a.omie_vendor_name).length ? b : a)
      const name = String(canonicalRow.canonical_name ?? canonicalRow.omie_vendor_name ?? '').trim()
      const amId = withAm?.app_user_bitrix_id ?? null
      for (const m of members) {
        await sql`
          UPDATE commission_vendors SET
            canonical_name = ${name},
            app_user_bitrix_id = COALESCE(${amId}, app_user_bitrix_id),
            updated_at = NOW()
          WHERE omie_vendor_code = ${m.omie_vendor_code}`
      }
      mergedGroups++
      mergedRows += members.length
    }
    await audit(null, 'config', admin, `Auto-agrupamento: ${mergedRows} códigos em ${mergedGroups} grupos`)
    return ok({ groups: mergedGroups, merged: mergedRows })
  } catch (e) { return err(e) }
}

/** Trilha de auditoria das ações de configuração (sem período). */
export async function getConfigAuditAction(): Promise<Res<{ audit: CommissionAudit[] }>> {
  try {
    await ensureCommissionSchema()
    await requireAdmin()
    const rows = await sql`
      SELECT * FROM commission_audit
      WHERE action = 'config'
      ORDER BY created_at DESC LIMIT 100`
    return ok({ audit: rows as CommissionAudit[] })
  } catch (e) { return err(e) }
}

/** AMs disponíveis para mapear (usuários ativos do app). */
export async function listAmCandidatesAction(): Promise<Res<{ users: Array<{ bitrix_user_id: string; name: string; role: string }> }>> {
  try {
    await requireFinance()
    const users = await sql`SELECT bitrix_user_id, name, role FROM app_users WHERE active = TRUE ORDER BY name`
    return ok({ users: users as any })
  } catch (e) { return err(e) }
}

// ─── Períodos / apuração ────────────────────────────────────────────────────────
async function getOrCreatePeriod(year: number, month: number) {
  const [existing] = await sql`SELECT * FROM commission_periods WHERE year = ${year} AND month = ${month}`
  if (existing) return existing
  const [created] = await sql`
    INSERT INTO commission_periods (year, month, status) VALUES (${year}, ${month}, 'open') RETURNING *`
  return created
}

export async function listPeriodsAction(): Promise<Res<{ periods: CommissionPeriod[] }>> {
  try {
    await ensureCommissionSchema()
    await requireView()
    const periods = await sql`SELECT * FROM commission_periods ORDER BY year DESC, month DESC`
    return ok({ periods: periods as CommissionPeriod[] })
  } catch (e) { return err(e) }
}

/** Sincroniza os recebimentos do mês no Omie e recalcula as comissões. */
export async function syncPeriodAction(year: number, month: number): Promise<Res<{ totals: PeriodTotals }>> {
  try {
    await ensureCommissionSchema()
    const actor = await requireFinance()
    const period = await getOrCreatePeriod(year, month)
    if (period.status === 'approved') throw new Error('Período já aprovado — reabra antes de sincronizar novamente.')

    const [settings] = await sql`SELECT * FROM commission_settings WHERE id = 1`
    const tiers = (await sql`SELECT * FROM commission_tiers ORDER BY sort, min_margin`) as CommissionTier[]
    const gate = Number(settings?.min_margin_gate ?? 10)
    const defaultMargin = Number(settings?.default_margin ?? 0)
    const useBitrixMargin = settings?.use_bitrix_margin !== false
    const ignoreUnmapped = settings?.ignore_unmapped === true

    const vendorRows = await sql`SELECT omie_vendor_code, app_user_bitrix_id, canonical_name, omie_vendor_name FROM commission_vendors`
    const vmap = new Map<string, any>()
    for (const v of vendorRows) vmap.set(String(v.omie_vendor_code), v)

    // Usuários do app (para saber quem já loga no sistema) — o AM vem do responsável do Bitrix
    const appUserRows = await sql`SELECT bitrix_user_id, name FROM app_users`
    const appUsers = new Map<string, string>()
    for (const u of appUserRows) appUsers.set(String(u.bitrix_user_id), String(u.name))

    const receipts = await fetchMonthReceipts(year, month)

    // refresh total do período
    await sql`DELETE FROM commission_receipts WHERE period_id = ${period.id}`

    const localCache = new Map<string, { margin: number | null; dealId: number | null }>()
    const dealCache = new Map<number, { margin: number | null; assignedById: string | null; title: string | null } | null>()
    const userNameCache = new Map<string, string | null>()
    let paidTotal = 0, commissionTotal = 0, unmapped = 0
    const amSet = new Set<string>()

    for (const r of receipts) {
      const vendor = r.vendorCode ? vmap.get(r.vendorCode) : null
      if (r.vendorCode && !vendor) {
        await sql`
          INSERT INTO commission_vendors (omie_vendor_code, omie_vendor_name, branch, canonical_name)
          VALUES (${r.vendorCode}, ${r.vendorName}, ${r.branch}, ${r.vendorName})
          ON CONFLICT (omie_vendor_code) DO NOTHING`
        vmap.set(r.vendorCode, { app_user_bitrix_id: null, canonical_name: r.vendorName, omie_vendor_name: r.vendorName })
      }

      // Negócio do Bitrix (cNumCtr → crm.deal): responsável = AM, título = projeto, margem
      const bitrixDealId = parseNumCtrDealId(r.numCtr)
      let dealInfo = null as null | { margin: number | null; assignedById: string | null; title: string | null }
      if (bitrixDealId) {
        if (!dealCache.has(bitrixDealId)) dealCache.set(bitrixDealId, await getBitrixDealInfoById(bitrixDealId))
        dealInfo = dealCache.get(bitrixDealId) ?? null
      }

      // ── AM: 1º responsável do Bitrix; 2º de-para do vendedor Omie ──
      let amId: string | null = null
      let amSource: string | null = null
      let responsibleName: string | null = null
      if (dealInfo?.assignedById) {
        amId = dealInfo.assignedById
        amSource = 'bitrix'
        if (!userNameCache.has(amId)) userNameCache.set(amId, appUsers.get(amId) ?? await getBitrixUserName(amId))
        responsibleName = userNameCache.get(amId) ?? null
      } else if (vendor?.app_user_bitrix_id) {
        amId = String(vendor.app_user_bitrix_id)
        amSource = 'omie'
        responsibleName = appUsers.get(amId) ?? null
      }

      const isSale = !r.docType || SALES_DOC_TYPES.has(r.docType)
      if (!amId) { if (isSale) unmapped++ ; if (ignoreUnmapped) continue }
      else amSet.add(amId)

      // ── Margem: 1º negócio Bitrix; 2º negócio local; 3º padrão ──
      let margin: number | null = null
      let marginSource: string | null = null
      let localDealId: number | null = null
      if (useBitrixMargin && dealInfo?.margin != null) { margin = dealInfo.margin; marginSource = 'bitrix' }
      if (margin == null && r.pedido) {
        if (!localCache.has(r.pedido)) localCache.set(r.pedido, await findDealMargin(r.pedido))
        const info = localCache.get(r.pedido)!
        if (info.margin != null) { margin = info.margin; marginSource = 'deal'; localDealId = info.dealId }
      }
      if (margin == null && defaultMargin > 0) { margin = defaultMargin; marginSource = 'default' }

      const rate = resolveRate(margin, tiers, gate)
      const commission = Math.round(r.paidValue * rate * 100) / 100

      paidTotal += r.paidValue
      commissionTotal += commission

      await sql`
        INSERT INTO commission_receipts (
          period_id, omie_key, branch, omie_vendor_code, omie_vendor_name, app_user_bitrix_id,
          client_name, client_cnpj, nf, pedido, parcela, paid_at, paid_value,
          margin, margin_source, num_ctr, project_name, bitrix_assigned_id, responsible_name,
          doc_type, am_source, rate, commission_value, deal_id
        ) VALUES (
          ${period.id}, ${r.omieKey}, ${r.branch}, ${r.vendorCode}, ${r.vendorName ?? vendor?.omie_vendor_name ?? null}, ${amId},
          ${r.clientName}, ${r.clientCnpj}, ${r.nf}, ${r.pedido}, ${r.parcela}, ${r.paidAt}, ${r.paidValue},
          ${margin}, ${marginSource}, ${r.numCtr}, ${dealInfo?.title ?? null}, ${dealInfo?.assignedById ?? null}, ${responsibleName},
          ${r.docType}, ${amSource}, ${rate}, ${commission}, ${localDealId}
        )
        ON CONFLICT (period_id, omie_key) DO UPDATE SET
          paid_value = EXCLUDED.paid_value, margin = EXCLUDED.margin,
          margin_source = EXCLUDED.margin_source, num_ctr = EXCLUDED.num_ctr,
          project_name = EXCLUDED.project_name, bitrix_assigned_id = EXCLUDED.bitrix_assigned_id,
          responsible_name = EXCLUDED.responsible_name, doc_type = EXCLUDED.doc_type,
          am_source = EXCLUDED.am_source, rate = EXCLUDED.rate,
          commission_value = EXCLUDED.commission_value, app_user_bitrix_id = EXCLUDED.app_user_bitrix_id`
    }

    const totals: PeriodTotals = {
      receipts: receipts.length,
      paidTotal: Math.round(paidTotal * 100) / 100,
      commissionTotal: Math.round(commissionTotal * 100) / 100,
      amCount: amSet.size,
      unmapped,
    }
    await sql`
      UPDATE commission_periods
      SET synced_at = NOW(), totals = ${JSON.stringify(totals)},
          status = CASE WHEN status = 'approved' THEN status ELSE 'open' END
      WHERE id = ${period.id}`
    await audit(period.id, 'synced', actor,
      `${totals.receipts} recebimentos · pago ${totals.paidTotal} · comissão ${totals.commissionTotal} · ${unmapped} sem AM`)
    return ok({ totals })
  } catch (e) { return err(e) }
}

/** Detalhe de um período: resumo por AM + linhas. Respeita permissão (AM vê só as suas). */
export async function getPeriodDetailAction(year: number, month: number): Promise<Res<{
  period: CommissionPeriod | null; summary: AmCommissionSummary[]; receipts: CommissionReceipt[]
}>> {
  try {
    await ensureCommissionSchema()
    const user = await requireView()
    const [period] = await sql`SELECT * FROM commission_periods WHERE year = ${year} AND month = ${month}`
    if (!period) return ok({ period: null, summary: [], receipts: [] })

    const onlyMine = user.role === 'am'
    const receipts = onlyMine
      ? await sql`
          SELECT r.*, COALESCE(u.name, r.responsible_name) AS am_name FROM commission_receipts r
          LEFT JOIN app_users u ON u.bitrix_user_id = r.app_user_bitrix_id
          WHERE r.period_id = ${period.id} AND r.app_user_bitrix_id = ${user.bitrixUserId}
          ORDER BY r.paid_at DESC, r.commission_value DESC`
      : await sql`
          SELECT r.*, COALESCE(u.name, r.responsible_name) AS am_name FROM commission_receipts r
          LEFT JOIN app_users u ON u.bitrix_user_id = r.app_user_bitrix_id
          WHERE r.period_id = ${period.id}
          ORDER BY r.paid_at DESC, r.commission_value DESC`

    // resumo por AM
    const map = new Map<string, AmCommissionSummary>()
    for (const r of receipts as CommissionReceipt[]) {
      const key = r.app_user_bitrix_id ?? '__none__'
      const name = (r as any).am_name ?? r.responsible_name ?? (r.app_user_bitrix_id ? `AM ${r.app_user_bitrix_id}` : 'Sem AM')
      if (!map.has(key)) {
        map.set(key, {
          app_user_bitrix_id: r.app_user_bitrix_id, am_name: name, vendorNames: [],
          receipts: 0, paidTotal: 0, commissionTotal: 0, mapped: !!r.app_user_bitrix_id,
        })
      }
      const s = map.get(key)!
      s.receipts++
      s.paidTotal += Number(r.paid_value)
      s.commissionTotal += Number(r.commission_value)
      const vn = r.omie_vendor_name ?? r.omie_vendor_code ?? ''
      if (vn && !s.vendorNames.includes(vn)) s.vendorNames.push(vn)
    }
    const summary = [...map.values()]
      .map(s => ({ ...s, paidTotal: Math.round(s.paidTotal * 100) / 100, commissionTotal: Math.round(s.commissionTotal * 100) / 100 }))
      .sort((a, b) => b.commissionTotal - a.commissionTotal)

    return ok({ period: period as CommissionPeriod, summary, receipts: receipts as CommissionReceipt[] })
  } catch (e) { return err(e) }
}

async function setPeriodStatus(year: number, month: number, from: string[], to: string, actor: SessionUser, action: string) {
  const [period] = await sql`SELECT * FROM commission_periods WHERE year = ${year} AND month = ${month}`
  if (!period) throw new Error('Período não encontrado — sincronize primeiro.')
  if (!from.includes(period.status)) throw new Error(`Transição inválida a partir de "${period.status}".`)
  if (to === 'approved') {
    await sql`UPDATE commission_periods SET status = 'approved', approved_at = NOW(), approved_by = ${actor.bitrixUserId} WHERE id = ${period.id}`
  } else if (to === 'closed') {
    await sql`UPDATE commission_periods SET status = 'closed', closed_at = NOW(), closed_by = ${actor.bitrixUserId} WHERE id = ${period.id}`
  } else {
    await sql`UPDATE commission_periods SET status = 'open', closed_at = NULL, approved_at = NULL, approved_by = NULL WHERE id = ${period.id}`
  }
  await audit(period.id, action, actor)
  return period.id as number
}

export async function closePeriodAction(year: number, month: number): Promise<Res> {
  try { const a = await requireFinance(); await setPeriodStatus(year, month, ['open'], 'closed', a, 'closed'); return ok({}) }
  catch (e) { return err(e) }
}
export async function approvePeriodAction(year: number, month: number): Promise<Res> {
  try { const a = await requireFinance(); await setPeriodStatus(year, month, ['closed'], 'approved', a, 'approved'); return ok({}) }
  catch (e) { return err(e) }
}
export async function reopenPeriodAction(year: number, month: number): Promise<Res> {
  try { const a = await requireAdmin(); await setPeriodStatus(year, month, ['closed', 'approved'], 'open', a, 'reopened'); return ok({}) }
  catch (e) { return err(e) }
}

export async function getPeriodAuditAction(year: number, month: number): Promise<Res<{ audit: CommissionAudit[] }>> {
  try {
    await ensureCommissionSchema()
    await requireView()
    const [period] = await sql`SELECT id FROM commission_periods WHERE year = ${year} AND month = ${month}`
    if (!period) return ok({ audit: [] })
    const rows = await sql`SELECT * FROM commission_audit WHERE period_id = ${period.id} ORDER BY created_at DESC LIMIT 100`
    return ok({ audit: rows as CommissionAudit[] })
  } catch (e) { return err(e) }
}
