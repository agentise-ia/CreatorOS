import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface RevokeInviteRequest {
  invite_id: string
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
      return json({ error: 'Apenas o owner pode revogar convites' }, 403)
    }

    const body: RevokeInviteRequest = await req.json()
    if (!body.invite_id) return json({ error: 'invite_id obrigatório' }, 400)

    const { error: updateErr } = await supabase
      .from('invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', body.invite_id)
      .is('used_at', null)
      .is('revoked_at', null)

    if (updateErr) return json({ error: updateErr.message }, 500)

    return json({ ok: true })
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
