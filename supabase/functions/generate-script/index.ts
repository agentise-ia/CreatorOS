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

interface GenerateScriptRequest {
  topic: string
  voice_profile_id?: string
  reference_reel_ids?: string[]
  additional_instructions?: string
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

function buildScriptPrompt(
  topic: string,
  voiceProfileDoc: string,
  viralPatternsSection: string,
  additionalInstructions?: string
): string {
  return `Você é um roteirista especializado em Instagram Reels virais. Gere um roteiro completo baseado nas informações abaixo.

TEMA: ${topic}

${voiceProfileDoc ? `VOICE PROFILE DO CRIADOR (reproduza este tom de fala fielmente):\n${voiceProfileDoc}\n` : 'Sem voice profile — use tom informal, energético e didático.\n'}

${viralPatternsSection ? `PADRÕES VIRAIS DE REFERÊNCIA:\n${viralPatternsSection}\n` : ''}

${additionalInstructions ? `INSTRUÇÕES ADICIONAIS: ${additionalInstructions}\n` : ''}

Retorne APENAS um JSON válido com esta estrutura:
{
  "title": "título curto e impactante",
  "script_teleprompter": "Texto limpo para ler no teleprompter. Sem marcações técnicas. Apenas o texto falado, com quebras de parágrafo para pausas.",
  "script_annotated": {
    "sections": [
      { "type": "hook", "text": "texto", "timing": "00:00-00:03", "notes": "instruções de performance" },
      { "type": "development", "text": "texto", "timing": "00:03-00:25", "notes": "instruções" },
      { "type": "cta", "text": "texto", "timing": "00:25-00:30", "notes": "instruções" }
    ]
  },
  "estimated_duration_seconds": 30,
  "editing_report": {
    "total_duration_estimate": "25-35 segundos",
    "music_recommendation": {
      "mood": "mood ideal",
      "genre": "gênero",
      "reference_tracks": ["referências"],
      "volume_curve": [
        {"start": "00:00", "end": "00:03", "volume": "baixo"},
        {"start": "00:03", "end": "00:25", "volume": "médio"},
        {"start": "00:25", "end": "00:30", "volume": "alto"}
      ]
    },
    "editing_instructions": [
      {
        "timestamp": "00:00-00:03", "section": "hook",
        "visual": "descrição visual", "text_overlay": "texto na tela",
        "audio": "áudio/efeitos", "transition_in": "transição"
      },
      {
        "timestamp": "00:03-00:25", "section": "development",
        "visual": "descrição", "broll_suggestions": ["b-roll 1", "b-roll 2"],
        "text_overlay": "textos", "audio": "áudio", "transitions": "transições"
      },
      {
        "timestamp": "00:25-00:30", "section": "cta",
        "visual": "descrição", "text_overlay": "CTA na tela",
        "audio": "áudio final", "transition_out": "transição saída"
      }
    ],
    "color_grading": "recomendação",
    "aspect_ratio": "9:16",
    "captions_style": "estilo de legendas"
  }
}`
}

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
        reasoning: { effort: 'medium' },
        text: { verbosity: 'low', format: { type: 'json_object' } },
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
      temperature: 0.7,
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
  params: GenerateScriptRequest,
  openaiKey: string
) {
  // Wall-clock 10-min defense para garantir que o job sempre finalize.
  // Mesmo se o worker da Supabase não for morto e algo travar internamente,
  // o job vira 'failed' em vez de ficar em 'processing' pra sempre.
  let overallTimer: number | undefined
  const overallTimeout = new Promise<never>((_, reject) => {
    overallTimer = setTimeout(() => {
      reject(new Error(`Job excedeu wall-clock timeout de ${OVERALL_JOB_TIMEOUT_MS}ms`))
    }, OVERALL_JOB_TIMEOUT_MS) as unknown as number
  })

  try {
    await Promise.race([overallTimeout, generateScriptCore(supabase, jobId, params, openaiKey)])
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('error', 'Script generation failed', { jobId, error: errorMessage })
    await supabase.from('processing_jobs').update({
      status: 'failed', error_message: errorMessage, completed_at: new Date().toISOString(),
    }).eq('id', jobId).in('status', ['pending', 'processing'])
  } finally {
    if (overallTimer !== undefined) clearTimeout(overallTimer)
  }
}

async function generateScriptCore(
  supabase: SupabaseClient,
  jobId: string,
  params: GenerateScriptRequest,
  openaiKey: string
) {
  try {
    const { topic, voice_profile_id, reference_reel_ids, additional_instructions, user_id, model_id } = params
    const model_provider = 'openai' as const

    let voiceProfileDoc = ''
    if (voice_profile_id) {
      const { data: vp } = await supabase
        .from('voice_profiles')
        .select('full_profile_document')
        .eq('id', voice_profile_id)
        .single()
      voiceProfileDoc = vp?.full_profile_document ?? ''
    }

    await supabase.from('processing_jobs').update({ progress: 10 }).eq('id', jobId)

    let viralPatternsSection = ''
    const viralPatternsUsed: Record<string, unknown>[] = []

    if (reference_reel_ids && reference_reel_ids.length > 0) {
      const { data: analyses } = await supabase
        .from('content_analyses')
        .select('hook, development, cta, viral_patterns')
        .in('reel_id', reference_reel_ids)

      if (analyses && analyses.length > 0) {
        const patterns = analyses.map((a: Record<string, unknown>, i: number) => {
          viralPatternsUsed.push(a.viral_patterns as Record<string, unknown>)
          return `Referência ${i + 1}:
- Hook: tipo "${(a.hook as Record<string, unknown>)?.type}", eficácia ${(a.hook as Record<string, unknown>)?.effectiveness_score}/10
- Técnica: ${(a.development as Record<string, unknown>)?.storytelling_technique}
- CTA: tipo "${(a.cta as Record<string, unknown>)?.type}", força ${(a.cta as Record<string, unknown>)?.strength_score}/10
- Padrões: ${JSON.stringify(a.viral_patterns)}`
        })
        viralPatternsSection = patterns.join('\n\n')
      }
    }

    await supabase.from('processing_jobs').update({ progress: 25 }).eq('id', jobId)

    log('info', `Generating script with ${model_provider}/${model_id}`, { jobId })

    const prompt = buildScriptPrompt(topic, voiceProfileDoc, viralPatternsSection, additional_instructions)

    const scriptData = await generateWithOpenAI(prompt, openaiKey, model_id)

    await supabase.from('processing_jobs').update({ progress: 80 }).eq('id', jobId)

    const scriptRecord = {
      user_id,
      voice_profile_id: voice_profile_id ?? null,
      topic,
      reference_reel_ids: reference_reel_ids ?? [],
      additional_instructions: additional_instructions ?? null,
      title: (scriptData.title as string) ?? `Roteiro: ${topic}`,
      script_teleprompter: (scriptData.script_teleprompter as string) ?? '',
      script_annotated: scriptData.script_annotated ?? {},
      estimated_duration_seconds: (scriptData.estimated_duration_seconds as number) ?? null,
      editing_report: scriptData.editing_report ?? {},
      generation_model: `${model_provider}/${model_id}`,
      viral_patterns_used: viralPatternsUsed.length > 0 ? viralPatternsUsed : null,
      status: 'draft',
    }

    const { data: newScript, error: insertError } = await supabase
      .from('scripts')
      .insert(scriptRecord)
      .select('id')
      .single()
    if (insertError || !newScript) throw new Error(`Failed to save script: ${insertError?.message}`)

    // Create initial version in script_versions
    await supabase.from('script_versions').insert({
      script_id: newScript.id,
      version_number: 1,
      script_teleprompter: scriptRecord.script_teleprompter,
      script_annotated: scriptRecord.script_annotated,
      editing_report: scriptRecord.editing_report,
      change_type: 'initial',
      change_description: 'Gerado por IA',
    })

    await supabase.from('processing_jobs').update({
      status: 'completed', progress: 100,
      output_data: { title: scriptRecord.title, model: `${model_provider}/${model_id}` },
      completed_at: new Date().toISOString(),
    }).eq('id', jobId).in('status', ['pending', 'processing'])

    log('info', 'Script generated', { jobId })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('error', 'Script generation failed', { jobId, error: errorMessage })
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
    const body: GenerateScriptRequest = await req.json()
    const { topic, user_id, model_id = 'gpt-4.1' } = body

    if (!topic || !user_id) {
      return new Response(JSON.stringify({ error: 'topic and user_id are required' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (!openaiKey) throw new Error('OPENAI_API_KEY not configured')

    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .insert({
        user_id, job_type: 'generate_script', status: 'processing', progress: 0,
        input_data: { topic, voice_profile_id: body.voice_profile_id, reference_reel_ids: body.reference_reel_ids, model_provider: 'openai', model_id },
        started_at: new Date().toISOString(),
      })
      .select('id').single()

    if (jobError || !job) throw new Error(`Failed to create job: ${jobError?.message}`)

    const backgroundTask = processInBackground(supabase, job.id, body, openaiKey)

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
