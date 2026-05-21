// api/credentials.ts
//
// Persiste e lista credenciais de aplicação (criptografadas via CRYPTO_KEY).
//
// POST /api/credentials
//   Body: { credentials: { key: value, ... } }
//   Salva cada par no app_settings (criptografado).
//   Re-valida cada credencial contra o manifesto setup.config.ts antes de salvar.
//
// GET /api/credentials
//   Retorna a lista de chaves presentes (sem valores).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setCredential, listCredentialKeys, markBootstrapStep } from '../lib/credentials.js'
import { setupConfig } from '../setup.config.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      .status(204)
      .end()
  }

  if (req.method === 'GET') {
    try {
      const keys = await listCredentialKeys()
      return res.status(200).json({ keys })
    } catch (err) {
      return res.status(500).json({ message: (err as Error).message })
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Use GET ou POST' })
  }

  const body = req.body as { credentials?: Record<string, string> }
  const credentials = body?.credentials ?? {}
  if (!credentials || typeof credentials !== 'object') {
    return res.status(400).json({ message: 'Body deve conter { credentials: { ... } }' })
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
    // Re-valida server-side
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

  // Se todas as credenciais obrigatórias foram salvas, marca setup completo
  const requiredKeys = setupConfig.appCredentials.filter((c) => !c.optional).map((c) => c.key)
  const allRequiredSaved = requiredKeys.every((k) => saved.includes(k))
  if (allRequiredSaved) {
    try {
      await markBootstrapStep('app_credentials_saved', { keys: saved })
      await markBootstrapStep('setup_complete')
    } catch (err) {
      // não bloqueia o sucesso do save em si
      console.error('Falha ao marcar setup_complete:', (err as Error).message)
    }
  }

  return res.status(200).json({ success: true, saved })
}
