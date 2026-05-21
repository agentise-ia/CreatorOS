import { useState, useEffect, useRef } from 'react'
import { Mic, Loader2, RefreshCw, Quote, Zap, Download, Check, X, AlertCircle, Eye, Film } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn, formatNumber } from '@/lib/utils'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { useVoiceProfile } from '@/hooks/useVoiceProfile'
import { useProfiles } from '@/hooks/useProfiles'
import { useAppStore } from '@/store'
import { generateVoiceProfile, scrapeProfile, cancelJob } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import supabase from '@/lib/supabase'
import type { Profile, Reel } from '@/types'

type ButtonStatus = 'idle' | 'starting' | 'processing' | 'success' | 'error'

function ReelThumb({ src, alt }: { src: string | null; alt: string }) {
  const [error, setError] = useState(false)
  if (!src || error) {
    return (
      <div className="flex size-full items-center justify-center bg-gradient-to-br from-[rgba(59,130,246,0.15)] to-[rgba(37,99,235,0.05)]">
        <Film className="size-6 text-muted-foreground/50" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className="size-full object-cover"
      onError={() => setError(true)}
      referrerPolicy="no-referrer"
    />
  )
}

export default function VoiceProfilePage() {
  const { voiceProfile, loading, refetch: refetchVoiceProfile } = useVoiceProfile()
  const { profiles, refetch: refetchProfiles } = useProfiles()
  const activeJobs = useAppStore((s) => s.activeJobs)
  const user = useAppStore((s) => s.user)
  const addProfile = useAppStore((s) => s.addProfile)

  const [ownReels, setOwnReels] = useState<Reel[]>([])
  const [generating, setGenerating] = useState(false)
  const [selectedReels, setSelectedReels] = useState<Set<string>>(new Set())
  const [scrapeStatus, setScrapeStatus] = useState<ButtonStatus>('idle')
  const [scrapeProgress, setScrapeProgress] = useState(0)
  const [scrapeError, setScrapeError] = useState<string | null>(null)
  const [reelsRefreshKey, setReelsRefreshKey] = useState(0)
  const [ownUsernameInput, setOwnUsernameInput] = useState('')
  const [creatingOwn, setCreatingOwn] = useState(false)
  const [createOwnError, setCreateOwnError] = useState<string | null>(null)

  const ownProfile = profiles.find((p) => p.profile_type === 'own')
  const vpJobs = activeJobs.filter(
    (j) => j.job_type === 'voice_profile' && (j.status === 'pending' || j.status === 'processing')
  )
  const activeVPJob = vpJobs[0]
  const vpProgress = activeVPJob?.progress ?? 0
  const isGenerating = !!activeVPJob

  const ownScrapeJob = ownProfile
    ? activeJobs.find((j) => {
        if (j.job_type !== 'scrape') return false
        const usernames = (j.input_data as { usernames?: unknown })?.usernames
        return Array.isArray(usernames) && usernames.includes(ownProfile.instagram_username)
      })
    : undefined

  const trackedJobRef = useRef<string | null>(null)
  const trackedVPJobRef = useRef<string | null>(null)
  const [vpError, setVpError] = useState<string | null>(null)

  // Track active vp job ID; when it transitions to completed/failed, refetch profile
  useEffect(() => {
    if (activeVPJob) {
      trackedVPJobRef.current = activeVPJob.id
      setVpError(null)
      return
    }
    const tracked = trackedVPJobRef.current
    if (!tracked) return
    const finished = activeJobs.find(
      (j) => j.id === tracked && (j.status === 'completed' || j.status === 'failed')
    )
    if (!finished) return
    trackedVPJobRef.current = null
    if (finished.status === 'completed') {
      refetchVoiceProfile()
    } else {
      setVpError(finished.error_message ?? 'Falha ao gerar Voice Profile')
      const t = setTimeout(() => setVpError(null), 8000)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVPJob?.id, activeJobs])

  useEffect(() => {
    if (!ownScrapeJob) return

    if (ownScrapeJob.status === 'pending' || ownScrapeJob.status === 'processing') {
      setScrapeStatus('processing')
      setScrapeProgress(ownScrapeJob.progress)
      setScrapeError(null)
      trackedJobRef.current = ownScrapeJob.id
      return
    }

    if (trackedJobRef.current !== ownScrapeJob.id) return

    if (ownScrapeJob.status === 'completed') {
      setScrapeStatus('success')
      setScrapeProgress(100)
      setReelsRefreshKey((k) => k + 1)
      trackedJobRef.current = null
      const t = setTimeout(() => setScrapeStatus('idle'), 4000)
      return () => clearTimeout(t)
    }

    if (ownScrapeJob.status === 'failed') {
      setScrapeStatus('error')
      setScrapeError(ownScrapeJob.error_message ?? 'Falha no processamento')
      trackedJobRef.current = null
      const t = setTimeout(() => setScrapeStatus('idle'), 8000)
      return () => clearTimeout(t)
    }
    // Watching specific fields (not the whole object) to avoid re-runs on store identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownScrapeJob?.id, ownScrapeJob?.status, ownScrapeJob?.progress, ownScrapeJob?.error_message])

  useEffect(() => {
    if (!ownProfile) return
    supabase
      .from('reels')
      .select('*')
      .eq('profile_id', ownProfile.id)
      .order('engagement_score', { ascending: false })
      .then(({ data }) => {
        const reels = (data ?? []) as Reel[]
        setOwnReels(reels)
        // Pre-select top 5-10
        const preselect = reels.slice(0, Math.min(10, reels.length)).map((r) => r.id)
        setSelectedReels(new Set(preselect))
      })
  }, [ownProfile, reelsRefreshKey])

  async function handleCreateOwn(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const cleanUsername = ownUsernameInput.replace(/^@/, '').trim()
    if (!cleanUsername) {
      setCreateOwnError('Insira um nome de usuário válido.')
      return
    }
    setCreatingOwn(true)
    setCreateOwnError(null)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .insert({
          user_id: user.id,
          instagram_username: cleanUsername,
          profile_type: 'own',
        })
        .select()
        .single()
      if (error) {
        if (error.code === '23505') {
          setCreateOwnError('Esse perfil já está cadastrado.')
        } else {
          setCreateOwnError(error.message)
        }
        setCreatingOwn(false)
        return
      }
      addProfile(data as Profile)
      await refetchProfiles()
      setOwnUsernameInput('')
      // Trigger scraping immediately
      scrapeProfile([cleanUsername], 'own').catch((err) => {
        console.error('Scrape trigger failed:', err)
      })
    } catch (err) {
      setCreateOwnError(err instanceof Error ? err.message : 'Erro desconhecido.')
    } finally {
      setCreatingOwn(false)
    }
  }

  async function handleScrapeOwn() {
    if (!ownProfile) return
    setScrapeError(null)
    setScrapeStatus('starting')
    setScrapeProgress(0)
    try {
      await scrapeProfile([ownProfile.instagram_username], 'own')
      // The job is now in flight. The useEffect watching ownScrapeJob will
      // pick it up via Supabase Realtime and drive scrapeStatus/progress —
      // this works even if the user navigates away and comes back.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setScrapeError(msg)
      setScrapeStatus('error')
      setTimeout(() => setScrapeStatus('idle'), 8000)
    }
  }

  const modelProvider = useAppStore((s) => s.modelProvider)
  const modelId = useAppStore((s) => s.modelId)

  async function handleGenerate() {
    if (!ownProfile || selectedReels.size === 0) return
    setGenerating(true)
    setVpError(null)
    try {
      await generateVoiceProfile(ownProfile.id, Array.from(selectedReels), modelProvider, modelId)
      // Job is now in flight. The useEffect watching activeVPJob picks it up
      // via Realtime and drives the button state until completion.
    } catch (err) {
      setVpError(err instanceof Error ? err.message : 'Erro ao iniciar geração')
      setTimeout(() => setVpError(null), 8000)
    } finally {
      setGenerating(false)
    }
  }

  function toggleReel(reelId: string) {
    setSelectedReels((prev) => {
      const next = new Set(prev)
      if (next.has(reelId)) next.delete(reelId)
      else next.add(reelId)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Estilo de Fala</h1>
          <p className="text-sm text-muted-foreground">
            Tom de fala extraído dos seus vídeos
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ownProfile && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleScrapeOwn}
              disabled={scrapeStatus === 'starting' || scrapeStatus === 'processing'}
              className={cn(
                scrapeStatus === 'processing' && 'border-primary/50 bg-primary/5 text-primary',
                scrapeStatus === 'success' && 'border-accent/50 bg-accent/10 text-accent',
                scrapeStatus === 'error' && 'border-destructive/50 bg-destructive/10 text-destructive',
              )}
            >
              {scrapeStatus === 'idle' && (<><Download className="size-3" />Extrair meus vídeos</>)}
              {scrapeStatus === 'starting' && (<><Loader2 className="size-3 animate-spin" />Iniciando...</>)}
              {scrapeStatus === 'processing' && (<><Loader2 className="size-3 animate-spin" />Extraindo{scrapeProgress > 0 ? ` ${scrapeProgress}%` : '...'}</>)}
              {scrapeStatus === 'success' && (<><Check className="size-3" />Concluído!</>)}
              {scrapeStatus === 'error' && (<><X className="size-3" />Falhou — tentar novamente</>)}
            </Button>
          )}
          {voiceProfile && (
            <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
              <RefreshCw className="size-3" />
              Regenerar
            </Button>
          )}
          {ownScrapeJob && scrapeStatus === 'processing' && (
            <button
              type="button"
              onClick={() => cancelJob(ownScrapeJob.id).catch(() => {})}
              className="text-xs text-muted-foreground transition-colors hover:text-destructive"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      {scrapeError && scrapeStatus === 'error' && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">{scrapeError}</p>
        </div>
      )}

      {/* Active jobs */}
      {vpJobs.length > 0 && (
        <Card className="border-[rgba(59,130,246,0.3)]">
          <CardContent className="flex items-center justify-between gap-3 pt-6">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-primary" />
              <span className="text-sm">
                Gerando Voice Profile...
                {vpJobs[0]?.progress > 0 && ` (${vpJobs[0].progress}%)`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => cancelJob(vpJobs[0].id).catch(() => {})}
              className="text-xs text-muted-foreground transition-colors hover:text-destructive"
            >
              Cancelar
            </button>
          </CardContent>
        </Card>
      )}

      {/* No own profile — form to create */}
      {!ownProfile && (
        <Card>
          <CardContent className="space-y-4 pt-4">
            <div className="flex items-center gap-2">
              <Mic className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                Cadastre seu perfil do Instagram
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Vamos analisar seus vídeos para extrair seu estilo de fala
              (vocabulário, ritmo, expressões frequentes, tom).
            </p>
            <form onSubmit={handleCreateOwn} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="own-username">Seu @ do Instagram</Label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">@</span>
                  <Input
                    id="own-username"
                    placeholder="seu_usuario"
                    value={ownUsernameInput}
                    onChange={(e) => setOwnUsernameInput(e.target.value)}
                    disabled={creatingOwn}
                    autoFocus
                  />
                </div>
              </div>
              <Button type="submit" disabled={creatingOwn || !ownUsernameInput.trim()}>
                {creatingOwn ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
                Cadastrar e extrair
              </Button>
            </form>
            {createOwnError && (
              <p className="text-xs text-destructive">{createOwnError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Voice profile exists */}
      {voiceProfile && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Summary card */}
          <Card>
            <CardContent className="space-y-4 pt-4">
              <div className="flex items-center gap-2">
                <Mic className="size-4 text-primary" />
                <h3 className="text-sm font-semibold">Resumo do Tom</h3>
                <Badge variant="secondary" className="text-[10px]">
                  {voiceProfile.source_reel_ids?.length ?? 0} vídeos base
                </Badge>
              </div>

              {voiceProfile.tone_description && (
                <div className="space-y-1">
                  <p className="label-uppercase">Tom</p>
                  <p className="text-sm text-foreground">{voiceProfile.tone_description}</p>
                </div>
              )}

              {voiceProfile.vocabulary_style && (
                <div className="space-y-1">
                  <p className="label-uppercase">Vocabulário</p>
                  <p className="text-sm text-foreground">{voiceProfile.vocabulary_style}</p>
                </div>
              )}

              {voiceProfile.sentence_structure && (
                <div className="space-y-1">
                  <p className="label-uppercase">Estrutura</p>
                  <p className="text-sm text-foreground">{voiceProfile.sentence_structure}</p>
                </div>
              )}

              {voiceProfile.pacing_style && (
                <div className="space-y-1">
                  <p className="label-uppercase">Ritmo</p>
                  <p className="text-sm text-foreground">{voiceProfile.pacing_style}</p>
                </div>
              )}

              {voiceProfile.emotional_range && (
                <div className="space-y-1">
                  <p className="label-uppercase">Emoções</p>
                  <p className="text-sm text-foreground">{voiceProfile.emotional_range}</p>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground">
                Gerado {formatDate(voiceProfile.generated_at)}
              </p>
            </CardContent>
          </Card>

          {/* Expressions */}
          <Card>
            <CardContent className="space-y-4 pt-4">
              {/* Filler words */}
              {voiceProfile.filler_words.length > 0 && (
                <div className="space-y-2">
                  <p className="label-uppercase">
                    Palavras de preenchimento
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {voiceProfile.filler_words.map((word) => (
                      <Badge key={word} variant="secondary" className="text-xs">
                        {word}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Common expressions */}
              {voiceProfile.common_expressions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <Quote className="size-3 text-muted-foreground" />
                    <p className="label-uppercase">
                      Expressões frequentes
                    </p>
                  </div>
                  <div className="space-y-1">
                    {voiceProfile.common_expressions.map((expr) => (
                      <div
                        key={expr}
                        className="rounded bg-[rgba(59,130,246,0.06)] border border-[rgba(59,130,246,0.12)] px-2 py-1 text-xs text-foreground"
                      >
                        "{expr}"
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Full profile document */}
          <Card className="lg:col-span-2">
            <CardContent className="pt-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">
                Documento Completo do Voice Profile
              </h3>
              <div className="max-h-64 overflow-y-auto rounded-lg bg-[rgba(59,130,246,0.05)] border border-[rgba(59,130,246,0.12)] p-4">
                <pre className="whitespace-pre-wrap text-xs text-foreground leading-relaxed">
                  {voiceProfile.full_profile_document}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Generate section (when no profile yet or when ownProfile exists) */}
      {ownProfile && !voiceProfile && ownReels.length > 0 && (
        <Card>
          <CardContent className="space-y-4 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                <h3 className="text-sm font-semibold">Gerar Voice Profile</h3>
              </div>
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={generating || isGenerating || selectedReels.size < 3}
              >
                {generating ? (
                  <><Loader2 className="size-3 animate-spin" />Iniciando...</>
                ) : isGenerating ? (
                  <><Loader2 className="size-3 animate-spin" />Gerando{vpProgress > 0 ? ` ${vpProgress}%` : '...'}</>
                ) : (
                  <>
                    <Mic className="size-3" />
                    Gerar ({selectedReels.size} selecionados)
                  </>
                )}
              </Button>
            </div>
            {vpError && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{vpError}</p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Selecione pelo menos 5 vídeos para um resultado mais preciso (mínimo 3).
            </p>

            <ModelSelector compact />

            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
              {ownReels.map((reel) => {
                const isSelected = selectedReels.has(reel.id)
                return (
                  <button
                    key={reel.id}
                    onClick={() => toggleReel(reel.id)}
                    className={cn(
                      'group relative flex flex-col gap-2 overflow-hidden rounded-lg border p-2 text-left transition-colors',
                      isSelected
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-muted-foreground',
                    )}
                  >
                    <div
                      className={cn(
                        'absolute right-2 top-2 z-10 flex size-5 items-center justify-center rounded border-2 transition-colors',
                        isSelected
                          ? 'border-accent bg-accent text-white'
                          : 'border-muted-foreground/40 bg-background/80 backdrop-blur-sm',
                      )}
                    >
                      {isSelected && <Check className="size-3" strokeWidth={3} />}
                    </div>
                    <div className="relative aspect-[9/16] max-h-48 w-full overflow-hidden rounded">
                      <ReelThumb src={reel.thumbnail_url} alt={reel.caption ?? ''} />
                    </div>
                    <div className="space-y-1">
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {reel.caption?.slice(0, 80) ?? 'Sem legenda'}
                      </p>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Eye className="size-3 text-[#3B82F6]" />
                        <span>{formatNumber(reel.views_count)} views</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {ownProfile && ownReels.length === 0 && !voiceProfile && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[rgba(59,130,246,0.2)] bg-[rgba(59,130,246,0.03)] py-16">
          <Mic className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhum reel encontrado no seu perfil
          </p>
          <p className="text-xs text-muted-foreground">
            Extraia os vídeos de @{ownProfile.instagram_username} pra começar.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleScrapeOwn}
            disabled={scrapeStatus === 'starting' || scrapeStatus === 'processing'}
            className="border-[rgba(59,130,246,0.25)] hover:border-[rgba(59,130,246,0.45)] hover:bg-[rgba(59,130,246,0.08)]"
          >
            {scrapeStatus === 'idle' && (<><Download className="size-3" />Extrair meus vídeos</>)}
            {scrapeStatus === 'starting' && (<><Loader2 className="size-3 animate-spin" />Iniciando...</>)}
            {scrapeStatus === 'processing' && (<><Loader2 className="size-3 animate-spin" />Extraindo{scrapeProgress > 0 ? ` ${scrapeProgress}%` : '...'}</>)}
            {scrapeStatus === 'success' && (<><Check className="size-3" />Concluído!</>)}
            {scrapeStatus === 'error' && (<><X className="size-3" />Tentar novamente</>)}
          </Button>
        </div>
      )}
    </div>
  )
}
