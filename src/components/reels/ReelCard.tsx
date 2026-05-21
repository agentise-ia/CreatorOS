import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, MessageCircle, Share2, Eye, Clock, Film, FileText, BarChart3, Loader2, Check, X, AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { analyzeContent, cancelJob } from '@/lib/api'
import { formatNumber, formatDate, formatDuration } from '@/lib/utils'
import type { Reel } from '@/types'

type ButtonStatus = 'idle' | 'starting' | 'processing' | 'success' | 'error'

interface ReelCardProps {
  reel: Reel
  usedInScript?: boolean
  analyzed?: boolean
  onAnalyzed?: () => void
}

export function ReelCard({ reel, usedInScript, analyzed: analyzedProp, onAnalyzed }: ReelCardProps) {
  const navigate = useNavigate()
  const [imgError, setImgError] = useState(false)
  const [analyzed, setAnalyzed] = useState<boolean>(!!analyzedProp)
  const [analyzeStatus, setAnalyzeStatus] = useState<ButtonStatus>('idle')
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const trackedAnalyzeRef = useRef<string | null>(null)

  const modelProvider = useAppStore((s) => s.modelProvider)
  const modelId = useAppStore((s) => s.modelId)
  const activeJobs = useAppStore((s) => s.activeJobs)

  // Sync from prop (parent may pass updated value)
  useEffect(() => {
    if (analyzedProp !== undefined) setAnalyzed(analyzedProp)
  }, [analyzedProp])

  // Find analyze job that contains this reel
  const analyzeJob = activeJobs.find((j) => {
    if (j.job_type !== 'analyze') return false
    const reelIds = (j.input_data as { reel_ids?: unknown })?.reel_ids
    return Array.isArray(reelIds) && reelIds.includes(reel.id)
  })
  const analyzeProgress = analyzeJob?.progress ?? 0

  useEffect(() => {
    if (!analyzeJob) return
    if (analyzeJob.status === 'pending' || analyzeJob.status === 'processing') {
      setAnalyzeStatus('processing')
      setAnalyzeError(null)
      trackedAnalyzeRef.current = analyzeJob.id
      return
    }
    if (trackedAnalyzeRef.current !== analyzeJob.id) return
    if (analyzeJob.status === 'completed') {
      setAnalyzeStatus('success')
      setAnalyzed(true)
      onAnalyzed?.()
      trackedAnalyzeRef.current = null
      const t = setTimeout(() => setAnalyzeStatus('idle'), 4000)
      return () => clearTimeout(t)
    }
    if (analyzeJob.status === 'failed') {
      setAnalyzeStatus('error')
      setAnalyzeError(analyzeJob.error_message ?? 'Falha na análise')
      trackedAnalyzeRef.current = null
      const t = setTimeout(() => setAnalyzeStatus('idle'), 8000)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzeJob?.id, analyzeJob?.status, analyzeJob?.error_message])

  const caption = reel.caption
    ? reel.caption.length > 80
      ? `${reel.caption.slice(0, 80)}...`
      : reel.caption
    : 'Sem legenda'

  async function handleAnalyze(e: React.MouseEvent) {
    e.stopPropagation()
    setAnalyzeError(null)
    setAnalyzeStatus('starting')
    try {
      await analyzeContent([reel.id], modelProvider, modelId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setAnalyzeError(msg)
      setAnalyzeStatus('error')
      setTimeout(() => setAnalyzeStatus('idle'), 8000)
    }
  }

  async function handleCancel(e: React.MouseEvent, jobId: string) {
    e.stopPropagation()
    try {
      await cancelJob(jobId)
    } catch (err) {
      console.error('Cancel failed:', err)
    }
  }

  function handleCardClick() {
    if (analyzed) navigate(`/analysis/${reel.id}`)
  }

  return (
    <Card
      className={cn(
        'overflow-hidden border-2 border-[rgba(59,130,246,0.25)] transition-all duration-200 hover:border-[rgba(59,130,246,0.65)] hover:shadow-[0_0_20px_rgba(59,130,246,0.18)] hover:-translate-y-0.5',
        analyzed && 'cursor-pointer'
      )}
      onClick={handleCardClick}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[9/16] w-full overflow-hidden">
        {reel.thumbnail_url && !imgError ? (
          <img
            src={reel.thumbnail_url}
            alt={caption}
            className="size-full object-cover"
            onError={() => setImgError(true)}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-[rgba(59,130,246,0.15)] to-[rgba(37,99,235,0.05)]">
            <Film className="size-8 text-muted-foreground/50" />
          </div>
        )}
        {usedInScript && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-[rgba(59,130,246,0.8)] text-primary-foreground text-[10px] px-2 py-0.5">
            <FileText className="size-3" />
            <span>Em roteiro</span>
          </div>
        )}
        {reel.duration_seconds !== null && (
          <Badge
            variant="secondary"
            className="absolute bottom-1.5 right-1.5 bg-black/70 text-white border-0"
          >
            <Clock className="size-3" />
            {formatDuration(reel.duration_seconds)}
          </Badge>
        )}
      </div>

      <CardContent className="flex flex-col gap-2 pt-2">
        {/* Caption */}
        <p className="line-clamp-2 text-xs text-muted-foreground">{caption}</p>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Heart className="size-3 text-red-400" />
            <span>{formatNumber(reel.likes_count)}</span>
          </div>
          <div className="flex items-center gap-1">
            <MessageCircle className="size-3 text-[#60A5FA]" />
            <span>{formatNumber(reel.comments_count)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Share2 className="size-3 text-accent" />
            <span>{formatNumber(reel.shares_count)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Eye className="size-3 text-[#3B82F6]" />
            <span>{formatNumber(reel.views_count)}</span>
          </div>
        </div>

        {/* Engagement + date */}
        <div className="flex items-center justify-between border-t border-[rgba(59,130,246,0.08)] pt-2">
          <Badge className="bg-[rgba(59,130,246,0.15)] text-[#60A5FA] border border-[rgba(59,130,246,0.25)]">
            {formatNumber(reel.engagement_score)} eng
          </Badge>
          {reel.posted_at && (
            <span className="text-[10px] text-muted-foreground">
              {formatDate(reel.posted_at)}
            </span>
          )}
        </div>

        {/* Analyze action */}
        <div className="space-y-1.5 border-t border-[rgba(59,130,246,0.08)] pt-2">
          <Button
            variant="outline"
            size="xs"
            className={cn(
              'w-full transition-all duration-300',
              analyzeStatus === 'idle' && analyzed && 'border-accent/30 text-accent hover:bg-accent/10',
              analyzeStatus === 'idle' && !analyzed && 'border-primary/30 text-primary hover:bg-primary/10',
              analyzeStatus === 'processing' && 'border-primary/50 bg-primary/5 text-primary',
              analyzeStatus === 'success' && 'border-accent/50 bg-accent/10 text-accent',
              analyzeStatus === 'error' && 'border-destructive/50 bg-destructive/10 text-destructive',
            )}
            onClick={(e) => {
              if (analyzeStatus === 'processing' || analyzeStatus === 'starting') return
              if (analyzed && analyzeStatus === 'idle') {
                e.stopPropagation()
                navigate(`/analysis/${reel.id}`)
                return
              }
              handleAnalyze(e)
            }}
            disabled={analyzeStatus === 'starting' || analyzeStatus === 'processing'}
          >
            {analyzeStatus === 'idle' && analyzed && (<><Check className="size-3" />Ver análise</>)}
            {analyzeStatus === 'idle' && !analyzed && (<><BarChart3 className="size-3" />Analisar este reel</>)}
            {analyzeStatus === 'starting' && (<><Loader2 className="size-3 animate-spin" />Iniciando...</>)}
            {analyzeStatus === 'processing' && (<><Loader2 className="size-3 animate-spin" />Analisando{analyzeProgress > 0 ? ` ${analyzeProgress}%` : '...'}</>)}
            {analyzeStatus === 'success' && (<><Check className="size-3" />Concluído!</>)}
            {analyzeStatus === 'error' && (<><X className="size-3" />Falhou — tentar novamente</>)}
          </Button>

          {analyzeJob && analyzeStatus === 'processing' && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={(e) => handleCancel(e, analyzeJob.id)}
                className="text-[10px] text-muted-foreground transition-colors hover:text-destructive"
              >
                Cancelar
              </button>
            </div>
          )}

          {analyzeError && analyzeStatus === 'error' && (
            <div className="flex items-start gap-1.5 rounded bg-destructive/5 px-2 py-1">
              <AlertCircle className="mt-0.5 size-3 shrink-0 text-destructive" />
              <p className="text-[10px] leading-tight text-destructive line-clamp-2">{analyzeError}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
