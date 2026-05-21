// setup.config.ts
// Manifesto declarativo do wizard /setup. Único arquivo que muda entre
// ferramentas Agentise — toda a infra (wizard, bootstrap, encrypt,
// app_settings, redeploy) lê deste manifesto.

export type ValidationResult = { ok: boolean; message?: string }

export type CredentialField = {
  /** chave em app_settings (snake_case) */
  key: string
  /** label visível no form */
  label: string
  /** texto auxiliar abaixo do input */
  helpText?: string
  /** link "onde gerar essa credencial" */
  docsUrl?: string
  placeholder?: string
  inputType?: 'text' | 'password'
  /** opcional: se true, não bloqueia conclusão do setup quando vazio */
  optional?: boolean
  /** valida client-side (form) e novamente no server (defesa em profundidade) */
  validate: (value: string) => Promise<ValidationResult>
}

export type SetupConfig = {
  toolName: string
  toolSlug: string
  /** lista de Edge Functions que o /api/bootstrap deve deployar */
  edgeFunctions: string[]
  /** credenciais específicas da ferramenta (Step 4 do wizard) */
  appCredentials: CredentialField[]
  /** rota pra qual redirecionar após setup OK */
  postBootstrapRedirect: string
}

// ---------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------

async function validateOpenAI(value: string): Promise<ValidationResult> {
  if (!value.startsWith('sk-')) {
    return { ok: false, message: 'Formato esperado: sk-...' }
  }
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${value}` },
    })
    if (res.status === 401) return { ok: false, message: 'Chave inválida (401)' }
    if (!res.ok) return { ok: false, message: `Erro ${res.status} ao validar` }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Falha de rede: ${(err as Error).message}` }
  }
}

async function validateApify(value: string): Promise<ValidationResult> {
  if (!value.startsWith('apify_api_')) {
    return { ok: false, message: 'Formato esperado: apify_api_...' }
  }
  try {
    const res = await fetch('https://api.apify.com/v2/users/me', {
      headers: { Authorization: `Bearer ${value}` },
    })
    if (res.status === 401) return { ok: false, message: 'Token inválido (401)' }
    if (!res.ok) return { ok: false, message: `Erro ${res.status} ao validar` }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Falha de rede: ${(err as Error).message}` }
  }
}

async function validateGemini(value: string): Promise<ValidationResult> {
  if (!value.startsWith('AIza')) {
    return { ok: false, message: 'Formato esperado: AIza...' }
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(value)}`,
    )
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, message: 'Chave inválida ou sem permissão' }
    }
    if (!res.ok) return { ok: false, message: `Erro ${res.status} ao validar` }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Falha de rede: ${(err as Error).message}` }
  }
}

async function validateResend(value: string): Promise<ValidationResult> {
  if (!value) return { ok: true } // opcional
  if (!value.startsWith('re_')) {
    return { ok: false, message: 'Formato esperado: re_...' }
  }
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${value}` },
    })
    if (res.status === 401) return { ok: false, message: 'Chave inválida (401)' }
    if (!res.ok) return { ok: false, message: `Erro ${res.status} ao validar` }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Falha de rede: ${(err as Error).message}` }
  }
}

async function validateEmail(value: string): Promise<ValidationResult> {
  if (!value) return { ok: true } // opcional
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(value)) {
    return { ok: false, message: 'Email inválido' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------
// Manifesto Creator OS
// ---------------------------------------------------------------------

export const setupConfig: SetupConfig = {
  toolName: 'Creator OS',
  toolSlug: 'creator-os',
  postBootstrapRedirect: '/login',

  edgeFunctions: [
    'analyze-content',
    'create-invite',
    'generate-script',
    'generate-voice-profile',
    'job-status',
    'revoke-invite',
    'scrape-profiles',
    'scrape-reel-url',
  ],

  appCredentials: [
    {
      key: 'apify_token',
      label: 'Apify Token',
      placeholder: 'apify_api_...',
      inputType: 'password',
      docsUrl: 'https://console.apify.com/account/integrations',
      helpText: 'Necessário para scraping de Reels do Instagram',
      validate: validateApify,
    },
    {
      key: 'openai_api_key',
      label: 'OpenAI API Key',
      placeholder: 'sk-...',
      inputType: 'password',
      docsUrl: 'https://platform.openai.com/api-keys',
      helpText: 'Usado por Whisper (transcrição) e GPT (análise/geração)',
      validate: validateOpenAI,
    },
    {
      key: 'gemini_api_key',
      label: 'Google Gemini API Key',
      placeholder: 'AIza...',
      inputType: 'password',
      docsUrl: 'https://aistudio.google.com/app/apikey',
      helpText: 'Usado para análise visual de vídeo',
      validate: validateGemini,
    },
    {
      key: 'resend_api_key',
      label: 'Resend API Key (opcional)',
      placeholder: 're_...',
      inputType: 'password',
      optional: true,
      docsUrl: 'https://resend.com/api-keys',
      helpText: 'Se configurado, convites de equipe são enviados por email',
      validate: validateResend,
    },
    {
      key: 'email_from',
      label: 'Email remetente (opcional)',
      placeholder: 'noreply@seudominio.com',
      inputType: 'text',
      optional: true,
      helpText: 'Endereço verificado no Resend (só preencha se usar Resend)',
      validate: validateEmail,
    },
  ],
}
