'use client'

import { useCallback, useEffect, useState } from 'react'
import { listUpdateRequestsAction, reviewUpdateRequestAction } from '@/lib/actions'
import { useCurrentUser, canAccess } from '@/components/current-user-provider'
import { toast } from 'sonner'
import {
  Loader2, RefreshCw, CheckCircle2, XCircle, Clock, ShieldAlert,
  Building2, User, FileText, History, ChevronDown,
} from 'lucide-react'

interface UpdateRequest {
  id: number
  deal_id: number | null
  bitrix_deal_id?: string | null
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
  order_kind?: string | null
  order_numero?: string | null
  order_branch?: string | null
  parceiro_name?: string | null
}

type TabId = 'pending' | 'approved' | 'rejected' | 'all'

const TABS: { id: TabId; label: string; icon: typeof Clock; color: string }[] = [
  { id: 'pending',  label: 'Pendentes',  icon: Clock,        color: 'bg-amber-500'   },
  { id: 'approved', label: 'Aprovadas',  icon: CheckCircle2, color: 'bg-emerald-500' },
  { id: 'rejected', label: 'Recusadas',  icon: XCircle,      color: 'bg-red-500'     },
  { id: 'all',      label: 'Histórico',  icon: History,      color: 'bg-gray-500'    },
]

function fmtDateTime(s?: string) {
  if (!s) return ''
  try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

export default function SolicitacoesPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [tab, setTab] = useState<TabId>('pending')
  const [requests, setRequests] = useState<UpdateRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<number | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [celebratingId, setCelebratingId] = useState<number | null>(null)
  const [expandedReason, setExpandedReason] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const status = tab === 'all' ? undefined : tab
      const r = await listUpdateRequestsAction(status)
      if (r.success) setRequests(r.requests as UpdateRequest[])
      else toast.error(r.error || 'Erro ao carregar solicitações')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  const handleReview = async (id: number, decision: 'approved' | 'rejected') => {
    setActing(id)
    try {
      const r = await reviewUpdateRequestAction(id, decision, notes[id])
      if (r.success) {
        if (decision === 'approved') {
          setCelebratingId(id)
          toast.success('Solicitação aprovada! InsideSales será notificada.', { duration: 5000 })
          setTimeout(() => { setCelebratingId(null); load() }, 3000)
        } else {
          toast.error('Solicitação recusada.')
          await load()
        }
      } else {
        toast.error(r.error || 'Erro ao registrar decisão')
      }
    } finally {
      setActing(null)
    }
  }

  if (userLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }

  if (!canAccess('solicitacoes', user?.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-center px-4">
        <ShieldAlert className="w-12 h-12 text-amber-400 mb-4" />
        <h2 className="text-lg font-semibold text-gray-800">Acesso restrito</h2>
        <p className="text-sm text-gray-500 mt-1">Esta área é exclusiva do financeiro e administradores.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <style>{`
        @keyframes approvalCelebrate {
          0%   { transform: scale(1);    background: #059669; }
          30%  { transform: scale(1.03); background: #10b981; }
          60%  { transform: scale(0.98); }
          100% { transform: scale(1);    background: #059669; }
        }
        @keyframes checkPop {
          0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
          60%  { transform: scale(1.3) rotate(5deg);  opacity: 1; }
          100% { transform: scale(1) rotate(0deg);    opacity: 1; }
        }
        @keyframes floatUp {
          0%   { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-40px); }
        }
        .celebrating { animation: approvalCelebrate 0.6s ease-in-out; }
      `}</style>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Solicitações de atualização</h1>
          <p className="text-sm text-gray-500">Aprove ou recuse pedidos de atualização de deals já enviados ao Omie.</p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          title="Atualizar"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex bg-gray-100 rounded-xl p-1 gap-1 mb-5">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                tab === t.id ? `${t.color} text-white shadow-sm` : 'text-gray-500 hover:text-gray-800 hover:bg-white/80'
              }`}
            >
              <Icon size={13} />
              {t.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center text-gray-400">
          <FileText size={36} className="mb-3 text-gray-300" />
          <p className="text-sm">
            {tab === 'pending' ? 'Nenhuma solicitação pendente.'
             : tab === 'approved' ? 'Nenhuma solicitação aprovada.'
             : tab === 'rejected' ? 'Nenhuma solicitação recusada.'
             : 'Nenhuma solicitação encontrada.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => {
            const isCelebrating = celebratingId === req.id

            return (
              <div
                key={req.id}
                className={`bg-white rounded-xl border shadow-sm p-4 transition-all duration-300 ${
                  isCelebrating ? 'border-emerald-400 ring-2 ring-emerald-300' : 'border-gray-200'
                }`}
              >
                {/* Celebrating overlay */}
                {isCelebrating && (
                  <div className="flex flex-col items-center justify-center py-5 gap-3">
                    <div
                      className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg"
                      style={{ animation: 'checkPop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
                    >
                      <CheckCircle2 size={36} className="text-white" />
                    </div>
                    <div className="text-center">
                      <p className="text-base font-bold text-emerald-700">Aprovado com sucesso!</p>
                      <p className="text-sm text-emerald-600 mt-0.5">
                        A InsideSales será notificada automaticamente.
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {['✅', '🎉', '✅'].map((e, i) => (
                        <span key={i} className="text-xl" style={{ animation: `floatUp 1.2s ease-out ${i * 0.2}s forwards` }}>
                          {e}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {!isCelebrating && (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {/* Destaque: pedido Omie (por número) ou deal */}
                        <div className="mb-2">
                          <p className="font-bold text-gray-900 text-base">
                            {req.order_numero
                              ? `${req.order_kind ?? 'Pedido'} nº ${req.order_numero}`
                              : req.proposal ? `Proposta ${req.proposal}` : req.business_name ?? `Deal #${req.deal_id}`}
                          </p>
                          {req.order_numero
                            ? req.parceiro_name && <p className="text-sm text-gray-600 mt-0.5">{req.parceiro_name}</p>
                            : req.business_name && req.proposal && (
                              <p className="text-sm text-gray-600 mt-0.5">{req.business_name}</p>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                          {req.order_numero ? (
                            <span className="flex items-center gap-1">
                              <FileText size={11} /> {req.order_kind} nº {req.order_numero}
                              {req.order_branch ? ` · ${req.order_branch === 'es' ? 'Filial ES' : 'Barueri'}` : ''}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1"><FileText size={11} /> Deal #{req.deal_id}</span>
                          )}
                          {req.customer_name && <span className="flex items-center gap-1"><Building2 size={11} /> {req.customer_name}</span>}
                          {req.requested_by_name && <span className="flex items-center gap-1"><User size={11} /> {req.requested_by_name}</span>}
                          <span className="flex items-center gap-1"><Clock size={11} /> {fmtDateTime(req.created_at)}</span>
                        </div>
                      </div>

                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ${
                        req.status === 'approved' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : req.status === 'rejected' ? 'bg-red-50 text-red-700 ring-red-200'
                        : 'bg-amber-50 text-amber-700 ring-amber-200'
                      }`}>
                        {req.status === 'approved' ? 'Aprovada' : req.status === 'rejected' ? 'Recusada' : 'Pendente'}
                      </span>
                    </div>

                    {/* Motivo / contexto da solicitação */}
                    {req.reason && (
                      <div className="mt-2">
                        <button
                          onClick={() => setExpandedReason(expandedReason === req.id ? null : req.id)}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          <ChevronDown size={12} className={`transition-transform ${expandedReason === req.id ? 'rotate-180' : ''}`} />
                          {expandedReason === req.id ? 'Ocultar detalhes' : 'Ver detalhes do deal'}
                        </button>
                        {expandedReason === req.id && (
                          <div className="mt-1.5 text-xs text-gray-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 leading-relaxed">
                            {req.reason}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Nota de revisão */}
                    {req.review_note && (
                      <p className="text-xs text-gray-600 mt-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
                        <span className="font-medium">Nota do financeiro:</span> {req.review_note}
                        {req.reviewed_by_name && <span className="text-gray-400"> — {req.reviewed_by_name}, {fmtDateTime(req.reviewed_at)}</span>}
                      </p>
                    )}

                    {/* Ações para pendentes */}
                    {req.status === 'pending' && (
                      <div className="mt-3 space-y-2">
                        <input
                          value={notes[req.id] ?? ''}
                          onChange={e => setNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                          placeholder="Observação (opcional)"
                          className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-300"
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleReview(req.id, 'rejected')}
                            disabled={acting === req.id}
                            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                          >
                            <XCircle size={14} /> Recusar
                          </button>
                          <button
                            onClick={() => handleReview(req.id, 'approved')}
                            disabled={acting === req.id}
                            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {acting === req.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                            Aprovar
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
