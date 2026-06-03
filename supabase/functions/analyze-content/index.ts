import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCredential } from '../_shared/credentials.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_RETRIES = 3
const FETCH_TIMEOUT_MS = 90_000 // 90s por request (upload/download de vídeo + LLM)
const PER_REEL_TIMEOUT_MS = 150_000 // 2.5 min por reel
const OVERALL_JOB_TIMEOUT_MS = 600_000 // 10 min wall-clock pro job inteiro

interface AnalyzeRequest {
  reel_ids: string[]
  user_id: string
  model_provider: 'openai'
  model_id: string
}

interface EditingElements {
  transitions: unknown[]
  music_segments: unknown[]
  sound_effects: unknown[]
  broll_segments: unknown[]
  text_overlays: unknown[]
  visual_effects: unknown[]
}

const EMPTY_EDITING_ELEMENTS: EditingElements = {
  transitions: [],
  music_segments: [],
  sound_effects: [],
  broll_segments: [],
  text_overlays: [],
  visual_effects: [],
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
    // AbortSignal.timeout aborta a conexão TCP, evitando requests pendurados
    // que NUNCA retornam (caso comum: provider trava após enviar headers).
    const signal = options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, { ...options, signal })
      if (response.ok || response.status < 500) return response
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`)
      log('warn', `Attempt ${attempt}/${retries} failed`, { status: response.status })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      log('warn', `Attempt ${attempt}/${retries} network error`, { error: lastError.message })
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 30000)))
    }
  }
  throw lastError ?? new Error('fetchWithRetry exhausted all retries')
}

async function transcribeWithWhisper(
  videoUrl: string,
  openaiKey: string
): Promise<{ full_text: string; segments: unknown[]; language: string }> {
  const videoResponse = await fetchWithRetry(videoUrl, { method: 'GET' })
  const videoBlob = await videoResponse.blob()

  const formData = new FormData()
  formData.append('file', videoBlob, 'audio.mp4')
  formData.append('model', 'whisper-1')
  // Sem 'language' fixo: Whisper detecta automaticamente o idioma do áudio.
  formData.append('response_format', 'verbose_json')
  formData.append('timestamp_granularities[]', 'word')
  formData.append('timestamp_granularities[]', 'segment')

  const response = await fetchWithRetry(
    'https://api.openai.com/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    }
  )

  if (!response.ok) {
    throw new Error(`Whisper API failed (${response.status}): ${await response.text()}`)
  }

  const result = await response.json()
  return {
    full_text: result.text ?? '',
    segments: result.segments ?? [],
    language: result.language ?? 'unknown',
  }
}

const STRUCTURE_PROMPT = `Analise esta transcrição de um Instagram Reel e identifique a estrutura narrativa.

TRANSCRIÇÃO:
{transcription}

Retorne APENAS um JSON válido com esta estrutura:
{
  "hook": { "text": "texto do hook", "start_ts": 0, "end_ts": 3, "type": "pergunta|afirmação chocante|promessa|polêmica|curiosidade", "effectiveness_score": 8 },
  "development": { "text": "resumo", "start_ts": 3, "end_ts": 25, "key_points": ["ponto 1"], "storytelling_technique": "storytelling|tutorial|lista|antes/depois|problema-solução" },
  "cta": { "text": "texto do CTA", "start_ts": 25, "end_ts": 30, "type": "seguir|comentar|compartilhar|link na bio|salvar", "strength_score": 7 },
  "viral_patterns": { "hook_type": "tipo", "pacing": "ritmo", "retention_technique": "técnica", "emotional_arc": "arco" }
}

Retorne APENAS o JSON.`

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

async function analyzeStructureWithOpenAI(
  transcription: string,
  openaiKey: string,
  modelId: string
): Promise<Record<string, unknown>> {
  const prompt = STRUCTURE_PROMPT.replace('{transcription}', transcription)

  if (isReasoningModel(modelId)) {
    const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: modelId,
        input: prompt,
        reasoning: { effort: 'medium' },
        text: { verbosity: 'low', format: { type: 'json_object' } },
      }),
    })
    if (!response.ok) {
      throw new Error(`OpenAI Responses API failed (${response.status}): ${await response.text()}`)
    }
    const result = await response.json()
    const text = extractResponsesText(result) || '{}'
    try {
      return JSON.parse(text)
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {}
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
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API failed (${response.status}): ${await response.text()}`)
  }

  const result = await response.json()
  const text = result.choices?.[0]?.message?.content ?? '{}'
  try {
    return JSON.parse(text)
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {}
  }
}

async function analyzeOneReel(
  supabase: SupabaseClient,
  reelId: string,
  modelId: string,
  openaiKey: string
) {
  const { data: reel, error: reelError } = await supabase
    .from('reels')
    .select('*')
    .eq('id', reelId)
    .single()

  if (reelError || !reel) {
    log('warn', `Reel not found: ${reelId}`)
    return
  }

  const videoUrl = reel.storage_path
    ? supabase.storage.from('videos').getPublicUrl(reel.storage_path).data.publicUrl
    : reel.video_url

  if (!videoUrl) {
    log('warn', `No video URL for reel ${reelId}`)
    return
  }

  // Mark editing analysis as processing
  await supabase.from('content_analyses').upsert({
    reel_id: reelId,
    hook: { text: '', start_ts: 0, end_ts: 0, type: 'pending', effectiveness_score: 0 },
    development: { text: '', start_ts: 0, end_ts: 0, key_points: [], storytelling_technique: 'pending' },
    cta: { text: '', start_ts: 0, end_ts: 0, type: 'pending', strength_score: 0 },
    editing_analysis_status: 'processing',
  }, { onConflict: 'reel_id' })

  // 1. Transcribe with Whisper
  log('info', 'Starting Whisper transcription', { reelId })
  const whisperResult = await transcribeWithWhisper(videoUrl, openaiKey)

  await supabase.from('transcriptions').upsert(
    {
      reel_id: reelId,
      full_text: whisperResult.full_text,
      language: whisperResult.language,
      segments: whisperResult.segments,
      whisper_model: 'whisper-1',
      processed_at: new Date().toISOString(),
    },
    { onConflict: 'reel_id' }
  )

  // 2. Analyze structure with OpenAI (text-only)
  log('info', `Starting structure analysis with openai/${modelId}`, { reelId })
  const structureAnalysis = await analyzeStructureWithOpenAI(
    whisperResult.full_text, openaiKey, modelId
  )

  // 3. Save content analysis. Visual editing elements ficam vazios
  // (sem mais análise visual de vídeo neste pipeline).
  await supabase.from('content_analyses').upsert({
    reel_id: reelId,
    hook: structureAnalysis.hook ?? { text: '', start_ts: 0, end_ts: 3, type: 'unknown', effectiveness_score: 5 },
    development: structureAnalysis.development ?? { text: '', start_ts: 3, end_ts: 20, key_points: [], storytelling_technique: 'unknown' },
    cta: structureAnalysis.cta ?? { text: '', start_ts: 20, end_ts: 30, type: 'unknown', strength_score: 5 },
    transitions: EMPTY_EDITING_ELEMENTS.transitions,
    music_segments: EMPTY_EDITING_ELEMENTS.music_segments,
    sound_effects: EMPTY_EDITING_ELEMENTS.sound_effects,
    broll_segments: EMPTY_EDITING_ELEMENTS.broll_segments,
    text_overlays: EMPTY_EDITING_ELEMENTS.text_overlays,
    visual_effects: EMPTY_EDITING_ELEMENTS.visual_effects,
    viral_patterns: structureAnalysis.viral_patterns ?? {},
    editing_analysis_status: 'completed',
    claude_model: `openai/${modelId}`,
    analyzed_at: new Date().toISOString(),
  }, { onConflict: 'reel_id' })
}

async function processInBackground(
  supabase: SupabaseClient,
  jobId: string,
  reelIds: string[],
  _userId: string,
  modelId: string,
  openaiKey: string
) {
  const total = reelIds.length
  let processed = 0
  let cancelled = false
  let timedOut = false
  const CONCURRENCY = 3

  // Wall-clock timer pro job inteiro. Defesa contra reels que travam
  // mesmo com per-reel timeout (ex: vários reels lentos em série).
  // Quando dispara: sinaliza cancelled e força finalização com os reels
  // que já foram processados.
  const overallTimer = setTimeout(() => {
    timedOut = true
    cancelled = true
    log('warn', `Job ${jobId} hit overall wall-clock timeout of ${OVERALL_JOB_TIMEOUT_MS}ms — finalizing with partial results`)
  }, OVERALL_JOB_TIMEOUT_MS)

  try {
    async function processOne(reelId: string) {
      if (cancelled) return
      log('info', `Analyzing reel ${reelId}`, { jobId })

      try {
        const result = await Promise.race([
          analyzeOneReel(supabase, reelId, modelId, openaiKey),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), PER_REEL_TIMEOUT_MS)),
        ])

        if (result === 'timeout') {
          log('warn', `Reel ${reelId} timed out, skipping`)
          await supabase.from('content_analyses').upsert({
            reel_id: reelId,
            hook: { text: '', start_ts: 0, end_ts: 0, type: 'timeout', effectiveness_score: 0 },
            development: { text: '', start_ts: 0, end_ts: 0, key_points: [], storytelling_technique: 'timeout' },
            cta: { text: '', start_ts: 0, end_ts: 0, type: 'timeout', strength_score: 0 },
            editing_analysis_status: 'failed',
          }, { onConflict: 'reel_id' })
        }
      } catch (err) {
        log('warn', `Reel ${reelId} failed: ${err instanceof Error ? err.message : err}, skipping`)
        await supabase.from('content_analyses').upsert({
          reel_id: reelId,
          hook: { text: '', start_ts: 0, end_ts: 0, type: 'error', effectiveness_score: 0 },
          development: { text: '', start_ts: 0, end_ts: 0, key_points: [], storytelling_technique: 'error' },
          cta: { text: '', start_ts: 0, end_ts: 0, type: 'error', strength_score: 0 },
          editing_analysis_status: 'failed',
        }, { onConflict: 'reel_id' })
      }

      processed++
      const { data: progressUpdate } = await supabase.from('processing_jobs').update({
        progress: Math.round((processed / total) * 100)
      }).eq('id', jobId).in('status', ['pending', 'processing']).select('status').maybeSingle()
      if (!progressUpdate) cancelled = true
    }

    // Process reels with bounded concurrency
    const queue = [...reelIds]
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0 && !cancelled) {
        const reelId = queue.shift()
        if (!reelId) break
        await processOne(reelId)
      }
    })
    await Promise.all(workers)

    // Marca reels não-processados (que ficaram na queue por timeout/cancelamento)
    // como failed pra eles não ficarem em status 'processing' eternamente.
    if (queue.length > 0) {
      log('warn', `${queue.length} reels não processados serão marcados como failed`, { jobId })
      for (const remainingReelId of queue) {
        await supabase.from('content_analyses').upsert({
          reel_id: remainingReelId,
          hook: { text: '', start_ts: 0, end_ts: 0, type: 'timeout', effectiveness_score: 0 },
          development: { text: '', start_ts: 0, end_ts: 0, key_points: [], storytelling_technique: 'timeout' },
          cta: { text: '', start_ts: 0, end_ts: 0, type: 'timeout', strength_score: 0 },
          editing_analysis_status: 'failed',
        }, { onConflict: 'reel_id' })
      }
    }

    const finalProgress = Math.round((processed / total) * 100)
    await supabase.from('processing_jobs').update({
      status: 'completed',
      progress: finalProgress,
      output_data: {
        reels_analyzed: processed,
        reels_total: total,
        reels_skipped: total - processed,
        model: `openai/${modelId}`,
        partial: timedOut || processed < total,
        timeout_reason: timedOut ? 'overall_wall_clock_10min' : null,
      },
      completed_at: new Date().toISOString(),
    }).eq('id', jobId).in('status', ['pending', 'processing'])
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('error', 'Analysis job failed', { jobId, error: errorMessage })
    await supabase.from('processing_jobs').update({
      status: 'failed', error_message: errorMessage, completed_at: new Date().toISOString(),
    }).eq('id', jobId).in('status', ['pending', 'processing'])
  } finally {
    clearTimeout(overallTimer)
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
    const body: AnalyzeRequest & { profile_id?: string } = await req.json()
    const { reel_ids, user_id, profile_id, model_id = 'gpt-4.1' } = body

    if (!reel_ids || !Array.isArray(reel_ids) || reel_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'reel_ids must be a non-empty array' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .insert({
        user_id, job_type: 'analyze', status: 'processing', progress: 0,
        input_data: { reel_ids, profile_id, model_provider: 'openai', model_id },
        started_at: new Date().toISOString(),
      })
      .select('id').single()

    if (jobError || !job) throw new Error(`Failed to create job: ${jobError?.message}`)

    const backgroundTask = processInBackground(
      supabase, job.id, reel_ids, user_id, model_id, openaiKey
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
