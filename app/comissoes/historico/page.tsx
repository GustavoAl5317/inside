'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, History, ShieldAlert, ChevronRight, CircleCheck,
  RefreshCw, Lock, Unlock, ClipboardList,
} from 'lucide-react'
import { useCurrentUser, canAccess } from '@/components/current-user-provider'
import { listPeriodsAction, getPeriodAuditAction } from '@/lib/commission-actions'
import {
  formatBRL, periodLabel, MONTH_LABELS,
  type CommissionPeriod, type CommissionAudit,
} from '@/lib/commission/types'
import { TechShell, PageHead, GlassCard, StatusPill } from '@/components/commission/kit'

const ACTION_META: Record<string, { label: string; icon: any; cls: string }> = {
  synced:   { label: 'Sincronizado', icon: RefreshCw,   cls: 'text-cyan-300' },
  closed:   { label: 'Fechado',      icon: Lock,        cls: 'text-amber-300' },
  approved: { label: 'Aprovado',     icon: CircleCheck, cls: 'text-emerald-300' },
  reopened: { label: 'Reaberto',     icon: Unlock,      cls: 'text-indigo-300' },
  config:   { label: 'Configuração', icon: ClipboardList, cls: 'text-violet-300' },
}

export default function HistoricoComissoesPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [periods, setPeriods] = useState<CommissionPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [audit, setAudit] = useState<Record<string, CommissionAudit[]>>({})
  const [loadingAudit, setLoadingAudit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await listPeriodsAction()
      if (r.success) setPeriods(r.periods); else toast.error(r.error)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (canAccess('comissoes', user?.role)) load() }, [user?.role, load])

  const toggle = async (p: CommissionPeriod) => {
    const key = `${p.year}-${p.month}`
    if (openKey === key) { setOpenKey(null); return }
    setOpenKey(key)
    if (!audit[key]) {
      setLoadingAudit(true)
      try {
        const r = await getPeriodAuditAction(p.year, p.month)
        if (r.success) setAudit(a => ({ ...a, [key]: r.audit }))
      } finally { setLoadingAudit(false) }
    }
  }

  if (userLoading) return <TechShell><div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-cyan-400" /></div></TechShell>

  if (!canAccess('comissoes', user?.role)) {
    return (
      <TechShell>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShieldAlert className="w-12 h-12 text-amber-400 mb-4" />
          <h2 className="text-lg font-semibold">Acesso restrito</h2>
        </div>
      </TechShell>
    )
  }

  return (
    <TechShell>
      <PageHead icon={<History className="w-5 h-5 text-white" />} title="Histórico de Comissões"
        subtitle="Períodos apurados, fechamentos e aprovações" />

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-cyan-400" /></div>
      ) : !periods.length ? (
        <GlassCard className="p-10 text-center">
          <History className="w-10 h-10 mx-auto text-indigo-400/60 mb-3" />
          <p className="text-indigo-200 font-medium">Nenhum período apurado ainda.</p>
          <p className="text-sm text-indigo-300/70 mt-1">Sincronize um mês no Painel para começar o histórico.</p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {periods.map(p => {
            const key = `${p.year}-${p.month}`
            const t = p.totals
            const isOpen = openKey === key
            return (
              <GlassCard key={key} className="overflow-hidden">
                <button onClick={() => toggle(p)} className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-white/5 text-left">
                  <ChevronRight size={16} className={`text-indigo-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-white">{periodLabel(p.year, p.month)}</span>
                      <StatusPill status={p.status} />
                    </div>
                    {p.approved_at && <span className="text-[11px] text-emerald-300/70">Aprovado em {new Date(p.approved_at).toLocaleDateString('pt-BR')}</span>}
                  </div>
                  <div className="hidden sm:flex items-center gap-6 text-right">
                    <div><div className="text-[10px] uppercase text-indigo-300/60">Recebido</div><div className="text-sm font-semibold text-indigo-100 tabular-nums">{formatBRL(t?.paidTotal)}</div></div>
                    <div><div className="text-[10px] uppercase text-indigo-300/60">Comissão</div><div className="text-sm font-semibold text-emerald-300 tabular-nums">{formatBRL(t?.commissionTotal)}</div></div>
                    <div className="w-16"><div className="text-[10px] uppercase text-indigo-300/60">AMs</div><div className="text-sm font-semibold text-indigo-100 tabular-nums">{t?.amCount ?? 0}</div></div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-indigo-400/10 px-4 py-3 bg-black/20">
                    {/* Totais no mobile */}
                    <div className="sm:hidden grid grid-cols-3 gap-2 mb-3 text-center">
                      <div><div className="text-[10px] uppercase text-indigo-300/60">Recebido</div><div className="text-sm font-semibold text-indigo-100">{formatBRL(t?.paidTotal)}</div></div>
                      <div><div className="text-[10px] uppercase text-indigo-300/60">Comissão</div><div className="text-sm font-semibold text-emerald-300">{formatBRL(t?.commissionTotal)}</div></div>
                      <div><div className="text-[10px] uppercase text-indigo-300/60">AMs</div><div className="text-sm font-semibold text-indigo-100">{t?.amCount ?? 0}</div></div>
                    </div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300/60 mb-2">Trilha de auditoria</h4>
                    {loadingAudit && !audit[key] ? (
                      <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-cyan-400" /></div>
                    ) : (audit[key]?.length ? (
                      <ol className="relative border-l border-indigo-400/20 ml-1.5 space-y-3">
                        {audit[key].map(a => {
                          const meta = ACTION_META[a.action] ?? { label: a.action, icon: ClipboardList, cls: 'text-indigo-300' }
                          const Icon = meta.icon
                          return (
                            <li key={a.id} className="ml-4">
                              <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-[#0b1029] ring-2 ring-indigo-400/40 flex items-center justify-center" />
                              <div className="flex items-center gap-2">
                                <Icon size={13} className={meta.cls} />
                                <span className={`text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                                <span className="text-[11px] text-indigo-300/50">{new Date(a.created_at).toLocaleString('pt-BR')}</span>
                              </div>
                              {(a.detail || a.actor_name) && (
                                <div className="text-[11px] text-indigo-300/70 mt-0.5">
                                  {a.actor_name && <span className="text-indigo-200">{a.actor_name}</span>}{a.detail ? ` — ${a.detail}` : ''}
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ol>
                    ) : <p className="text-xs text-indigo-300/50 py-2">Sem eventos registrados.</p>)}
                  </div>
                )}
              </GlassCard>
            )
          })}
        </div>
      )}
    </TechShell>
  )
}
