import { useCallback, useEffect, useState } from 'react'
import supabase from '@/lib/supabase'
import type { ContentAnalysis, Transcription } from '@/types'

export function useAnalysis(reelId: string | undefined) {
  const [analysis, setAnalysis] = useState<ContentAnalysis | null>(null)
  const [transcription, setTranscription] = useState<Transcription | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalysis = useCallback(async () => {
    if (!reelId) {
      setAnalysis(null)
      setTranscription(null)
      return
    }

    setLoading(true)
    setError(null)

    const [analysisResult, transcriptionResult] = await Promise.all([
      supabase
        .from('content_analyses')
        .select('*')
        .eq('reel_id', reelId)
        .maybeSingle(),
      supabase
        .from('transcriptions')
        .select('*')
        .eq('reel_id', reelId)
        .maybeSingle(),
    ])

    if (analysisResult.error && analysisResult.error.code !== 'PGRST116') {
      setError(analysisResult.error.message)
    } else {
      setAnalysis((analysisResult.data as ContentAnalysis) ?? null)
    }

    if (!transcriptionResult.error) {
      setTranscription((transcriptionResult.data as Transcription) ?? null)
    }

    setLoading(false)
  }, [reelId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAnalysis()
  }, [fetchAnalysis])

  return { analysis, transcription, loading, error, refetch: fetchAnalysis }
}

export function useAnalysisList() {
  const [analyses, setAnalyses] = useState<
    (ContentAnalysis & { reel?: { caption: string | null; thumbnail_url: string | null; engagement_score: number; views_count: number; posted_at: string | null; profile_id: string; profile: { instagram_username: string; profile_pic_url: string | null } | null } })[]
  >([])
  const [usedInScriptReelIds, setUsedInScriptReelIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalyses = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [analysesResult, scriptsResult] = await Promise.all([
      supabase
        .from('content_analyses')
        .select('*, reel:reels(caption, thumbnail_url, engagement_score, views_count, posted_at, profile_id, profile:profiles(instagram_username, profile_pic_url))')
        .order('analyzed_at', { ascending: false }),
      supabase
        .from('scripts')
        .select('reference_reel_ids'),
    ])

    if (analysesResult.error) {
      setError(analysesResult.error.message)
    } else {
      setAnalyses((analysesResult.data ?? []) as typeof analyses)
    }

    // Build set of reel IDs used in scripts
    const usedIds = new Set<string>()
    if (scriptsResult.data) {
      for (const script of scriptsResult.data) {
        const reelIds = (script as { reference_reel_ids: string[] | null }).reference_reel_ids
        if (Array.isArray(reelIds)) {
          for (const id of reelIds) usedIds.add(id)
        }
      }
    }
    setUsedInScriptReelIds(usedIds)

    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAnalyses()
  }, [fetchAnalyses])

  return { analyses, usedInScriptReelIds, loading, error, refetch: fetchAnalyses }
}
