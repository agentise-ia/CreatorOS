// lib/credentials.ts
// ⚠️ SERVER-SIDE ONLY. Nunca importar em código que vai pro client/browser.
// Usado pelas Vercel Serverless Functions em api/*.ts.
//
// Persiste credenciais de aplicação criptografadas (AES-256-GCM) na tabela
// app_settings do Supabase do aluno. Chave de cripto vive em CRYPTO_KEY (env
// Vercel) — se ela for perdida, os dados se tornam irrecuperáveis.

import { createClient } from '@supabase/supabase-js'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits, recomendado para GCM
const TAG_LENGTH = 16

function getKey(): Buffer {
  const hex = process.env.CRYPTO_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      'CRYPTO_KEY ausente ou inválida (esperado: 64 chars hex = 32 bytes). ' +
        'Refaça o wizard /setup ou verifique as envs do Vercel.',
    )
  }
  return Buffer.from(hex, 'hex')
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias no server')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export function generateCryptoKey(): string {
  return randomBytes(32).toString('hex')
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_LENGTH) throw new Error('Tag GCM com tamanho inesperado')
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) throw new Error('Payload de criptografia malformado')
  const [ivHex, tagHex, cipherHex] = parts
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

export async function getCredential(key: string): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('app_settings')
    .select('value_encrypted')
    .eq('key', key)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return decrypt((data as { value_encrypted: string }).value_encrypted)
}

export async function setCredential(key: string, plaintext: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  const value_encrypted = encrypt(plaintext)
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value_encrypted, updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function listCredentialKeys(): Promise<string[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.from('app_settings').select('key')
  if (error) throw error
  return ((data ?? []) as { key: string }[]).map((r) => r.key)
}

export async function markBootstrapStep(
  step: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('_bootstrap_state')
    .upsert({ step, completed_at: new Date().toISOString(), metadata })
  if (error) throw error
}

export async function isBootstrapStepCompleted(step: string): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('_bootstrap_state')
    .select('step')
    .eq('step', step)
    .maybeSingle()
  if (error) throw error
  return !!data
}

export async function listBootstrapSteps(): Promise<string[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.from('_bootstrap_state').select('step')
  if (error) throw error
  return ((data ?? []) as { step: string }[]).map((r) => r.step)
}
