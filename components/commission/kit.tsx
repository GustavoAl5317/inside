'use client'

import { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MONTH_LABELS, type PeriodStatus } from '@/lib/commission/types'

/** Fundo tecnológico escuro reaproveitado nas telas de comissão. */
export function TechShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[calc(100vh-8rem)] bg-[#0b1029] text-indigo-50 overflow-hidden">
      <div className="absolute inset-0 tech-grid-light opacity-40 pointer-events-none" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 80% at 15% 0%, rgba(99,102,241,0.22), transparent 60%), radial-gradient(ellipse 50% 70% at 90% 10%, rgba(34,211,238,0.14), transparent 55%)' }}
      />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</div>
    </div>
  )
}

export function PageHead({ icon, title, subtitle, right }: {
  icon: ReactNode; title: string; subtitle?: string; right?: ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-gradient-to-br from-indigo-500 to-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.4)] flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight font-[var(--font-display)] truncate">{title}</h1>
          {subtitle && <p className="text-xs sm:text-sm text-indigo-300/80 truncate">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

export function GlassCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-indigo-400/15 bg-white/5 backdrop-blur-sm shadow-[0_8px_40px_rgba(2,6,23,0.5)] ${className}`}>
      {children}
    </div>
  )
}

const ACCENTS: Record<string, string> = {
  cyan:   'from-cyan-500/20 to-cyan-400/5 text-cyan-300 ring-cyan-400/30',
  indigo: 'from-indigo-500/20 to-indigo-400/5 text-indigo-300 ring-indigo-400/30',
  emerald:'from-emerald-500/20 to-emerald-400/5 text-emerald-300 ring-emerald-400/30',
  amber:  'from-amber-500/20 to-amber-400/5 text-amber-300 ring-amber-400/30',
  violet: 'from-violet-500/20 to-violet-400/5 text-violet-300 ring-violet-400/30',
}

export function Kpi({ label, value, hint, accent = 'indigo', icon }: {
  label: string; value: string; hint?: string; accent?: keyof typeof ACCENTS; icon?: ReactNode
}) {
  return (
    <div className={`relative rounded-2xl p-4 bg-gradient-to-br ring-1 ${ACCENTS[accent]} overflow-hidden`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-200/70">{label}</span>
        {icon && <span className="opacity-80">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-bold text-white tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-indigo-300/70">{hint}</div>}
    </div>
  )
}

const STATUS_STYLE: Record<PeriodStatus, { label: string; cls: string }> = {
  open:     { label: 'Aberto',   cls: 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/30' },
  closed:   { label: 'Fechado',  cls: 'bg-amber-500/15 text-amber-300 ring-amber-400/30' },
  approved: { label: 'Aprovado', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30' },
}

export function StatusPill({ status }: { status: PeriodStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.open
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ring-1 ${s.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />{s.label}
    </span>
  )
}

export function MonthNav({ year, month, onChange }: {
  year: number; month: number; onChange: (y: number, m: number) => void
}) {
  const step = (delta: number) => {
    let m = month + delta, y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    onChange(y, m)
  }
  return (
    <div className="flex items-center gap-1 rounded-xl bg-white/5 ring-1 ring-indigo-400/20 p-1">
      <button onClick={() => step(-1)} className="p-1.5 rounded-lg hover:bg-white/10 text-indigo-200" aria-label="Mês anterior">
        <ChevronLeft size={16} />
      </button>
      <span className="px-2 text-sm font-semibold text-white tabular-nums min-w-[130px] text-center">
        {MONTH_LABELS[month - 1]} {year}
      </span>
      <button onClick={() => step(1)} className="p-1.5 rounded-lg hover:bg-white/10 text-indigo-200" aria-label="Próximo mês">
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

export function TechButton({ children, onClick, disabled, variant = 'primary', title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string
  variant?: 'primary' | 'ghost' | 'success' | 'warning' | 'danger'
}) {
  const styles: Record<string, string> = {
    primary: 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white hover:shadow-[0_0_18px_rgba(34,211,238,0.5)]',
    ghost:   'bg-white/5 text-indigo-100 ring-1 ring-indigo-400/25 hover:bg-white/10',
    success: 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white hover:shadow-[0_0_18px_rgba(16,185,129,0.5)]',
    warning: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:shadow-[0_0_18px_rgba(245,158,11,0.5)]',
    danger:  'bg-red-500/90 text-white hover:bg-red-500',
  }
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {children}
    </button>
  )
}
