'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Settings2, ShieldAlert, SlidersHorizontal, Layers, Users,
  Plus, Trash2, Save, Download, Merge, Search,
} from 'lucide-react'
import { useCurrentUser, canAccess } from '@/components/current-user-provider'
import {
  getCommissionConfigAction, updateCommissionSettingsAction, upsertTierAction, deleteTierAction,
  listVendorsAction, importVendorsFromOmieAction, updateVendorAction, mergeVendorsAction, listAmCandidatesAction,
} from '@/lib/commission-actions'
import { formatPct, type CommissionTier, type CommissionSettings, type CommissionVendor } from '@/lib/commission/types'
import { TechShell, PageHead, GlassCard, TechButton } from '@/components/commission/kit'

type Tab = 'regras' | 'faixas' | 'vendedores'
type AmUser = { bitrix_user_id: string; name: string; role: string }

export default function AdminComissoesPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [tab, setTab] = useState<Tab>('faixas')

  if (userLoading) return <TechShell><div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-cyan-400" /></div></TechShell>
  if (!canAccess('comissoes_admin', user?.role)) {
    return (
      <TechShell>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShieldAlert className="w-12 h-12 text-amber-400 mb-4" />
          <h2 className="text-lg font-semibold">Acesso restrito</h2>
          <p className="text-sm text-indigo-300/80 mt-1">Somente administradores configuram o comissionamento.</p>
        </div>
      </TechShell>
    )
  }

  const TABS: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'faixas', label: 'Faixas de margem', icon: Layers },
    { id: 'regras', label: 'Regras gerais', icon: SlidersHorizontal },
    { id: 'vendedores', label: 'Vendedores (de-para)', icon: Users },
  ]

  return (
    <TechShell>
      <PageHead icon={<Settings2 className="w-5 h-5 text-white" />} title="Configuração de Comissões"
        subtitle="Regras avançadas · faixas de margem · mapeamento de vendedores" />

      <div className="flex flex-wrap gap-1.5 mb-6 p-1 rounded-2xl bg-white/5 ring-1 ring-indigo-400/15 w-full sm:w-auto">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === t.id ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-[0_0_16px_rgba(34,211,238,0.4)]' : 'text-indigo-200 hover:bg-white/10'
              }`}>
              <Icon size={14} /><span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {tab === 'faixas' && <TiersTab />}
      {tab === 'regras' && <SettingsTab />}
      {tab === 'vendedores' && <VendorsTab />}
    </TechShell>
  )
}

// ─── Faixas de margem ────────────────────────────────────────────────────────────
function TiersTab() {
  const [tiers, setTiers] = useState<CommissionTier[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | 'new' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await getCommissionConfigAction()
    if (r.success) setTiers(r.tiers)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (t: CommissionTier) => {
    setBusy(t.id)
    const r = await upsertTierAction({ ...t, rate: Number(t.rate), min_margin: Number(t.min_margin), max_margin: t.max_margin == null ? null : Number(t.max_margin) })
    if (r.success) { toast.success('Faixa salva.'); await load() } else toast.error(r.error)
    setBusy(null)
  }
  const addNew = async () => {
    setBusy('new')
    const r = await upsertTierAction({ min_margin: 0, max_margin: null, rate: 0, label: 'Nova faixa', sort: tiers.length })
    if (r.success) await load(); else toast.error(r.error)
    setBusy(null)
  }
  const del = async (id: number) => {
    if (!confirm('Remover esta faixa?')) return
    const r = await deleteTierAction(id); if (r.success) { toast.success('Removida.'); await load() } else toast.error(r.error)
  }
  const patch = (id: number, k: keyof CommissionTier, v: any) => setTiers(ts => ts.map(t => t.id === id ? { ...t, [k]: v } : t))

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>

  return (
    <GlassCard className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-indigo-400/10">
        <p className="text-xs text-indigo-300/70">Margem sobre a venda total → taxa aplicada ao recebido. Margem inclusiva nos limites.</p>
        <TechButton variant="ghost" onClick={addNew} disabled={busy === 'new'}><Plus size={14} /> Faixa</TechButton>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="text-[11px] uppercase tracking-wider text-indigo-300/60 text-left">
            <th className="px-3 py-2">Descrição</th><th className="px-3 py-2">Margem mín. %</th><th className="px-3 py-2">Margem máx. %</th>
            <th className="px-3 py-2">Taxa (%)</th><th className="px-3 py-2">Ativa</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-indigo-400/5">
            {tiers.map(t => (
              <tr key={t.id} className="hover:bg-white/5">
                <td className="px-3 py-2"><input value={t.label} onChange={e => patch(t.id, 'label', e.target.value)} className="w-40 bg-white/5 rounded-lg px-2 py-1.5 text-indigo-50 ring-1 ring-indigo-400/20 focus:ring-cyan-400/50 outline-none" /></td>
                <td className="px-3 py-2"><input type="number" step="0.001" value={t.min_margin} onChange={e => patch(t.id, 'min_margin', e.target.value)} className="w-24 bg-white/5 rounded-lg px-2 py-1.5 text-indigo-50 ring-1 ring-indigo-400/20 outline-none tabular-nums" /></td>
                <td className="px-3 py-2"><input type="number" step="0.001" placeholder="∞" value={t.max_margin ?? ''} onChange={e => patch(t.id, 'max_margin', e.target.value === '' ? null : e.target.value)} className="w-24 bg-white/5 rounded-lg px-2 py-1.5 text-indigo-50 ring-1 ring-indigo-400/20 outline-none tabular-nums" /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.001" value={Number(t.rate) * 100} onChange={e => patch(t.id, 'rate', Number(e.target.value) / 100)} className="w-20 bg-white/5 rounded-lg px-2 py-1.5 text-indigo-50 ring-1 ring-indigo-400/20 outline-none tabular-nums" />
                    <span className="text-indigo-400/60 text-xs">%</span>
                  </div>
                </td>
                <td className="px-3 py-2"><input type="checkbox" checked={t.active} onChange={e => patch(t.id, 'active', e.target.checked)} className="w-4 h-4 accent-cyan-500" /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => save(t)} disabled={busy === t.id} title="Salvar" className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25">{busy === t.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}</button>
                    <button onClick={() => del(t.id)} title="Remover" className="p-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  )
}

// ─── Regras gerais ───────────────────────────────────────────────────────────────
function SettingsTab() {
  const [s, setS] = useState<CommissionSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => { (async () => { const r = await getCommissionConfigAction(); if (r.success) setS(r.settings); setLoading(false) })() }, [])

  const save = async () => {
    if (!s) return
    setSaving(true)
    const r = await updateCommissionSettingsAction({ base_mode: s.base_mode, min_margin_gate: Number(s.min_margin_gate), default_margin: Number(s.default_margin) })
    if (r.success) toast.success('Regras salvas.'); else toast.error(r.error)
    setSaving(false)
  }

  if (loading || !s) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>

  return (
    <GlassCard className="p-5 max-w-2xl space-y-5">
      <Field label="Base de cálculo da comissão" hint="Sobre o que a taxa incide.">
        <select value={s.base_mode} onChange={e => setS({ ...s, base_mode: e.target.value as any })} className="w-full bg-white/5 rounded-lg px-3 py-2 text-indigo-50 ring-1 ring-indigo-400/20 outline-none">
          <option value="received">Valor recebido no mês (caixa)</option>
          <option value="invoiced">Valor faturado (NF emitida)</option>
        </select>
      </Field>
      <Field label="Portão de margem mínima (%)" hint="Abaixo desta margem a comissão é zero (regra bp-49).">
        <input type="number" step="0.001" value={s.min_margin_gate} onChange={e => setS({ ...s, min_margin_gate: Number(e.target.value) })} className="w-40 bg-white/5 rounded-lg px-3 py-2 text-indigo-50 ring-1 ring-indigo-400/20 outline-none tabular-nums" />
      </Field>
      <Field label="Margem padrão (%)" hint="Usada quando o recebimento não é vinculado a um negócio com margem conhecida.">
        <input type="number" step="0.001" value={s.default_margin} onChange={e => setS({ ...s, default_margin: Number(e.target.value) })} className="w-40 bg-white/5 rounded-lg px-3 py-2 text-indigo-50 ring-1 ring-indigo-400/20 outline-none tabular-nums" />
      </Field>
      <div className="pt-2"><TechButton variant="primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar regras</TechButton></div>
    </GlassCard>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-indigo-100 mb-1">{label}</label>
      {hint && <p className="text-[11px] text-indigo-300/60 mb-2">{hint}</p>}
      {children}
    </div>
  )
}

// ─── Vendedores (de-para) ────────────────────────────────────────────────────────
function VendorsTab() {
  const [vendors, setVendors] = useState<CommissionVendor[]>([])
  const [ams, setAms] = useState<AmUser[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [v, a] = await Promise.all([listVendorsAction(), listAmCandidatesAction()])
    if (v.success) setVendors(v.vendors)
    if (a.success) setAms(a.users)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const doImport = async () => {
    setImporting(true)
    const r = await importVendorsFromOmieAction()
    if (r.success) { toast.success(`${r.imported} vendedores importados do Omie.`); await load() } else toast.error(r.error)
    setImporting(false)
  }

  const setAm = async (code: string, appUserBitrixId: string) => {
    setBusy(code)
    const r = await updateVendorAction({ code, appUserBitrixId: appUserBitrixId || null })
    if (r.success) { setVendors(vs => vs.map(v => v.omie_vendor_code === code ? { ...v, app_user_bitrix_id: appUserBitrixId || null, am_name: ams.find(a => a.bitrix_user_id === appUserBitrixId)?.name ?? null } : v)) } else toast.error(r.error)
    setBusy(null)
  }

  const consolidate = async () => {
    if (sel.size < 2) { toast.error('Selecione ao menos 2 códigos para consolidar.'); return }
    const codes = [...sel]
    const first = vendors.find(v => v.omie_vendor_code === codes[0])
    const canonical = prompt('Nome consolidado deste AM:', first?.canonical_name ?? first?.omie_vendor_name ?? '')
    if (!canonical) return
    const amId = first?.app_user_bitrix_id ?? null
    setBusy('merge')
    const r = await mergeVendorsAction({ codes, appUserBitrixId: amId, canonicalName: canonical })
    if (r.success) { toast.success(`${codes.length} códigos consolidados em "${canonical}".`); setSel(new Set()); await load() } else toast.error(r.error)
    setBusy(null)
  }

  const filtered = useMemo(() => {
    const term = q.toLowerCase()
    return vendors.filter(v => !term
      || (v.omie_vendor_name ?? '').toLowerCase().includes(term)
      || (v.canonical_name ?? '').toLowerCase().includes(term)
      || v.omie_vendor_code.includes(term))
  }, [vendors, q])

  const unmapped = vendors.filter(v => !v.app_user_bitrix_id).length

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>

  return (
    <GlassCard className="p-0 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between px-4 py-3 border-b border-indigo-400/10">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-indigo-400/60 w-4 h-4" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar vendedor..." className="w-full text-sm pl-8 pr-3 py-1.5 rounded-lg bg-white/5 text-indigo-50 ring-1 ring-indigo-400/20 outline-none" />
        </div>
        <div className="flex items-center gap-2">
          {unmapped > 0 && <span className="text-[11px] px-2 py-1 rounded-full bg-amber-500/15 text-amber-300">{unmapped} sem AM</span>}
          <TechButton variant="ghost" onClick={consolidate} disabled={busy === 'merge' || sel.size < 2}>{busy === 'merge' ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />} Consolidar ({sel.size})</TechButton>
          <TechButton variant="primary" onClick={doImport} disabled={importing}>{importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Importar do Omie</TechButton>
        </div>
      </div>

      {!vendors.length ? (
        <div className="p-10 text-center text-indigo-300/70">
          <Users className="w-9 h-9 mx-auto text-indigo-400/50 mb-2" />
          Nenhum vendedor ainda. Clique em <strong className="text-indigo-100">Importar do Omie</strong> para trazer o cadastro.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="text-[11px] uppercase tracking-wider text-indigo-300/60 text-left">
              <th className="px-3 py-2 w-8"></th><th className="px-3 py-2">Vendedor no Omie</th><th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Filial</th><th className="px-3 py-2">AM (recebe a comissão)</th>
            </tr></thead>
            <tbody className="divide-y divide-indigo-400/5">
              {filtered.map(v => (
                <tr key={v.omie_vendor_code} className={`hover:bg-white/5 ${sel.has(v.omie_vendor_code) ? 'bg-cyan-500/5' : ''}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={sel.has(v.omie_vendor_code)} onChange={e => setSel(s => { const n = new Set(s); e.target.checked ? n.add(v.omie_vendor_code) : n.delete(v.omie_vendor_code); return n })} className="w-4 h-4 accent-cyan-500" />
                  </td>
                  <td className="px-3 py-2"><span className="text-indigo-50">{v.canonical_name ?? v.omie_vendor_name}</span>{v.canonical_name && v.canonical_name !== v.omie_vendor_name && <span className="text-[10px] text-indigo-300/50 ml-1.5">({v.omie_vendor_name})</span>}</td>
                  <td className="px-3 py-2 text-indigo-300/70 tabular-nums text-xs">{v.omie_vendor_code}</td>
                  <td className="px-3 py-2 text-indigo-300/70 text-xs">{v.branch ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select value={v.app_user_bitrix_id ?? ''} onChange={e => setAm(v.omie_vendor_code, e.target.value)} disabled={busy === v.omie_vendor_code}
                        className={`bg-white/5 rounded-lg px-2 py-1.5 text-sm ring-1 outline-none min-w-[180px] ${v.app_user_bitrix_id ? 'text-indigo-50 ring-indigo-400/20' : 'text-amber-300 ring-amber-400/30'}`}>
                        <option value="">— sem AM —</option>
                        {ams.map(a => <option key={a.bitrix_user_id} value={a.bitrix_user_id}>{a.name}</option>)}
                      </select>
                      {busy === v.omie_vendor_code && <Loader2 size={13} className="animate-spin text-cyan-400" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  )
}
