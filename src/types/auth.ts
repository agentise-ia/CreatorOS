// ==========================================
// Auth / Roles — Creator OS
// ==========================================

export type AppRole = 'owner' | 'member' | 'admin' | 'operator'

export type AppUser = {
  user_id: string
  role: AppRole
  created_at: string
  updated_at: string
}

export type Invite = {
  id: string
  email: string
  role: AppRole
  invited_by: string | null
  expires_at: string
  used_at: string | null
  revoked_at: string | null
  created_at: string
}
