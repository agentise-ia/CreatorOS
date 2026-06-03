import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCredential } from '../_shared/credentials.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_RETRIES = 3
const FETCH_TIMEOUT_MS = 90_000
const OVERALL_JOB_TIMEOUT_MS = 600_000 // 10 min wall-clock pro job inteiro

interface GenerateVPRequest {
  profile_id: string
  reel_ids: string[]
  user_id: string
  model_provider: 'openai'
  model_id: string
}

function log(level: string, message: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...data }))
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= retries; attempt++) {
    const signal = options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, { ...options, signal })
      if (response.ok || response.status < 500) return response
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 30000)))
    }
  }
  throw lastError ?? new Error('fetchWithRetry exhausted all retries')
}

const VP_PROMPT = `Analise as transcrições abaixo de {count} vídeos do mesmo criador de conteúdo do Instagram e extraia um perfil completo do tom de fala.

TRANSCRIÇÕES:
{transcriptions}

Retorne APENAS um JSON válido com esta estrutura:
{
  "vocabulary_style": "descrição do estilo de vocabulário",
  "sentence_structure": "descrição da estrutura das frases",
  "filler_words": ["palavras", "de", "preenchimento"],
  "common_expressions": ["expressões", "frequentes"],
  "tone_description": "descrição do tom geral",
  "pacing_style": "descrição do ritmo de fala",
  "emotional_range": "descrição da variação emocional",
  "speech_patterns": {
    "opening_patterns": ["como costuma abrir"],
    "closing_patterns": ["como costuma fechar"],
    "transition_phrases": ["frases de transição"],
    "emphasis_techniques": ["como enfatiza pontos"]
  },
  "full_profile_document": "Documento completo e detalhado descrevendo o tom de fala do criador, com exemplos concretos. Deve ser suficiente para reproduzir fielmente o tom ao escrever roteiros."
}`

function isReasoningModel(modelId: string): boolean {
  return /^gpt-5/i.test(modelId) || /^o[1-9]/i.test(modelId)
}

function extractResponsesText(result: Record<string, unknown>): string {
  if (typeof result.output_text === 'string') return result.output_text
  const output = result.output as unknown
  if (!Array.isArray(output)) return ''
  let text = ''
  for (const item of output) {
    if (item && typeof item === 'object' && 'content' in item && Array.isArray((item as { content: unknown[] }).content)) {
      for (const c of (item as { content: Array<Record<string, unknown>> }).content) {
        if ((c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') text += c.text
      }
    }
  }
  return text
}

async function generateWithOpenAI(
  prompt: string,
  openaiKey: string,
  modelId: string
): Promise<Record<string, unknown>> {
  if (isReasoningModel(modelId)) {
    const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: modelId,
        input: prompt,
        reasoning: { effort: 'low' },
        text: { verbosity: 'medium', format: { type: 'json_object' } },
      }),
    })
    if (!response.ok) throw new Error(`OpenAI Responses API failed (${response.status}): ${await response.text()}`)
    const result = await response.json()
    const text = extractResponsesText(result) || '{}'
    try { return JSON.parse(text) } catch {
      const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {}
    }
  }

  const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) throw new Error(`OpenAI API failed (${response.status}): ${await response.text()}`)

  const result = await response.json()
  const text = result.choices?.[0]?.message?.content ?? '{}'
  try { return JSON.parse(text) } catch {
    const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {}
  }
}

async function processInBackground(
  supabase: SupabaseClient,
  jobId: string,
  profileId: string,
  reelIds: string[],
  userId: string,
  modelId: string,
  openaiKey: string
) {
  // Wall-clock 10-min defense (idem analyze-content): garante que o job
  // sempre finalize em vez de ficar travado em 'processing'.
  let overallTimer: number | undefined
  const overallTimeout = new Promise<never>((_, reject) => {
    overallTimer = setTimeout(() => {
      reject(new Error(`Job excedeu wall-clock timeout de ${OVERALL_JOB_TIMEOUT_MS}ms`))
    }, OVERALL_JOB_TIMEOUT_MS) as unknown as number
  })

  try {
    await Promise.race([
      overallTimeout,
      voiceProfileCore(supabase, jobId, profileId, reelIds, userId, modelId, openaiKey),
    ])
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('error', 'Voice profile generation failed', { jobId, error: errorMessage })
    await supabase.from('processing_jobs').update({
      status: 'failed', error_message: errorMessage, completed_at: new Date().toISOString(),
    }).eq('id', jobId).in('status', ['pending', 'processing'])
  } finally {
    if (overallTimer !== undefined) clearTimeout(overallTimer)
  }
}

async function voiceProfileCore(
  supabase: SupabaseClient,
  jobId: string,
  profileId: string,
  reelIds: string[],
  userId: string,
  modelId: string,
  openaiKey: string
) {
  try {
    // Check for existing transcriptions
    const { data: existingTx } = await supabase
      .from('transcriptions')
      .select('reel_id, full_text')
      .in('reel_id', reelIds)

    const existingMap = new Map<string, string>()
    for (const t of (existingTx ?? []) as { reel_id: string; full_text: string }[]) {
      existingMap.set(t.reel_id, t.full_text)
    }

    // Transcribe reels that don't have transcriptions yet
    const missingReelIds = reelIds.filter((id) => !existingMap.has(id))
    if (missingReelIds.length > 0 && openaiKey) {
      log('info', `Transcribing ${missingReelIds.length} reels for voice profile`, { jobId })

      for (let i = 0; i < missingReelIds.length; i++) {
        const rid = missingReelIds[i]
        try {
          const { data: reel } = await supabase.from('reels').select('video_url').eq('id', rid).single()
          if (!reel?.video_url) continue

          // Download and transcribe
          const videoRes = await fetchWithRetry(reel.video_url, { method: 'GET' })
          const videoBlob = await videoRes.blob()
          const formData = new FormData()
          formData.append('file', videoBlob, 'audio.mp4')
          formData.append('model', 'whisper-1')
          formData.append('language', 'pt')
          formData.append('response_format', 'verbose_json')
          formData.append('timestamp_granularities[]', 'word')
          formData.append('timestamp_granularities[]', 'segment')

          const whisperRes = await fetchWithRetry('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${openaiKey}` },
            body: formData,
          })

          if (whisperRes.ok) {
            const result = await whisperRes.json()
            const fullText = result.text ?? ''

            await supabase.from('transcriptions').upsert({
              reel_id: rid,
              full_text: fullText,
              language: 'pt',
              segments: result.segments ?? [],
              whisper_model: 'whisper-1',
              processed_at: new Date().toISOString(),
            }, { onConflict: 'reel_id' })

            existingMap.set(rid, fullText)
          }
        } catch (err) {
          log('warn', `Failed to transcribe reel ${rid}: ${err}`)
        }

        const progress = Math.round(((i + 1) / missingReelIds.length) * 25)
        await supabase.from('processing_jobs').update({ progress }).eq('id', jobId)
      }
    }

    const available = Array.from(existingMap.entries()).map(([, text]) => ({ full_text: text }))
    if (available.length === 0) {
      throw new Error('Não foi possível transcrever nenhum reel. Verifique se os vídeos estão acessíveis.')
    }

    await supabase.from('processing_jobs').update({ progress: 30 }).eq('id', jobId)

    const combinedText = available
      .map((t: { full_text: string }, i: number) => `--- Vídeo ${i + 1} ---\n${t.full_text}`)
      .join('\n\n')

    const prompt = VP_PROMPT
      .replace('{count}', String(available.length))
      .replace('{transcriptions}', combinedText)

    log('info', `Generating voice profile with openai/${modelId}`, { jobId })

    const profile = await generateWithOpenAI(prompt, openaiKey, modelId)

    await supabase.from('processing_jobs').update({ progress: 80 }).eq('id', jobId)

    const vpData = {
      user_id: userId,
      profile_id: profileId,
      vocabulary_style: (profile.vocabulary_style as string) ?? null,
      sentence_structure: (profile.sentence_structure as string) ?? null,
      filler_words: (profile.filler_words as string[]) ?? [],
      common_expressions: (profile.common_expressions as string[]) ?? [],
      tone_description: (profile.tone_description as string) ?? null,
      pacing_style: (profile.pacing_style as string) ?? null,
      emotional_range: (profile.emotional_range as string) ?? null,
      speech_patterns: (profile.speech_patterns as Record<string, unknown>) ?? null,
      full_profile_document: (profile.full_profile_document as string) ?? 'Profile generation failed.',
      source_reel_ids: reelIds,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await supabase.from('voice_profiles').delete().eq('user_id', userId).eq('profile_id', profileId)
    const { error: insertError } = await supabase.from('voice_profiles').insert(vpData)
    if (insertError) throw new Error(`Failed to save voice profile: ${insertError.message}`)

    await supabase.from('processing_jobs').update({
      status: 'completed', progress: 100,
      output_data: { transcriptions_used: available.length, model: `openai/${modelId}` },
      completed_at: new Date().toISOString(),
    }).eq('id', jobId).in('status', ['pending', 'processing'])

    log('info', 'Voice profile generated', { jobId })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('error', 'Voice profile generation failed', { jobId, error: errorMessage })
    await supabase.from('processing_jobs').update({
      status: 'failed', error_message: errorMessage, completed_at: new Date().toISOString(),
    }).eq('id', jobId).in('status', ['pending', 'processing'])
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const openaiKey = await getCredential('openai_api_key')

    const missing: string[] = []
    if (!supabaseUrl) missing.push('SUPABASE_URL')
    if (!supabaseServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
    if (!openaiKey) missing.push('openai_api_key (configure em /setup ou /settings)')
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Credenciais ausentes: ${missing.join(', ')}.`,
          instrucao: 'Abra /setup ou /settings no app para configurar as APIs.',
        }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const body: GenerateVPRequest = await req.json()
    const { profile_id, reel_ids, user_id, model_id = 'gpt-4.1' } = body

    if (!profile_id || !reel_ids || reel_ids.length === 0 || !user_id) {
      return new Response(JSON.stringify({ error: 'profile_id, reel_ids, and user_id are required' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (!openaiKey) throw new Error('OPENAI_API_KEY not configured')

    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .insert({
        user_id, job_type: 'voice_profile', status: 'processing', progress: 0,
        input_data: { profile_id, reel_ids, model_provider: 'openai', model_id },
        started_at: new Date().toISOString(),
      })
      .select('id').single()

    if (jobError || !job) throw new Error(`Failed to create job: ${jobError?.message}`)

    const backgroundTask = processInBackground(
      supabase, job.id, profile_id, reel_ids, user_id, model_id, openaiKey
    )

    try {
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
      if (runtime?.waitUntil) runtime.waitUntil(backgroundTask)
    } catch {
      backgroundTask.catch((err) => log('error', 'Background task failed', { error: String(err) }))
    }

    return new Response(JSON.stringify({ job_id: job.id }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('error', 'Request handler failed', { error: errorMessage })
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
