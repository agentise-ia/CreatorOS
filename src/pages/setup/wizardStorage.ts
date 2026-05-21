// Persistência simples em localStorage do estado do wizard.
// Não armazenamos credenciais sensíveis a longo prazo — limpamos
// totalmente após o setup completo.

const PREFIX = 'agentise.setup'

export type CoreCredentials = {
  supabase_url: string
  supabase_anon_key: string
  supabase_service_role_key: string
  supabase_pat: string
  vercel_token: string
  owner_email: string
  owner_password: string
}

export const emptyCore: CoreCredentials = {
  supabase_url: '',
  supabase_anon_key: '',
  supabase_service_role_key: '',
  supabase_pat: '',
  vercel_token: '',
  owner_email: '',
  owner_password: '',
}

export function saveStep<T>(step: string, data: T): void {
  try {
    localStorage.setItem(`${PREFIX}.${step}`, JSON.stringify(data))
  } catch {
    /* private mode / cota cheia */
  }
}

export function loadStep<T>(step: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}.${step}`)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function clearAll(): void {
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`${PREFIX}.`)) toRemove.push(k)
    }
    toRemove.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* noop */
  }
}
