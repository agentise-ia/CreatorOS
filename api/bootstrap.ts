// api/bootstrap.ts
//
// Vercel Serverless Function executada pelo wizard /setup (Step 3).
// Idempotente: cada step escreve em _bootstrap_state. Re-execução pula
// steps já concluídos. Pode rodar em fases via ?phase=migrations / functions / vercel
// caso aproxime do timeout (60s no Hobby).
//
// Contrato:
//   POST /api/bootstrap
//   Body: { supabase_url, supabase_anon_key, supabase_service_role_key,
//           supabase_pat, vercel_token, owner_email, owner_password,
//           phase? }
//   Response 200: { success, steps_completed: string[], deployment?: {...} }
//   Response 4xx/5xx: { success:false, step_failed, message }

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

type BootstrapBody = {
  supabase_url: string
  supabase_anon_key: string
  supabase_service_role_key: string
  supabase_pat: string
  vercel_token: string
  owner_email: string
  owner_password: string
  phase?: 'all' | 'init' | 'migrations' | 'functions' | 'vercel' | 'owner'
}

type StepResult = { step: string; ok: boolean; skipped?: boolean; message?: string }

// ---------------------------------------------------------------------
// Helpers — Supabase Management API
// ---------------------------------------------------------------------

function extractProjectRef(supabaseUrl: string): string {
  // ex: https://xhznjliw....supabase.co  →  xhznjliw...
  const u = new URL(supabaseUrl)
  return u.hostname.split('.')[0]
}

async function runSQL(pat: string, ref: string, sql: string): Promise<void> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SQL falhou (${res.status}): ${text.slice(0, 500)}`)
  }
}

async function getAdminClient(url: string, serviceKey: string) {
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

async function markStep(
  url: string,
  serviceKey: string,
  step: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const supabase = await getAdminClient(url, serviceKey)
  const { error } = await supabase
    .from('_bootstrap_state')
    .upsert({ step, completed_at: new Date().toISOString(), metadata })
  if (error) throw new Error(`Falha ao marcar step ${step}: ${error.message}`)
}

async function stepDone(url: string, serviceKey: string, step: string): Promise<boolean> {
  try {
    const supabase = await getAdminClient(url, serviceKey)
    const { data, error } = await supabase
      .from('_bootstrap_state')
      .select('step')
      .eq('step', step)
      .maybeSingle()
    if (error) return false
    return !!data
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------
// Helpers — Vercel Management API
// ---------------------------------------------------------------------

async function vercelFetch<T = unknown>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Vercel API ${path} (${res.status}): ${text.slice(0, 500)}`)
  }
  return text ? (JSON.parse(text) as T) : ({} as T)
}

async function setVercelEnv(
  token: string,
  projectId: string,
  teamId: string | undefined,
  key: string,
  value: string,
): Promise<void> {
  const params = new URLSearchParams()
  if (teamId) params.set('teamId', teamId)
  params.set('upsert', 'true')
  const createUrl = `/v10/projects/${projectId}/env?${params.toString()}`
  try {
    await vercelFetch(token, createUrl, {
      method: 'POST',
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: ['production', 'preview', 'development'],
      }),
    })
  } catch (err) {
    // Fallback: buscar id da env e fazer PATCH
    const listParams = new URLSearchParams()
    if (teamId) listParams.set('teamId', teamId)
    const listQuery = listParams.toString() ? `?${listParams.toString()}` : ''
    const list = await vercelFetch<{ envs: Array<{ id: string; key: string }> }>(
      token,
      `/v9/projects/${projectId}/env${listQuery}`,
    )
    const existing = list.envs.find((e) => e.key === key)
    if (!existing) throw err
    await vercelFetch(token, `/v9/projects/${projectId}/env/${existing.id}${listQuery}`, {
      method: 'PATCH',
      body: JSON.stringify({
        value,
        target: ['production', 'preview', 'development'],
      }),
    })
  }
}

// ---------------------------------------------------------------------
// Helpers — leitura dos arquivos do projeto (migrations + EFs)
// ---------------------------------------------------------------------

const PROJECT_ROOT = process.cwd()
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'supabase', 'migrations')
const FUNCTIONS_DIR = path.join(PROJECT_ROOT, 'supabase', 'functions')

async function listMigrations(): Promise<{ name: string; sql: string }[]> {
  const files = await readdir(MIGRATIONS_DIR)
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort()
  const out: { name: string; sql: string }[] = []
  for (const file of sqlFiles) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
    out.push({ name: file, sql })
  }
  return out
}

async function listFunctions(): Promise<string[]> {
  const entries = await readdir(FUNCTIONS_DIR)
  const out: string[] = []
  for (const entry of entries) {
    if (entry.startsWith('_') || entry.startsWith('.')) continue
    const p = path.join(FUNCTIONS_DIR, entry)
    const st = await stat(p)
    if (!st.isDirectory()) continue
    try {
      await stat(path.join(p, 'index.ts'))
      out.push(entry)
    } catch {
      /* sem index.ts → ignora */
    }
  }
  return out.sort()
}

async function readFunctionFiles(
  slug: string,
): Promise<{ entrypoint: string; files: { path: string; content: string }[] }> {
  const dir = path.join(FUNCTIONS_DIR, slug)
  const out: { path: string; content: string }[] = []
  // Inclui o próprio diretório + o _shared (se EF importa dele)
  async function walk(base: string, prefix: string) {
    const entries = await readdir(base)
    for (const e of entries) {
      const fp = path.join(base, e)
      const st = await stat(fp)
      if (st.isDirectory()) {
        await walk(fp, path.posix.join(prefix, e))
      } else if (e.endsWith('.ts') || e.endsWith('.json')) {
        const content = await readFile(fp, 'utf8')
        out.push({ path: path.posix.join(prefix, e), content })
      }
    }
  }
  await walk(dir, '')
  // Inclui _shared/* como subfolder ao lado de index.ts
  const sharedDir = path.join(FUNCTIONS_DIR, '_shared')
  try {
    const sharedEntries = await readdir(sharedDir)
    for (const e of sharedEntries) {
      const fp = path.join(sharedDir, e)
      const st = await stat(fp)
      if (st.isFile() && (e.endsWith('.ts') || e.endsWith('.json'))) {
        const content = await readFile(fp, 'utf8')
        out.push({ path: path.posix.join('_shared', e), content })
      }
    }
  } catch {
    /* sem _shared → ignora */
  }
  return { entrypoint: 'index.ts', files: out }
}

// ---------------------------------------------------------------------
// Deploy de Edge Function via Supabase Management API (multipart)
// ---------------------------------------------------------------------

async function deployEdgeFunction(
  pat: string,
  ref: string,
  slug: string,
): Promise<void> {
  const { entrypoint, files } = await readFunctionFiles(slug)

  const form = new FormData()
  form.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          entrypoint_path: entrypoint,
          name: slug,
          verify_jwt: false,
        }),
      ],
      { type: 'application/json' },
    ),
    'metadata.json',
  )
  for (const f of files) {
    form.append('file', new Blob([f.content], { type: 'application/typescript' }), f.path)
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${pat}` },
      body: form,
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Deploy de ${slug} falhou (${res.status}): ${text.slice(0, 500)}`)
  }
}

async function setEdgeFunctionSecrets(
  pat: string,
  ref: string,
  secrets: Record<string, string>,
): Promise<void> {
  const payload = Object.entries(secrets).map(([name, value]) => ({ name, value }))
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Set secrets falhou (${res.status}): ${text.slice(0, 300)}`)
  }
}

// ---------------------------------------------------------------------
// Owner creation
// ---------------------------------------------------------------------

async function createOwnerUser(
  url: string,
  serviceKey: string,
  email: string,
  password: string,
): Promise<{ id: string } | null> {
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  // Verifica se já existe pra ser idempotente
  const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (list.error) throw new Error(`listUsers: ${list.error.message}`)
  const existing = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (existing) return { id: existing.id }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`createUser: ${error.message}`)
  return data.user ? { id: data.user.id } : null
}

// ---------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .status(204)
      .end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Use POST' })
  }

  const body = req.body as BootstrapBody
  const required: (keyof BootstrapBody)[] = [
    'supabase_url',
    'supabase_anon_key',
    'supabase_service_role_key',
    'supabase_pat',
    'vercel_token',
    'owner_email',
    'owner_password',
  ]
  for (const k of required) {
    if (!body || typeof body[k] !== 'string' || !(body[k] as string).length) {
      return res
        .status(400)
        .json({ success: false, message: `Campo obrigatório ausente: ${k}` })
    }
  }

  const phase = body.phase ?? 'all'
  const ref = extractProjectRef(body.supabase_url)
  const steps: StepResult[] = []

  try {
    // -----------------------------------------------------------------
    // INIT — Garante _bootstrap_state e app_settings antes de tudo.
    // -----------------------------------------------------------------
    if (phase === 'all' || phase === 'init') {
      const initSQL = `
        CREATE TABLE IF NOT EXISTS public._bootstrap_state (
          step TEXT PRIMARY KEY,
          completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          metadata JSONB DEFAULT '{}'::jsonb
        );
        ALTER TABLE public._bootstrap_state ENABLE ROW LEVEL SECURITY;

        CREATE TABLE IF NOT EXISTS public.app_settings (
          key TEXT PRIMARY KEY,
          value_encrypted TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
      `
      await runSQL(body.supabase_pat, ref, initSQL)
      await markStep(body.supabase_url, body.supabase_service_role_key, 'init')
      steps.push({ step: 'init', ok: true })
    }

    // -----------------------------------------------------------------
    // MIGRATIONS
    // -----------------------------------------------------------------
    if (phase === 'all' || phase === 'migrations') {
      const migrations = await listMigrations()
      for (const m of migrations) {
        const stepKey = `migration:${m.name}`
        if (await stepDone(body.supabase_url, body.supabase_service_role_key, stepKey)) {
          steps.push({ step: stepKey, ok: true, skipped: true })
          continue
        }
        try {
          await runSQL(body.supabase_pat, ref, m.sql)
          await markStep(body.supabase_url, body.supabase_service_role_key, stepKey, {
            name: m.name,
          })
          steps.push({ step: stepKey, ok: true })
        } catch (err) {
          steps.push({ step: stepKey, ok: false, message: (err as Error).message })
          throw err
        }
      }
      await markStep(body.supabase_url, body.supabase_service_role_key, 'migrations_done', {
        count: migrations.length,
      })
    }

    // -----------------------------------------------------------------
    // EDGE FUNCTIONS — secrets primeiro (precisam estar no place antes do deploy)
    // -----------------------------------------------------------------
    if (phase === 'all' || phase === 'functions') {
      // CRYPTO_KEY: gera só uma vez (persiste em _bootstrap_state.metadata)
      let cryptoKey = process.env.CRYPTO_KEY
      const existingMeta = await (async () => {
        const supabase = createClient(body.supabase_url, body.supabase_service_role_key, {
          auth: { persistSession: false },
        })
        const { data } = await supabase
          .from('_bootstrap_state')
          .select('metadata')
          .eq('step', 'crypto_key_generated')
          .maybeSingle()
        return data as { metadata: { value: string } } | null
      })()
      if (existingMeta?.metadata?.value) {
        cryptoKey = existingMeta.metadata.value
      } else if (!cryptoKey) {
        cryptoKey = randomBytes(32).toString('hex')
        await markStep(
          body.supabase_url,
          body.supabase_service_role_key,
          'crypto_key_generated',
          { value: cryptoKey },
        )
      }

      // Set secrets nas Edge Functions (CRYPTO_KEY é o único realmente necessário
      // além das auto-injetadas SUPABASE_URL/SERVICE_ROLE_KEY).
      await setEdgeFunctionSecrets(body.supabase_pat, ref, {
        CRYPTO_KEY: cryptoKey,
      })
      await markStep(body.supabase_url, body.supabase_service_role_key, 'ef_secrets_set')
      steps.push({ step: 'ef_secrets_set', ok: true })

      // Deploy cada EF
      const slugs = await listFunctions()
      for (const slug of slugs) {
        const stepKey = `ef:${slug}`
        if (await stepDone(body.supabase_url, body.supabase_service_role_key, stepKey)) {
          steps.push({ step: stepKey, ok: true, skipped: true })
          continue
        }
        try {
          await deployEdgeFunction(body.supabase_pat, ref, slug)
          await markStep(body.supabase_url, body.supabase_service_role_key, stepKey)
          steps.push({ step: stepKey, ok: true })
        } catch (err) {
          steps.push({ step: stepKey, ok: false, message: (err as Error).message })
          throw err
        }
      }
    }

    // -----------------------------------------------------------------
    // OWNER — cria o usuário primário antes do redeploy
    // -----------------------------------------------------------------
    if (phase === 'all' || phase === 'owner') {
      if (!(await stepDone(body.supabase_url, body.supabase_service_role_key, 'owner_created'))) {
        const u = await createOwnerUser(
          body.supabase_url,
          body.supabase_service_role_key,
          body.owner_email,
          body.owner_password,
        )
        await markStep(body.supabase_url, body.supabase_service_role_key, 'owner_created', {
          email: body.owner_email,
          user_id: u?.id,
        })
      }
      steps.push({ step: 'owner_created', ok: true })
    }

    // -----------------------------------------------------------------
    // VERCEL — set envs + redeploy
    // -----------------------------------------------------------------
    let deployment: { id?: string; url?: string } | undefined
    if (phase === 'all' || phase === 'vercel') {
      const projectId = process.env.VERCEL_PROJECT_ID
      const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID
      if (!projectId) {
        throw new Error(
          'VERCEL_PROJECT_ID não disponível no runtime. Reabra o wizard após o primeiro deploy do template.',
        )
      }

      // Pega CRYPTO_KEY do state
      const supabase = createClient(body.supabase_url, body.supabase_service_role_key, {
        auth: { persistSession: false },
      })
      const { data: cryptoRow } = await supabase
        .from('_bootstrap_state')
        .select('metadata')
        .eq('step', 'crypto_key_generated')
        .maybeSingle()
      const cryptoKey = (cryptoRow as { metadata?: { value?: string } } | null)?.metadata?.value
      if (!cryptoKey) throw new Error('CRYPTO_KEY ausente no _bootstrap_state')

      const envs: Record<string, string> = {
        VITE_SUPABASE_URL: body.supabase_url,
        VITE_SUPABASE_ANON_KEY: body.supabase_anon_key,
        SUPABASE_URL: body.supabase_url,
        SUPABASE_ANON_KEY: body.supabase_anon_key,
        SUPABASE_SERVICE_ROLE_KEY: body.supabase_service_role_key,
        CRYPTO_KEY: cryptoKey,
      }

      for (const [k, v] of Object.entries(envs)) {
        await setVercelEnv(body.vercel_token, projectId, teamId, k, v)
      }
      await markStep(body.supabase_url, body.supabase_service_role_key, 'vercel_envs_set')
      steps.push({ step: 'vercel_envs_set', ok: true })

      // Redeploy: pega o deployment mais recente em production e re-cria
      const teamQuery = teamId ? `?teamId=${teamId}&` : '?'
      const deployments = await vercelFetch<{
        deployments: Array<{ uid: string; meta?: Record<string, string>; name: string }>
      }>(
        body.vercel_token,
        `/v6/deployments${teamQuery}projectId=${projectId}&limit=1&target=production`,
      )
      const latest = deployments.deployments[0]
      if (latest) {
        const redep = await vercelFetch<{ id: string; url: string }>(
          body.vercel_token,
          `/v13/deployments${teamId ? `?forceNew=1&teamId=${teamId}` : '?forceNew=1'}`,
          {
            method: 'POST',
            body: JSON.stringify({
              name: latest.name,
              deploymentId: latest.uid,
              target: 'production',
            }),
          },
        )
        deployment = { id: redep.id, url: redep.url }
        await markStep(body.supabase_url, body.supabase_service_role_key, 'redeploy_triggered', {
          deployment_id: redep.id,
          url: redep.url,
        })
        steps.push({ step: 'redeploy_triggered', ok: true })
      } else {
        steps.push({
          step: 'redeploy_triggered',
          ok: false,
          message: 'Nenhum deployment anterior encontrado — push manual necessário',
        })
      }
    }

    return res.status(200).json({
      success: true,
      steps_completed: steps,
      deployment,
    })
  } catch (err) {
    const lastFailed = steps.find((s) => !s.ok)?.step ?? 'unknown'
    return res.status(500).json({
      success: false,
      step_failed: lastFailed,
      message: (err as Error).message,
      steps_completed: steps,
    })
  }
}
