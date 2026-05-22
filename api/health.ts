import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).end()
  }

  const requiredEnvs = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CRYPTO_KEY',
  ]
  const missing = requiredEnvs.filter((key) => !process.env[key])
  const ready = missing.length === 0

  res.setHeader('Cache-Control', 'no-store, max-age=0')
  return res.status(ready ? 200 : 503).json({ ready })
}
