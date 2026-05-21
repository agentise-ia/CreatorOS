import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Download, Loader2, Mic, Check, X, AlertCircle, RotateCcw, BarChart3 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { scrapeProfile, generateVoiceProfile, cancelJob, analyzeContent } from '@/lib/api'
import { formatNumber, formatDate } from '@/lib/utils'
import supabase from '@/lib/supabase'
import type { Profile } from '@/types'

type ButtonStatus = 'idle' | 'starting' | 'processing' | 'success' | 'error'

interface ProfileCardProps {
  profile: Profile
  onScrapeComplete?: () => void
}

export function ProfileCard({ profile, onScrapeComplete }: ProfileCardProps) {
  const navigate = useNavigate()
  const modelProvider = useAppStore((s) => s.modelProvider)
  const modelId = useAppStore((s) => s.modelId)
  const activeJobs = useAppStore((s) => s.activeJobs)

  const [scrapeStatus, setScrapeStatus] = useState<ButtonStatus>('idle')
  const [voiceStatus, setVoiceStatus] = useState<ButtonStatus>('idle')
  const [analyzeStatus, setAnalyzeStatus] = useState<ButtonStatus>('idle')
  const [hasVoiceProfile, setHasVoiceProfile] = useState<boolean | null>(null)
  const [scrapeError, setScrapeError] = useState<string | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [reelCounts, setReelCounts] = useState<{ total: number; analyzed: number } | null>(null)

  // Find jobs in-flight that match this profile
  const scrapeJob = activeJobs.find((j) => {
    if (j.job_type !== 'scrape') return false
    const usernames = (j.input_data as { usernames?: unknown })?.usernames
    return Array.isArray(usernames) && usernames.includes(profile.instagram_username)
  })
  const voiceJob = activeJobs.find((j) => {
    if (j.job_type !== 'voice_profile') return false
    return (j.input_data as { profile_id?: string })?.profile_id === profile.id
  })
  const analyzeJob = activeJobs.find((j) => {
    if (j.job_type !== 'analyze') return false
    return (j.input_data as { profile_id?: string })?.profile_id === profile.id
  })

  const scrapeProgress = scrapeJob?.progress ?? 0
  const voiceProgress = voiceJob?.progress ?? 0
  const analyzeProgress = analyzeJob?.progress ?? 0

  const trackedScrapeRef = useRef<string | null>(null)
  const trackedVoiceRef = useRef<string | null>(null)
  const trackedAnalyzeRef = useRef<string | null>(null)

  // Drive scrape button state from realtime job
  useEffect(() => {
    if (!scrapeJob) return
    if (scrapeJob.status === 'pending' || scrapeJob.status === 'processing') {
      setScrapeStatus('processing')
      setScrapeError(null)
      trackedScrapeRef.current = scrapeJob.id
      return
    }
    if (trackedScrapeRef.current !== scrapeJob.id) return
    if (scrapeJob.status === 'completed') {
      setScrapeStatus('success')
      onScrapeComplete?.()
      trackedScrapeRef.current = null
      const t = setTimeout(() => setScrapeStatus('idle'), 4000)
      return () => clearTimeout(t)
    }
    if (scrapeJob.status === 'failed') {
      setScrapeStatus('error')
      setScrapeError(scrapeJob.error_message ?? 'Falha no processamento')
      trackedScrapeRef.current = null
      const t = setTimeout(() => setScrapeStatus('idle'), 8000)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrapeJob?.id, scrapeJob?.status, scrapeJob?.error_message])

  // Drive voice button state from realtime job
  useEffect(() => {
    if (!voiceJob) return
    if (voiceJob.status === 'pending' || voiceJob.status === 'processing') {
      setVoiceStatus('processing')
      setVoiceError(null)
      trackedVoiceRef.current = voiceJob.id
      return
    }
    if (trackedVoiceRef.current !== voiceJob.id) return
    if (voiceJob.status === 'completed') {
      setVoiceStatus('success')
      setHasVoiceProfile(true)
      trackedVoiceRef.current = null
      const t = setTimeout(() => setVoiceStatus('idle'), 4000)
      return () => clearTimeout(t)
    }
    if (voiceJob.status === 'failed') {
      setVoiceStatus('error')
      setVoiceError(voiceJob.error_message ?? 'Falha no processamento')
      trackedVoiceRef.current = null
      const t = setTimeout(() => setVoiceStatus('idle'), 8000)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceJob?.id, voiceJob?.status, voiceJob?.error_message])

  // Drive analyze button state from realtime job
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
      trackedAnalyzeRef.current = null
      // Refresh counts so "X/Y analisados" updates
      loadReelCounts()
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

  // Load count of reels and analyzed reels for this profile
  async function loadReelCounts() {
    const { data: reels } = await supabase
      .from('reels')
      .select('id')
      .eq('profile_id', profile.id)
    const reelIds = (reels ?? []).map((r: { id: string }) => r.id)
    if (reelIds.length === 0) {
      setReelCounts({ total: 0, analyzed: 0 })
      return
    }
    const { data: analyses } = await supabase
      .from('content_analyses')
      .select('reel_id')
      .in('reel_id', reelIds)
    setReelCounts({ total: reelIds.length, analyzed: (analyses ?? []).length })
  }

  useEffect(() => {
    if (!profile.last_scraped_at) return
    loadReelCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.last_scraped_at])

  // Check if voice profile exists (own profiles only)
  useEffect(() => {
    if (profile.profile_type !== 'own' || hasVoiceProfile !== null) return
    supabase
      .from('voice_profiles')
      .select('id')
      .eq('profile_id', profile.id)
      .limit(1)
      .then(({ data }) => {
        setHasVoiceProfile((data ?? []).length > 0)
      })
  }, [profile.id, profile.profile_type, hasVoiceProfile])

  async function handleScrape(e: React.MouseEvent) {
    e.stopPropagation()
    setScrapeError(null)
    setScrapeStatus('starting')
    try {
      await scrapeProfile([profile.instagram_username], profile.profile_type)
      // Realtime takes over via the useEffect above.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setScrapeError(msg)
      setScrapeStatus('error')
      setTimeout(() => setScrapeStatus('idle'), 8000)
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

  async function handleAnalyze(e: React.MouseEvent) {
    e.stopPropagation()
    setAnalyzeError(null)
    setAnalyzeStatus('starting')
    try {
      // Get top 10 unanalyzed reels of this profile
      const { data: reels } = await supabase
        .from('reels')
        .select('id')
        .eq('profile_id', profile.id)
        .order('engagement_score', { ascending: false })
        .limit(10)
      const reelIds = (reels ?? []).map((r: { id: string }) => r.id)
      if (reelIds.length === 0) {
        setAnalyzeError('Nenhum reel disponível para analisar')
        setAnalyzeStatus('error')
        setTimeout(() => setAnalyzeStatus('idle'), 5000)
        return
      }
      const { data: existing } = await supabase
        .from('content_analyses')
        .select('reel_id')
        .in('reel_id', reelIds)
      const analyzed = new Set(((existing ?? []) as { reel_id: string }[]).map((a) => a.reel_id))
      const todo = reelIds.filter((id) => !analyzed.has(id))
      if (todo.length === 0) {
        setAnalyzeError('Todos os top 10 reels já foram analisados')
        setAnalyzeStatus('error')
        setTimeout(() => setAnalyzeStatus('idle'), 5000)
        return
      }
      await analyzeContent(todo, modelProvider, modelId, profile.id)
      // Realtime takes over.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setAnalyzeError(msg)
      setAnalyzeStatus('error')
      setTimeout(() => setAnalyzeStatus('idle'), 8000)
    }
  }

  async function handleAnalyzeVoice(e: React.MouseEvent) {
    e.stopPropagation()
    setVoiceError(null)
    setVoiceStatus('starting')
    try {
      const { data: reels } = await supabase
        .from('reels')
        .select('id')
        .eq('profile_id', profile.id)
        .order('engagement_score', { ascending: false })
        .limit(10)

      const reelIds = (reels ?? []).map((r: { id: string }) => r.id)
      if (reelIds.length === 0) {
        setVoiceError('Processe o perfil primeiro para ter reels disponíveis')
        setVoiceStatus('error')
        setTimeout(() => setVoiceStatus('idle'), 5000)
        return
      }

      await generateVoiceProfile(profile.id, reelIds, modelProvider, modelId)
      // Realtime takes over.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setVoiceError(msg)
      setVoiceStatus('error')
      setTimeout(() => setVoiceStatus('idle'), 8000)
    }
  }

  return (
    <Card
      className="cursor-pointer transition-colors hover:border-[rgba(59,130,246,0.45)]"
      onClick={() => navigate(`/profiles/${profile.id}/reels`)}
    >
      <CardHeader>
        <div className="flex items-center gap-3">
          {profile.profile_pic_url ? (
            <img
              src={profile.profile_pic_url}
              alt={profile.instagram_username}
              className="size-10 rounded-full object-cover border border-[rgba(59,130,246,0.15)]"
              referrerPolicy="no-referrer"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground border border-[rgba(59,130,246,0.15)]">
              {profile.instagram_username.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">
              @{profile.instagram_username}
            </CardTitle>
            {profile.full_name && (
              <p className="truncate text-xs text-muted-foreground">
                {profile.full_name}
              </p>
            )}
          </div>
          <Badge
            variant={profile.profile_type === 'own' ? 'default' : 'secondary'}
            className={
              profile.profile_type === 'own'
                ? 'bg-accent/20 text-accent'
                : 'bg-blue-500/20 text-blue-400'
            }
          >
            {profile.profile_type === 'own' ? 'Meu Perfil' : 'Referência'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Users className="size-3.5" />
            <span>
              {profile.followers_count !== null
                ? formatNumber(profile.followers_count)
                : '—'}{' '}
              seguidores
            </span>
          </div>
          {profile.last_scraped_at && (
            <span>Atualizado {formatDate(profile.last_scraped_at)}</span>
          )}
        </div>

        {/* Scrape button */}
        <div className="space-y-1.5">
          <Button
            variant="outline"
            size="xs"
            className={cn(
              'w-full transition-all duration-300',
              scrapeStatus === 'processing' && 'border-primary/50 bg-primary/5 text-primary',
              scrapeStatus === 'success' && 'border-accent/50 bg-accent/10 text-accent',
              scrapeStatus === 'error' && 'border-destructive/50 bg-destructive/10 text-destructive',
            )}
            onClick={handleScrape}
            disabled={scrapeStatus === 'starting' || scrapeStatus === 'processing'}
          >
            {scrapeStatus === 'idle' && (
              profile.last_scraped_at ? (
                <>
                  <RotateCcw className="size-3" />
                  Atualizar reels
                </>
              ) : (
                <>
                  <Download className="size-3" />
                  Processar
                </>
              )
            )}
            {scrapeStatus === 'starting' && (
              <>
                <Loader2 className="size-3 animate-spin" />
                Iniciando...
              </>
            )}
            {scrapeStatus === 'processing' && (
              <>
                <Loader2 className="size-3 animate-spin" />
                Processando{scrapeProgress > 0 ? ` ${scrapeProgress}%` : '...'}
              </>
            )}
            {scrapeStatus === 'success' && (
              <>
                <Check className="size-3" />
                Concluído!
              </>
            )}
            {scrapeStatus === 'error' && (
              <>
                <X className="size-3" />
                Falhou — tentar novamente
              </>
            )}
          </Button>

          {/* Progress bar */}
          {(scrapeStatus === 'processing' || scrapeStatus === 'starting') && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500 ease-out',
                  scrapeStatus === 'starting' ? 'bg-primary/50 animate-pulse w-full' : 'bg-primary'
                )}
                style={scrapeStatus === 'processing' ? { width: `${Math.max(scrapeProgress, 5)}%` } : undefined}
              />
            </div>
          )}

          {scrapeJob && scrapeStatus === 'processing' && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={(e) => handleCancel(e, scrapeJob.id)}
                className="text-[10px] text-muted-foreground transition-colors hover:text-destructive"
              >
                Cancelar
              </button>
            </div>
          )}

          {scrapeError && scrapeStatus === 'error' && (
            <div className="flex items-start gap-1.5 rounded bg-destructive/5 px-2 py-1">
              <AlertCircle className="mt-0.5 size-3 shrink-0 text-destructive" />
              <p className="text-[10px] leading-tight text-destructive line-clamp-2">{scrapeError}</p>
            </div>
          )}

        </div>

        {/* Analyze section (only after scrape) */}
        {profile.last_scraped_at && (
          <div className="space-y-1.5">
            <Button
              variant="outline"
              size="xs"
              className={cn(
                'w-full transition-all duration-300',
                analyzeStatus === 'idle' && 'border-accent/30 text-accent hover:bg-accent/10',
                analyzeStatus === 'processing' && 'border-primary/50 bg-primary/5 text-primary',
                analyzeStatus === 'success' && 'border-accent/50 bg-accent/10 text-accent',
                analyzeStatus === 'error' && 'border-destructive/50 bg-destructive/10 text-destructive',
              )}
              onClick={handleAnalyze}
              disabled={analyzeStatus === 'starting' || analyzeStatus === 'processing'}
            >
              {analyzeStatus === 'idle' && (
                <>
                  <BarChart3 className="size-3" />
                  Analisar top 10 reels
                  {reelCounts && reelCounts.analyzed > 0 ? ` (${Math.min(reelCounts.analyzed, 10)}/10 já feito)` : ''}
                </>
              )}
              {analyzeStatus === 'starting' && (<><Loader2 className="size-3 animate-spin" />Iniciando...</>)}
              {analyzeStatus === 'processing' && (<><Loader2 className="size-3 animate-spin" />Analisando{analyzeProgress > 0 ? ` ${analyzeProgress}%` : '...'}</>)}
              {analyzeStatus === 'success' && (<><Check className="size-3" />Concluído!</>)}
              {analyzeStatus === 'error' && (<><X className="size-3" />Falhou — tentar novamente</>)}
            </Button>

            {(analyzeStatus === 'processing' || analyzeStatus === 'starting') && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500 ease-out',
                    analyzeStatus === 'starting' ? 'bg-primary/50 animate-pulse w-full' : 'bg-primary'
                  )}
                  style={analyzeStatus === 'processing' ? { width: `${Math.max(analyzeProgress, 5)}%` } : undefined}
                />
              </div>
            )}

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

            {reelCounts && reelCounts.analyzed > 0 && analyzeStatus === 'idle' && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigate(`/profiles/${profile.id}/reels`) }}
                className="block w-full text-center text-[10px] text-muted-foreground hover:text-primary"
              >
                Ver reels analisados →
              </button>
            )}
          </div>
        )}

        {/* Voice profile button (own profiles only) */}
        {profile.profile_type === 'own' && (
          <div className="space-y-1.5">
            <Button
              variant="outline"
              size="xs"
              className={cn(
                'w-full transition-all duration-300',
                voiceStatus === 'processing' && 'border-primary/50 bg-primary/5 text-primary',
                voiceStatus === 'success' && 'border-accent/50 bg-accent/10 text-accent',
                voiceStatus === 'error' && 'border-destructive/50 bg-destructive/10 text-destructive',
                hasVoiceProfile && voiceStatus === 'idle' && 'border-accent/30 text-accent',
              )}
              onClick={handleAnalyzeVoice}
              disabled={
                voiceStatus === 'starting' ||
                voiceStatus === 'processing' ||
                (hasVoiceProfile === true && voiceStatus === 'idle')
              }
            >
              {voiceStatus === 'idle' && hasVoiceProfile && (
                <>
                  <Check className="size-3" />
                  Tom de fala salvo
                </>
              )}
              {voiceStatus === 'idle' && !hasVoiceProfile && (
                <>
                  <Mic className="size-3" />
                  Analisar tom de fala
                </>
              )}
              {voiceStatus === 'starting' && (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Iniciando análise...
                </>
              )}
              {voiceStatus === 'processing' && (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Analisando tom{voiceProgress > 0 ? ` ${voiceProgress}%` : '...'}
                </>
              )}
              {voiceStatus === 'success' && (
                <>
                  <Check className="size-3" />
                  Tom salvo!
                </>
              )}
              {voiceStatus === 'error' && (
                <>
                  <X className="size-3" />
                  Falhou — tentar novamente
                </>
              )}
            </Button>

            {(voiceStatus === 'processing' || voiceStatus === 'starting') && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500 ease-out',
                    voiceStatus === 'starting' ? 'bg-primary/50 animate-pulse w-full' : 'bg-primary'
                  )}
                  style={voiceStatus === 'processing' ? { width: `${Math.max(voiceProgress, 5)}%` } : undefined}
                />
              </div>
            )}

            {voiceJob && voiceStatus === 'processing' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={(e) => handleCancel(e, voiceJob.id)}
                  className="text-[10px] text-muted-foreground transition-colors hover:text-destructive"
                >
                  Cancelar
                </button>
              </div>
            )}

            {voiceError && voiceStatus === 'error' && (
              <div className="flex items-start gap-1.5 rounded bg-destructive/5 px-2 py-1">
                <AlertCircle className="mt-0.5 size-3 shrink-0 text-destructive" />
                <p className="text-[10px] leading-tight text-destructive line-clamp-2">{voiceError}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
