import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCredential } from '../_shared/credentials.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_RETRIES = 3
const APIFY_POLL_INTERVAL_MS = 5_000
const APIFY_TIMEOUT_MS = 10 * 60 * 1_000 // 10 minutes
const MAX_USERNAMES_PER_JOB = 10
const USERNAME_REGEX = /^[a-zA-Z0-9._]{1,30}$/

interface ScrapeRequest {
  usernames: string[]
  user_id: string
  profile_type?: 'reference' | 'own'
}

interface ApifyReelItem {
  id?: string | number
  shortCode?: string
  caption?: string
  videoUrl?: string
  displayUrl?: string
  videoDuration?: number
  likesCount?: number
  commentsCount?: number
  videoPlayCount?: number
  videoViewCount?: number
  musicInfo?: {
    artist_name?: string
    song_name?: string
  }
  hashtags?: string[]
  mentions?: string[]
  timestamp?: string
  ownerUsername?: string
  // Itens de erro que o Apify às vezes retorna no dataset (perfil privado/inexistente)
  error?: string
  errorDescription?: string
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
      if (response.ok || response.status < 500) {
        return response
      }
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`)
      log('warn', `Attempt ${attempt}/${retries} failed`, { status: response.status, url })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      log('warn', `Attempt ${attempt}/${retries} network error`, { error: lastError.message, url })
    }

    if (attempt < retries) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError ?? new Error('fetchWithRetry exhausted all retries')
}

async function startApifyRun(username: string, apifyToken: string): Promise<{ runId: string; datasetId: string }> {
  const url = `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/runs?token=${apifyToken}`

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: [username],
      resultsLimit: 50,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Apify start run failed (${response.status}): ${body}`)
  }

  const result = await response.json()
  const runId = result.data?.id
  const datasetId = result.data?.defaultDatasetId

  if (!runId || !datasetId) {
    throw new Error(`Apify response missing runId or datasetId: ${JSON.stringify(result)}`)
  }

  return { runId, datasetId }
}

async function waitForApifyRun(
  runId: string,
  apifyToken: string,
  onHeartbeat?: () => Promise<void>
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < APIFY_TIMEOUT_MS) {
    const url = `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
    const response = await fetchWithRetry(url, { method: 'GET' })

    if (!response.ok) {
      throw new Error(`Apify poll failed (${response.status}): ${await response.text()}`)
    }

    const result = await response.json()
    const status = result.data?.status

    log('info', `Apify run ${runId} status: ${status}`)

    if (status === 'SUCCEEDED') return
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${runId} ended with status: ${status}`)
    }

    // Heartbeat: bump o job (updated_at + progress) a cada poll para o watchdog
    // do frontend não considerar o job travado enquanto o Apify ainda roda.
    if (onHeartbeat) {
      try { await onHeartbeat() } catch { /* heartbeat best-effort */ }
    }

    await new Promise((resolve) => setTimeout(resolve, APIFY_POLL_INTERVAL_MS))
  }

  throw new Error(`Apify run ${runId} timed out after ${APIFY_TIMEOUT_MS / 1000}s`)
}

async function fetchApifyDataset(datasetId: string, apifyToken: string): Promise<ApifyReelItem[]> {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`
  const response = await fetchWithRetry(url, { method: 'GET' })

  if (!response.ok) {
    throw new Error(`Apify dataset fetch failed (${response.status}): ${await response.text()}`)
  }

  return await response.json()
}

async function upsertProfile(
  supabase: SupabaseClient,
  userId: string,
  username: string,
  profileType: 'reference' | 'own'
): Promise<string> {
  const { data: existing, error: selectError } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('instagram_username', username)
    .maybeSingle()

  if (selectError) throw new Error(`Failed to check profile ${username}: ${selectError.message}`)

  if (existing) {
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (updateError) throw new Error(`Failed to update profile ${username}: ${updateError.message}`)
    return existing.id
  }

  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .insert({
      user_id: userId,
      instagram_username: username,
      profile_type: profileType,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (insertError) throw new Error(`Failed to insert profile ${username}: ${insertError.message}`)
  return inserted.id
}

// Instagram CDN responds with Cross-Origin-Resource-Policy: same-origin, which
// blocks direct rendering in the browser. Re-host thumbs in Supabase Storage so
// they get served with the project's own headers (and survive URL expiry).
async function downloadThumbnailToStorage(
  supabase: SupabaseClient,
  imageUrl: string,
  instagramId: string
): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    })
    if (!res.ok) {
      log('warn', `Thumbnail fetch failed for ${instagramId}`, { status: res.status })
      return null
    }
    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
        ? 'webp'
        : 'jpg'
    const path = `${instagramId}.${ext}`
    const bytes = new Uint8Array(await res.arrayBuffer())
    const { error } = await supabase.storage
      .from('thumbnails')
      .upload(path, bytes, { contentType, upsert: true })
    if (error) {
      log('warn', `Storage upload failed for ${instagramId}`, { error: error.message })
      return null
    }
    return supabase.storage.from('thumbnails').getPublicUrl(path).data.publicUrl
  } catch (err) {
    log('warn', `Thumbnail re-host failed for ${instagramId}`, { error: String(err) })
    return null
  }
}

async function insertReels(
  supabase: SupabaseClient,
  profileId: string,
  items: ApifyReelItem[],
  onBatch?: (done: number, total: number) => Promise<void>
): Promise<number> {
  // Process in concurrent batches: each item downloads its thumb and upserts
  // independently. Limit concurrency to avoid hammering Instagram CDN /
  // Supabase Storage / DB at once.
  const BATCH_SIZE = 8
  let insertedCount = 0

  async function processItem(item: ApifyReelItem): Promise<boolean> {
    const instagramId = item.id != null ? String(item.id) : null
    if (!instagramId) {
      log('warn', 'Skipping reel with no id', { item: JSON.stringify(item).slice(0, 200) })
      return false
    }

    const originalThumb = item.displayUrl ?? null
    const storedThumb = originalThumb
      ? await downloadThumbnailToStorage(supabase, originalThumb, instagramId)
      : null

    const reelData = {
      profile_id: profileId,
      instagram_id: instagramId,
      shortcode: item.shortCode ?? null,
      caption: item.caption ?? null,
      video_url: item.videoUrl ?? null,
      thumbnail_url: storedThumb ?? originalThumb,
      duration_seconds: item.videoDuration ?? null,
      likes_count: item.likesCount ?? 0,
      comments_count: item.commentsCount ?? 0,
      shares_count: 0,
      views_count: item.videoPlayCount ?? item.videoViewCount ?? 0,
      music_name: item.musicInfo?.song_name ?? null,
      music_artist: item.musicInfo?.artist_name ?? null,
      hashtags: item.hashtags ?? [],
      mentions: item.mentions ?? [],
      posted_at: item.timestamp ? new Date(item.timestamp).toISOString() : null,
    }

    const { error } = await supabase
      .from('reels')
      .upsert(reelData, { onConflict: 'instagram_id' })

    if (error) {
      log('warn', `Failed to upsert reel ${instagramId}`, { error: error.message })
      return false
    }
    return true
  }

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(processItem))
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) insertedCount++
    }
    // Heartbeat: mantém o job vivo pro watchdog durante a inserção (download de
    // thumbnails de até 50 reels pode passar de 4 min).
    if (onBatch) {
      try { await onBatch(Math.min(i + BATCH_SIZE, items.length), items.length) } catch { /* best-effort */ }
    }
  }

  return insertedCount
}

async function updateJobProgress(
  supabase: SupabaseClient,
  jobId: string,
  progress: number,
  extraFields?: Record<string, unknown>
) {
  const updateData: Record<string, unknown> = { progress, ...extraFields }
  // Skip update if user already cancelled the job
  const { error } = await supabase
    .from('processing_jobs')
    .update(updateData)
    .eq('id', jobId)
    .in('status', ['pending', 'processing'])
  if (error) {
    log('warn', `Failed to update job ${jobId} progress`, { error: error.message })
  }
}

async function processInBackground(
  supabase: SupabaseClient,
  jobId: string,
  usernames: string[],
  userId: string,
  profileType: 'reference' | 'own',
  apifyToken: string
) {
  try {
    const totalUsernames = usernames.length
    let processedCount = 0
    let totalReels = 0
    const failures: string[] = []

    for (const username of usernames) {
      log('info', `Processing username: ${username}`, { jobId })

      // 1. Upsert profile
      const profileId = await upsertProfile(supabase, userId, username, profileType)
      log('info', `Profile upserted: ${profileId}`, { username })

      // 2. Start Apify run
      const { runId, datasetId } = await startApifyRun(username, apifyToken)
      log('info', `Apify run started`, { runId, datasetId, username })

      // 3. Wait for completion — com heartbeat que faz o progresso "rastejar"
      // dentro da fatia deste username, mantendo o job vivo pro watchdog.
      const baseProgress = Math.round((processedCount / totalUsernames) * 100)
      const nextProgress = Math.round(((processedCount + 1) / totalUsernames) * 100)
      // Sobe até 85% da fatia, deixando os 15% finais para o trabalho real (fetch/insert).
      const ceiling = baseProgress + Math.floor((nextProgress - baseProgress) * 0.85)
      let heartbeatProgress = baseProgress
      await waitForApifyRun(runId, apifyToken, async () => {
        if (heartbeatProgress < ceiling) heartbeatProgress += 1
        await updateJobProgress(supabase, jobId, heartbeatProgress)
      })
      log('info', `Apify run completed`, { runId, username })

      // 4. Fetch results
      const items = await fetchApifyDataset(datasetId, apifyToken)
      log('info', `Fetched ${items.length} reels`, { username })

      // 4b. Detecta item de erro do Apify (perfil privado/inexistente)
      const apifyError = items.find((it) => it.error || it.errorDescription)
      if (apifyError) {
        const reason = apifyError.errorDescription ?? apifyError.error ?? 'erro desconhecido'
        log('warn', `Apify retornou erro para ${username}`, { reason })
        failures.push(`@${username}: ${reason}`)
        processedCount++
        await updateJobProgress(supabase, jobId, Math.round((processedCount / totalUsernames) * 100))
        continue
      }

      // 4c. Sem reels válidos = perfil privado, sem reels, ou @ errado
      const validItems = items.filter((it) => it.id != null)
      if (validItems.length === 0) {
        log('warn', `Nenhum reel válido para ${username}`)
        failures.push(`@${username}: nenhum reel encontrado (perfil pode ser privado, sem reels, ou o @ está incorreto)`)
        processedCount++
        await updateJobProgress(supabase, jobId, Math.round((processedCount / totalUsernames) * 100))
        continue
      }

      // 5. Insert reels — com heartbeat por batch (passos finais da fatia: ceiling→nextProgress)
      const insertedCount = await insertReels(supabase, profileId, validItems, async (done, total) => {
        const p = ceiling + Math.round((nextProgress - ceiling) * (done / total))
        await updateJobProgress(supabase, jobId, p)
      })
      totalReels += insertedCount
      log('info', `Inserted ${insertedCount} reels`, { username })

      if (insertedCount === 0) {
        failures.push(`@${username}: ${validItems.length} reels retornados mas nenhum pôde ser salvo`)
      }

      // 6. Update profile last_scraped_at
      await supabase
        .from('profiles')
        .update({ last_scraped_at: new Date().toISOString() })
        .eq('id', profileId)

      // 7. Update job progress
      processedCount++
      const progress = Math.round((processedCount / totalUsernames) * 100)
      await updateJobProgress(supabase, jobId, progress)
    }

    // Se nenhum reel foi salvo em nenhum perfil, falha com mensagem clara.
    if (totalReels === 0) {
      throw new Error(
        failures.length > 0
          ? failures.join(' · ')
          : 'Nenhum reel foi extraído. Verifique se o(s) perfil(is) são públicos e têm reels.'
      )
    }

    // Mark job as completed (no-op if user already cancelled)
    await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        progress: 100,
        output_data: {
          total_reels: totalReels,
          usernames_processed: usernames,
          failures: failures.length > 0 ? failures : undefined,
        },
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .in('status', ['pending', 'processing'])

    log('info', `Job completed successfully`, { jobId, totalReels, failures })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('error', `Job failed`, { jobId, error: errorMessage })

    await supabase
      .from('processing_jobs')
      .update({
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .in('status', ['pending', 'processing'])
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    // 1. Validate body BEFORE checking secrets, so client gets the most specific error.
    let body: ScrapeRequest
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: 'Body deve ser JSON válido' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const { usernames, user_id, profile_type = 'reference' } = body

    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return new Response(
        JSON.stringify({ error: 'usernames must be a non-empty array of strings' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    if (usernames.length > MAX_USERNAMES_PER_JOB) {
      return new Response(
        JSON.stringify({
          error: `Máximo ${MAX_USERNAMES_PER_JOB} usernames por job (recebido: ${usernames.length}).`,
        }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    if (!user_id || typeof user_id !== 'string') {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    if (profile_type !== 'reference' && profile_type !== 'own') {
      return new Response(
        JSON.stringify({ error: "profile_type deve ser 'reference' ou 'own'" }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // Clean and validate each username: trim, remove @ prefix, check Instagram-handle format.
    const cleanedUsernames: string[] = []
    for (const raw of usernames) {
      if (typeof raw !== 'string') {
        return new Response(
          JSON.stringify({ error: 'usernames deve ser array de strings' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        )
      }
      const cleaned = raw.replace(/^@/, '').trim()
      if (!cleaned) continue
      if (!USERNAME_REGEX.test(cleaned)) {
        return new Response(
          JSON.stringify({
            error: `Username inválido: "${cleaned.slice(0, 50)}". Use até 30 caracteres alfanuméricos, ponto ou underline.`,
          }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        )
      }
      cleanedUsernames.push(cleaned)
    }

    if (cleanedUsernames.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhum username válido após sanitização' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Validate secrets (now that body is known good).
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const apifyToken = await getCredential('apify_token')

    const missing: string[] = []
    if (!supabaseUrl) missing.push('SUPABASE_URL')
    if (!supabaseServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
    if (!apifyToken) missing.push('apify_token (configure em /setup ou /settings)')
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Credenciais ausentes: ${missing.join(', ')}.`,
          instrucao: 'Abra /setup ou /settings no app para configurar as APIs.',
        }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl!, supabaseServiceKey!)

    // Create processing job
    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .insert({
        user_id,
        job_type: 'scrape',
        status: 'processing',
        progress: 0,
        input_data: { usernames: cleanedUsernames },
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (jobError || !job) {
      // Foreign-key violation = user_id não existe em auth.users.
      // Devolve mensagem genérica em vez de vazar nome da constraint.
      const isFkViolation =
        (jobError as { code?: string } | null)?.code === '23503'
      const clientMessage = isFkViolation
        ? 'user_id inválido ou inexistente'
        : 'Falha ao criar job de processamento'
      log('error', 'Failed to create processing job', {
        code: (jobError as { code?: string } | null)?.code,
        details: jobError?.message,
      })
      return new Response(
        JSON.stringify({ error: clientMessage }),
        {
          status: isFkViolation ? 400 : 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      )
    }

    log('info', `Job created`, { jobId: job.id, usernames: cleanedUsernames })

    // Start background processing using EdgeRuntime.waitUntil if available,
    // otherwise fall back to fire-and-forget promise
    const backgroundTask = processInBackground(
      supabase,
      job.id,
      cleanedUsernames,
      user_id,
      profile_type,
      apifyToken!
    )

    // Deno Deploy / Supabase Edge Functions support EdgeRuntime.waitUntil
    // to keep the function alive after the response is sent
    try {
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
      if (runtime?.waitUntil) {
        runtime.waitUntil(backgroundTask)
      }
    } catch {
      // If EdgeRuntime is not available, the promise will still execute
      // but may be cut short if the runtime shuts down.
      // As a fallback, we just let the promise run.
      backgroundTask.catch((err) => {
        log('error', 'Background task failed (no EdgeRuntime)', { error: String(err) })
      })
    }

    // Return job_id immediately
    return new Response(
      JSON.stringify({ job_id: job.id }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log('error', 'Request handler failed', { error: errorMessage })

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  }
})
