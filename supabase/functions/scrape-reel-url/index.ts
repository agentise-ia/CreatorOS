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
const APIFY_TIMEOUT_MS = 5 * 60 * 1_000 // 5 minutes

interface ScrapeReelUrlRequest {
  reel_url: string
  user_id: string
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
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 30000)))
    }
  }
  throw lastError ?? new Error('fetchWithRetry exhausted all retries')
}

function extractUsernameFromUrl(url: string): string | null {
  // Patterns: instagram.com/reel/XXX/, instagram.com/p/XXX/, instagram.com/@user/reel/XXX/
  const match = url.match(/instagram\.com\/(?:@?([^/]+)\/)?(?:reel|p)\//)
  if (match && match[1] && match[1] !== 'reel' && match[1] !== 'p') {
    return match[1]
  }
  return null
}

function extractShortcodeFromUrl(url: string): string | null {
  const match = url.match(/(?:reel|p)\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : null
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
    const path = `thumbnails/${instagramId}.${ext}`
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const body: ScrapeReelUrlRequest = await req.json()
    const { reel_url, user_id } = body

    if (!reel_url || !user_id) {
      return new Response(JSON.stringify({ error: 'reel_url and user_id are required' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Validate URL format
    if (!reel_url.includes('instagram.com/')) {
      return new Response(JSON.stringify({ error: 'URL deve ser um link do Instagram (instagram.com/reel/... ou instagram.com/p/...)' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Create job
    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .insert({
        user_id,
        job_type: 'scrape',
        status: 'processing',
        progress: 0,
        input_data: { reel_url },
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (jobError || !job) throw new Error(`Failed to create job: ${jobError?.message}`)

    // Process in background
    const backgroundTask = (async () => {
      try {
        log('info', 'Starting Apify scrape for reel URL', { reel_url, jobId: job.id })

        await supabase.from('processing_jobs').update({ progress: 10 }).eq('id', job.id)

        // Use Apify Instagram API Scraper (supports directUrls without username)
        const startResponse = await fetchWithRetry(
          `https://api.apify.com/v2/acts/apify~instagram-api-scraper/runs?token=${apifyToken}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              directUrls: [reel_url],
              resultsLimit: 1,
            }),
          }
        )

        if (!startResponse.ok) {
          throw new Error(`Apify start failed (${startResponse.status}): ${await startResponse.text()}`)
        }

        const startResult = await startResponse.json()
        const runId = startResult.data?.id
        const datasetId = startResult.data?.defaultDatasetId

        if (!runId || !datasetId) {
          throw new Error('Apify response missing runId or datasetId')
        }

        await supabase.from('processing_jobs').update({ progress: 30 }).eq('id', job.id)

        // Wait for completion
        const startTime = Date.now()
        while (Date.now() - startTime < APIFY_TIMEOUT_MS) {
          const statusRes = await fetchWithRetry(
            `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`,
            { method: 'GET' }
          )
          const statusData = await statusRes.json()
          const status = statusData.data?.status

          if (status === 'SUCCEEDED') break
          if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
            throw new Error(`Apify run ended with status: ${status}`)
          }
          await new Promise((r) => setTimeout(r, APIFY_POLL_INTERVAL_MS))
        }

        await supabase.from('processing_jobs').update({ progress: 60 }).eq('id', job.id)

        // Fetch results
        const datasetRes = await fetchWithRetry(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`,
          { method: 'GET' }
        )
        const items = await datasetRes.json()

        if (!items || items.length === 0) {
          throw new Error('Nenhum reel encontrado nesta URL. Verifique se o link está correto.')
        }

        const item = items[0]
        log('info', 'Apify returned reel data', { keys: Object.keys(item) })

        await supabase.from('processing_jobs').update({ progress: 70 }).eq('id', job.id)

        // Extract username from URL or Apify data
        const username = item.ownerUsername
          ?? item.owner?.username
          ?? extractUsernameFromUrl(reel_url)
          ?? 'reel_avulso'

        // Upsert a "reference" profile for this username
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .upsert(
            {
              user_id,
              instagram_username: username,
              profile_type: 'reference',
              full_name: item.ownerFullName ?? item.owner?.full_name ?? null,
              profile_pic_url: item.owner?.profile_pic_url ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,instagram_username' }
          )
          .select('id')
          .single()

        if (profileError || !profile) {
          throw new Error(`Failed to upsert profile: ${profileError?.message}`)
        }

        await supabase.from('processing_jobs').update({ progress: 80 }).eq('id', job.id)

        // Build reel record
        const instagramId = item.id != null ? String(item.id) : extractShortcodeFromUrl(reel_url) ?? `url_${Date.now()}`

        const originalThumb = item.displayUrl ?? item.display_url ?? item.thumbnailUrl ?? null
        const storedThumb = originalThumb
          ? await downloadThumbnailToStorage(supabase, originalThumb, instagramId)
          : null

        const reelData = {
          profile_id: profile.id,
          instagram_id: instagramId,
          shortcode: item.shortCode ?? item.shortcode ?? extractShortcodeFromUrl(reel_url),
          caption: item.caption ?? null,
          video_url: item.videoUrl ?? item.video_url ?? null,
          thumbnail_url: storedThumb ?? originalThumb,
          duration_seconds: item.videoDuration ?? item.video_duration ?? null,
          likes_count: item.likesCount ?? item.likes ?? 0,
          comments_count: item.commentsCount ?? item.comments ?? 0,
          shares_count: 0,
          views_count: item.videoPlayCount ?? item.videoViewCount ?? item.video_play_count ?? 0,
          music_name: item.musicInfo?.song_name ?? null,
          music_artist: item.musicInfo?.artist_name ?? null,
          hashtags: item.hashtags ?? [],
          mentions: item.mentions ?? [],
          posted_at: item.timestamp ? new Date(item.timestamp).toISOString() : null,
        }

        const { data: reel, error: reelError } = await supabase
          .from('reels')
          .upsert(reelData, { onConflict: 'instagram_id' })
          .select('id')
          .single()

        if (reelError || !reel) {
          throw new Error(`Failed to upsert reel: ${reelError?.message}`)
        }

        await supabase.from('processing_jobs').update({
          status: 'completed',
          progress: 100,
          output_data: { reel_id: reel.id, profile_id: profile.id, username },
          completed_at: new Date().toISOString(),
        }).eq('id', job.id).in('status', ['pending', 'processing'])

        log('info', 'Reel URL scrape completed', { reelId: reel.id, username })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log('error', 'Reel URL scrape failed', { error: errorMessage })
        await supabase.from('processing_jobs').update({
          status: 'failed',
          error_message: errorMessage,
          completed_at: new Date().toISOString(),
        }).eq('id', job.id).in('status', ['pending', 'processing'])
      }
    })()

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
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
