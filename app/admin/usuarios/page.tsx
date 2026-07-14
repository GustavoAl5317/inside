'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  listAppUsersAction, searchBitrixUsersAction, upsertAppUserAction,
  setUserRoleAction, setUserActiveAction, deleteAppUserAction,
} from '@/lib/auth-actions'
import type { Role } from '@/lib/auth-types'
import { useCurrentUser, canAccess } from '@/components/current-user-provider'
import { toast } from 'sonner'
import {
  Loader2, RefreshCw, Search, Trash2, ShieldAlert, UserPlus, UserCheck, UserX,
} from 'lucide-react'

interface AppUser {
  id: number
  bitrix_user_id: string
  name: string
  email?: string | null
  role: Role
  active: boolean
  created_at?: string
}

interface BitrixUser { id: number; fullName: string; email?: string }

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'insidesales', label: 'Inside Sales' },
  { value: 'financeiro',  label: 'Financeiro' },
  { value: 'am',          label: 'Account Manager' },
  { value: 'admin',       label: 'Administrador' },
]

const ROLE_BADGE: Record<Role, string> = {
  insidesales: 'bg-blue-50 text-blue-700 ring-blue-200',
  financeiro:  'bg-violet-50 text-violet-700 ring-violet-200',
  am:          'bg-amber-50 text-amber-700 ring-amber-200',
  admin:       'bg-emerald-50 text-emerald-700 ring-emerald-200',
}

export default function AdminUsersPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<BitrixUser[]>([])
  const [addRole, setAddRole] = useState<Role>('insidesales')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await listAppUsersAction()
      if (r.success) setUsers(r.users as AppUser[])
      else toast.error(r.error || 'Erro ao carregar usuários')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSearch = async () => {
    setSearching(true)
    try {
      const r = await searchBitrixUsersAction(query)
      if (r.success) setResults(r.users as BitrixUser[])
      else toast.error(r.error || 'Erro na busca')
    } finally {
      setSearching(false)
    }
  }

  const handleAdd = async (bu: BitrixUser) => {
    setBusy(`add-${bu.id}`)
    try {
      const r = await upsertAppUserAction({ bitrixUserId: bu.id, name: bu.fullName, email: bu.email, role: addRole })
      if (r.success) { toast.success(`${bu.fullName} adicionado como ${addRole}.`); await load() }
      else toast.error(r.error || 'Erro ao adicionar')
    } finally {
      setBusy(null)
    }
  }

  const handleRole = async (bitrixUserId: string, role: Role) => {
    setBusy(`role-${bitrixUserId}`)
    try {
      const r = await setUserRoleAction(bitrixUserId, role)
      if (r.success) { toast.success('Papel atualizado.'); await load() }
      else toast.error(r.error || 'Erro ao atualizar papel')
    } finally {
      setBusy(null)
    }
  }

  const handleActive = async (bitrixUserId: string, active: boolean) => {
    setBusy(`active-${bitrixUserId}`)
    try {
      const r = await setUserActiveAction(bitrixUserId, active)
      if (r.success) { toast.success(active ? 'Acesso liberado.' : 'Acesso suspenso.'); await load() }
      else toast.error(r.error || 'Erro ao alterar acesso')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (bitrixUserId: string, name: string) => {
    if (!confirm(`Excluir o acesso de ${name}?`)) return
    setBusy(`del-${bitrixUserId}`)
    try {
      const r = await deleteAppUserAction(bitrixUserId)
      if (r.success) { toast.success('Acesso excluído.'); await load() }
      else toast.error(r.error || 'Erro ao excluir')
    } finally {
      setBusy(null)
    }
  }

  if (userLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }

  if (!canAccess('admin', user?.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-center px-4">
        <ShieldAlert className="w-12 h-12 text-amber-400 mb-4" />
        <h2 className="text-lg font-semibold text-gray-800">Acesso restrito</h2>
        <p className="text-sm text-gray-500 mt-1">Somente administradores podem gerenciar usuários.</p>
      </div>
    )
  }

  const existingIds = new Set(users.map(u => u.bitrix_user_id))

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Gerenciar usuários e permissões</h1>
        <p className="text-sm text-gray-500">Busque uma pessoa do Bitrix pelo nome e conceda o acesso adequado.</p>
      </div>

      {/* Busca Bitrix */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Buscar pessoa no Bitrix pelo nome..."
              className="w-full text-sm pl-9 pr-3 py-2 rounded-lg border border-gray-200"
            />
          </div>
          <select
            value={addRole}
            onChange={e => setAddRole(e.target.value as Role)}
            className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white"
          >
            {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Buscar
          </button>
        </div>

        {results.length > 0 && (
          <div className="space-y-1.5 border-t border-gray-100 pt-3">
            {results.map(bu => (
              <div key={bu.id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{bu.fullName}</p>
                  <p className="text-xs text-gray-400">Bitrix #{bu.id}{bu.email ? ` · ${bu.email}` : ''}</p>
                </div>
                {existingIds.has(String(bu.id)) ? (
                  <span className="text-xs text-gray-400">Já cadastrado</span>
                ) : (
                  <button
                    onClick={() => handleAdd(bu)}
                    disabled={busy === `add-${bu.id}`}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {busy === `add-${bu.id}` ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                    Conceder acesso
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usuários com acesso */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Usuários com acesso</h2>
          <button onClick={load} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="Atualizar">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : users.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">Nenhum usuário cadastrado.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-800 truncate">{u.name}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ${ROLE_BADGE[u.role]}`}>
                      {ROLE_OPTIONS.find(o => o.value === u.role)?.label ?? u.role}
                    </span>
                    {!u.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inativo</span>}
                  </div>
                  <p className="text-xs text-gray-400">Bitrix #{u.bitrix_user_id}{u.email ? ` · ${u.email}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={u.role}
                    onChange={e => handleRole(u.bitrix_user_id, e.target.value as Role)}
                    disabled={busy === `role-${u.bitrix_user_id}`}
                    className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white"
                  >
                    {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button
                    onClick={() => handleActive(u.bitrix_user_id, !u.active)}
                    disabled={busy === `active-${u.bitrix_user_id}`}
                    className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${
                      u.active
                        ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    }`}
                    title={u.active ? 'Suspender acesso' : 'Liberar acesso'}
                  >
                    {u.active ? <UserX size={12} /> : <UserCheck size={12} />}
                    {u.active ? 'Suspender' : 'Liberar'}
                  </button>
                  <button
                    onClick={() => handleDelete(u.bitrix_user_id, u.name)}
                    disabled={busy === `del-${u.bitrix_user_id}` || u.bitrix_user_id === user?.bitrixUserId}
                    className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-40"
                    title={u.bitrix_user_id === user?.bitrixUserId ? 'Você não pode excluir a si mesmo' : 'Excluir acesso'}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
