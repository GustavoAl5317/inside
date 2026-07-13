'use client'

import { useState } from 'react'
import { useCurrentUser } from '@/components/current-user-provider'
import { cleanProcessDataAction } from '@/lib/auth-actions'
import { toast } from 'sonner'
import { ShieldAlert, Trash2, CheckCircle2, Loader2, ArrowLeft, AlertTriangle, Database } from 'lucide-react'
import Link from 'next/link'

export default function LimpezaPage() {
  const { user, loading } = useCurrentUser()
  const [confirm, setConfirm]     = useState('')
  const [running, setRunning]     = useState(false)
  const [result, setResult]       = useState<{ deleted: Record<string, number> } | null>(null)
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)

  const WORD = 'LIMPAR'
  const ready = confirm === WORD && !running

  const handleClean = async () => {
    if (!ready) return
    setRunning(true)
    setResult(null)
    setErrorMsg(null)
    try {
      const r = await cleanProcessDataAction()
      if (r.success) {
        setResult({ deleted: r.deleted })
        toast.success('Limpeza concluída com sucesso!')
        setConfirm('')
      } else {
        const msg = r.error || 'Erro ao executar limpeza'
        setErrorMsg(msg)
        toast.error(msg)
      }
    } catch (e: any) {
      const msg = e.message || 'Erro inesperado'
      setErrorMsg(msg)
      toast.error(msg)
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
        <ShieldAlert className="w-12 h-12 text-amber-400 mb-3" />
        <p className="text-base font-semibold text-gray-800">Acesso restrito</p>
        <p className="text-sm text-gray-500 mt-1">Apenas administradores podem acessar esta página.</p>
      </div>
    )
  }

  const tables = [
    { name: 'deals',          label: 'Deals / Processos',           desc: 'Formulários salvos (backlog, processamento, enviados)',    danger: true  },
    { name: 'update_requests',label: 'Solicitações de aprovação',   desc: 'Histórico de pedidos de aprovação do financeiro',         danger: true  },
    { name: 'logs',           label: 'Logs do sistema',             desc: 'Logs gerados durante os processos',                       danger: false },
    { name: 'transactions',   label: 'Transações (legado)',         desc: 'Modelo antigo de dados de transação',                    danger: false },
    { name: 'businesses',     label: 'Negócios (legado)',           desc: 'Dados de negócio do modelo antigo',                      danger: false },
    { name: 'webhook_logs',   label: 'Logs de webhook',             desc: 'Registros de chamadas de webhook',                       danger: false },
    { name: 'process_history',label: 'Histórico de processos',      desc: 'Histórico de status de processos (modelo legado)',        danger: false },
  ]

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/"
          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Database size={18} className="text-red-500" /> Limpeza de dados
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Remove histórico e processos salvos. Cadastros não são afetados.</p>
        </div>
      </div>

      {/* Aviso */}
      <div className="flex gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
        <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-semibold mb-1">Esta ação é irreversível.</p>
          <p>Os dados abaixo serão <strong>excluídos permanentemente</strong>. Cadastros de produtos, fornecedores, famílias, condições de pagamento e usuários <strong>não serão afetados</strong>.</p>
        </div>
      </div>

      {/* O que será apagado */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">O que será apagado</p>
        </div>
        <div className="divide-y divide-gray-100">
          {tables.map(t => (
            <div key={t.name} className="px-4 py-3 flex items-start gap-3">
              <Trash2 size={14} className={`flex-shrink-0 mt-0.5 ${t.danger ? 'text-red-400' : 'text-gray-300'}`} />
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${t.danger ? 'text-red-700' : 'text-gray-700'}`}>{t.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* O que NÃO será apagado */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-emerald-800 mb-2 flex items-center gap-2">
          <CheckCircle2 size={15} /> O que NÃO será apagado
        </p>
        <ul className="text-sm text-emerald-700 space-y-1">
          {[
            'Usuários e permissões (app_users)',
            'Produtos e estoque',
            'Fornecedores',
            'Famílias de produtos',
            'Condições de pagamento',
            'Empresas (companies)',
          ].map(item => (
            <li key={item} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Erro em destaque */}
      {errorMsg && (
        <div className="flex gap-3 p-4 rounded-xl bg-red-50 border border-red-300">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">
            <p className="font-bold mb-1">Falha na limpeza</p>
            <p>{errorMsg}</p>
            {errorMsg.includes('sessão') && (
              <p className="mt-1 font-medium">Dica: recarregue a página (F5) e tente novamente.</p>
            )}
          </div>
        </div>
      )}

      {/* Confirmação */}
      {!result ? (
        <div className="bg-white border border-red-200 rounded-xl p-5 space-y-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-800">
            Para confirmar, digite <span className="font-mono font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">{WORD}</span> no campo abaixo:
          </p>
          <input
            type="text"
            value={confirm}
            onChange={e => setConfirm(e.target.value.toUpperCase())}
            placeholder={`Digite ${WORD} para confirmar`}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400"
            disabled={running}
          />
          <button
            onClick={handleClean}
            disabled={!ready}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {running ? (
              <><Loader2 size={15} className="animate-spin" /> Limpando…</>
            ) : (
              <><Trash2 size={15} /> Executar limpeza</>
            )}
          </button>
        </div>
      ) : (
        <div className="bg-white border border-emerald-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={20} className="text-emerald-500" />
            <p className="text-base font-bold text-emerald-800">Limpeza concluída!</p>
          </div>
          <div className="space-y-2">
            {Object.entries(result.deleted).map(([table, count]) => (
              <div key={table} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 font-medium">{table}</span>
                <span className={`font-bold px-2 py-0.5 rounded-full text-xs ${count > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'}`}>
                  {count} {count === 1 ? 'registro' : 'registros'} removidos
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setResult(null)}
            className="mt-4 w-full py-2 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Fechar
          </button>
        </div>
      )}
    </div>
  )
}
