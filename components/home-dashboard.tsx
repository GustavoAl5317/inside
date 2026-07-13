'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCurrentUser } from '@/components/current-user-provider'
import type { Role, SessionUser } from '@/lib/auth-types'
import {
  listUpdateRequestsAction, getPendingProcessesAction, getDealsHistoryAction,
} from '@/lib/actions'
import { listAppUsersAction } from '@/lib/auth-actions'
import { InsideSalesLayout } from '@/components/inside-sales-layout'
import Image from 'next/image'
import {
  Loader2, RefreshCw, Building2, Clock, CheckCircle2,
  ShieldCheck, History, Users, ArrowRight, TrendingUp,
  ClipboardList, Send, Pencil, LayoutDashboard, Zap,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<Role, string> = {
  insidesales: 'Inside Sales',
  financeiro:  'Financeiro',
  admin:       'Administrador',
}

const ROLE_AVATAR: Record<Role, string> = {
  insidesales: 'bg-blue-600',
  financeiro:  'bg-violet-600',
  admin:       'bg-emerald-600',
}

const ROLE_RING: Record<Role, string> = {
  insidesales: 'ring-blue-200',
  financeiro:  'ring-violet-200',
  admin:       'ring-emerald-200',
}

function fmtRelative(s?: string) {
  if (!s) return ''
  try {
    const diff = Date.now() - new Date(s).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'agora'
    if (m < 60) return `${m}min atrás`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h atrás`
    return new Date(s).toLocaleDateString('pt-BR')
  } catch { return '' }
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

// ── Welcome header ────────────────────────────────────────────────────────────

function DashboardWelcome({
  user,
  subtitle,
  actions,
}: {
  user: SessionUser
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#0b1029] text-white shadow-[0_20px_60px_-16px_rgba(30,27,75,0.55)] neon-border holo-scan animate-rise">
      {/* Camadas 3D: grade + orbes flutuantes */}
      <div className="absolute inset-0 tech-grid-light" />
      <div className="orb w-48 h-48 -top-16 -left-10" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.8), transparent 70%)' }} />
      <div className="orb w-56 h-56 -bottom-24 right-10" style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.6), transparent 70%)', animationDelay: '-4s' }} />
      <div className="orb w-32 h-32 top-0 right-1/3" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.6), transparent 70%)', animationDelay: '-8s' }} />

      {/* Logo no canto superior direito */}
      <div className="absolute top-4 right-5">
        <Image
          src="/logo-interatell-nav-trim.png"
          alt="Interatell"
          width={120}
          height={32}
          className="h-7 w-auto object-contain brightness-0 invert opacity-60"
        />
      </div>
      <div className="relative px-6 py-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-[0_0_24px_rgba(99,102,241,0.55)] ring-2 ring-cyan-400/40 ${ROLE_AVATAR[user.role]}`}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-cyan-300/90 text-sm font-medium tracking-wide">{greeting()},</p>
            <h1 className="text-xl sm:text-2xl font-bold truncate" style={{ fontFamily: 'var(--font-display), sans-serif' }}>{user.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/25 border border-indigo-400/30 backdrop-blur-sm">
                {ROLE_LABEL[user.role]}
              </span>
              {subtitle && (
                <span className="text-xs text-indigo-200/80 truncate">{subtitle}</span>
              )}
            </div>
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, color, href,
}: {
  label: string
  value: string | number
  icon: typeof Clock
  color: 'amber' | 'emerald' | 'blue' | 'violet'
  href?: string
}) {
  const styles = {
    amber:   { wrap: 'bg-amber-50 border-amber-200',   icon: 'bg-amber-500',   val: 'text-amber-700',   lbl: 'text-amber-600'   },
    emerald: { wrap: 'bg-emerald-50 border-emerald-200', icon: 'bg-emerald-500', val: 'text-emerald-700', lbl: 'text-emerald-600' },
    blue:    { wrap: 'bg-blue-50 border-blue-200',     icon: 'bg-blue-500',    val: 'text-blue-700',    lbl: 'text-blue-600'    },
    violet:  { wrap: 'bg-violet-50 border-violet-200', icon: 'bg-violet-500',  val: 'text-violet-700',  lbl: 'text-violet-600'  },
  }[color]

  const inner = (
    <div className={`card-3d border rounded-2xl p-4 flex items-center gap-3 ${styles.wrap}`}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg ${styles.icon}`} style={{ transform: 'translateZ(24px)' }}>
        <Icon size={20} className="text-white" />
      </div>
      <div style={{ transform: 'translateZ(12px)' }}>
        <p className={`text-2xl font-bold leading-none ${styles.val}`}>{value}</p>
        <p className={`text-xs font-medium mt-1 leading-tight ${styles.lbl}`}>{label}</p>
      </div>
    </div>
  )

  return href ? <Link href={href} className="block animate-rise">{inner}</Link> : <div className="animate-rise">{inner}</div>
}

// ── Quick action ──────────────────────────────────────────────────────────────

function QuickAction({
  href, icon: Icon, label, sub, accent,
}: {
  href: string
  icon: typeof ShieldCheck
  label: string
  sub: string
  accent: 'violet' | 'amber' | 'blue' | 'emerald'
}) {
  const accents = {
    violet:  { icon: 'text-violet-500', hover: 'hover:border-violet-300 hover:bg-violet-50', arrow: 'group-hover:text-violet-400' },
    amber:   { icon: 'text-amber-500',  hover: 'hover:border-amber-300 hover:bg-amber-50',   arrow: 'group-hover:text-amber-400'  },
    blue:    { icon: 'text-blue-500',   hover: 'hover:border-blue-300 hover:bg-blue-50',     arrow: 'group-hover:text-blue-400'   },
    emerald: { icon: 'text-emerald-500',hover: 'hover:border-emerald-300 hover:bg-emerald-50',arrow: 'group-hover:text-emerald-400'},
  }[accent]

  return (
    <Link href={href}
      className={`group card-3d-subtle flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-2xl transition-all ${accents.hover}`}
    >
      <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
        <Icon size={20} className={accents.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        <p className="text-xs text-gray-400 truncate">{sub}</p>
      </div>
      <ArrowRight size={14} className={`text-gray-300 flex-shrink-0 transition-colors ${accents.arrow}`} />
    </Link>
  )
}

// ── Process entry cards (novo processo) ───────────────────────────────────────

function ProcessEntryCards({ onStart }: { onStart?: () => void }) {
  const cards = [
    {
      key: 'backlog',
      icon: ClipboardList,
      title: 'Backlog',
      desc: 'Preencha o formulário e salve como rascunho com PDF.',
      color: 'border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-300',
      iconBg: 'bg-blue-500',
      badge: 'Etapa 1',
    },
    {
      key: 'omie',
      icon: Send,
      title: 'Processamento',
      desc: 'Revise os dados e envie diretamente ao Omie.',
      color: 'border-purple-200 bg-purple-50 hover:bg-purple-100 hover:border-purple-300',
      iconBg: 'bg-purple-500',
      badge: 'Etapa 2',
    },
    {
      key: 'update',
      icon: Pencil,
      title: 'Atualização',
      desc: 'Altere pedidos já enviados (requer aprovação do financeiro).',
      color: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300',
      iconBg: 'bg-emerald-500',
      badge: 'Etapa 3',
      href: '/atualizacao',
    },
  ]

  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {cards.map(({ key, icon: Icon, title, desc, color, iconBg, badge, href }) => {
        const content = (
          <div className={`card-3d relative rounded-2xl border p-4 transition-all cursor-pointer h-full ${color}`}>
            <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/80 text-gray-500">
              {badge}
            </span>
            <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center mb-3 shadow-lg`} style={{ transform: 'translateZ(20px)' }}>
              <Icon size={18} className="text-white" />
            </div>
            <p className="text-sm font-bold text-gray-800 mb-1">{title}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
            {key !== 'update' && (
              <p className="text-[11px] font-semibold text-gray-400 mt-2 flex items-center gap-1">
                <ArrowRight size={11} /> Selecione um card na barra lateral
              </p>
            )}
          </div>
        )
        if (href) return <Link key={key} href={href}>{content}</Link>
        return (
          <button key={key} type="button" onClick={onStart} className="text-left w-full">
            {content}
          </button>
        )
      })}
    </div>
  )
}

// ── Financeiro ────────────────────────────────────────────────────────────────

function FinanceiroDashboard({ user }: { user: SessionUser }) {
  const [pending, setPending]   = useState<any[]>([])
  const [approved, setApproved] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [pRes, aRes] = await Promise.all([
        listUpdateRequestsAction('pending'),
        listUpdateRequestsAction('approved'),
      ])
      if (pRes.success) setPending(pRes.requests)
      if (aRes.success) setApproved(aRes.requests)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
        <DashboardWelcome
          user={user}
          subtitle="Revise solicitações de atualização do Inside Sales"
          actions={
            <button onClick={load} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-sm font-medium transition-colors"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </button>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Aguardando aprovação" value={loading ? '—' : pending.length} icon={Clock} color="amber" href="/solicitacoes" />
          <StatCard label="Aprovadas recentes" value={loading ? '—' : approved.length} icon={CheckCircle2} color="emerald" href="/solicitacoes" />
          <StatCard label="Seu papel" value="Revisor" icon={ShieldCheck} color="violet" />
        </div>

        {!loading && pending.length > 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-amber-50/60">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                <Clock size={15} />
                Solicitações pendentes
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800">{pending.length}</span>
              </p>
              <Link href="/solicitacoes" className="text-xs text-amber-700 hover:text-amber-900 font-semibold flex items-center gap-1">
                Ver todas <ArrowRight size={11} />
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {pending.slice(0, 6).map((req: any) => (
                <div key={req.id} className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-gray-50/80 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {req.proposal ? `Proposta ${req.proposal}` : req.business_name ?? `Deal #${req.deal_id}`}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-0.5">
                      {req.customer_name && <span className="flex items-center gap-1"><Building2 size={10} />{req.customer_name}</span>}
                      {req.requested_by_name && <span className="flex items-center gap-1"><Users size={10} />{req.requested_by_name}</span>}
                      <span>{fmtRelative(req.created_at)}</span>
                    </div>
                  </div>
                  <Link href="/solicitacoes"
                    className="flex-shrink-0 text-xs font-semibold px-3.5 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                  >
                    Revisar
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ) : !loading && (
          <div className="flex flex-col items-center justify-center py-14 text-center bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
            <p className="text-base font-semibold text-gray-700">Tudo em dia!</p>
            <p className="text-sm text-gray-400 mt-1">Nenhuma solicitação aguardando sua revisão.</p>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Acesso rápido</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <QuickAction href="/solicitacoes" icon={ShieldCheck} label="Solicitações" sub="Aprovar ou recusar atualizações" accent="violet" />
            <QuickAction href="/historico"    icon={History}     label="Histórico"    sub="Envios ao Omie e aprovações"   accent="amber"  />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Admin ─────────────────────────────────────────────────────────────────────

type AdminTab = 'processos' | 'painel'

function AdminDashboard({ user }: { user: SessionUser }) {
  const [tab, setTab]               = useState<AdminTab>('processos')
  const [pending, setPending]       = useState<any[]>([])
  const [processes, setProcesses]   = useState<any[]>([])
  const [userCount, setUserCount]   = useState(0)
  const [users, setUsers]           = useState<any[]>([])
  const [recentDeals, setRecentDeals] = useState<any[]>([])
  const [loading, setLoading]       = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [pRes, rRes, uRes, dRes] = await Promise.all([
        listUpdateRequestsAction('pending'),
        getPendingProcessesAction(),
        listAppUsersAction(),
        getDealsHistoryAction(5, 0),
      ])
      if (pRes.success) setPending(pRes.requests)
      if (rRes.success) setProcesses(rRes.processes || [])
      if (uRes.success) {
        setUserCount(uRes.users.length)
        setUsers(uRes.users)
      }
      if (dRes.success) setRecentDeals(dRes.deals)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  if (tab === 'processos') {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${ROLE_AVATAR[user.role]}`}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{user.name}</p>
              <p className="text-[11px] text-gray-400">Selecione um card na barra lateral para iniciar</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 flex-shrink-0">
            <button onClick={() => setTab('processos')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-blue-700 shadow-sm"
            >
              <Zap size={12} /> Processos
            </button>
            <button onClick={() => setTab('painel')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-500 hover:text-gray-700"
            >
              <LayoutDashboard size={12} /> Painel
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <InsideSalesLayout embedded />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
        <DashboardWelcome
          user={user}
          subtitle="Visão geral do sistema Inside Sales"
          actions={
            <>
              <button onClick={() => setTab('processos')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-blue-700 text-sm font-semibold hover:bg-blue-50 shadow-sm transition-colors"
              >
                <Zap size={14} /> Novo processo
              </button>
              <button onClick={load} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-sm font-medium transition-colors"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </>
          }
        />

        {/* Tab switch */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit shadow-sm">
          <button onClick={() => setTab('processos')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg text-gray-500 hover:text-gray-700 transition-colors"
          >
            <Zap size={14} /> Processos
          </button>
          <button onClick={() => setTab('painel')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white shadow-sm"
          >
            <LayoutDashboard size={14} /> Painel
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Aprovações pendentes"  value={loading ? '—' : pending.length}   icon={Clock}         color="amber"   href="/solicitacoes" />
          <StatCard label="Processos em andamento" value={loading ? '—' : processes.length} icon={ClipboardList} color="blue"    href="/historico"    />
          <StatCard label="Usuários cadastrados" value={loading ? '—' : userCount}        icon={Users}         color="emerald" href="/admin/usuarios" />
          <StatCard label="Últimos envios"        value={loading ? '—' : recentDeals.length} icon={TrendingUp}  color="violet"  href="/historico"    />
        </div>

        {/* Novo processo CTA */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-gray-800">Como iniciar um processo</h2>
              <p className="text-sm text-gray-500 mt-0.5">Escolha a etapa e selecione um card do Bitrix24 na barra lateral.</p>
            </div>
            <button onClick={() => setTab('processos')}
              className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shadow-sm"
            >
              <Zap size={14} /> Ir para processos
            </button>
          </div>
          <ProcessEntryCards onStart={() => setTab('processos')} />
        </div>

        {/* Usuários */}
        {!loading && users.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <Users size={15} className="text-emerald-500" />
                Usuários do sistema
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{userCount}</span>
              </p>
              <Link href="/admin/usuarios" className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
                Gerenciar <ArrowRight size={11} />
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {users.slice(0, 6).map((u: any) => (
                <div key={u.bitrix_user_id} className="px-5 py-3 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
                    u.role === 'admin' ? 'bg-emerald-500' : u.role === 'financeiro' ? 'bg-violet-500' : 'bg-blue-500'
                  }`}>
                    {(u.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{u.name}</p>
                    <p className="text-xs text-gray-400">{ROLE_LABEL[u.role as Role] ?? u.role}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    u.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {u.active ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Acesso rápido</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <QuickAction href="/solicitacoes"   icon={ShieldCheck} label="Solicitações" sub="Revisar aprovações de atualização" accent="violet"  />
            <QuickAction href="/historico"      icon={History}     label="Histórico"    sub="Envios ao Omie e aprovações"       accent="amber"   />
            <QuickAction href="/atualizacao"    icon={TrendingUp}  label="Atualização"  sub="Atualizar pedidos no Omie"         accent="blue"    />
            <QuickAction href="/admin/usuarios" icon={Users}       label="Usuários"     sub="Gerenciar permissões e papéis"     accent="emerald" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Inside Sales wrapper ──────────────────────────────────────────────────────

function InsideSalesHome({ user }: { user: SessionUser }) {
  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <div className="relative flex-shrink-0 overflow-hidden bg-[#0b1029] px-4 py-2.5 flex items-center justify-between gap-3 holo-scan">
        <div className="absolute inset-0 tech-grid-light pointer-events-none" />
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 60% 140% at 10% 50%, rgba(99,102,241,0.30), transparent 60%), radial-gradient(ellipse 40% 120% at 90% 50%, rgba(34,211,238,0.18), transparent 55%)' }}
        />
        <div className="relative flex items-center gap-3 min-w-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ring-2 ring-cyan-400/40 shadow-[0_0_14px_rgba(34,211,238,0.35)] ${ROLE_AVATAR[user.role]}`}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 text-white">
            <p className="text-sm font-semibold truncate">{greeting()}, {user.name.split(' ')[0]}</p>
            <p className="text-[11px] text-indigo-300">Selecione um card na barra lateral para iniciar um processo</p>
          </div>
        </div>
        <Link href="/atualizacao"
          className="relative flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/25 border border-indigo-400/30 hover:bg-indigo-500/40 text-white text-xs font-semibold transition-all btn-3d"
        >
          <Pencil size={12} /> Atualização
        </Link>
      </div>
      <div className="flex-1 overflow-hidden">
        <InsideSalesLayout embedded />
      </div>
    </div>
  )
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function HomeDashboard() {
  const { user, loading } = useCurrentUser()

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
        <p className="text-sm text-gray-400">Carregando...</p>
      </div>
    )
  }

  if (!user) return null

  if (user.role === 'financeiro') return <FinanceiroDashboard user={user} />
  if (user.role === 'admin')      return <AdminDashboard user={user} />
  return <InsideSalesHome user={user} />
}
