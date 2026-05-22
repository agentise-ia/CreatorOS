// Persistência do estado do wizard em localStorage.
//
// ⚠️ NUNCA persiste credenciais sensíveis (senha do owner, service_role, PAT,
// Vercel token). Mesmo durante o setup, um XSS/extensão maliciosa no domínio
// poderia ler o localStorage — então essas chaves são removidas antes de gravar
// e removidas defensivamente ao carregar (caso um localStorage legado as tenha).

const PREFIX = 'agentise.setup'

// Chaves que NUNCA podem ir pra localStorage.
export const SENSITIVE_KEYS = [
  'owner_password',
  'supabase_service_role_key',
  'supabase_pat',
  'vercel_token',
] as const

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Remove chaves sensíveis de objetos. Valores primitivos (ex.: o número do
// step) passam intactos. Em DEV, faz uma asserção de integridade: se alguma
// chave sensível sobreviveu ao strip, é bug deste módulo — falha alto.
function stripSensitive<T>(data: T): T {
  if (!isPlainObject(data)) return data
  const safe: Record<string, unknown> = { ...data }
  for (const k of SENSITIVE_KEYS) delete safe[k]

  if (import.meta.env.DEV) {
    for (const k of SENSITIVE_KEYS) {
      if (k in safe) {
        throw new Error(
          `[SECURITY] Chave sensível "${k}" sobreviveu ao strip em wizardStorage. ` +
            'Isso é bug e nunca pode ser commitado.',
        )
      }
    }
  }

  return safe as T
}

export function saveStep<T>(step: string, data: T): void {
  try {
    localStorage.setItem(`${PREFIX}.${step}`, JSON.stringify(stripSensitive(data)))
  } catch {
    /* private mode / cota cheia — wizard segue funcional sem persistência */
  }
}

export function loadStep<T>(step: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}.${step}`)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)

    if (isPlainObject(parsed)) {
      // Sanitização defensiva: localStorage de versão antiga pode conter senha.
      const hadSensitive = SENSITIVE_KEYS.some((k) => k in parsed)
      const cleaned = stripSensitive(parsed)
      if (hadSensitive) {
        console.warn('[SECURITY] localStorage legado continha credencial sensível. Limpando.')
        try {
          localStorage.setItem(`${PREFIX}.${step}`, JSON.stringify(cleaned))
        } catch {
          /* noop */
        }
      }
      return cleaned as T
    }

    return parsed as T
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
