'use client'

import { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MONTH_LABELS, type PeriodStatus } from '@/lib/commission/types'

/** Casca escura das telas de comissão — sóbria, sem efeitos exagerados. */
export function TechShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-8rem)] bg-[#0c1120] text-slate-100">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-5 sm:py-8">{children}</div>
    </div>
  )
}

export function PageHead({ icon, title, subtitle, right }: {
  icon: ReactNode; title: string; subtitle?: string; right?: ReactNode
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 mb-5 sm:mb-7">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/[0.04] ring-1 ring-white/10 text-cyan-400 flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-white truncate">{title}</h1>
          {subtitle && <p className="text-xs sm:text-[13px] text-slate-400 truncate">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </div>
  )
}

export function GlassCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.07] bg-white/[0.02] ${className}`}>
      {children}
    </div>
  )
}

const ACCENT_TEXT: Record<string, string> = {
  cyan: 'text-cyan-400',
  indigo: 'text-indigo-400',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  violet: 'text-violet-400',
}

export function Kpi({ label, value, hint, accent = 'indigo', icon }: {
  label: string; value: string; hint?: string; accent?: keyof typeof ACCENT_TEXT; icon?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 sm:p-4 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500 truncate">{label}</span>
        {icon && <span className={`flex-shrink-0 ${ACCENT_TEXT[accent]}`}>{icon}</span>}
      </div>
      <div className="mt-1.5 text-lg sm:text-2xl font-semibold text-white tabular-nums truncate">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500 truncate">{hint}</div>}
    </div>
  )
}

const STATUS_STYLE: Record<PeriodStatus, { label: string; cls: string }> = {
  open:     { label: 'Aberto',   cls: 'border-cyan-400/30 text-cyan-300 bg-cyan-400/[0.06]' },
  closed:   { label: 'Fechado',  cls: 'border-amber-400/30 text-amber-300 bg-amber-400/[0.06]' },
  approved: { label: 'Aprovado', cls: 'border-emerald-400/30 text-emerald-300 bg-emerald-400/[0.06]' },
}

export function StatusPill({ status }: { status: PeriodStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.open
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border ${s.cls}`}>
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
    <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.03]">
      <button onClick={() => step(-1)} className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.05] rounded-l-lg" aria-label="Mês anterior">
        <ChevronLeft size={15} />
      </button>
      <span className="px-2 text-sm font-medium text-white tabular-nums min-w-[118px] text-center select-none">
        {MONTH_LABELS[month - 1]} {year}
      </span>
      <button onClick={() => step(1)} className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.05] rounded-r-lg" aria-label="Próximo mês">
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

export function TechButton({ children, onClick, disabled, variant = 'primary', title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string
  variant?: 'primary' | 'ghost' | 'success' | 'warning' | 'danger'
}) {
  const styles: Record<string, string> = {
    primary: 'bg-cyan-500 hover:bg-cyan-400 text-slate-950',
    ghost:   'border border-white/10 text-slate-200 hover:bg-white/[0.05]',
    success: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950',
    warning: 'bg-amber-500 hover:bg-amber-400 text-slate-950',
    danger:  'bg-red-500/90 hover:bg-red-500 text-white',
  }
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${styles[variant]}`}
    >
      {children}
    </button>
  )
}
