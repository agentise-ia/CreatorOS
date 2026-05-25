import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    // RFC-pragmático: bloqueia caracteres HTML/JS na parte local e no domínio.
    const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/
    if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
      return json({ error: 'Email inválido' }, 400)
    }

    // De-dup: já existe convite pendente (não usado, não revogado, não expirado)?
    const nowIso = new Date().toISOString()
    const { data: existing } = await supabase
      .from('invites')
      .select('id')
      .eq('email', email)
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .limit(1)
      .maybeSingle()
    if (existing) {
      return json({
        error: 'Já existe um convite ativo para este email. Revogue-o antes de criar outro.',
        existing_invite_id: (existing as { id: string }).id,
      }, 409)
    }

    // URL pra onde o magic link redireciona: a tela /invite do app.
    const origin = req.headers.get('Origin') ?? req.headers.get('Referer') ?? ''
    const redirectTo = origin ? `${origin.replace(/\/$/, '')}/invite` : undefined

    // Convite NATIVO: o Supabase cria o usuário (com invited_at) e dispara o
    // email com o magic link. Requer SMTP configurado em Auth → Settings (o
    // sender default é rate-limited e só pra teste).
    const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    )
    if (inviteErr) {
      // Ex.: email já registrado, ou SMTP não configurado.
      return json({ error: `Falha ao enviar convite: ${inviteErr.message}` }, 400)
    }

    // Registra o convite pendente (pra TeamPage listar / owner revogar). O token
    // só satisfaz a coluna NOT NULL UNIQUE legada — não é mais usado no fluxo.
    const tokenBytes = new Uint8Array(16)
    crypto.getRandomValues(tokenBytes)
    const placeholderToken =
      'native_' + Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('')

    const { data: invite, error: insertErr } = await supabase
      .from('invites')
      .insert({ email, token: placeholderToken, role: 'member', invited_by: user.id })
      .select('id, email, expires_at')
      .single()

    if (insertErr) {
      // O email já foi enviado; só o tracking falhou. Não é fatal.
      return json({ ok: true, email, warning: `Convite enviado, mas o tracking falhou: ${insertErr.message}` })
    }

    return json({
      ok: true,
      email,
      invite_id: invite.id,
      expires_at: invite.expires_at,
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
