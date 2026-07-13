'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { getDealsHistoryAction } from '@/lib/actions'
import { MultiStepForm } from './multi-step-form'
import { OmiePartialUpdateTab, type OmiePedidoPrefill } from './form-tabs/omie-partial-update-tab'
import type { HistoryDeal } from './omie-stage-sidebar'
import {
  RefreshCw, CheckCircle2, XCircle, Building2, Package,
  Pencil, Send, X, ShoppingCart, TrendingUp, Wrench,
  FileEdit, Hash,
} from 'lucide-react'
import { Loader2 } from 'lucide-react'

type AtualizacaoView = 'deal' | 'pedido-omie'

const STATUS_CFG: Record<string, { label: string; dot: string; badge: string; icon: typeof CheckCircle2 }> = {
  sent:    { label: 'Enviado', dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2 },
  failed:  { label: 'Falhou',  dot: 'bg-red-400',     badge: 'bg-red-50 text-red-700 ring-red-200',             icon: XCircle      },
}

function fmtDateTime(s?: string) {
  if (!s) return ''
  try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

// ── Card da sidebar ────────────────────────────────────────────────────────────
function DealCard({ deal, selected, onClick }: { deal: HistoryDeal; selected: boolean; onClick: () => void }) {
  const cfg = STATUS_CFG[deal.status] ?? STATUS_CFG.sent

  const omieNums = (() => {
    const r = deal.omieResponse?.resumo
    if (!r) return []
    return [
      ...(r.oc ?? []).map(o => ({ label: 'OC', num: o.numero, cls: 'bg-blue-100 text-blue-700' })),
      ...(r.ov ?? []).map(o => ({ label: 'OV', num: o.numero, cls: 'bg-violet-100 text-violet-700' })),
      ...(r.os ?? []).map(o => ({ label: 'OS', num: o.numero, cls: 'bg-amber-100 text-amber-700' })),
    ]
  })()

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left rounded-xl border p-3 transition-all duration-150
        ${selected
          ? 'border-emerald-300 bg-emerald-50 shadow-sm ring-1 ring-emerald-200'
          : 'border-gray-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40 hover:shadow-sm'}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className={`text-[13px] font-semibold leading-tight ${selected ? 'text-emerald-900' : 'text-gray-800'}`}>
          {deal.proposal ? `Proposta ${deal.proposal}` : deal.businessName ?? `Deal #${deal.id}`}
        </p>
        <span className={`shrink-0 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ring-1 ${cfg.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {deal.proposal && deal.businessName && (
        <p className={`text-[11px] font-medium truncate mb-1 ${selected ? 'text-emerald-700' : 'text-gray-600'}`}>
          {deal.businessName}
        </p>
      )}

      <div className="space-y-0.5 mb-1.5">
        {deal.supplierName && (
          <div className="flex items-center gap-1 text-[10px] text-gray-400">
            <Package size={9} className="shrink-0" /><span className="truncate">{deal.supplierName}</span>
          </div>
        )}
        {deal.customerName && (
          <div className="flex items-center gap-1 text-[10px] text-gray-400">
            <Building2 size={9} className="shrink-0" /><span className="truncate">{deal.customerName}</span>
          </div>
        )}
      </div>

      {omieNums.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {omieNums.map((t, i) => (
            <span key={i} className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded ${t.cls}`}>
              {t.label} {t.num}
            </span>
          ))}
        </div>
      )}

      <p className="text-[10px] text-gray-400">{fmtDateTime(deal.updatedAt)}</p>
    </button>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-20 bg-gradient-to-r from-gray-100 to-gray-50 rounded-xl animate-pulse" />
      ))}
    </div>
  )
}

// ── Layout principal ───────────────────────────────────────────────────────────
export function AtualizacaoLayout() {
  const [deals, setDeals]       = useState<HistoryDeal[]>([])
  const [loading, setLoading]   = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [selected, setSelected] = useState<HistoryDeal | null>(null)
  const [search, setSearch]     = useState('')
  const [view, setView]         = useState<AtualizacaoView>('pedido-omie')
  const [pedidoPrefill, setPedidoPrefill] = useState<OmiePedidoPrefill | null>(null)

  const openPedidoEditor = useCallback((prefill: OmiePedidoPrefill) => {
    setPedidoPrefill(prefill)
    setView('pedido-omie')
  }, [])

  const loadDeals = useCallback(async () => {
    setSpinning(true)
    setLoading(true)
    try {
      const res = await getDealsHistoryAction(200)
      if (res.success) {
        const updatable = (res.deals as HistoryDeal[]).filter(
          d => d.status === 'sent' || d.status === 'failed'
        )
        setDeals(updatable)
      }
    } finally {
      setLoading(false)
      setSpinning(false)
    }
  }, [])

  useEffect(() => { loadDeals() }, [])

  const filtered = deals.filter(d => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      d.businessName?.toLowerCase().includes(q) ||
      d.proposal?.toLowerCase().includes(q) ||
      d.supplierName?.toLowerCase().includes(q) ||
      d.customerName?.toLowerCase().includes(q)
    )
  })

  const existingDeal = useMemo(
    () => (selected ? { id: selected.id, payload: selected.payload } : null),
    [selected?.id, selected?.payload],
  )

  const dealBranches = useMemo((): ('barueri' | 'es')[] => {
    const p = selected?.payload
    const fromForm = p?.interatellBranches as ('barueri' | 'es')[] | undefined
    if (fromForm?.length) return fromForm
    return ['barueri', 'es']
  }, [selected?.payload])

  const resumo = selected?.omieResponse?.resumo

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">

      {/* Sidebar */}
      <aside className="w-80 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white h-full overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
          <div className="flex bg-gray-100 rounded-2xl p-1 gap-0.5">
            <button
              type="button"
              onClick={() => setView('pedido-omie')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all ${
                view === 'pedido-omie'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-white/80'
              }`}
            >
              <Hash size={13} />
              Pedido Omie
            </button>
            <button
              type="button"
              onClick={() => setView('deal')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all ${
                view === 'deal'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-white/80'
              }`}
            >
              <FileEdit size={13} />
              Deal completo
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pencil size={15} className="text-emerald-500" />
              <span className="text-sm font-semibold text-gray-800">Atualização</span>
              {deals.length > 0 && view === 'deal' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {deals.length}
                </span>
              )}
            </div>
            <button
              onClick={loadDeals}
              disabled={spinning}
              title="Atualizar"
              className="p-1 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40"
            >
              <RefreshCw size={13} className={spinning ? 'animate-spin' : ''} />
            </button>
          </div>

          {view === 'pedido-omie' ? (
            <p className="text-[10px] text-teal-600 font-medium px-0.5">
              Busque OC, OV ou OS pelo número no Omie e atualize só o que alterar
            </p>
          ) : (
            <>
              <input
                type="text"
                placeholder="Buscar por empresa, proposta..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-300 focus:border-emerald-300"
              />
              <p className="text-[10px] text-gray-400 px-0.5">Deals enviados ou com falha — reenvio completo ao Omie</p>
            </>
          )}
        </div>

        {view === 'deal' && (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? <Skeleton /> :
           filtered.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-44 text-center select-none">
               <span className="text-4xl mb-3 opacity-60">✅</span>
               <p className="text-xs text-gray-400 font-medium">
                 {search ? 'Nenhum resultado' : 'Nenhum deal para atualizar'}
               </p>
             </div>
           ) : (
             <div className="space-y-2">
               {filtered.map(deal => (
                 <DealCard
                   key={deal.id}
                   deal={deal}
                   selected={selected?.id === deal.id}
                   onClick={() => setSelected(deal)}
                 />
               ))}
             </div>
           )}
        </div>
        )}

        {view === 'pedido-omie' && (
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-0.5">
              Vincular a um deal (opcional)
            </p>
            {loading ? <Skeleton /> : filtered.length === 0 ? (
              <p className="text-[11px] text-gray-400 px-1">Nenhum deal recente — você pode buscar pedidos mesmo assim.</p>
            ) : (
              filtered.slice(0, 8).map(deal => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  selected={selected?.id === deal.id}
                  onClick={() => setSelected(deal)}
                />
              ))
            )}
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="max-w-5xl mx-auto">
          {view === 'pedido-omie' ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-teal-50 to-cyan-50 px-6 py-4 border-b border-teal-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 ring-1 ring-teal-200">
                        <Hash size={10} />
                        Pedido Omie
                      </span>
                      {selected && (
                        <span className="text-[11px] text-teal-500 font-medium">Deal #{selected.id} (logs)</span>
                      )}
                    </div>
                    <h2 className="text-base font-bold text-gray-900">Atualização parcial no Omie</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Informe o tipo e o número do pedido, edite os campos e envie só o que mudou.
                    </p>
                  </div>
                  {selected && (
                    <button
                      onClick={() => setSelected(null)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
                      title="Desvincular deal"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="p-6">
                <OmiePartialUpdateTab
                  dealId={selected?.id}
                  branches={dealBranches}
                  prefill={pedidoPrefill}
                />
              </div>
            </div>
          ) : !selected ? (
            <div className="flex flex-col items-center justify-center h-64 text-center text-gray-400 select-none">
              <FileEdit size={40} className="mb-4 text-gray-300" />
              <p className="text-base font-medium text-gray-500">Selecione um deal na lista</p>
              <p className="text-sm mt-1">Para reenviar o deal completo ao Omie</p>
              <button
                type="button"
                onClick={() => setView('pedido-omie')}
                className="mt-4 text-sm text-teal-600 hover:text-teal-700 font-medium underline underline-offset-2"
              >
                Ou atualize só um pedido pelo número → Pedido Omie
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

              {/* Header */}
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-4 border-b border-emerald-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
                        <Pencil size={10} />
                        Atualização
                      </span>
                      <span className="text-[11px] text-emerald-400 font-medium">Deal #{selected.id}</span>
                    </div>
                    <h2 className="text-base font-bold text-gray-900">
                      {selected.proposal ? `Proposta ${selected.proposal}` : selected.businessName ?? `Deal #${selected.id}`}
                    </h2>
                    {selected.proposal && selected.businessName && (
                      <p className="text-sm text-gray-500 mt-0.5">{selected.businessName}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selected.customerName && (
                        <span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg font-medium">
                          <Building2 size={10} />{selected.customerName}
                        </span>
                      )}
                      {selected.supplierName && (
                        <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-lg font-medium">
                          <Package size={10} />{selected.supplierName}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Pedidos anteriores do Omie */}
              {resumo && (resumo.oc?.length || resumo.ov?.length || resumo.os?.length) ? (
                <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Pedidos Omie anteriores</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ...(resumo.oc ?? []).map(o => ({ kind: 'OC' as const, label: 'OC', num: o.numero, Icon: ShoppingCart, cls: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' })),
                      ...(resumo.ov ?? []).map(o => ({ kind: 'OV' as const, label: 'OV', num: o.numero, Icon: TrendingUp,   cls: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100' })),
                      ...(resumo.os ?? []).map(o => ({ kind: 'OS' as const, label: 'OS', num: o.numero, Icon: Wrench,       cls: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' })),
                    ].map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        title={`Editar ${t.label} ${t.num} (só este pedido)`}
                        onClick={() => openPedidoEditor({ orderKind: t.kind, numero: t.num })}
                        className={`flex items-center gap-1.5 text-xs font-bold font-mono px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${t.cls}`}
                      >
                        <t.Icon size={11} />
                        {t.label} {t.num}
                        <Pencil size={10} className="opacity-60" />
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">Clique em um pedido para trocar fornecedor/cliente só naquele OC/OV/OS.</p>
                </div>
              ) : null}

              {/* Banner modo */}
              <div className="px-6 py-2 border-b border-gray-100 text-xs flex items-center gap-2 bg-emerald-50/60 text-emerald-700">
                <Send size={12} className="shrink-0" />
                Edite o deal nas abas abaixo e reenvie ao Omie para atualizar todos os pedidos vinculados.
              </div>

              {/* Form */}
              <div className="p-6">
                <MultiStepForm
                  selectedItem={null}
                  cardDetails={null}
                  mode="update"
                  existingDeal={existingDeal}
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
