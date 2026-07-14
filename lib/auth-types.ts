export type Role = 'insidesales' | 'financeiro' | 'admin' | 'am'

export interface SessionUser {
  bitrixUserId: string
  name: string
  role: Role
  active: boolean
}
