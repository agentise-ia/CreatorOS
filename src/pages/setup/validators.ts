// Validadores das credenciais "core" do Step 2 do wizard.
//
// ⚠️ Tokens NUNCA são enviados direto do browser para as APIs de
// gerenciamento do Supabase/Vercel — isso vazaria o valor no DevTools/Network.
// Em vez disso, chamamos /api/validate-token (Serverless Function) que faz o
// ping server-side. A validação de formato (regex/prefixo) acontece
// client-side só para feedback rápido, sem mandar o valor pra fora.

export type ValidationResult = { ok: boolean; message?: string }

async function validateViaProxy(
  type: string,
  value: string,
  supabase_url?: string,
): Promise<ValidationResult> {
  try {
    const res = await fetch('/api/validate-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, value, supabase_url }),
    })
    const data = (await res.json()) as { valid?: boolean; message?: string }
    if (!res.ok) {
      return { ok: false, message: data.message ?? `Erro ${res.status} ao validar` }
    }
    return { ok: !!data.valid, message: data.valid ? undefined : data.message }
  } catch (err) {
    return { ok: false, message: `Falha de rede ao validar: ${(err as Error).message}` }
  }
}

export function validateSupabaseUrl(value: string): ValidationResult {
  // 100% client-side: só regex, não envolve token nenhum.
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
  return validateViaProxy('supabase_anon_key', key, url)
}

export async function validateSupabaseServiceRole(
  url: string,
  key: string,
): Promise<ValidationResult> {
  if (!key) return { ok: false, message: 'Obrigatório' }
  if (!key.startsWith('eyJ')) return { ok: false, message: 'Esperado JWT (eyJ...)' }
  if (!url) return { ok: false, message: 'Preencha a URL primeiro' }
  return validateViaProxy('supabase_service_role_key', key, url)
}

export async function validateSupabasePAT(token: string): Promise<ValidationResult> {
  if (!token) return { ok: false, message: 'Obrigatório' }
  if (!token.startsWith('sbp_')) return { ok: false, message: 'Formato esperado: sbp_...' }
  return validateViaProxy('supabase_pat', token)
}

export async function validateVercelToken(token: string): Promise<ValidationResult> {
  if (!token) return { ok: false, message: 'Obrigatório' }
  return validateViaProxy('vercel_token', token)
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
