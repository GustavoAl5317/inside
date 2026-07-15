'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  Loader2, RefreshCw, TrendingUp, Wallet, Users, AlertTriangle,
  Lock, CheckCircle2, Unlock, ShieldAlert, Building2, Receipt, FileDown, Filter, X,
} from 'lucide-react'
import { useCurrentUser, canAccess } from '@/components/current-user-provider'
import {
  getPeriodDetailAction, syncPeriodAction, closePeriodAction,
  approvePeriodAction, reopenPeriodAction,
} from '@/lib/commission-actions'
import {
  formatBRL, formatPct, periodLabel, MARGIN_SOURCE_LABEL, AM_SOURCE_LABEL, docKind,
  type AmCommissionSummary, type CommissionReceipt, type CommissionPeriod,
} from '@/lib/commission/types'
import {
  TechShell, PageHead, GlassCard, Kpi, StatusPill, MonthNav, TechButton,
} from '@/components/commission/kit'

const CHART_COLORS = ['#22d3ee', '#818cf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#2dd4bf', '#fb923c']

export default function ComissoesPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const isManager = user?.role === 'financeiro' || user?.role === 'admin'
  const isAdmin = user?.role === 'admin'

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [period, setPeriod] = useState<CommissionPeriod | null>(null)
  const [summary, setSummary] = useState<AmCommissionSummary[]>([])
  const [receipts, setReceipts] = useState<CommissionReceipt[]>([])

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true)
    try {
      const r = await getPeriodDetailAction(y, m)
      if (r.success) { setPeriod(r.period); setSummary(r.summary); setReceipts(r.receipts) }
      else toast.error(r.error)
    } finally { setLoading(false) }
  }, [])

  const [amFilter, setAmFilter] = useState<string>('all')
  const [detail, setDetail] = useState<CommissionReceipt | null>(null)

  useEffect(() => { if (canAccess('comissoes', user?.role)) load(year, month) }, [year, month, user?.role, load])
  useEffect(() => { setAmFilter('all') }, [year, month])

  const totals = period?.totals
  const chartData = useMemo(
    () => summary.filter(s => s.commissionTotal > 0).slice(0, 8)
      .map(s => ({ name: s.am_name.split(' ')[0], value: s.commissionTotal })),
    [summary],
  )
  const shownReceipts = useMemo(
    () => amFilter === 'all' ? receipts : receipts.filter(r => (r.app_user_bitrix_id ?? '__none__') === amFilter),
    [receipts, amFilter],
  )

  const doSync = async () => {
    setSyncing(true)
    try {
      const r = await syncPeriodAction(year, month)
      if (r.success) { toast.success(`Sincronizado: ${r.totals.receipts} recebimentos · ${formatBRL(r.totals.commissionTotal)} em comissão`); await load(year, month) }
      else toast.error(r.error)
    } finally { setSyncing(false) }
  }

  const doStatus = async (action: 'close' | 'approve' | 'reopen') => {
    setBusy(action)
    try {
      const fn = action === 'close' ? closePeriodAction : action === 'approve' ? approvePeriodAction : reopenPeriodAction
      const r = await fn(year, month)
      if (r.success) { toast.success(action === 'close' ? 'Período fechado.' : action === 'approve' ? 'Comissões aprovadas.' : 'Período reaberto.'); await load(year, month) }
      else toast.error(r.error)
    } finally { setBusy(null) }
  }

  if (userLoading) return <TechShell><div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-cyan-400" /></div></TechShell>

  if (!canAccess('comissoes', user?.role)) {
    return (
      <TechShell>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShieldAlert className="w-12 h-12 text-amber-400 mb-4" />
          <h2 className="text-lg font-semibold">Acesso restrito</h2>
          <p className="text-sm text-slate-400 mt-1">Somente AM, Financeiro e Admin acessam as comissões.</p>
        </div>
      </TechShell>
    )
  }

  return (
    <TechShell>
      <PageHead
        icon={<TrendingUp className="w-5 h-5 text-white" />}
        title="Painel de Comissões"
        subtitle={isManager ? 'Comissão sobre o valor recebido no mês · todos os AMs' : 'Suas comissões do período'}
        right={<MonthNav year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m) }} />}
      />

      {/* Barra de ação / status */}
      <GlassCard className="p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            {period ? <StatusPill status={period.status} /> : <span className="text-xs text-slate-400">Nunca sincronizado</span>}
            {period?.synced_at && <span className="text-[11px] text-slate-500">Última sync: {new Date(period.synced_at).toLocaleString('pt-BR')}</span>}
          </div>
          {isManager && (
            <div className="flex flex-wrap items-center gap-2">
              <TechButton variant="primary" onClick={doSync} disabled={syncing || period?.status === 'approved'}>
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Sincronizar Omie
              </TechButton>
              {period?.status === 'open' && (
                <TechButton variant="warning" onClick={() => doStatus('close')} disabled={busy === 'close' || !receipts.length}>
                  {busy === 'close' ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Fechar mês
                </TechButton>
              )}
              {period?.status === 'closed' && (
                <TechButton variant="success" onClick={() => doStatus('approve')} disabled={busy === 'approve'}>
                  {busy === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Aprovar
                </TechButton>
              )}
              {isAdmin && period && period.status !== 'open' && (
                <TechButton variant="ghost" onClick={() => doStatus('reopen')} disabled={busy === 'reopen'}>
                  {busy === 'reopen' ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />} Reabrir
                </TechButton>
              )}
            </div>
          )}
        </div>
      </GlassCard>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-cyan-400" /></div>
      ) : !period ? (
        <GlassCard className="p-10 text-center">
          <Receipt className="w-10 h-10 mx-auto text-slate-500 mb-3" />
          <p className="text-slate-300 font-medium">Nenhuma apuração para {periodLabel(year, month)}.</p>
          {isManager && <p className="text-sm text-slate-400 mt-1">Clique em “Sincronizar Omie” para puxar os recebimentos do mês.</p>}
        </GlassCard>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Kpi label="Recebido no mês" value={formatBRL(isManager ? totals?.paidTotal : sumField(receipts, 'paid_value'))} accent="cyan" icon={<Wallet size={16} />} />
            <Kpi label="Comissão total" value={formatBRL(isManager ? totals?.commissionTotal : sumField(receipts, 'commission_value'))} accent="emerald" icon={<TrendingUp size={16} />} hint="taxa × recebido" />
            <Kpi label={isManager ? 'AMs com comissão' : 'Recebimentos'} value={String(isManager ? (totals?.amCount ?? 0) : receipts.length)} accent="indigo" icon={<Users size={16} />} />
            {isManager
              ? <Kpi label="Sem AM mapeado" value={String(totals?.unmapped ?? 0)} accent={totals?.unmapped ? 'amber' : 'violet'} icon={<AlertTriangle size={16} />} hint={totals?.unmapped ? 'ajuste o de-para' : 'tudo mapeado'} />
              : <Kpi label="Parcelas pagas" value={String(receipts.length)} accent="violet" icon={<Receipt size={16} />} />}
          </div>

          {/* Gráfico + resumo por AM (visão gestor) */}
          {isManager && (
            <div className="grid lg:grid-cols-5 gap-4 mb-6">
              <GlassCard className="lg:col-span-2 p-4">
                <h3 className="text-sm font-semibold text-slate-200 mb-3">Comissão por AM</h3>
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                        contentStyle={{ background: '#111726', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#e2e8f0' }}
                        formatter={(v: any) => [formatBRL(v), 'Comissão']}
                      />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-slate-500 py-16 text-center">Sem comissão calculada neste mês.</p>}
              </GlassCard>

              <GlassCard className="lg:col-span-3 p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.06]"><h3 className="text-sm font-semibold text-slate-200">Resumo por AM</h3></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider text-slate-500 text-left">
                        <th className="px-4 py-2 font-semibold">AM</th>
                        <th className="px-4 py-2 font-semibold text-right">Recebido</th>
                        <th className="px-4 py-2 font-semibold text-right">Comissão</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {summary.map(s => (
                        <tr key={s.app_user_bitrix_id ?? 'none'} className="hover:bg-white/[0.04]">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-100">{s.am_name}</span>
                              {!s.mapped && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">sem AM</span>}
                            </div>
                            {s.vendorNames.length > 0 && <div className="text-[10px] text-slate-500 truncate max-w-[240px]">{s.vendorNames.join(' · ')}</div>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{formatBRL(s.paidTotal)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-300">{formatBRL(s.commissionTotal)}</td>
                        </tr>
                      ))}
                      {!summary.length && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">Sem recebimentos.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            </div>
          )}

          {/* Detalhe dos recebimentos */}
          <GlassCard className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex flex-wrap items-center gap-2">
              <Receipt size={15} className="text-cyan-300" />
              <h3 className="text-sm font-semibold text-slate-200">Recebimentos do mês</h3>
              <span className="text-[11px] text-slate-500">({shownReceipts.length})</span>
              <div className="ml-auto flex items-center gap-2">
                {isManager && summary.length > 0 && (
                  <div className="relative">
                    <select value={amFilter} onChange={e => setAmFilter(e.target.value)}
                      className="appearance-none text-xs font-medium text-slate-200 bg-white/[0.03] border border-white/10 rounded-lg pl-7 pr-6 py-1.5 hover:bg-white/[0.05] outline-none">
                      <option value="all">Todos os AMs</option>
                      {summary.map(s => (
                        <option key={s.app_user_bitrix_id ?? 'none'} value={s.app_user_bitrix_id ?? '__none__'}>{s.am_name}</option>
                      ))}
                    </select>
                    <Filter size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  </div>
                )}
                {shownReceipts.length > 0 && (
                  <button onClick={() => exportCsv(shownReceipts, year, month, isManager)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white border border-white/10 rounded-lg px-2.5 py-1.5 hover:bg-white/[0.05]">
                    <FileDown size={13} /> CSV
                  </button>
                )}
              </div>
            </div>

            {/* Mobile: cards */}
            <div className="md:hidden divide-y divide-white/[0.05]">
              {shownReceipts.map(r => {
                const k = docKind(r.doc_type)
                return (
                  <button key={r.id} onClick={() => setDetail(r)} className="w-full text-left px-4 py-3 hover:bg-white/[0.04]">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-slate-100 truncate">{r.client_name ?? r.client_cnpj ?? '—'}</span>
                      <span className="text-sm font-semibold text-emerald-300 tabular-nums flex-shrink-0">{formatBRL(r.commission_value)}</span>
                    </div>
                    {r.project_name && <div className="text-[11px] text-cyan-300/80 truncate mt-0.5">{r.project_name}</div>}
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className={`px-1.5 py-0.5 rounded border ${k.cls}`}>{k.label}</span>
                      <span>{r.paid_at ? new Date(r.paid_at).toLocaleDateString('pt-BR') : '—'}</span>
                      <span className="ml-auto tabular-nums">pago {formatBRL(r.paid_value)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="truncate">{isManager ? ((r as any).am_name ?? 'sem AM') : (r.parcela ?? '')}</span>
                      <span>margem {r.margin != null ? `${Number(r.margin).toFixed(1)}%` : '—'} · taxa {formatPct(r.rate)}</span>
                    </div>
                  </button>
                )
              })}
              {!shownReceipts.length && <div className="px-4 py-10 text-center text-slate-500 text-sm">Nenhum recebimento.</div>}
            </div>

            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-slate-500 text-left">
                    <th className="px-4 py-2 font-semibold">Pago em</th>
                    <th className="px-4 py-2 font-semibold">Tipo</th>
                    <th className="px-4 py-2 font-semibold">Projeto / Cliente</th>
                    {isManager && <th className="px-4 py-2 font-semibold">AM</th>}
                    <th className="px-4 py-2 font-semibold">NF</th>
                    <th className="px-4 py-2 font-semibold text-right">Pago</th>
                    <th className="px-4 py-2 font-semibold text-right">Margem</th>
                    <th className="px-4 py-2 font-semibold text-right">Taxa</th>
                    <th className="px-4 py-2 font-semibold text-right">Comissão</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {shownReceipts.map(r => {
                    const k = docKind(r.doc_type)
                    return (
                      <tr key={r.id} onClick={() => setDetail(r)} className="hover:bg-white/[0.04] cursor-pointer">
                        <td className="px-4 py-2 text-slate-300 tabular-nums">{r.paid_at ? new Date(r.paid_at).toLocaleDateString('pt-BR') : '—'}</td>
                        <td className="px-4 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded border ${k.cls}`}>{k.label}</span></td>
                        <td className="px-4 py-2">
                          <div className="max-w-[300px]">
                            <div className="truncate text-slate-100">{r.project_name ?? r.client_name ?? r.client_cnpj ?? '—'}</div>
                            {r.project_name && <div className="truncate text-[11px] text-slate-500 flex items-center gap-1"><Building2 size={10} />{r.client_name ?? r.client_cnpj}</div>}
                          </div>
                        </td>
                        {isManager && <td className="px-4 py-2 text-slate-300">{(r as any).am_name ?? <span className="text-amber-300/80">sem AM</span>}</td>}
                        <td className="px-4 py-2 text-slate-400 text-xs">{r.nf ? `NF ${r.nf}` : '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-200">{formatBRL(r.paid_value)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-400" title={r.margin_source ? (MARGIN_SOURCE_LABEL[r.margin_source] ?? '') : 'Sem fonte de margem'}>
                          {r.margin != null ? `${Number(r.margin).toFixed(1)}%` : '—'}
                          {r.margin_source === 'bitrix' && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-cyan-400/10 text-cyan-300 align-middle">B24</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-400">{formatPct(r.rate)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-300">{formatBRL(r.commission_value)}</td>
                      </tr>
                    )
                  })}
                  {!shownReceipts.length && <tr><td colSpan={isManager ? 9 : 8} className="px-4 py-10 text-center text-slate-500">Nenhum recebimento.</td></tr>}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </>
      )}

      {detail && <ReceiptDetail receipt={detail} isManager={isManager} onClose={() => setDetail(null)} />}
    </TechShell>
  )
}

function ReceiptDetail({ receipt: r, isManager, onClose }: { receipt: CommissionReceipt; isManager: boolean; onClose: () => void }) {
  const k = docKind(r.doc_type)
  const rows: Array<[string, React.ReactNode]> = [
    ['Projeto', r.project_name ?? '—'],
    ['Negócio (Bitrix)', r.num_ctr ?? '—'],
    ['Cliente', r.client_name ?? '—'],
    ['CNPJ', r.client_cnpj ?? '—'],
    ['Nota fiscal', r.nf ? `NF ${r.nf}` : '—'],
    ['Pedido / OS', r.pedido ? `#${r.pedido}` : '—'],
    ['Parcela', r.parcela ?? '—'],
    ['Pago em', r.paid_at ? new Date(r.paid_at).toLocaleDateString('pt-BR') : '—'],
    ...(isManager ? [['AM (responsável)', <span key="am">{(r as any).am_name ?? r.responsible_name ?? 'sem AM'}{r.am_source && <span className="ml-1.5 text-[10px] text-slate-500">· {AM_SOURCE_LABEL[r.am_source] ?? r.am_source}</span>}</span>] as [string, React.ReactNode]] : []),
    ['Margem', <span key="m">{r.margin != null ? `${Number(r.margin).toFixed(2)}%` : '—'}{r.margin_source && <span className="ml-1.5 text-[10px] text-slate-500">· {MARGIN_SOURCE_LABEL[r.margin_source] ?? r.margin_source}</span>}</span>],
    ['Taxa aplicada', formatPct(r.rate)],
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-2xl bg-[#131a2b] border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${k.cls}`}>{k.label}</span>
              <h3 className="font-semibold text-white truncate">Detalhe da comissão</h3>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{r.project_name ?? r.client_name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-white/10 flex-shrink-0"><X size={16} /></button>
        </div>
        <div className="p-5 overflow-y-auto">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {rows.map(([label, val]) => (
              <div key={label} className={label === 'Projeto' ? 'sm:col-span-2' : ''}>
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="text-sm text-slate-100 break-words">{val}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Valor pago</div>
              <div className="text-lg font-semibold text-slate-100 tabular-nums">{formatBRL(r.paid_value)}</div>
            </div>
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400/70">Comissão</div>
              <div className="text-lg font-semibold text-emerald-300 tabular-nums">{formatBRL(r.commission_value)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function exportCsv(receipts: CommissionReceipt[], year: number, month: number, isManager: boolean) {
  const brNum = (v: unknown) => String(v ?? '').replace('.', ',')
  const head = ['Pago em', 'Cliente', 'CNPJ', ...(isManager ? ['AM', 'Vendedor Omie'] : []), 'NF', 'Pedido', 'Parcela', 'Pago (R$)', 'Margem %', 'Taxa %', 'Comissão (R$)']
  const lines = receipts.map(r => [
    r.paid_at ? new Date(r.paid_at).toLocaleDateString('pt-BR') : '',
    r.client_name ?? '', r.client_cnpj ?? '',
    ...(isManager ? [(r as any).am_name ?? '', r.omie_vendor_name ?? ''] : []),
    r.nf ?? '', r.pedido ?? '', r.parcela ?? '',
    brNum(r.paid_value), r.margin != null ? brNum(Number(r.margin).toFixed(2)) : '',
    r.rate != null ? brNum((Number(r.rate) * 100).toFixed(3)) : '', brNum(r.commission_value),
  ])
  const csv = [head, ...lines]
    .map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `comissoes-${year}-${String(month).padStart(2, '0')}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function sumField(rows: CommissionReceipt[], field: 'paid_value' | 'commission_value'): number {
  return Math.round(rows.reduce((a, r) => a + Number(r[field] || 0), 0) * 100) / 100
}
