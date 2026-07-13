'use server'

import crypto from 'crypto'
import { cookies } from 'next/headers'
import { sql } from './db'
import { BitrixService } from './bitrix-service'
import type { Role, SessionUser } from './auth-types'

const COOKIE_NAME = 'is_session'
const SESSION_MAX_AGE = 60 * 60 * 12 // 12h

function getSecret(): string {
  return process.env.APP_SESSION_SECRET || 'insidesales-dev-secret-change-me'
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(payload: object): string {
  const data = b64url(JSON.stringify(payload))
  const hmac = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url')
  return `${data}.${hmac}`
}

function verify(token: string | undefined): SessionUser | null {
  if (!token) return null
  const [data, hmac] = token.split('.')
  if (!data || !hmac) return null
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url')
  // timingSafeEqual exige buffers do mesmo tamanho
  const a = Buffer.from(hmac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    if (!parsed?.bitrixUserId || !parsed?.role) return null
    return parsed as SessionUser
  } catch {
    return null
  }
}

async function writeSessionCookie(user: SessionUser): Promise<void> {
  cookies().set(COOKIE_NAME, sign(user), {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
}

/** Lê e valida a sessão do cookie. Retorna null se não houver/for inválida. */
export async function getSessionUser(): Promise<SessionUser | null> {
  return verify(cookies().get(COOKIE_NAME)?.value)
}

/**
 * Resolve o usuário atual a partir dos dados vindos do BX24 (client).
 * - Se ainda não existir NENHUM usuário cadastrado, este vira 'admin' (primeiro acesso).
 * - Se já existir, apenas carrega o papel (atualizando nome/email).
 * - Usuários desconhecidos são criados como inativos (sem acesso) até um admin liberar.
 * Grava a sessão em cookie assinado.
 */
export async function resolveCurrentUserAction(input: {
  bitrixUserId: string | number
  name?: string
  email?: string
}) {
  try {
    const bitrixUserId = String(input.bitrixUserId || '').trim()
    if (!bitrixUserId) return { success: false as const, error: 'ID do usuário Bitrix ausente' }

    const name = String(input.name || '').trim() || `Usuário ${bitrixUserId}`
    const email = String(input.email || '').trim() || null

    const [existing] = await sql`
      SELECT bitrix_user_id, name, role, active FROM app_users WHERE bitrix_user_id = ${bitrixUserId}
    `

    if (existing) {
      // Atualiza nome/email (mantém papel e status)
      await sql`
        UPDATE app_users SET name = ${name}, email = ${email} WHERE bitrix_user_id = ${bitrixUserId}
      `
      const user: SessionUser = {
        bitrixUserId,
        name,
        role: existing.role as Role,
        active: existing.active as boolean,
      }
      await writeSessionCookie(user)
      return { success: true as const, user }
    }

    // Não existe ainda — checa se é o primeiro acesso de todos
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM app_users`
    const isFirst = Number(count) === 0

    const role: Role = isFirst ? 'admin' : 'insidesales'
    const active = isFirst // primeiro = admin ativo; demais entram inativos até liberação

    await sql`
      INSERT INTO app_users (bitrix_user_id, name, email, role, active, created_by)
      VALUES (${bitrixUserId}, ${name}, ${email}, ${role}, ${active}, ${isFirst ? 'system' : null})
    `

    const user: SessionUser = { bitrixUserId, name, role, active }
    await writeSessionCookie(user)
    return { success: true as const, user }
  } catch (error) {
    console.error('Erro ao resolver usuário atual:', error)
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

/** Fallback de desenvolvimento (fora do iframe do Bitrix): assume a sessão como um bitrixUserId dado. */
export async function devLoginAction(bitrixUserId: string, name?: string) {
  if (process.env.NODE_ENV === 'production') {
    return { success: false as const, error: 'Login dev indisponível em produção' }
  }
  return resolveCurrentUserAction({ bitrixUserId, name })
}

export async function logoutAction() {
  cookies().delete(COOKIE_NAME)
  return { success: true as const }
}

// ─── Administração de usuários (somente admin) ──────────────────────────────────

async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user || user.role !== 'admin' || !user.active) {
    throw new Error('Acesso negado: requer administrador')
  }
  return user
}

export async function listAppUsersAction() {
  try {
    await requireAdmin()
    const rows = await sql`
      SELECT id, bitrix_user_id, name, email, role, active, created_at
      FROM app_users
      ORDER BY created_at DESC
    `
    return { success: true as const, users: rows }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function searchBitrixUsersAction(query: string) {
  try {
    await requireAdmin()
    const users = await BitrixService.searchBitrixUsers(query)
    return { success: true as const, users }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function upsertAppUserAction(input: {
  bitrixUserId: string | number
  name: string
  email?: string
  role: Role
}) {
  try {
    const admin = await requireAdmin()
    const bitrixUserId = String(input.bitrixUserId)
    const role: Role = input.role
    if (!['insidesales', 'financeiro', 'admin'].includes(role)) {
      return { success: false as const, error: 'Papel inválido' }
    }
    await sql`
      INSERT INTO app_users (bitrix_user_id, name, email, role, active, created_by)
      VALUES (${bitrixUserId}, ${input.name}, ${input.email || null}, ${role}, TRUE, ${admin.bitrixUserId})
      ON CONFLICT (bitrix_user_id) DO UPDATE
        SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, active = TRUE
    `
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function setUserRoleAction(bitrixUserId: string, role: Role) {
  try {
    await requireAdmin()
    if (!['insidesales', 'financeiro', 'admin'].includes(role)) {
      return { success: false as const, error: 'Papel inválido' }
    }
    await sql`UPDATE app_users SET role = ${role} WHERE bitrix_user_id = ${bitrixUserId}`
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function setUserActiveAction(bitrixUserId: string, active: boolean) {
  try {
    await requireAdmin()
    await sql`UPDATE app_users SET active = ${active} WHERE bitrix_user_id = ${bitrixUserId}`
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

export async function deleteAppUserAction(bitrixUserId: string) {
  try {
    const admin = await requireAdmin()
    if (admin.bitrixUserId === bitrixUserId) {
      return { success: false as const, error: 'Você não pode excluir a si mesmo' }
    }
    await sql`DELETE FROM app_users WHERE bitrix_user_id = ${bitrixUserId}`
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido' }
  }
}

/**
 * Limpa dados de processo/histórico.
 * NÃO apaga: app_users, products, companies, suppliers, families, payment_conditions.
 */
export async function cleanProcessDataAction() {
  // Verificar sessão — loga para diagnóstico
  const sessionUser = await getSessionUser()
  console.log('[cleanProcessData] sessionUser:', sessionUser?.bitrixUserId, sessionUser?.role)

  if (!sessionUser || sessionUser.role !== 'admin' || !sessionUser.active) {
    const reason = !sessionUser ? 'sem sessão' : `papel=${sessionUser.role} ativo=${sessionUser.active}`
    console.error('[cleanProcessData] acesso negado:', reason)
    return { success: false as const, error: `Acesso negado (${reason}). Recarregue a página e tente novamente.`, deleted: {} }
  }

  try {
    const deleted: Record<string, number> = {}
    const countDel = (rows: any[]) => (Array.isArray(rows) ? rows.length : 0)

    // update_requests referencia deals via FK — apaga primeiro para evitar conflito
    const urRows = await sql`DELETE FROM update_requests RETURNING id`
    deleted['update_requests'] = countDel(urRows)
    console.log('[cleanProcessData] update_requests deletadas:', deleted['update_requests'])

    const dlRows = await sql`DELETE FROM deals RETURNING id`
    deleted['deals'] = countDel(dlRows)
    console.log('[cleanProcessData] deals deletadas:', deleted['deals'])

    const lgRows = await sql`DELETE FROM logs RETURNING id`
    deleted['logs'] = countDel(lgRows)
    console.log('[cleanProcessData] logs deletados:', deleted['logs'])

    // Tabelas do modelo legado (podem não existir — ignoramos erros individuais)
    try {
      deleted['webhook_logs'] = countDel(await sql`DELETE FROM webhook_logs RETURNING id`)
    } catch (e) { deleted['webhook_logs'] = 0; console.log('[cleanProcessData] webhook_logs: tabela ausente') }

    try {
      deleted['process_history'] = countDel(await sql`DELETE FROM process_history RETURNING id`)
    } catch { deleted['process_history'] = 0 }

    try {
      deleted['transaction_items'] = countDel(await sql`DELETE FROM transaction_items RETURNING id`)
    } catch { deleted['transaction_items'] = 0 }

    try {
      deleted['transactions'] = countDel(await sql`DELETE FROM transactions RETURNING id`)
    } catch { deleted['transactions'] = 0 }

    try {
      deleted['businesses'] = countDel(await sql`DELETE FROM businesses RETURNING id`)
    } catch { deleted['businesses'] = 0 }

    console.log('[cleanProcessData] concluído:', deleted)
    return { success: true as const, deleted }
  } catch (error) {
    console.error('[cleanProcessData] erro inesperado:', error)
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro desconhecido', deleted: {} }
  }
}
