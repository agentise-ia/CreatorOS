import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCredential } from '../_shared/credentials.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface CreateInviteRequest {
  email: string
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    const missing: string[] = []
    if (!supabaseUrl) missing.push('SUPABASE_URL')
    if (!supabaseServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
    if (missing.length > 0) {
      return json({
        error: `Secrets ausentes: ${missing.join(', ')}.`,
        instrucao: 'Configure em Supabase Dashboard → Project Settings → Edge Functions → Secrets.',
      }, 500)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Não autorizado' }, 401)

    const supabase = createClient(supabaseUrl!, supabaseServiceKey!, {
      auth: { persistSession: false },
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Sessão inválida' }, 401)

    const { data: caller } = await supabase
      .from('app_users')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (!caller || caller.role !== 'owner') {
      return json({ error: 'Apenas o owner pode criar convites' }, 403)
    }

    let body: CreateInviteRequest
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body deve ser JSON válido' }, 400)
    }
    const email = (body.email || '').toLowerCase().trim()

    // RFC-pragmático: alfanum + ._%+- antes do @, alfanum + .- depois, TLD com 2+ letras.
    // Bloqueia caracteres HTML/JS na parte local e no domínio.
    const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/
    if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
      return json({ error: 'Email inválido' }, 400)
    }

    // De-dup: rejeitar se já existe convite ativo (não revogado, não usado, não expirado)
    // para este email. Owner pode revogar e criar de novo se quiser reenviar.
    const nowIso = new Date().toISOString()
    const { data: existing, error: existingErr } = await supabase
      .from('invites')
      .select('id, expires_at, revoked_at, used_at')
      .eq('email', email)
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .limit(1)
      .maybeSingle()
    if (existingErr) return json({ error: existingErr.message }, 500)
    if (existing) {
      return json({
        error: 'Já existe um convite ativo para este email. Revogue-o antes de criar outro.',
        existing_invite_id: existing.id,
      }, 409)
    }

    const tokenBytes = new Uint8Array(32)
    crypto.getRandomValues(tokenBytes)
    const inviteToken = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const { data: invite, error: insertErr } = await supabase
      .from('invites')
      .insert({
        email,
        token: inviteToken,
        role: 'member',
        invited_by: user.id,
      })
      .select('id, email, expires_at, created_at')
      .single()

    if (insertErr) return json({ error: insertErr.message }, 500)

    // Origem do link: prefere o header Origin (URL real do app no momento do request),
    // com fallback para o app_url salvo em app_settings (caso configurado).
    const originHeader = req.headers.get('Origin') ?? req.headers.get('Referer') ?? ''
    const appUrl = originHeader
      ? originHeader.replace(/\/$/, '')
      : ((await getCredential('app_url')) ?? '').replace(/\/$/, '')
    const inviteUrl = appUrl
      ? `${appUrl}/invite?token=${inviteToken}`
      : `/invite?token=${inviteToken}`

    const resendKey = await getCredential('resend_api_key')
    const emailFrom = (await getCredential('email_from')) ?? 'noreply@example.com'
    let emailSent = false
    if (resendKey) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: emailFrom,
            to: email,
            subject: 'Você foi convidado para o Creator OS',
            html: `<p>Você foi convidado para esta instância do Creator OS.</p>
                   <p>Acesse o link abaixo para criar sua conta (válido por 7 dias):</p>
                   <p><a href="${inviteUrl}">${inviteUrl}</a></p>`,
          }),
        })
        emailSent = resendRes.ok
      } catch {
        emailSent = false
      }
    }

    return json({
      ok: true,
      invite_id: invite.id,
      invite_url: inviteUrl,
      expires_at: invite.expires_at,
      email_sent: emailSent,
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
