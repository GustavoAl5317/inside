'use client'

import { useState, useEffect, useCallback } from 'react'
import { getDealsHistoryAction, listUpdateRequestsAction } from '@/lib/actions'
import { generateDealPDF } from '@/lib/generate-pdf'
import type { HistoryDeal } from './omie-stage-sidebar'
import {
  RefreshCw, CheckCircle2, XCircle, Clock, FileText,
  Building2, Package, History, Download, ShoppingCart,
  TrendingUp, Wrench, X, User, ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'

const STATUS_CFG: Record<string, { label: string; dot: string; badge: string; icon: typeof CheckCircle2 }> = {
  pending:  { label: 'Rascunho', dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',          icon: FileText     },
  approved: { label: 'Aprovado', dot: 'bg-yellow-400',  badge: 'bg-yellow-50 text-yellow-700 ring-yellow-200',    icon: Clock        },
  sent:     { label: 'Enviado',  dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2 },
  failed:   { label: 'Falhou',   dot: 'bg-red-400',     badge: 'bg-red-50 text-red-700 ring-red-200',             icon: XCircle      },
  draft:    { label: 'Rascunho', dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',          icon: FileText     },
}

function fmtDateTime(s?: string) {
  if (!s) return ''
  try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

// ── Card da sidebar ────────────────────────────────────────────────────────────
function HistoryCard({ deal, selected, onClick }: { deal: HistoryDeal; selected: boolean; onClick: () => void }) {
  const cfg = STATUS_CFG[deal.status] ?? STATUS_CFG.pending

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
          ? 'border-amber-300 bg-amber-50 shadow-sm ring-1 ring-amber-200'
          : 'border-gray-200 bg-white hover:border-amber-200 hover:bg-amber-50/40 hover:shadow-sm'}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className={`text-[13px] font-semibold leading-tight ${selected ? 'text-amber-900' : 'text-gray-800'}`}>
          {deal.proposal ? `Proposta ${deal.proposal}` : deal.businessName ?? `Deal #${deal.id}`}
        </p>
        <span className={`shrink-0 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ring-1 ${cfg.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {deal.proposal && deal.businessName && (
        <p className={`text-[11px] font-medium truncate mb-1 ${selected ? 'text-amber-700' : 'text-gray-600'}`}>
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
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-20 bg-gradient-to-r from-gray-100 to-gray-50 rounded-xl animate-pulse" />
      ))}
    </div>
  )
}

// ── Painel de detalhe ──────────────────────────────────────────────────────────
function DealDetail({ deal, onClose }: { deal: HistoryDeal; onClose: () => void }) {
  const [downloading, setDownloading] = useState(false)
  const cfg = STATUS_CFG[deal.status] ?? STATUS_CFG.pending
  const resumo = deal.omieResponse?.resumo

  const handlePDF = async () => {
    setDownloading(true)
    try {
      await generateDealPDF(deal.payload)
      toast.success('PDF baixado com sucesso!')
    } catch {
      toast.error('Erro ao gerar PDF')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

      {/* Header */}
      <div className="bg-gradient-to-r from-amber-50 to-yellow-50 px-6 py-4 border-b border-amber-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ${cfg.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
              <span className="text-[11px] text-amber-400 font-medium">Deal #{deal.id}</span>
              <span className="text-[10px] text-gray-400">{fmtDateTime(deal.updatedAt)}</span>
            </div>
            <h2 className="text-base font-bold text-gray-900">
              {deal.proposal ? `Proposta ${deal.proposal}` : deal.businessName ?? `Deal #${deal.id}`}
            </h2>
            {deal.businessName && deal.proposal && (
              <p className="text-sm text-gray-500 mt-0.5">{deal.businessName}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handlePDF}
              disabled={downloading}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              <Download size={12} />
              {downloading ? 'Gerando...' : 'Baixar PDF'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* Pedidos Omie */}
        {resumo && (resumo.oc?.length || resumo.ov?.length || resumo.os?.length) ? (
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              Pedidos gerados no Omie
            </h3>
            <div className="grid gap-2">
              {resumo.oc?.map((oc, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-blue-100 bg-blue-50">
                  <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
                    <ShoppingCart size={14} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">Ordem de Compra</p>
                    <p className="text-sm font-bold text-blue-900 font-mono">{oc.numero}</p>
                    {oc.fornecedor && <p className="text-[11px] text-blue-600 truncate">{oc.fornecedor}</p>}
                  </div>
                </div>
              ))}
              {resumo.ov?.map((ov, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-violet-100 bg-violet-50">
                  <div className="w-8 h-8 rounded-lg bg-violet-500 flex items-center justify-center flex-shrink-0">
                    <TrendingUp size={14} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wide">Ordem de Venda</p>
                    <p className="text-sm font-bold text-violet-900 font-mono">{ov.numero}</p>
                    {ov.cliente && <p className="text-[11px] text-violet-600 truncate">{ov.cliente}</p>}
                  </div>
                </div>
              ))}
              {resumo.os?.map((os, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-amber-100 bg-amber-50">
                  <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
                    <Wrench size={14} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">Ordem de Serviço · {os.nat}</p>
                    <p className="text-sm font-bold text-amber-900 font-mono">{os.numero}</p>
                    {os.cliente && <p className="text-[11px] text-amber-600 truncate">{os.cliente}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : deal.status === 'sent' ? (
          <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-center">
            <p className="text-xs text-gray-400">Números do Omie não disponíveis para este registro</p>
          </div>
        ) : null}

        {/* Detalhes da proposta */}
        {(deal.payload?.business?.purchaseOrderDate ||
          deal.payload?.business?.deliveryDeadline ||
          deal.payload?.business?.purchasePaymentCondition ||
          deal.payload?.business?.salePaymentCondition) && (
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Detalhes da proposta</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Data OC',       value: deal.payload?.business?.purchaseOrderDate },
                { label: 'Prazo entrega', value: deal.payload?.business?.deliveryDeadline },
                { label: 'Cond. compra',  value: deal.payload?.business?.purchasePaymentCondition },
                { label: 'Cond. venda',   value: deal.payload?.business?.salePaymentCondition },
              ].filter(f => f.value).map(({ label, value }) => (
                <div key={label} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-medium mb-0.5">{label}</p>
                  <p className="text-sm font-semibold text-gray-800 truncate">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fornecedores */}
        {deal.payload?.supplierGroups?.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Fornecedores</h3>
            <div className="space-y-2">
              {deal.payload.supplierGroups.map((sg: any, i: number) => (
                <div key={i} className="p-3 rounded-xl border border-gray-200 bg-white">
                  <p className="text-xs font-semibold text-gray-700 mb-2">
                    {sg.supplier?.name || `Fornecedor ${i + 1}`}
                  </p>
                  <div className="space-y-1">
                    {(sg.products || []).slice(0, 4).map((p: any, j: number) => (
                      <div key={j} className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-500 font-mono">{p.partnumber}</span>
                        <span className="text-gray-600 font-medium">Qtd {p.quantity}</span>
                      </div>
                    ))}
                    {(sg.products || []).length > 4 && (
                      <p className="text-[10px] text-gray-400">+{sg.products.length - 4} produtos</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clientes */}
        {deal.payload?.customers?.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Clientes</h3>
            <div className="space-y-2">
              {deal.payload.customers.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-3 rounded-xl border border-gray-200 bg-white">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <Building2 size={13} className="text-gray-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-700 truncate">{c.customer?.name || `Cliente ${i + 1}`}</p>
                    {c.customer?.cnpj && <p className="text-[10px] text-gray-400">{c.customer.cnpj}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
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

// ── Histórico de aprovações ────────────────────────────────────────────────────
interface ApprovalRecord {
  id: number
  deal_id: number
  status: 'pending' | 'approved' | 'rejected'
  reason?: string | null
  review_note?: string | null
  requested_by_name?: string | null
  reviewed_by_name?: string | null
  created_at?: string
  reviewed_at?: string
  business_name?: string | null
  proposal?: string | null
  customer_name?: string | null
}

function ApprovalHistory() {
  const [records, setRecords] = useState<ApprovalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await listUpdateRequestsAction(undefined)
      if (r.success) setRecords(r.requests as ApprovalRecord[])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = records.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.proposal?.toLowerCase().includes(q) ||
      r.business_name?.toLowerCase().includes(q) ||
      r.customer_name?.toLowerCase().includes(q) ||
      r.requested_by_name?.toLowerCase().includes(q)
    )
  })

  const statusCfg = {
    pending:  { label: 'Pendente',  cls: 'bg-amber-50 text-amber-700 ring-amber-200',   dot: 'bg-amber-400'   },
    approved: { label: 'Aprovada',  cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-400' },
    rejected: { label: 'Recusada', cls: 'bg-red-50 text-red-700 ring-red-200',          dot: 'bg-red-400'     },
  }

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-80 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white h-full overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-violet-500" />
              <span className="text-sm font-semibold text-gray-800">Aprovações</span>
              {records.length > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">{records.length}</span>
              )}
            </div>
            <button onClick={load} className="p-1 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <input
            type="text"
            placeholder="Buscar por proposta, cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 text-center select-none">
              <ShieldCheck size={32} className="mb-3 text-gray-200" />
              <p className="text-xs text-gray-400 font-medium">{search ? 'Nenhum resultado' : 'Nenhuma solicitação'}</p>
            </div>
          ) : filtered.map(rec => {
            const cfg = statusCfg[rec.status] ?? statusCfg.pending
            return (
              <div key={rec.id} className="bg-white border border-gray-200 rounded-xl p-3 text-left hover:border-violet-200 hover:bg-violet-50/30 transition-all">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-[13px] font-semibold text-gray-800 leading-tight truncate">
                    {rec.proposal ? `Proposta ${rec.proposal}` : rec.business_name ?? `Deal #${rec.deal_id}`}
                  </p>
                  <span className={`shrink-0 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ring-1 ${cfg.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                </div>
                {rec.customer_name && (
                  <p className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5">
                    <Building2 size={9} />{rec.customer_name}
                  </p>
                )}
                {rec.requested_by_name && (
                  <p className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5">
                    <User size={9} />Solicitado por {rec.requested_by_name}
                  </p>
                )}
                {rec.reviewed_by_name && (
                  <p className="flex items-center gap-1 text-[10px] text-gray-400">
                    <ShieldCheck size={9} />{rec.status === 'approved' ? 'Aprovado' : 'Recusado'} por {rec.reviewed_by_name}
                  </p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">{fmtRelative(rec.created_at)}</p>
              </div>
            )
          })}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex flex-col items-center justify-center h-64 text-center text-gray-400 select-none">
            <ShieldCheck size={40} className="mb-4 text-gray-300" />
            <p className="text-base font-medium text-gray-500">Histórico de aprovações</p>
            <p className="text-sm mt-1">Selecione um item na lista para ver detalhes</p>
          </div>
        </div>
      </main>
    </div>
  )
}

// ── Layout principal ───────────────────────────────────────────────────────────
export function HistoricoLayout() {
  const [view, setView]         = useState<'envios' | 'aprovacoes'>('envios')
  const PAGE = 40
  const [deals, setDeals]         = useState<HistoryDeal[]>([])
  const [loading, setLoading]     = useState(true)
  const [spinning, setSpinning]   = useState(false)
  const [loadingMore, setLoadMore] = useState(false)
  const [hasMore, setHasMore]     = useState(false)
  const [offset, setOffset]       = useState(0)
  const [selected, setSelected]   = useState<HistoryDeal | null>(null)
  const [search, setSearch]       = useState('')

  const loadDeals = useCallback(async (replace = true) => {
    if (replace) { setSpinning(true); setLoading(true) }
    else setLoadMore(true)
    try {
      const currentOffset = replace ? 0 : offset
      const res = await getDealsHistoryAction(PAGE, currentOffset)
      if (res.success) {
        setDeals(prev => replace ? (res.deals as HistoryDeal[]) : [...prev, ...(res.deals as HistoryDeal[])])
        setHasMore(res.hasMore)
        if (replace) setOffset(res.deals.length)
        else setOffset(o => o + res.deals.length)
      }
    } finally {
      setLoading(false)
      setSpinning(false)
      setLoadMore(false)
    }
  }, [offset])

  useEffect(() => { loadDeals(true) }, [])

  const filtered = deals.filter(d => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      d.businessName?.toLowerCase().includes(q) ||
      d.proposal?.toLowerCase().includes(q) ||
      d.supplierName?.toLowerCase().includes(q) ||
      d.customerName?.toLowerCase().includes(q) ||
      d.status?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">

      {/* Tab switch */}
      <div className="flex bg-white border-b border-gray-200 px-4 pt-2 gap-1 flex-shrink-0">
        <button
          onClick={() => setView('envios')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
            view === 'envios'
              ? 'border-amber-500 text-amber-700 bg-amber-50/60'
              : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          <ShoppingCart size={14} /> Envios ao Omie
        </button>
        <button
          onClick={() => setView('aprovacoes')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
            view === 'aprovacoes'
              ? 'border-violet-500 text-violet-700 bg-violet-50/60'
              : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          <ShieldCheck size={14} /> Aprovações
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === 'aprovacoes' ? <ApprovalHistory /> : (
          <div className="flex h-full overflow-hidden">

            {/* Sidebar envios */}
            <aside className="w-80 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white h-full overflow-hidden">
              <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History size={15} className="text-amber-500" />
                    <span className="text-sm font-semibold text-gray-800">Envios</span>
                    {deals.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {deals.length}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => loadDeals(true)}
                    disabled={spinning}
                    title="Atualizar"
                    className="p-1 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-40"
                  >
                    <RefreshCw size={13} className={spinning ? 'animate-spin' : ''} />
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Buscar por empresa, proposta..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-300 focus:border-amber-300"
                />
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-3">
                {loading ? <Skeleton /> :
                 filtered.length === 0 ? (
                   <div className="flex flex-col items-center justify-center h-44 text-center select-none">
                     <span className="text-4xl mb-3 opacity-60">🗂️</span>
                     <p className="text-xs text-gray-400 font-medium">
                       {search ? 'Nenhum resultado' : 'Nenhum registro no histórico'}
                     </p>
                   </div>
                 ) : (
                   <div className="space-y-2">
                     {filtered.map(deal => (
                       <HistoryCard
                         key={deal.id}
                         deal={deal}
                         selected={selected?.id === deal.id}
                         onClick={() => setSelected(deal)}
                       />
                     ))}
                     {!search && hasMore && (
                       <button
                         onClick={() => loadDeals(false)}
                         disabled={loadingMore}
                         className="w-full py-2 text-xs font-semibold text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg border border-dashed border-amber-200 transition-colors disabled:opacity-50"
                       >
                         {loadingMore ? 'Carregando...' : 'Carregar mais'}
                       </button>
                     )}
                   </div>
                 )}
              </div>
            </aside>

            {/* Main envios */}
            <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
              <div className="max-w-3xl mx-auto">
                {!selected ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center text-gray-400 select-none">
                    <History size={40} className="mb-4 text-gray-300" />
                    <p className="text-base font-medium text-gray-500">Selecione um registro</p>
                    <p className="text-sm mt-1">Visualize os pedidos gerados no Omie e baixe o PDF</p>
                  </div>
                ) : (
                  <DealDetail deal={selected} onClose={() => setSelected(null)} />
                )}
              </div>
            </main>
          </div>
        )}
      </div>
    </div>
  )
}
