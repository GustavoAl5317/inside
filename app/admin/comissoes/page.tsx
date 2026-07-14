'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Settings2, ShieldAlert, SlidersHorizontal, Layers, Users,
  Plus, Trash2, Save, Download, Merge, Search, X, Check, Wand2, ScrollText,
} from 'lucide-react'
import { useCurrentUser, canAccess } from '@/components/current-user-provider'
import {
  getCommissionConfigAction, updateCommissionSettingsAction, upsertTierAction, deleteTierAction,
  listVendorsAction, importVendorsFromOmieAction, updateVendorAction, mergeVendorsAction, listAmCandidatesAction,
  autoConsolidateVendorsAction, getConfigAuditAction,
} from '@/lib/commission-actions'
import { type CommissionTier, type CommissionSettings, type CommissionVendor, type CommissionAudit } from '@/lib/commission/types'
import { TechShell, PageHead, GlassCard, TechButton } from '@/components/commission/kit'

type Tab = 'regras' | 'faixas' | 'vendedores' | 'auditoria'
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
          <p className="text-sm text-slate-400 mt-1">Somente administradores configuram o comissionamento.</p>
        </div>
      </TechShell>
    )
  }

  const TABS: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'faixas', label: 'Faixas de margem', icon: Layers },
    { id: 'regras', label: 'Regras gerais', icon: SlidersHorizontal },
    { id: 'vendedores', label: 'Vendedores (de-para)', icon: Users },
    { id: 'auditoria', label: 'Auditoria', icon: ScrollText },
  ]

  return (
    <TechShell>
      <PageHead icon={<Settings2 className="w-5 h-5 text-white" />} title="Configuração de Comissões"
        subtitle="Regras avançadas · faixas de margem · mapeamento de vendedores" />

      <div className="flex flex-wrap gap-1.5 mb-6 p-1 rounded-xl border border-white/10 bg-white/[0.02] w-full sm:w-auto">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === t.id ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-white/10'
              }`}>
              <Icon size={14} /><span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {tab === 'faixas' && <TiersTab />}
      {tab === 'regras' && <SettingsTab />}
      {tab === 'vendedores' && <VendorsTab />}
      {tab === 'auditoria' && <AuditTab />}
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <p className="text-xs text-slate-400">Margem sobre a venda total → taxa aplicada ao recebido. Margem inclusiva nos limites.</p>
        <TechButton variant="ghost" onClick={addNew} disabled={busy === 'new'}><Plus size={14} /> Faixa</TechButton>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="text-[11px] uppercase tracking-wider text-slate-500 text-left">
            <th className="px-3 py-2">Descrição</th><th className="px-3 py-2">Margem mín. %</th><th className="px-3 py-2">Margem máx. %</th>
            <th className="px-3 py-2">Taxa (%)</th><th className="px-3 py-2">Ativa</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-white/[0.05]">
            {tiers.map(t => (
              <tr key={t.id} className="hover:bg-white/[0.04]">
                <td className="px-3 py-2"><input value={t.label} onChange={e => patch(t.id, 'label', e.target.value)} className="w-40 bg-white/5 rounded-lg px-2 py-1.5 text-slate-100 ring-1 ring-white/10 focus:ring-cyan-400/50 outline-none" /></td>
                <td className="px-3 py-2"><input type="number" step="0.001" value={t.min_margin} onChange={e => patch(t.id, 'min_margin', e.target.value)} className="w-24 bg-white/5 rounded-lg px-2 py-1.5 text-slate-100 ring-1 ring-white/10 outline-none tabular-nums" /></td>
                <td className="px-3 py-2"><input type="number" step="0.001" placeholder="∞" value={t.max_margin ?? ''} onChange={e => patch(t.id, 'max_margin', e.target.value === '' ? null : e.target.value)} className="w-24 bg-white/5 rounded-lg px-2 py-1.5 text-slate-100 ring-1 ring-white/10 outline-none tabular-nums" /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.001" value={Math.round(Number(t.rate) * 100000) / 1000} onChange={e => patch(t.id, 'rate', Number(e.target.value) / 100)} className="w-20 bg-white/5 rounded-lg px-2 py-1.5 text-slate-100 ring-1 ring-white/10 outline-none tabular-nums" />
                    <span className="text-slate-500 text-xs">%</span>
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
    const r = await updateCommissionSettingsAction({
      base_mode: s.base_mode,
      min_margin_gate: Number(s.min_margin_gate),
      default_margin: Number(s.default_margin),
      use_bitrix_margin: s.use_bitrix_margin !== false,
      ignore_unmapped: s.ignore_unmapped === true,
    })
    if (r.success) toast.success('Regras salvas. Sincronize o mês para recalcular.'); else toast.error(r.error)
    setSaving(false)
  }

  if (loading || !s) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>

  return (
    <GlassCard className="p-5 max-w-2xl space-y-5">
      <Toggle
        label="Buscar margem no negócio do Bitrix (recomendado)"
        hint="Usa o código do recebimento (ano.ID) para ler a margem que o processo bp-49 grava no card. É o que faz a comissão sair do zero."
        checked={s.use_bitrix_margin !== false}
        onChange={v => setS({ ...s, use_bitrix_margin: v })}
      />
      <Toggle
        label="Ignorar recebimentos sem AM mapeado"
        hint="Recebimentos de vendedor não mapeado ficam fora da apuração (não entram nos totais)."
        checked={s.ignore_unmapped === true}
        onChange={v => setS({ ...s, ignore_unmapped: v })}
      />
      <Field label="Base de cálculo da comissão" hint="Sobre o que a taxa incide.">
        <select value={s.base_mode} onChange={e => setS({ ...s, base_mode: e.target.value as any })} className="w-full bg-white/5 rounded-lg px-3 py-2 text-slate-100 ring-1 ring-white/10 outline-none">
          <option value="received">Valor recebido no mês (caixa)</option>
          <option value="invoiced">Valor faturado (NF emitida)</option>
        </select>
      </Field>
      <Field label="Portão de margem mínima (%)" hint="Abaixo desta margem a comissão é zero (regra bp-49).">
        <input type="number" step="0.001" value={s.min_margin_gate} onChange={e => setS({ ...s, min_margin_gate: Number(e.target.value) })} className="w-40 bg-white/5 rounded-lg px-3 py-2 text-slate-100 ring-1 ring-white/10 outline-none tabular-nums" />
      </Field>
      <Field label="Margem padrão (%)" hint="Último recurso: usada quando nem o Bitrix nem o negócio local têm a margem. Deixe 0 para não comissionar nesses casos.">
        <input type="number" step="0.001" value={s.default_margin} onChange={e => setS({ ...s, default_margin: Number(e.target.value) })} className="w-40 bg-white/5 rounded-lg px-3 py-2 text-slate-100 ring-1 ring-white/10 outline-none tabular-nums" />
      </Field>
      <div className="pt-2"><TechButton variant="primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar regras</TechButton></div>
    </GlassCard>
  )
}

function Toggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="w-full flex items-start gap-3 text-left group">
      <span className={`mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-cyan-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-200 group-hover:text-white">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 mt-0.5">{hint}</span>}
      </span>
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-200 mb-1">{label}</label>
      {hint && <p className="text-[11px] text-slate-500 mb-2">{hint}</p>}
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
  const [mergeOpen, setMergeOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({})

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

  const saveName = async (code: string, name: string) => {
    const v = vendors.find(x => x.omie_vendor_code === code)
    if (!v || (v.canonical_name ?? '') === name) return
    const r = await updateVendorAction({ code, canonicalName: name })
    if (r.success) setVendors(vs => vs.map(x => x.omie_vendor_code === code ? { ...x, canonical_name: name } : x))
    else toast.error(r.error)
  }

  const autoGroup = async () => {
    setBusy('auto')
    const r = await autoConsolidateVendorsAction()
    if (r.success) {
      if (r.merged > 0) toast.success(`${r.merged} códigos agrupados em ${r.groups} pessoas.`)
      else toast.info('Nenhum duplicado óbvio encontrado — use a seleção manual para os demais.')
      await load()
    } else toast.error(r.error)
    setBusy(null)
  }

  const doMerge = async (canonicalName: string, amId: string | null) => {
    const codes = [...sel]
    setBusy('merge')
    const r = await mergeVendorsAction({ codes, appUserBitrixId: amId, canonicalName })
    if (r.success) { toast.success(`${codes.length} vendedores consolidados em "${canonicalName}".`); setSel(new Set()); setMergeOpen(false); await load() }
    else toast.error(r.error)
    setBusy(null)
  }

  const filtered = useMemo(() => {
    const term = q.toLowerCase()
    return vendors.filter(v => !term
      || (v.omie_vendor_name ?? '').toLowerCase().includes(term)
      || (v.canonical_name ?? '').toLowerCase().includes(term)
      || v.omie_vendor_code.includes(term))
  }, [vendors, q])

  const dup = useMemo(() => {
    const norm = (s?: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
    const counts = new Map<string, number>()
    for (const v of vendors) { const k = norm(v.canonical_name ?? v.omie_vendor_name); if (k) counts.set(k, (counts.get(k) ?? 0) + 1) }
    return { is: (v: CommissionVendor) => (counts.get(norm(v.canonical_name ?? v.omie_vendor_name)) ?? 0) > 1 }
  }, [vendors])

  const unmapped = vendors.filter(v => !v.app_user_bitrix_id).length
  const dupCount = vendors.filter(v => dup.is(v)).length
  const selectedVendors = vendors.filter(v => sel.has(v.omie_vendor_code))
  const selectDuplicates = () => setSel(new Set(vendors.filter(v => dup.is(v)).map(v => v.omie_vendor_code)))

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>

  return (
    <>
    <GlassCard className="p-0 overflow-hidden">
      <div className="flex flex-col gap-3 px-4 py-3 border-b border-white/[0.06]">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar vendedor..." className="w-full text-sm pl-8 pr-3 py-1.5 rounded-lg bg-white/5 text-slate-100 ring-1 ring-white/10 outline-none" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unmapped > 0 && <span className="text-[11px] px-2 py-1 rounded-full bg-amber-500/15 text-amber-300">{unmapped} sem AM</span>}
            {dupCount > 0 && (
              <TechButton variant="ghost" onClick={selectDuplicates} title="Selecionar prováveis duplicados"><Wand2 size={14} /> Duplicados ({dupCount})</TechButton>
            )}
            {vendors.length > 0 && (
              <TechButton variant="ghost" onClick={autoGroup} disabled={busy === 'auto'} title="Junta automaticamente nomes iguais e variações óbvias (ex.: ALINE → ALINE GOMES)">
                {busy === 'auto' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Auto-agrupar
              </TechButton>
            )}
            <TechButton variant="primary" onClick={doImport} disabled={importing}>{importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Importar do Omie</TechButton>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Cada <strong className="text-slate-300">vendedor do Omie</strong> (esquerda) liga a um <strong className="text-slate-300">AM do sistema</strong> (direita) que recebe a comissão. O nome é <strong className="text-slate-300">editável direto na linha</strong>. Para juntar duplicados, marque as linhas iguais e clique em <strong className="text-slate-300">Consolidar</strong>.
        </p>
      </div>

      {sel.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-cyan-500/5 border-b border-cyan-400/10">
          <span className="text-sm text-cyan-200">{sel.size} selecionado(s)</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setSel(new Set())} className="text-xs text-slate-400 hover:text-white">Limpar</button>
            <TechButton variant="primary" onClick={() => { if (sel.size < 2) { toast.error('Selecione ao menos 2 vendedores.'); return } setMergeOpen(true) }} disabled={sel.size < 2}>
              <Merge size={14} /> Consolidar {sel.size} em 1
            </TechButton>
          </div>
        </div>
      )}

      {!vendors.length ? (
        <div className="p-10 text-center text-slate-400">
          <Users className="w-9 h-9 mx-auto text-slate-600 mb-2" />
          Nenhum vendedor ainda. Clique em <strong className="text-slate-200">Importar do Omie</strong> para trazer o cadastro.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="text-[11px] uppercase tracking-wider text-slate-500 text-left">
              <th className="px-3 py-2 w-8"></th><th className="px-3 py-2">Vendedor (nome — editável)</th><th className="px-3 py-2">Código Omie</th>
              <th className="px-3 py-2">Filial</th><th className="px-3 py-2">AM que recebe</th>
            </tr></thead>
            <tbody className="divide-y divide-white/[0.05]">
              {filtered.map(v => (
                <tr key={v.omie_vendor_code} className={`hover:bg-white/[0.04] ${sel.has(v.omie_vendor_code) ? 'bg-cyan-500/5' : ''}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={sel.has(v.omie_vendor_code)} onChange={e => setSel(s => { const n = new Set(s); e.target.checked ? n.add(v.omie_vendor_code) : n.delete(v.omie_vendor_code); return n })} className="w-4 h-4 accent-cyan-500" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={nameDraft[v.omie_vendor_code] ?? (v.canonical_name ?? v.omie_vendor_name ?? '')}
                        onChange={e => setNameDraft(d => ({ ...d, [v.omie_vendor_code]: e.target.value }))}
                        onBlur={e => saveName(v.omie_vendor_code, e.target.value.trim())}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        className="w-44 bg-white/5 rounded-lg px-2 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 focus:ring-cyan-400/50 outline-none"
                      />
                      {dup.is(v) && <span title="Possível duplicado" className="text-[9px] px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300">dup</span>}
                    </div>
                    {v.canonical_name && v.omie_vendor_name && v.canonical_name !== v.omie_vendor_name && (
                      <div className="text-[10px] text-slate-600 mt-0.5 pl-1">Omie: {v.omie_vendor_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400 tabular-nums text-xs">{v.omie_vendor_code}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{v.branch ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select value={v.app_user_bitrix_id ?? ''} onChange={e => setAm(v.omie_vendor_code, e.target.value)} disabled={busy === v.omie_vendor_code}
                        className={`bg-white/5 rounded-lg px-2 py-1.5 text-sm ring-1 outline-none min-w-[180px] ${v.app_user_bitrix_id ? 'text-slate-100 ring-white/10' : 'text-amber-300 ring-amber-400/30'}`}>
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

    {mergeOpen && (
      <MergeModal vendors={selectedVendors} ams={ams} busy={busy === 'merge'} onClose={() => setMergeOpen(false)} onConfirm={doMerge} />
    )}
    </>
  )
}

function MergeModal({ vendors, ams, busy, onClose, onConfirm }: {
  vendors: CommissionVendor[]; ams: AmUser[]; busy: boolean
  onClose: () => void; onConfirm: (name: string, amId: string | null) => void
}) {
  const distinctNames = [...new Set(vendors.map(v => (v.canonical_name ?? v.omie_vendor_name ?? '').trim()).filter(Boolean))]
  const [name, setName] = useState(distinctNames[0] ?? '')
  const [amId, setAmId] = useState(vendors.find(v => v.app_user_bitrix_id)?.app_user_bitrix_id ?? '')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-2xl bg-[#131a2b] ring-1 ring-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2"><Merge size={16} className="text-cyan-300" /><h3 className="font-semibold text-white">Consolidar vendedores</h3></div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-white/10"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">{vendors.length} códigos que viram 1 pessoa</p>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {vendors.map(v => (
                <span key={v.omie_vendor_code} className="text-[11px] px-2 py-1 rounded-lg bg-white/5 ring-1 ring-white/10 text-slate-300">
                  {v.canonical_name ?? v.omie_vendor_name} <span className="text-slate-600">· {v.omie_vendor_code}</span>
                </span>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Nome consolidado</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Nome do vendedor / AM"
              className="w-full bg-white/5 rounded-lg px-3 py-2 text-slate-100 ring-1 ring-white/10 focus:ring-cyan-400/50 outline-none" />
            {distinctNames.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[10px] text-slate-500">usar:</span>
                {distinctNames.map(n => (
                  <button key={n} onClick={() => setName(n)}
                    className={`text-[11px] px-2 py-1 rounded-lg ring-1 ${name === n ? 'bg-cyan-500/20 text-cyan-200 ring-cyan-400/40' : 'bg-white/5 text-slate-400 ring-white/10 hover:bg-white/10'}`}>{n}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">AM que recebe a comissão</label>
            <select value={amId} onChange={e => setAmId(e.target.value)}
              className="w-full bg-white/5 rounded-lg px-3 py-2 text-slate-100 ring-1 ring-white/10 outline-none">
              <option value="">— definir depois —</option>
              {ams.map(a => <option key={a.bitrix_user_id} value={a.bitrix_user_id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-white/[0.06]">
          <TechButton variant="ghost" onClick={onClose}>Cancelar</TechButton>
          <TechButton variant="primary" onClick={() => onConfirm(name.trim(), amId || null)} disabled={busy || !name.trim()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Consolidar
          </TechButton>
        </div>
      </div>
    </div>
  )
}

// ─── Auditoria de configuração ───────────────────────────────────────────────────
function AuditTab() {
  const [rows, setRows] = useState<CommissionAudit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const r = await getConfigAuditAction()
      if (r.success) setRows(r.audit); else toast.error(r.error)
      setLoading(false)
    })()
  }, [])

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-cyan-400" /></div>

  return (
    <GlassCard className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <p className="text-xs text-slate-400">Quem alterou o quê nas configurações de comissão (faixas, regras, de-para).</p>
      </div>
      {!rows.length ? (
        <div className="p-10 text-center text-slate-500 text-sm">Nenhuma alteração registrada ainda.</div>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {rows.map(a => (
            <div key={a.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
              <span className="text-[11px] text-slate-500 tabular-nums sm:w-36 flex-shrink-0">{new Date(a.created_at).toLocaleString('pt-BR')}</span>
              <span className="text-sm text-slate-200 sm:w-44 flex-shrink-0 truncate">{a.actor_name ?? a.actor ?? '—'}</span>
              <span className="text-sm text-slate-400 min-w-0">{a.detail ?? 'Configuração alterada'}</span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}
