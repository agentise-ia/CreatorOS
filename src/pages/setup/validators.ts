// Validadores das credenciais "core" do Step 2 do wizard.
// Cada validador faz ping na API real para verificar permissão/atividade.

export type ValidationResult = { ok: boolean; message?: string }

export function validateSupabaseUrl(value: string): ValidationResult {
  if (!value) return { ok: false, message: 'Obrigatório' }
  const ok = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(value)
  return ok
    ? { ok: true }
    : { ok: false, message: 'Formato esperado: https://xxxx.supabase.co' }
}

export async function validateSupabaseAnonKey(
  url: string,
  key: string,
): Promise<ValidationResult> {
  if (!key) return { ok: false, message: 'Obrigatório' }
  if (!key.startsWith('eyJ')) return { ok: false, message: 'Esperado JWT (eyJ...)' }
  if (!url) return { ok: false, message: 'Preencha a URL primeiro' }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
      headers: { apikey: key },
    })
    if (res.status === 401) return { ok: false, message: 'Chave inválida (401)' }
    if (res.status >= 200 && res.status < 500) return { ok: true }
    return { ok: false, message: `Erro ${res.status}` }
  } catch (err) {
    return { ok: false, message: `Falha de rede: ${(err as Error).message}` }
  }
}

export async function validateSupabaseServiceRole(
  url: string,
  key: string,
): Promise<ValidationResult> {
  if (!key) return { ok: false, message: 'Obrigatório' }
  if (!key.startsWith('eyJ')) return { ok: false, message: 'Esperado JWT (eyJ...)' }
  if (!url) return { ok: false, message: 'Preencha a URL primeiro' }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
      headers: { apikey: key },
    })
    if (res.status === 401) return { ok: false, message: 'Chave inválida (401)' }
    if (res.status >= 200 && res.status < 500) return { ok: true }
    return { ok: false, message: `Erro ${res.status}` }
  } catch (err) {
    return { ok: false, message: `Falha de rede: ${(err as Error).message}` }
  }
}

export async function validateSupabasePAT(token: string): Promise<ValidationResult> {
  if (!token) return { ok: false, message: 'Obrigatório' }
  if (!token.startsWith('sbp_')) return { ok: false, message: 'Formato esperado: sbp_...' }
  try {
    const res = await fetch('https://api.supabase.com/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) return { ok: false, message: 'Token sem permissão (401)' }
    if (!res.ok) return { ok: false, message: `Erro ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Falha de rede: ${(err as Error).message}` }
  }
}

export async function validateVercelToken(token: string): Promise<ValidationResult> {
  if (!token) return { ok: false, message: 'Obrigatório' }
  try {
    const res = await fetch('https://api.vercel.com/v2/user', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: 'Token inválido ou sem permissão' }
    if (!res.ok) return { ok: false, message: `Erro ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Falha de rede: ${(err as Error).message}` }
  }
}

export function validateEmail(value: string): ValidationResult {
  if (!value) return { ok: false, message: 'Obrigatório' }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? { ok: true }
    : { ok: false, message: 'Email inválido' }
}

export function validatePassword(value: string): ValidationResult {
  if (!value) return { ok: false, message: 'Obrigatório' }
  if (value.length < 8) return { ok: false, message: 'Mínimo 8 caracteres' }
  return { ok: true }
}
