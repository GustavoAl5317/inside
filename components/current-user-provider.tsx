'use client'

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react'
import { resolveCurrentUserAction, devLoginAction, getSessionUser } from '@/lib/auth-actions'
import type { Role, SessionUser } from '@/lib/auth-types'

declare global {
  interface Window { BX24?: any }
}

interface CurrentUserContextValue {
  user: SessionUser | null
  loading: boolean
  error: string | null
  isBitrix: boolean
  sessionExpired: boolean
  refresh: () => Promise<void>
  devLogin: (bitrixUserId: string, name?: string) => Promise<void>
}

const CurrentUserContext = createContext<CurrentUserContextValue>({
  user: null,
  loading: true,
  error: null,
  isBitrix: false,
  sessionExpired: false,
  refresh: async () => {},
  devLogin: async () => {},
})

export function useCurrentUser() {
  return useContext(CurrentUserContext)
}

// Papéis que podem ver cada área
export const ROLE_ACCESS: Record<string, Role[]> = {
  home:         ['insidesales', 'financeiro', 'admin'],
  atualizacao:  ['insidesales', 'admin'],
  aprovacoes:   ['insidesales', 'financeiro', 'admin'],
  historico:    ['insidesales', 'financeiro', 'admin'],
  solicitacoes: ['financeiro', 'admin'],             // aprovação de atualização
  cadastros:    ['insidesales', 'admin'],            // fornecedores, famílias, pagamentos
  admin:        ['admin'],
}

export function canAccess(area: keyof typeof ROLE_ACCESS, role?: Role | null): boolean {
  if (!role) return false
  return ROLE_ACCESS[area]?.includes(role) ?? false
}

function loadBx24Script(timeoutMs = 5000): Promise<any | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null)
    if (window.BX24) return resolve(window.BX24)

    const done = (v: any | null) => resolve(v)
    const timer = setTimeout(() => done(null), timeoutMs)

    const script = document.createElement('script')
    script.src = '//api.bitrix24.com/api/v1/'
    script.async = true
    script.onload = () => { clearTimeout(timer); done(window.BX24 ?? null) }
    script.onerror = () => { clearTimeout(timer); done(null) }
    document.head.appendChild(script)
  })
}

function bx24Call(BX24: any, method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      BX24.callMethod(method, params, (res: any) => {
        if (res.error && res.error()) reject(res.error())
        else resolve(res.data())
      })
    } catch (e) {
      reject(e)
    }
  })
}

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]                   = useState<SessionUser | null>(null)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [isBitrix, setIsBitrix]           = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [bx24RetryCount, setBx24RetryCount] = useState(0)
  const startedRef = useRef(false)

  const resolveFromBitrix = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSessionExpired(false)
    try {
      const BX24 = await loadBx24Script(6000)
      if (!BX24) {
        // Fora do Bitrix24: restaura sessão existente do cookie (ex.: login dev)
        try {
          const existing = await getSessionUser()
          if (existing) setUser(existing)
        } catch { /* sem sessão válida */ }
        setIsBitrix(false)
        setLoading(false)
        return
      }

      await new Promise<void>((r) => {
        let settled = false
        const t = setTimeout(() => { if (!settled) { settled = true; r() } }, 5000)
        try {
          BX24.init(() => { if (!settled) { settled = true; clearTimeout(t); r() } })
        } catch { if (!settled) { settled = true; clearTimeout(t); r() } }
      })

      let profile: any = null
      try { profile = await bx24Call(BX24, 'user.current') } catch {
        try { profile = await bx24Call(BX24, 'profile') } catch { profile = null }
      }

      if (!profile?.ID) {
        // BX24 carregou mas sem perfil: tenta restaurar sessão do cookie
        try {
          const existing = await getSessionUser()
          if (existing) setUser(existing)
        } catch { /* sem sessão válida */ }
        setIsBitrix(false)
        setLoading(false)
        return
      }

      setIsBitrix(true)
      setBx24RetryCount(0)
      const res = await resolveCurrentUserAction({
        bitrixUserId: profile.ID,
        name: [profile.NAME, profile.LAST_NAME].filter(Boolean).join(' ') || profile.LOGIN,
        email: profile.EMAIL,
      })
      if (res.success) setUser(res.user)
      else setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao identificar usuário')
    } finally {
      setLoading(false)
    }
  }, [])

  const devLogin = useCallback(async (bitrixUserId: string, name?: string) => {
    setLoading(true)
    setSessionExpired(false)
    const res = await devLoginAction(bitrixUserId, name)
    if (res.success) setUser(res.user)
    else setError(res.error)
    setLoading(false)
  }, [])

  // Init
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    resolveFromBitrix()
  }, [resolveFromBitrix])

  // Verificação de sessão a cada 5 minutos
  useEffect(() => {
    if (!user) return
    const id = setInterval(async () => {
      try {
        const current = await getSessionUser()
        if (!current) {
          setUser(null)
          setSessionExpired(true)
        }
      } catch { /* silently ignore */ }
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [user])

  const handleBx24Retry = useCallback(() => {
    setBx24RetryCount(c => c + 1)
    resolveFromBitrix()
  }, [resolveFromBitrix])

  return (
    <CurrentUserContext.Provider
      value={{ user, loading, error, isBitrix, sessionExpired, refresh: resolveFromBitrix, devLogin }}
    >
      {/* Modal de sessão expirada */}
      {sessionExpired && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Sessão expirada</h3>
              <p className="text-sm text-gray-500 mt-1">
                Sua sessão expirou. Clique em <strong>Reconectar</strong> para continuar.
              </p>
            </div>
            <button
              onClick={() => { setSessionExpired(false); resolveFromBitrix() }}
              className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            >
              Reconectar
            </button>
          </div>
        </div>
      )}

      {/* Banner de erro de BX24 com retry */}
      {!loading && !user && error && isBitrix === false && bx24RetryCount > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998] bg-red-50 border border-red-200 rounded-xl shadow-lg px-5 py-3 flex items-center gap-3 max-w-sm">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
          </svg>
          <p className="text-xs text-red-700 flex-1">Não foi possível conectar ao Bitrix24.</p>
          <button onClick={handleBx24Retry} className="text-xs font-semibold text-blue-600 hover:underline">
            Tentar novamente
          </button>
        </div>
      )}

      {children}
    </CurrentUserContext.Provider>
  )
}
