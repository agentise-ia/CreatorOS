// supabase/functions/_shared/credentials.ts
//
// Helper compartilhado pelas Edge Functions. Lê credenciais criptografadas
// de app_settings (mesmo formato AES-256-GCM usado pelo lib/credentials.ts
// no lado Node/Vercel: iv_hex:tag_hex:ciphertext_hex).
//
// Web Crypto API (subtle) é usado em Deno em vez de node:crypto. Aceita
// a mesma chave de 32 bytes (hex de 64 chars) via CRYPTO_KEY.

// @ts-expect-error Deno remoto
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
declare const Deno: { env: { get(k: string): string | undefined } }

const ALGORITHM = 'AES-GCM'

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex de tamanho ímpar')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0')
  }
  return s
}

async function getCryptoKey(): Promise<CryptoKey> {
  const hex = Deno.env.get('CRYPTO_KEY')
  if (!hex || hex.length !== 64) {
    throw new Error(
      'CRYPTO_KEY ausente ou inválida nas Edge Function secrets (esperado 64 chars hex). ' +
        'Verifique o setup do wizard /setup.',
    )
  }
  const raw = hexToBytes(hex)
  return await crypto.subtle.importKey(
    'raw',
    raw,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function decrypt(payload: string): Promise<string> {
  const parts = payload.split(':')
  if (parts.length !== 3) throw new Error('Payload de criptografia malformado')
  const [ivHex, tagHex, cipherHex] = parts
  const iv = hexToBytes(ivHex)
  const tag = hexToBytes(tagHex)
  const ciphertext = hexToBytes(cipherHex)
  // Web Crypto AES-GCM espera ciphertext+tag concatenados
  const combined = new Uint8Array(ciphertext.length + tag.length)
  combined.set(ciphertext, 0)
  combined.set(tag, ciphertext.length)
  const key = await getCryptoKey()
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    combined,
  )
  return new TextDecoder().decode(plaintext)
}

export async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await getCryptoKey()
  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  )
  // Separa tag (últimos 16 bytes) do ciphertext
  const tag = ciphertextWithTag.slice(ciphertextWithTag.length - 16)
  const ciphertext = ciphertextWithTag.slice(0, ciphertextWithTag.length - 16)
  return `${bytesToHex(iv)}:${bytesToHex(tag)}:${bytesToHex(ciphertext)}`
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY auto-injetadas estão ausentes')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

// Cache simples por invocação (cada cold start zera)
const cache = new Map<string, { value: string; expires: number }>()
const CACHE_TTL_MS = 60_000

export async function getCredential(key: string): Promise<string | null> {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expires > now) return cached.value

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('app_settings')
    .select('value_encrypted')
    .eq('key', key)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const value = await decrypt((data as { value_encrypted: string }).value_encrypted)
  cache.set(key, { value, expires: now + CACHE_TTL_MS })
  return value
}

export async function requireCredential(key: string, label?: string): Promise<string> {
  const v = await getCredential(key)
  if (!v) {
    throw new Error(
      `Credencial "${label ?? key}" não configurada em app_settings. ` +
        'Abra /setup ou /settings para configurar antes de usar esta feature.',
    )
  }
  return v
}
