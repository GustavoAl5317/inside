'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { useCurrentUser, canAccess, type ROLE_ACCESS } from '@/components/current-user-provider'
import { listUpdateRequestsAction } from '@/lib/actions'
import { Loader2, ShieldAlert, ChevronDown, Menu, X } from 'lucide-react'

function usePendingApprovalCount(role: string | null) {
  const [count, setCount] = useState(0)
  const canSee = role === 'financeiro' || role === 'admin'

  useEffect(() => {
    if (!canSee) return
    let mounted = true
    const check = async () => {
      try {
        const r = await listUpdateRequestsAction('pending')
        if (mounted && r.success) setCount(r.requests.length)
      } catch { /* silently ignore */ }
    }
    check()
    const id = setInterval(check, 30_000)
    return () => { mounted = false; clearInterval(id) }
  }, [canSee])

  return canSee ? count : 0
}

type Area = keyof typeof ROLE_ACCESS

interface NavItem {
  href: string
  label: string
  emoji: string
  area: Area
}

interface NavGroup {
  label: string
  emoji: string
  items: NavItem[]
  direct?: boolean
  href?: string
  area?: Area
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Início',
    emoji: '🏠',
    direct: true,
    href: '/',
    area: 'home',
    items: [],
  },
  {
    label: 'Operações',
    emoji: '⚡',
    items: [
      { href: '/atualizacao', label: 'Atualização', emoji: '✏️', area: 'atualizacao' },
      { href: '/solicitacoes',label: 'Solicitações',emoji: '🔐', area: 'solicitacoes' },
      { href: '/historico',   label: 'Histórico',   emoji: '📋', area: 'historico' },
    ],
  },
  {
    label: 'Cadastros',
    emoji: '🗂️',
    items: [
      { href: '/fornecedores',       label: 'Fornecedores', emoji: '🏭', area: 'cadastros' },
      { href: '/familias',           label: 'Famílias',     emoji: '📁', area: 'cadastros' },
      { href: '/condicoes-pagamento',label: 'Pagamentos',   emoji: '💳', area: 'cadastros' },
    ],
  },
  {
    label: 'Admin',
    emoji: '👥',
    items: [
      { href: '/admin/usuarios', label: 'Usuários',  emoji: '👥', area: 'admin' },
      { href: '/admin/limpeza',  label: 'Limpeza DB', emoji: '🗑️', area: 'admin' },
    ],
  },
]

const ROLE_LABEL: Record<string, string> = {
  insidesales: 'Inside Sales',
  financeiro:  'Financeiro',
  admin:       'Administrador',
}

const ROLE_COLOR: Record<string, string> = {
  insidesales: 'bg-blue-500',
  financeiro:  'bg-violet-500',
  admin:       'bg-emerald-500',
}

function NavDropdown({ group, role, badgeCounts }: { group: NavGroup; role: string | null; badgeCounts?: Record<string, number> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const visibleItems = group.items.filter(i => canAccess(i.area, role as any))

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (visibleItems.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
          open
            ? 'bg-indigo-500/25 text-white shadow-[0_0_16px_rgba(99,102,241,0.35)]'
            : 'text-indigo-200 hover:text-white hover:bg-white/10'
        }`}
      >
        <span>{group.emoji}</span>
        <span>{group.label}</span>
        {!open && visibleItems.some(i => (badgeCounts?.[i.href] ?? 0) > 0) && (
          <span className="w-2 h-2 rounded-full bg-cyan-400 pulse-glow flex-shrink-0" />
        )}
        <ChevronDown size={13} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 min-w-[200px] glass-dark rounded-2xl overflow-hidden animate-rise">
          {visibleItems.map(item => {
            const badge = badgeCounts?.[item.href] ?? 0
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-indigo-100 hover:bg-indigo-500/20 hover:text-white hover:pl-5 transition-all duration-200"
              >
                <span className="text-base leading-none">{item.emoji}</span>
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-cyan-500 text-white text-[10px] font-bold px-1 leading-none pulse-glow">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function AppNav() {
  const { user } = useCurrentUser()
  const role = user?.role ?? null
  const [mobileOpen, setMobileOpen] = useState(false)
  const pendingCount = usePendingApprovalCount(role)

  const badgeCounts: Record<string, number> = pendingCount > 0
    ? { '/solicitacoes': pendingCount }
    : {}

  const allItems = NAV_GROUPS.flatMap(g =>
    g.direct ? [] : g.items.filter(i => canAccess(i.area, role as any))
  )

  return (
    <header className="relative bg-[#0b1029] shadow-[0_4px_30px_rgba(30,27,75,0.45)] sticky top-0 z-40">
      {/* Camadas futuristas: grade tecnológica + brilhos */}
      <div className="absolute inset-0 tech-grid-light pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 55% 130% at 18% 50%, rgba(99,102,241,0.28), transparent 60%), radial-gradient(ellipse 40% 120% at 85% 50%, rgba(34,211,238,0.16), transparent 55%)' }}
      />
      <div className="absolute inset-x-0 bottom-0 h-px pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.9), rgba(34,211,238,0.9), transparent)' }}
      />
      <div className="relative px-0 md:px-0">
        <div className="flex items-center h-14">

          {/* Logo — centralizado na mesma largura da sidebar (w-80) */}
          <div className="w-full md:w-80 flex-shrink-0 flex items-center justify-center h-14 px-12 md:px-4 border-b md:border-b-0 md:border-r border-indigo-500/25">
            <Link
              href="/"
              className="flex items-center py-1 transition-transform duration-300 hover:scale-105"
              aria-label="Interatell — Início"
            >
              <Image
                src="/logo-interatell-nav-trim.png"
                alt="Interatell"
                width={240}
                height={56}
                className="h-9 w-auto object-contain brightness-0 invert drop-shadow-[0_0_12px_rgba(99,102,241,0.65)]"
                priority
              />
            </Link>
          </div>

          {/* Desktop: menus + usuário */}
          <div className="hidden md:flex flex-1 items-center min-w-0 px-4">
            <nav className="flex items-center gap-1 flex-1 justify-center">
              {canAccess('home', role as any) && (
                <Link
                  href="/"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-indigo-200 hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  🏠 Início
                </Link>
              )}
              {NAV_GROUPS.filter(g => !g.direct).map(g => (
                <NavDropdown key={g.label} group={g} role={role} badgeCounts={badgeCounts} />
              ))}
            </nav>

            {user && (
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                <div className="text-right">
                  <div className="text-xs font-semibold text-white leading-tight">{user.name}</div>
                  <div className="text-[10px] text-indigo-300 leading-tight">{ROLE_LABEL[user.role] ?? user.role}</div>
                </div>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ring-2 ring-cyan-400/40 shadow-[0_0_12px_rgba(34,211,238,0.35)] ${ROLE_COLOR[user.role] ?? 'bg-blue-500'}`}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
              </div>
            )}
          </div>

          {/* Mobile: burger (esq) e avatar (dir) — logo fica centralizado no meio */}
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="md:hidden absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-indigo-200 hover:text-white hover:bg-white/10 transition-colors"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          {user && (
            <div className={`md:hidden absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-cyan-400/40 ${ROLE_COLOR[user.role] ?? 'bg-blue-500'}`}>
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-indigo-500/25 py-2 space-y-0.5 animate-rise">
            {canAccess('home', role as any) && (
              <Link href="/" onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-indigo-200 hover:text-white hover:bg-white/10"
              >🏠 Início</Link>
            )}
            {allItems.map(item => {
              const badge = badgeCounts[item.href] ?? 0
              return (
                <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-indigo-200 hover:text-white hover:bg-white/10"
                >
                  <span>{item.emoji}</span>
                  <span className="flex-1">{item.label}</span>
                  {badge > 0 && (
                    <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-cyan-500 text-white text-[10px] font-bold px-1 pulse-glow">
                      {badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </header>
  )
}

/** Bloqueia o conteúdo para usuários sem acesso liberado. */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const { user, loading, isBitrix, devLogin, error } = useCurrentUser()
  const [devId, setDevId] = useState('')
  const [devName, setDevName] = useState('')

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin mb-3" />
        <p className="text-sm">Identificando usuário…</p>
      </div>
    )
  }

  if (!user && !isBitrix) {
    return (
      <div className="flex items-center justify-center h-[70vh] p-4">
        <div className="w-full max-w-sm glass neon-border rounded-2xl p-6 space-y-4 animate-rise">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Login de desenvolvimento</h2>
            <p className="text-xs text-gray-500 mt-1">
              O app não está dentro do Bitrix24. Informe um ID de usuário Bitrix para testar.
            </p>
          </div>
          <input
            value={devId}
            onChange={e => setDevId(e.target.value)}
            placeholder="ID do usuário Bitrix (ex: 1)"
            className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200"
          />
          <input
            value={devName}
            onChange={e => setDevName(e.target.value)}
            placeholder="Nome (opcional)"
            className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200"
          />
          <button
            onClick={() => devId && devLogin(devId, devName || undefined)}
            disabled={!devId}
            className="w-full py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-500 text-white text-sm font-medium btn-3d disabled:opacity-50"
          >
            Entrar
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </div>
    )
  }

  if (!user || !user.active) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-center px-4">
        <ShieldAlert className="w-12 h-12 text-amber-400 mb-4" />
        <h2 className="text-lg font-semibold text-gray-800">Acesso pendente</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-md">
          {user
            ? `Olá, ${user.name}. Seu acesso ainda não foi liberado. Solicite a um administrador para conceder uma permissão.`
            : 'Não foi possível identificar seu usuário. Contate um administrador.'}
        </p>
      </div>
    )
  }

  return <>{children}</>
}
