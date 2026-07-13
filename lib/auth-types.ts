export type Role = 'insidesales' | 'financeiro' | 'admin'

export interface SessionUser {
  bitrixUserId: string
  name: string
  role: Role
  active: boolean
}
