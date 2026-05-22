// api/validate-token.ts
//
// Valida tokens "core" (Supabase + Vercel) SERVER-SIDE, sem nunca expor os
// valores no browser. O Step 2 do wizard chama esta rota em vez de pingar
// api.supabase.com / api.vercel.com diretamente do client (onde o token
// apareceria no DevTools/Network e seria captável por extensões/SW maliciosos).
//
// Contrato:
//   POST /api/validate-token
//   Body: { type, value, supabase_url? }
//   Response 200: { valid: boolean, message?: string }
//
// ⚠️ NUNCA logar `value`. Só `type` + tamanho + outcome.

import type { VercelRequest, VercelResponse } from '@vercel/node'

type TokenType =
  | 'supabase_anon_key'
  | 'supabase_service_role_key'
  | 'supabase_pat'
  | 'vercel_token'

type ValidateBody = {
  type: TokenType
  value: string
  // anon_key e service_role_key precisam da URL do projeto para o ping.
  supabase_url?: string
}

// supabase_url em si é validado client-side (regex, não envolve token).
const SUPABASE_URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/

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
    return res.status(405).json({ valid: false, message: 'Use POST' })
  }

  const { type, value, supabase_url } = (req.body ?? {}) as ValidateBody

  if (typeof value !== 'string' || value.length === 0) {
    return res.status(400).json({ valid: false, message: 'Valor ausente' })
  }
  if (typeof type !== 'string') {
    return res.status(400).json({ valid: false, message: 'Tipo ausente' })
  }

  const logCtx = { type, value_length: value.length }

  try {
    let valid = false
    let message: string | undefined

    switch (type) {
      case 'supabase_anon_key':
      case 'supabase_service_role_key': {
        if (!supabase_url || !SUPABASE_URL_RE.test(supabase_url)) {
          return res
            .status(400)
            .json({ valid: false, message: 'URL Supabase válida necessária' })
        }
        const base = supabase_url.replace(/\/$/, '')
        const r = await fetch(`${base}/rest/v1/`, {
          headers: { apikey: value, Authorization: `Bearer ${value}` },
        })
        if (r.status === 401) {
          message = 'Chave Supabase inválida ou sem permissão'
        } else if (r.status >= 200 && r.status < 500) {
          valid = true
        } else {
          message = `Erro ${r.status} ao validar`
        }
        break
      }

      case 'supabase_pat': {
        const r = await fetch('https://api.supabase.com/v1/projects', {
          headers: { Authorization: `Bearer ${value}` },
        })
        if (r.ok) {
          valid = true
        } else {
          message =
            r.status === 401
              ? 'Personal Access Token Supabase sem permissão (401)'
              : `Erro ${r.status}`
        }
        break
      }

      case 'vercel_token': {
        const r = await fetch('https://api.vercel.com/v2/user', {
          headers: { Authorization: `Bearer ${value}` },
        })
        if (r.status === 401 || r.status === 403) {
          message = 'Token Vercel inválido'
        } else if (!r.ok) {
          message = `Erro ${r.status}`
        } else {
          valid = true
        }
        break
      }

      default:
        return res.status(400).json({ valid: false, message: 'Tipo de token desconhecido' })
    }

    console.log('[validate-token]', JSON.stringify({ ...logCtx, valid }))
    return res.status(200).json({ valid, message })
  } catch (err) {
    console.error(
      '[validate-token] erro:',
      JSON.stringify({ ...logCtx, error: (err as Error).message }),
    )
    return res
      .status(502)
      .json({ valid: false, message: 'Falha ao validar token (serviço externo indisponível)' })
  }
}
