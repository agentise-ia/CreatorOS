import { useState, useCallback, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StructureTimeline } from '@/components/analysis/StructureTimeline'
import { TranscriptViewer } from '@/components/analysis/TranscriptViewer'
import { VideoPlayer } from '@/components/analysis/VideoPlayer'
import { PatternCard } from '@/components/analysis/PatternCard'
import { useAnalysis } from '@/hooks/useAnalysis'
import { formatNumber, formatDuration } from '@/lib/utils'
import supabase from '@/lib/supabase'
import type { Reel } from '@/types'

export default function ReelAnalysisPage() {
  const { reelId } = useParams<{ reelId: string }>()
  const navigate = useNavigate()
  const { analysis, transcription, loading, error } = useAnalysis(reelId)

  const [reel, setReel] = useState<Reel | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [seekTo, setSeekTo] = useState<number | undefined>()

  useEffect(() => {
    if (!reelId) return
    supabase
      .from('reels')
      .select('*')
      .eq('id', reelId)
      .single()
      .then(({ data }) => {
        if (data) setReel(data as Reel)
      })
  }, [reelId])

  const handleSeek = useCallback((time: number) => {
    setSeekTo(time)
    // Reset seekTo after a tick so it can be triggered again
    setTimeout(() => setSeekTo(undefined), 100)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
        <div className="flex flex-col items-center justify-center gap-2 py-16">
          <p className="text-sm text-muted-foreground">
            Análise não encontrada para este reel
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
        {reel && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground line-clamp-1">
              {reel.caption?.slice(0, 60) ?? 'Sem legenda'}
            </span>
            <Badge className="bg-accent/20 text-accent">
              {formatNumber(reel.engagement_score)} eng
            </Badge>
            {reel.duration_seconds && (
              <Badge variant="secondary">
                {formatDuration(reel.duration_seconds)}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Main layout: video + analysis */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left: Video player */}
        <div className="space-y-4">
          <VideoPlayer
            src={reel?.storage_path ? supabase.storage.from('videos').getPublicUrl(reel.storage_path).data.publicUrl : reel?.video_url ?? null}
            thumbnail={reel?.thumbnail_url}
            onTimeUpdate={setCurrentTime}
            seekTo={seekTo}
          />

          {/* Viral patterns */}
          <PatternCard patterns={analysis.viral_patterns} />
        </div>

        {/* Right: Analysis details */}
        <div className="space-y-6">
          {/* Structure timeline */}
          <StructureTimeline analysis={analysis} onSeek={handleSeek} />

          {/* Transcript */}
          {transcription && (
            <TranscriptViewer
              transcription={transcription}
              currentTime={currentTime}
              onSeek={handleSeek}
            />
          )}

        </div>
      </div>
    </div>
  )
}
