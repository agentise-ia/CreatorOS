// api/credentials.ts
//
// Persiste e consulta credenciais de aplicação (criptografadas via CRYPTO_KEY).
// PROTEGIDO por requireOwner(): só um usuário autenticado com role owner/admin
// (modelo public.app_users deste projeto) pode ler ou escrever. Sem isso,
// qualquer um com a URL pública sobrescreveria/enumeraria credenciais.
//
// POST /api/credentials
//   Header: Authorization: Bearer <jwt do owner>
//   Body:   { credentials: { key: value, ... } }
//   Re-valida cada credencial contra o manifesto setup.config.ts antes de salvar.
//
// GET /api/credentials?keys=key1,key2
//   Header: Authorization: Bearer <jwt do owner>
//   Retorna { [key]: { exists: boolean } } — NUNCA valores.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { setCredential, credentialExists, markBootstrapStep } from '../lib/credentials.js'
import { setupConfig } from '../setup.config.js'

// Roles com acesso elevado nesta instância. 'owner' é o usuário criado pelo
// wizard; 'admin' é mantido por compat com o helper is_admin() (migration
// 20260505_invites_and_owner_role). A tabela `profiles` aqui é de perfis do
// Instagram — o modelo de role vive em public.app_users.
const OWNER_ROLES = ['owner', 'admin']

type AuthOk = { userId: string }
type AuthErr = { error: 401 | 403 | 500; message: string }

async function requireOwner(req: VercelRequest): Promise<AuthOk | AuthErr> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) {
    return {
      error: 500,
      message: 'Servidor sem envs Supabase. Conclua o bootstrap (/setup) antes de gerenciar credenciais.',
    }
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 401, message: 'Token de acesso ausente' }
  }
  const jwt = authHeader.slice('Bearer '.length).trim()
  if (!jwt) return { error: 401, message: 'Token de acesso ausente' }

  // 1. Validar JWT contra auth.users (client com o token do usuário).
  const userClient = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser()
  if (userError || !user) {
    return { error: 401, message: 'Sessão inválida ou expirada' }
  }

  // 2. Validar role via public.app_users (service_role bypassa RLS).
  const adminClient = createClient(url, service, { auth: { persistSession: false } })
  const { data: appUser, error: roleError } = await adminClient
    .from('app_users')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (roleError) {
    return { error: 500, message: `Falha ao verificar role: ${roleError.message}` }
  }
  const role = (appUser as { role?: string } | null)?.role
  if (!role || !OWNER_ROLES.includes(role)) {
    return { error: 403, message: 'Apenas o owner desta instância pode gerenciar credenciais' }
  }

  return { userId: user.id }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      .status(204)
      .end()
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Use GET ou POST' })
  }

  // Guard de auth aplicado a TODOS os métodos (GET e POST).
  const auth = await requireOwner(req)
  if ('error' in auth) {
    return res.status(auth.error).json({ success: false, message: auth.message })
  }

  // -------------------------------------------------------------------
  // GET — retorna apenas existência (nunca valores).
  // -------------------------------------------------------------------
  if (req.method === 'GET') {
    const keys = String(req.query.keys ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
    if (keys.length === 0) {
      return res.status(400).json({ success: false, message: 'Parâmetro keys obrigatório' })
    }
    try {
      const existsMap = await credentialExists(keys)
      const result = Object.fromEntries(keys.map((k) => [k, { exists: existsMap[k] ?? false }]))
      return res.status(200).json(result)
    } catch (err) {
      return res.status(500).json({ success: false, message: (err as Error).message })
    }
  }

  // -------------------------------------------------------------------
  // POST — valida contra o manifesto e persiste criptografado.
  // -------------------------------------------------------------------
  const body = req.body as { credentials?: Record<string, string> }
  const credentials = body?.credentials ?? {}
  if (!credentials || typeof credentials !== 'object') {
    return res.status(400).json({ success: false, message: 'Body deve conter { credentials: { ... } }' })
  }

  const manifest = new Map(setupConfig.appCredentials.map((c) => [c.key, c]))
  const errors: Record<string, string> = {}
  const saved: string[] = []

  for (const [key, rawValue] of Object.entries(credentials)) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    const field = manifest.get(key)
    if (!field) {
      errors[key] = 'Chave desconhecida (não está no manifesto)'
      continue
    }
    if (!value) {
      if (field.optional) continue
      errors[key] = 'Valor obrigatório vazio'
      continue
    }
    // Re-valida server-side (defesa em profundidade).
    try {
      const result = await field.validate(value)
      if (!result.ok) {
        errors[key] = result.message ?? 'Validação falhou'
        continue
      }
    } catch (err) {
      errors[key] = `Erro ao validar: ${(err as Error).message}`
      continue
    }
    try {
      await setCredential(key, value)
      saved.push(key)
    } catch (err) {
      errors[key] = `Erro ao salvar: ${(err as Error).message}`
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ success: false, errors, saved })
  }

  // Se todas as obrigatórias foram salvas, marca setup completo (idempotente).
  const requiredKeys = setupConfig.appCredentials.filter((c) => !c.optional).map((c) => c.key)
  const allRequiredSaved = requiredKeys.every((k) => saved.includes(k))
  if (allRequiredSaved) {
    try {
      await markBootstrapStep('app_credentials_saved', { keys: saved })
      await markBootstrapStep('setup_complete')
    } catch (err) {
      console.error('Falha ao marcar setup_complete:', (err as Error).message)
    }
  }

  return res.status(200).json({ success: true, saved })
}
