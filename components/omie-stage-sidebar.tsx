'use client'

import { useState, useEffect, useCallback } from 'react'
import { getInsideSalesByStageAction } from '@/lib/actions'
import type { BitrixInsideSalesItem } from '@/lib/bitrix-service'
import {
  RefreshCw,
  ClipboardList,
  Settings2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Building2,
  Package,
} from 'lucide-react'

const BACKLOG_STAGE = 'DT129_13:NEW'
const OMIE_STAGE   = 'DT129_13:PREPARATION'

export type StageTab = 'backlog' | 'omie'

// HistoryDeal is exported here so historico-layout can import it
export interface HistoryDeal {
  id: number
  status: string
  bitrixDealId: string | null
  payload: any
  omieResponse: {
    resumo?: {
      oc: { numero: string; fornecedor: string }[]
      ov: { numero: string; cliente: string }[]
      os: { numero: string; cliente: string; nat: string }[]
    }
  } | null
  createdAt: string
  updatedAt: string
  businessName: string | null
  proposal: string | null
  supplierName: string | null
  customerName: string | null
}

// Keep STATUS_CFG exported for historico-layout
export const STATUS_CFG: Record<string, {
  label: string
  dot: string
  badge: string
  icon: typeof CheckCircle2
}> = {
  pending:  { label: 'Rascunho', dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',       icon: FileText     },
  approved: { label: 'Aprovado', dot: 'bg-yellow-400',  badge: 'bg-yellow-50 text-yellow-700 ring-yellow-200', icon: Clock        },
  sent:     { label: 'Enviado',  dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2 },
  failed:   { label: 'Falhou',   dot: 'bg-red-400',     badge: 'bg-red-50 text-red-700 ring-red-200',          icon: XCircle      },
  draft:    { label: 'Rascunho', dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',       icon: FileText     },
}

function fmtDate(s?: string) {
  if (!s) return ''
  try {
    return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch { return '' }
}

interface OmieStageSidebarProps {
  selectedBitrixId: number | null
  onSelect: (item: BitrixInsideSalesItem, stage: StageTab) => void
}

// ─── Tab button ────────────────────────────────────────────────────────────────
function TabBtn({
  active, onClick, icon: Icon, label, count, activeCls,
}: {
  active: boolean
  onClick: () => void
  icon: typeof ClipboardList
  label: string
  count: number
  activeCls: string
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl
        text-xs font-semibold transition-all duration-200
        ${active
          ? `${activeCls} shadow-sm`
          : 'text-gray-500 hover:text-gray-800 hover:bg-white/80'}
      `}
    >
      <Icon size={13} strokeWidth={active ? 2.5 : 2} />
      <span>{label}</span>
      {count > 0 && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
          active ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-500'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

// ─── Card de Bitrix ────────────────────────────────────────────────────────────
function BitrixCard({
  item, selected, accent, onClick,
}: {
  item: BitrixInsideSalesItem
  selected: boolean
  accent: 'blue' | 'purple'
  onClick: () => void
}) {
  const code = item.xmlId ? String(item.xmlId) : null
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left rounded-xl border p-3 transition-all duration-150
        ${selected
          ? accent === 'blue'
            ? 'border-blue-300 bg-blue-50 shadow-sm ring-1 ring-blue-200'
            : 'border-purple-300 bg-purple-50 shadow-sm ring-1 ring-purple-200'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 hover:shadow-sm'}
      `}
    >
      <p className={`text-[13px] font-semibold leading-snug line-clamp-2 ${
        selected
          ? accent === 'blue' ? 'text-blue-900' : 'text-purple-900'
          : 'text-gray-800'
      }`}>
        {item.title || `Item #${item.id}`}
      </p>

      {item.companyName && (
        <div className={`flex items-center gap-1 mt-1.5 ${
          selected
            ? accent === 'blue' ? 'text-blue-600' : 'text-purple-600'
            : 'text-gray-500'
        }`}>
          <Building2 size={10} />
          <p className="text-[11px] font-medium truncate">{item.companyName}</p>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {code && (
          <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
            accent === 'blue'
              ? 'bg-blue-100/80 text-blue-700'
              : 'bg-purple-100/80 text-purple-700'
          }`}>
            {code}
          </span>
        )}
        {item.createdTime && (
          <span className="text-[10px] text-gray-400">{fmtDate(item.createdTime)}</span>
        )}
      </div>
    </button>
  )
}

function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-44 text-center select-none">
      <span className="text-4xl mb-3 opacity-70">{emoji}</span>
      <p className="text-xs text-gray-400 font-medium">{text}</p>
    </div>
  )
}

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${i === 0 ? 'h-20' : 'h-16'} bg-gradient-to-r from-gray-100 to-gray-50 rounded-xl animate-pulse`} />
      ))}
    </div>
  )
}

// ─── Sidebar principal ─────────────────────────────────────────────────────────
export function OmieStageSidebar({
  selectedBitrixId,
  onSelect,
}: OmieStageSidebarProps) {
  const [tab, setTab]              = useState<StageTab>('backlog')
  const [backlogItems, setBacklog] = useState<BitrixInsideSalesItem[]>([])
  const [omieItems, setOmie]       = useState<BitrixInsideSalesItem[]>([])
  const [loading, setLoading]      = useState(true)
  const [spinning, setSpinning]    = useState(false)
  const [search, setSearch]        = useState('')

  const loadAll = useCallback(async () => {
    setSpinning(true)
    setLoading(true)
    try {
      const [backlogRes, omieRes] = await Promise.all([
        getInsideSalesByStageAction(BACKLOG_STAGE),
        getInsideSalesByStageAction(OMIE_STAGE),
      ])
      if (backlogRes.success) setBacklog(backlogRes.items ?? [])
      if (omieRes.success)    setOmie(omieRes.items ?? [])
    } finally {
      setLoading(false)
      setSpinning(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [])

  const TAB_DEFS = [
    { id: 'backlog' as StageTab, icon: ClipboardList, label: 'Backlog',       count: backlogItems.length, activeCls: 'bg-blue-500 text-white'   },
    { id: 'omie'   as StageTab, icon: Settings2,      label: 'Processamento', count: omieItems.length,   activeCls: 'bg-violet-500 text-white' },
  ]

  const descMap: Record<StageTab, { text: string; cls: string }> = {
    backlog: { text: 'Elaboração de OC',       cls: 'text-blue-500'   },
    omie:    { text: 'Processamento no Omie',  cls: 'text-violet-500' },
  }

  const rawItems = tab === 'backlog' ? backlogItems : omieItems
  const items = search
    ? rawItems.filter(it => {
        const q = search.toLowerCase()
        return (
          (it.title ?? '').toLowerCase().includes(q) ||
          (it.companyName ?? '').toLowerCase().includes(q) ||
          String(it.xmlId ?? '').toLowerCase().includes(q)
        )
      })
    : rawItems
  const accent  = tab === 'backlog' ? 'blue' : 'purple'
  const empty   = tab === 'backlog' ? '📋' : '⚙️'
  const emptyTx = tab === 'backlog' ? 'Nenhum card no Backlog' : 'Nenhum card em Processamento'

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white h-full overflow-hidden">

      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">

        <div className="flex bg-gray-100 rounded-2xl p-1 gap-0.5">
          {TAB_DEFS.map(t => (
            <TabBtn
              key={t.id}
              active={tab === t.id}
              onClick={() => setTab(t.id)}
              icon={t.icon}
              label={t.label}
              count={t.count}
              activeCls={t.activeCls}
            />
          ))}
        </div>

        <div className="flex items-center justify-between px-0.5">
          <p className={`text-[10px] font-semibold ${descMap[tab].cls}`}>{descMap[tab].text}</p>
          <button
            onClick={loadAll}
            disabled={spinning}
            title="Atualizar"
            className="p-1 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={spinning ? 'animate-spin' : ''} />
          </button>
        </div>

        <input
          type="text"
          placeholder="Buscar por título, empresa..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-300"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading ? <Skeleton /> :
         !items.length ? <EmptyState emoji={empty} text={emptyTx} /> :
         <div className="space-y-2">
           {items.map(item => (
             <BitrixCard
               key={item.id}
               item={item}
               selected={selectedBitrixId === item.id}
               accent={accent as 'blue' | 'purple'}
               onClick={() => onSelect(item, tab)}
             />
           ))}
         </div>
        }
      </div>
    </aside>
  )
}
