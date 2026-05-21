import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCredential } from '../_shared/credentials.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_RETRIES = 3

interface AnalyzeRequest {
  reel_ids: string[]
  user_id: string
  model_provider: 'openai' | 'gemini'
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
    try {
      const response = await fetch(url, options)
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

// Upload video to Gemini Files API, then reference it — much faster than inline base64
async function uploadToGeminiFiles(
  videoUrl: string,
  geminiKey: string
): Promise<string | null> {
  try {
    // Download video
    const videoResponse = await fetchWithRetry(videoUrl, { method: 'GET' })
    const videoBlob = await videoResponse.blob()
    const videoSize = videoBlob.size

    log('info', `Video size: ${(videoSize / 1024 / 1024).toFixed(1)}MB`)

    // Skip if > 20MB (Gemini inline limit; Files API supports up to 2GB but slow)
    if (videoSize > 20 * 1024 * 1024) {
      log('info', 'Video too large for Gemini, skipping visual analysis')
      return null
    }

    // Upload via resumable upload to Files API
    const startResponse = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiKey}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(videoSize),
          'X-Goog-Upload-Header-Content-Type': 'video/mp4',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: 'reel.mp4' } }),
      }
    )

    const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL')
    if (!uploadUrl) {
      log('warn', 'No upload URL returned from Gemini Files API')
      return null
    }

    // Upload the bytes
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Type': 'video/mp4',
      },
      body: videoBlob,
    })

    if (!uploadResponse.ok) {
      log('warn', `Gemini file upload failed: ${uploadResponse.status}`)
      return null
    }

    const uploadResult = await uploadResponse.json()
    const fileUri = uploadResult.file?.uri
    if (!fileUri) {
      log('warn', 'No file URI in upload response')
      return null
    }

    // Wait for file to be processed (ACTIVE state)
    const fileName = uploadResult.file?.name
    for (let i = 0; i < 20; i++) {
      const statusRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${geminiKey}`
      )
      const statusData = await statusRes.json()
      if (statusData.state === 'ACTIVE') return fileUri
      if (statusData.state === 'FAILED') return null
      await new Promise((r) => setTimeout(r, 2000))
    }

    return fileUri
  } catch (err) {
    log('warn', `Gemini file upload error: ${err}`)
    return null
  }
}

const GEMINI_VIDEO_PROMPT = `Você é um editor de vídeo profissional analisando um Reel do Instagram. Analise CADA SEGUNDO deste vídeo com atenção máxima.

IMPORTANTE: Mesmo vídeos simples de "talking head" possuem elementos de edição. Considere:
- Jump cuts entre frases = transição do tipo "jump_cut"
- Zoom in/out durante a fala = transição do tipo "zoom"
- Qualquer mudança de enquadramento = transição
- Música de fundo (mesmo baixa) = segmento de música
- Legendas/texto aparecendo na tela = text overlay
- Mudança de cenário ou ângulo = b-roll ou corte
- Sons de "whoosh", "pop", "ding" = efeitos sonoros
- Silêncios estratégicos = devem ser registrados

Retorne APENAS um JSON válido (sem markdown, sem backticks, sem explicação) com esta estrutura exata:

{
  "transitions": [
    {
      "timestamp": 3,
      "type": "jump_cut|fade|zoom_in|zoom_out|swipe|match_cut|speed_ramp|whip_pan|hard_cut",
      "description": "Descrição curta do que acontece visualmente"
    }
  ],
  "music_segments": [
    {
      "start_ts": 0,
      "end_ts": 45,
      "mood": "energético|calmo|tenso|inspirador|dramático",
      "energy_level": "baixo|médio|alto",
      "genre": "lo-fi|trap|pop|eletrônica|acústico|sem música",
      "description": "Descrição da música/som de fundo"
    }
  ],
  "sound_effects": [
    {
      "timestamp": 5,
      "type": "whoosh|ding|pop|click|boom|notification|riser|drop",
      "description": "Descrição do efeito e contexto de uso"
    }
  ],
  "broll_segments": [
    {
      "start_ts": 8,
      "end_ts": 11,
      "description": "O que aparece no b-roll",
      "visual_type": "screencast|footage|gráfico|imagem_estática|animação"
    }
  ],
  "text_overlays": [
    {
      "start_ts": 0,
      "end_ts": 3,
      "text": "Texto exato que aparece na tela",
      "style": "bold_grande|subtítulo|legenda_animada|bullet_point|número|emoji",
      "position": "topo|centro|base|lateral"
    }
  ],
  "visual_effects": [
    {
      "start_ts": 0,
      "end_ts": 2,
      "type": "zoom_dinâmico|shake|slow_motion|speed_ramp|filtro_cor|blur|split_screen",
      "description": "Descrição do efeito"
    }
  ]
}

TODOS os timestamps devem ser números em segundos (não strings).
Se alguma categoria não tiver elementos, retorne array vazio []. Mas ANALISE COM CUIDADO — a maioria dos Reels tem pelo menos transições (jump cuts) e texto na tela (legendas).`

function parseGeminiResponse(responseText: string): EditingElements {
  // Remove markdown code fences
  let cleaned = responseText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  // Try to extract JSON object from response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    cleaned = jsonMatch[0]
  }

  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')

  try {
    const parsed = JSON.parse(cleaned)

    return {
      transitions: Array.isArray(parsed.transitions) ? parsed.transitions : [],
      music_segments: Array.isArray(parsed.music_segments) ? parsed.music_segments : [],
      sound_effects: Array.isArray(parsed.sound_effects) ? parsed.sound_effects : [],
      broll_segments: Array.isArray(parsed.broll_segments) ? parsed.broll_segments : [],
      text_overlays: Array.isArray(parsed.text_overlays) ? parsed.text_overlays : [],
      visual_effects: Array.isArray(parsed.visual_effects) ? parsed.visual_effects : [],
    }
  } catch (e) {
    log('error', 'Failed to parse Gemini response', {
      error: String(e),
      raw: responseText.slice(0, 1000),
    })
    return {
      transitions: [],
      music_segments: [],
      sound_effects: [],
      broll_segments: [],
      text_overlays: [],
      visual_effects: [],
    }
  }
}

async function analyzeVideoWithGemini(
  videoUrl: string,
  geminiKey: string
): Promise<EditingElements> {
  // Try Files API first (faster for large videos)
  const fileUri = await uploadToGeminiFiles(videoUrl, geminiKey)

  let contentParts
  if (fileUri) {
    contentParts = [{ fileData: { mimeType: 'video/mp4', fileUri } }, { text: GEMINI_VIDEO_PROMPT }]
  } else {
    // Fallback: skip video analysis, return empty
    log('info', 'Skipping Gemini visual analysis (no file URI)')
    return {
      transitions: [],
      music_segments: [],
      sound_effects: [],
      broll_segments: [],
      text_overlays: [],
      visual_effects: [],
    }
  }

  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: contentParts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  )

  if (!response.ok) {
    const errText = await response.text()
    log('warn', `Gemini API failed (${response.status}): ${errText.slice(0, 300)}`)
    return {
      transitions: [],
      music_segments: [],
      sound_effects: [],
      broll_segments: [],
      text_overlays: [],
      visual_effects: [],
    }
  }

  const result = await response.json()
  const textContent = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

  return parseGeminiResponse(textContent)
}

const STRUCTURE_PROMPT = `Analise esta transcrição de um Instagram Reel e a análise visual, e identifique a estrutura narrativa.

TRANSCRIÇÃO:
{transcription}

ANÁLISE VISUAL:
{visual}

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
  visualAnalysis: EditingElements,
  openaiKey: string,
  modelId: string
): Promise<Record<string, unknown>> {
  const prompt = STRUCTURE_PROMPT
    .replace('{transcription}', transcription)
    .replace('{visual}', JSON.stringify(visualAnalysis, null, 2))

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

async function analyzeStructureWithGemini(
  transcription: string,
  visualAnalysis: EditingElements,
  geminiKey: string,
  modelId: string
): Promise<Record<string, unknown>> {
  const prompt = STRUCTURE_PROMPT
    .replace('{transcription}', transcription)
    .replace('{visual}', JSON.stringify(visualAnalysis, null, 2))

  const generationConfig: Record<string, unknown> = {
    temperature: 0.3,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
  }
  if (/^gemini-2\.5/i.test(modelId)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  }

  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Gemini API failed (${response.status}): ${await response.text()}`)
  }

  const result = await response.json()
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {}
  } catch {
    return {}
  }
}

async function analyzeOneReel(
  supabase: SupabaseClient,
  reelId: string,
  modelProvider: 'openai' | 'gemini',
  modelId: string,
  openaiKey: string,
  geminiKey: string
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

  // 2. Analyze video visually with Gemini
  log('info', 'Starting Gemini video analysis', { reelId })
  let visualAnalysis: EditingElements
  let editingStatus: 'completed' | 'failed' = 'completed'

  try {
    visualAnalysis = await analyzeVideoWithGemini(videoUrl, geminiKey)

    // Check if we got any meaningful data
    const hasData = visualAnalysis.transitions.length > 0 ||
      visualAnalysis.music_segments.length > 0 ||
      visualAnalysis.sound_effects.length > 0 ||
      visualAnalysis.broll_segments.length > 0 ||
      visualAnalysis.text_overlays.length > 0 ||
      visualAnalysis.visual_effects.length > 0

    if (!hasData) {
      log('warn', 'Gemini returned no editing elements', { reelId })
    }
  } catch (err) {
    log('warn', `Gemini visual analysis failed: ${err}`, { reelId })
    editingStatus = 'failed'
    visualAnalysis = {
      transitions: [],
      music_segments: [],
      sound_effects: [],
      broll_segments: [],
      text_overlays: [],
      visual_effects: [],
    }
  }

  // 3. Analyze structure with selected model
  log('info', `Starting structure analysis with ${modelProvider}/${modelId}`, { reelId })
  let structureAnalysis: Record<string, unknown>

  if (modelProvider === 'openai') {
    structureAnalysis = await analyzeStructureWithOpenAI(
      whisperResult.full_text, visualAnalysis, openaiKey, modelId
    )
  } else {
    structureAnalysis = await analyzeStructureWithGemini(
      whisperResult.full_text, visualAnalysis, geminiKey, modelId
    )
  }

  // 4. Save content analysis
  await supabase.from('content_analyses').upsert({
    reel_id: reelId,
    hook: structureAnalysis.hook ?? { text: '', start_ts: 0, end_ts: 3, type: 'unknown', effectiveness_score: 5 },
    development: structureAnalysis.development ?? { text: '', start_ts: 3, end_ts: 20, key_points: [], storytelling_technique: 'unknown' },
    cta: structureAnalysis.cta ?? { text: '', start_ts: 20, end_ts: 30, type: 'unknown', strength_score: 5 },
    transitions: visualAnalysis.transitions,
    music_segments: visualAnalysis.music_segments,
    sound_effects: visualAnalysis.sound_effects,
    broll_segments: visualAnalysis.broll_segments,
    text_overlays: visualAnalysis.text_overlays,
    visual_effects: visualAnalysis.visual_effects,
    viral_patterns: structureAnalysis.viral_patterns ?? {},
    editing_analysis_status: editingStatus,
    gemini_model: 'gemini-2.5-flash',
    claude_model: `${modelProvider}/${modelId}`,
    analyzed_at: new Date().toISOString(),
  }, { onConflict: 'reel_id' })
}

async function processInBackground(
  supabase: SupabaseClient,
  jobId: string,
  reelIds: string[],
  userId: string,
  modelProvider: 'openai' | 'gemini',
  modelId: string,
  openaiKey: string,
  geminiKey: string
) {
  try {
    const total = reelIds.length
    let processed = 0
    let cancelled = false
    const CONCURRENCY = 3

    async function processOne(reelId: string) {
      if (cancelled) return
      log('info', `Analyzing reel ${reelId}`, { jobId })

      try {
        const result = await Promise.race([
          analyzeOneReel(supabase, reelId, modelProvider, modelId, openaiKey, geminiKey),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 180_000)),
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

    await supabase.from('processing_jobs').update({
      status: 'completed', progress: 100,
      output_data: { reels_analyzed: processed, model: `${modelProvider}/${modelId}` },
      completed_at: new Date().toISOString(),
    }).eq('id', jobId).in('status', ['pending', 'processing'])
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('error', 'Analysis job failed', { jobId, error: errorMessage })
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
    const geminiKey = await getCredential('gemini_api_key')

    const missing: string[] = []
    if (!supabaseUrl) missing.push('SUPABASE_URL')
    if (!supabaseServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
    if (!openaiKey) missing.push('openai_api_key (configure em /setup ou /settings)')
    if (!geminiKey) missing.push('gemini_api_key (configure em /setup ou /settings)')
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
    const { reel_ids, user_id, profile_id, model_provider = 'openai', model_id = 'gpt-4.1' } = body

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
        input_data: { reel_ids, profile_id, model_provider, model_id },
        started_at: new Date().toISOString(),
      })
      .select('id').single()

    if (jobError || !job) throw new Error(`Failed to create job: ${jobError?.message}`)

    const backgroundTask = processInBackground(
      supabase, job.id, reel_ids, user_id, model_provider, model_id, openaiKey, geminiKey
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
