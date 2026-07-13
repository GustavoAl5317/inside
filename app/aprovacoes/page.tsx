'use client'

import type React from 'react'
import { useState, useEffect, useMemo } from 'react'
import {
  getPendingProcessesAction,
  getCompletedProcessesAction,
  checkPendingApprovalsAction,
  sendApprovedProcessToOmieAction,
  deleteProcessAction,
  moveDealToFinancialApprovalAction,
} from '@/lib/actions'
import { ProcessHistoryEntry } from '@/lib/process-history-service'
import { useCurrentUser } from '@/components/current-user-provider'
import { toast } from 'sonner'
import OmieLogsModal from '@/components/omie-logs-modal'
import {
  Loader2, RefreshCw, Send, Eye, Clock, CheckCircle2,
  XCircle, AlertCircle, Trash2, ArrowRight, ClipboardCheck,
} from 'lucide-react'

// ── Configuração de status ─────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; dot: string; badge: string }> = {
  pending:  { label: 'Pendente',  dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 ring-amber-200'     },
  approved: { label: 'Aprovado',  dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  sent:     { label: 'Enviado',   dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 ring-blue-200'         },
  failed:   { label: 'Falhou',    dot: 'bg-red-400',     badge: 'bg-red-50 text-red-700 ring-red-200'            },
}

function fmtDateTime(s?: string) {
  if (!s) return ''
  try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

// ── Card do processo na sidebar ────────────────────────────────────────────────
function ProcessCard({
  process, selected, onClick,
}: { process: ProcessHistoryEntry; selected: boolean; onClick: () => void }) {
  const cfg = STATUS_CFG[process.status] ?? STATUS_CFG.pending
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left rounded-xl border p-3 transition-all duration-150
        ${selected
          ? 'border-violet-300 bg-violet-50 shadow-sm ring-1 ring-violet-200'
          : 'border-gray-200 bg-white hover:border-violet-200 hover:bg-violet-50/40 hover:shadow-sm'}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className={`text-[13px] font-semibold leading-tight font-mono ${selected ? 'text-violet-900' : 'text-gray-800'}`}>
          #{process.transaction_id}
        </p>
        <span className={`shrink-0 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ring-1 ${cfg.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>
      {process.bitrix_deal_id && (
        <p className={`text-[11px] font-medium truncate mb-1 ${selected ? 'text-violet-600' : 'text-gray-500'}`}>
          Bitrix {process.bitrix_deal_id}
        </p>
      )}
      {process.current_stage_name && (
        <p className="text-[10px] text-gray-400 truncate mb-1">{process.current_stage_name}</p>
      )}
      <p className="text-[10px] text-gray-400">{fmtDateTime(process.created_at)}</p>
    </button>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-16 bg-gradient-to-r from-gray-100 to-gray-50 rounded-xl animate-pulse" />
      ))}
    </div>
  )
}

// ── Painel de detalhe ─────────────────────────────────────────────────────────
function ProcessDetail({
  process,
  sending,
  moving,
  readonly,
  onSendToOmie,
  onMove,
  onDelete,
  onViewOmieLogs,
}: {
  process: ProcessHistoryEntry
  sending: boolean
  moving: boolean
  readonly: boolean
  onSendToOmie: () => void
  onMove: () => void
  onDelete: () => void
  onViewOmieLogs: () => void
}) {
  const cfg = STATUS_CFG[process.status] ?? STATUS_CFG.pending

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

      {/* Header */}
      <div className="bg-gradient-to-r from-violet-50 to-purple-50 px-6 py-4 border-b border-violet-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ${cfg.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
              <span className="text-[11px] text-violet-400 font-medium">
                Atualizado {fmtDateTime(process.updated_at)}
              </span>
              {readonly && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 ring-1 ring-gray-200">
                  Somente leitura
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-900 font-mono">
              Transação #{process.transaction_id}
            </h2>
            {process.bitrix_deal_id && (
              <p className="text-sm text-violet-600 mt-0.5">Bitrix Deal: {process.bitrix_deal_id}</p>
            )}
          </div>

          {/* Ações — ocultas para Financeiro (readonly) */}
          {!readonly && (
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
              {process.status === 'approved' && (
                <button
                  onClick={onSendToOmie}
                  disabled={sending}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
                >
                  {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Enviar ao Omie
                </button>
              )}
              {process.status === 'sent' && process.bitrix_deal_id && (
                <button
                  onClick={onMove}
                  disabled={moving}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {moving ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
                  Mover no Bitrix
                </button>
              )}
              {process.status === 'sent' && (
                <button
                  onClick={onViewOmieLogs}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                >
                  <Eye size={12} />
                  Ver Logs Omie
                </button>
              )}
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
              >
                <Trash2 size={12} />
                Excluir
              </button>
            </div>
          )}

          {/* Para Financeiro: apenas botão de ver logs se enviado */}
          {readonly && process.status === 'sent' && (
            <button
              onClick={onViewOmieLogs}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors flex-shrink-0"
            >
              <Eye size={12} />
              Ver Logs Omie
            </button>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      <div className="p-6 space-y-5">

        {/* Grid de info */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Criado em',      value: fmtDateTime(process.created_at) },
            { label: 'Última atualização', value: fmtDateTime(process.updated_at) },
            { label: 'Etapa atual',    value: process.current_stage_name || process.current_stage_id || '—' },
            { label: 'Bitrix Deal ID', value: process.bitrix_deal_id || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
              <p className="text-[10px] text-gray-400 font-medium mb-0.5">{label}</p>
              <p className="text-sm font-semibold text-gray-800 truncate">{value}</p>
            </div>
          ))}
        </div>

        {/* Erro */}
        {process.error_message && (
          <div className="flex gap-3 p-4 rounded-xl border border-red-200 bg-red-50">
            <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-red-700 mb-1">Mensagem de erro</p>
              <p className="text-xs text-red-600">{process.error_message}</p>
            </div>
          </div>
        )}

        {/* Resposta Bitrix */}
        {process.approval_check_result && (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">Resposta Bitrix24</p>
            <pre className="text-[11px] p-3 bg-gray-50 border border-gray-200 rounded-xl overflow-x-auto text-gray-700 leading-relaxed">
              {typeof process.approval_check_result === 'string'
                ? process.approval_check_result
                : JSON.stringify(process.approval_check_result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function ProcessApprovalPage() {
  const { user } = useCurrentUser()
  const isReadonly = user?.role === 'financeiro'

  const [pendingProcesses, setPendingProcesses]   = useState<ProcessHistoryEntry[]>([])
  const [completedProcesses, setCompletedProcesses] = useState<ProcessHistoryEntry[]>([])
  const [loading, setLoading]                     = useState(true)
  const [spinning, setSpinning]                   = useState(false)
  const [checkingApprovals, setCheckingApprovals] = useState(false)
  const [selectedProcess, setSelectedProcess]     = useState<ProcessHistoryEntry | null>(null)
  const [sendingToOmie, setSendingToOmie]         = useState<number | null>(null)
  const [movingDeal, setMovingDeal]               = useState<number | null>(null)
  const [tab, setTab]                             = useState<'active' | 'done'>('active')
  const [search, setSearch]                       = useState('')
  const [omieLogsOpen, setOmieLogsOpen]           = useState(false)
  const [omieTransaction, setOmieTransaction]     = useState<number | null>(null)
  const [omieRunId, setOmieRunId]                 = useState<string>('')
  const [message, setMessage]                     = useState('')

  const loadPending = async () => {
    const r = await getPendingProcessesAction()
    if (r.success) setPendingProcesses(r.processes || [])
  }

  const loadCompleted = async () => {
    const r = await getCompletedProcessesAction(50)
    if (r.success) setCompletedProcesses((r.processes || []).filter(p => p.status === 'sent' || p.status === 'failed'))
  }

  const loadAll = async () => {
    setSpinning(true)
    setLoading(true)
    try { await Promise.all([loadPending(), loadCompleted()]) }
    finally { setLoading(false); setSpinning(false) }
  }

  useEffect(() => { loadAll() }, [])

  const handleRefreshApprovals = async () => {
    setCheckingApprovals(true)
    try {
      const r = await checkPendingApprovalsAction()
      if (r.success) {
        const approved = 'approved' in r ? r.approved : 0
        const checked  = 'checked'  in r ? r.checked  : 0
        setMessage(`${approved} de ${checked} processos aprovados`)
        toast.success('Aprovações verificadas!')
        await loadAll()
      } else {
        toast.error(r.error || 'Erro ao verificar aprovações')
      }
    } finally { setCheckingApprovals(false) }
  }

  const handleSendToOmie = async (transactionId: number) => {
    const runId = crypto.randomUUID()
    setOmieRunId(runId)
    setOmieTransaction(transactionId)
    setOmieLogsOpen(true)
    setSendingToOmie(transactionId)
    try {
      const r = await sendApprovedProcessToOmieAction(transactionId, { runId })
      if (r.success) { toast.success('Enviado ao Omie!'); await loadAll() }
      else toast.error(r.error || 'Erro ao enviar ao Omie')
    } finally { setSendingToOmie(null) }
  }

  const handleMove = async (transactionId: number, bitrixDealId: string) => {
    setMovingDeal(transactionId)
    try {
      const r = await moveDealToFinancialApprovalAction(bitrixDealId)
      if (r.success) { toast.success('Deal movido no Bitrix!'); await loadAll() }
      else toast.error(r.message || 'Erro ao mover deal')
    } finally { setMovingDeal(null) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Excluir este processo?')) return
    const r = await deleteProcessAction(id)
    if (r.success) {
      toast.success('Processo excluído')
      if (selectedProcess?.id === id) setSelectedProcess(null)
      await loadAll()
    } else toast.error(r.error || 'Erro ao excluir')
  }

  const activeList = useMemo(() => {
    const q = search.toLowerCase()
    return pendingProcesses.filter(p =>
      !q ||
      String(p.transaction_id).includes(q) ||
      (p.bitrix_deal_id ?? '').toLowerCase().includes(q) ||
      (p.current_stage_name ?? '').toLowerCase().includes(q)
    )
  }, [pendingProcesses, search])

  const doneList = useMemo(() => {
    const q = search.toLowerCase()
    return completedProcesses.filter(p =>
      !q ||
      String(p.transaction_id).includes(q) ||
      (p.bitrix_deal_id ?? '').toLowerCase().includes(q)
    )
  }, [completedProcesses, search])

  const displayList = tab === 'active' ? activeList : doneList

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-80 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white h-full overflow-hidden">

        {/* Header sidebar */}
        <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={15} className="text-violet-500" />
              <span className="text-sm font-semibold text-gray-800">Aprovações</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleRefreshApprovals}
                disabled={checkingApprovals}
                title="Verificar aprovações no Bitrix"
                className="p-1.5 rounded-lg text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-colors disabled:opacity-40 flex items-center gap-1"
              >
                {checkingApprovals ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                Verificar
              </button>
              <button
                onClick={loadAll}
                disabled={spinning}
                title="Atualizar"
                className="p-1 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={12} className={spinning ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5">
            {([
              { id: 'active', label: 'Em Andamento', count: pendingProcesses.length,   cls: 'bg-amber-500 text-white'  },
              { id: 'done',   label: 'Concluídos',   count: completedProcesses.length, cls: 'bg-blue-500 text-white'   },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                  tab === t.id ? `${t.cls} shadow-sm` : 'text-gray-500 hover:text-gray-800 hover:bg-white/80'
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                    tab === t.id ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-500'
                  }`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Busca */}
          <input
            type="text"
            placeholder="Buscar por transação, Bitrix..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-violet-300 focus:border-violet-300"
          />

          {message && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg">
              <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
              <p className="text-[10px] text-emerald-700 font-medium">{message}</p>
            </div>
          )}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading ? <Skeleton /> :
           displayList.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-44 text-center select-none">
               <span className="text-4xl mb-3 opacity-60">{tab === 'active' ? '⏳' : '✅'}</span>
               <p className="text-xs text-gray-400 font-medium">
                 {search ? 'Nenhum resultado' : tab === 'active' ? 'Nenhum processo em andamento' : 'Nenhum processo concluído'}
               </p>
             </div>
           ) : (
             <div className="space-y-2">
               {displayList.map(p => (
                 <ProcessCard
                   key={p.id}
                   process={p}
                   selected={selectedProcess?.id === p.id}
                   onClick={() => setSelectedProcess(p)}
                 />
               ))}
             </div>
           )}
        </div>
      </aside>

      {/* ── Painel de detalhe ── */}
      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="max-w-3xl mx-auto">
          {!selectedProcess ? (
            <div className="flex flex-col items-center justify-center h-64 text-center text-gray-400 select-none">
              <AlertCircle size={40} className="mb-4 text-gray-300" />
              <p className="text-base font-medium text-gray-500">Selecione um processo</p>
              <p className="text-sm mt-1">
                {isReadonly
                  ? 'Visualize os detalhes dos processos'
                  : 'Veja detalhes, envie ao Omie ou mova o deal no Bitrix'}
              </p>
            </div>
          ) : (
            <ProcessDetail
              process={selectedProcess}
              sending={sendingToOmie === selectedProcess.transaction_id}
              moving={movingDeal === selectedProcess.transaction_id}
              readonly={isReadonly}
              onSendToOmie={() => handleSendToOmie(selectedProcess.transaction_id)}
              onMove={() => handleMove(selectedProcess.transaction_id, selectedProcess.bitrix_deal_id!)}
              onDelete={() => handleDelete(selectedProcess.id)}
              onViewOmieLogs={() => {
                setOmieTransaction(selectedProcess.transaction_id)
                setOmieLogsOpen(true)
              }}
            />
          )}
        </div>
      </main>

      {/* Modal logs Omie */}
      <OmieLogsModal
        open={omieLogsOpen}
        onOpenChange={setOmieLogsOpen}
        transactionId={omieTransaction || 0}
        runId={omieRunId}
        onComplete={() => setTimeout(() => { setOmieLogsOpen(false); setOmieTransaction(null) }, 3000)}
      />
    </div>
  )
}
