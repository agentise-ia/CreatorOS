import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Sparkles, Heart, MessageCircle, Share2, Eye, Check, FileText, AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { useVoiceProfile } from '@/hooks/useVoiceProfile'
import { useProfiles } from '@/hooks/useProfiles'
import { useAppStore } from '@/store'
import { generateScript, getJobStatus } from '@/lib/api'
import { cn, formatNumber } from '@/lib/utils'
import supabase from '@/lib/supabase'
import type { Reel } from '@/types'

type ReelWithAnalysis = Reel & {
  analysis?: {
    hook: { type: string; effectiveness_score: number }
    development: { storytelling_technique: string }
    cta: { type: string; strength_score: number }
  } | null
}

export default function NewScriptPage() {
  const navigate = useNavigate()
  const { voiceProfile } = useVoiceProfile()
  const { profiles } = useProfiles()

  const [step, setStep] = useState<'select' | 'configure' | 'generating' | 'done'>('select')
  const [selectedReel, setSelectedReel] = useState<ReelWithAnalysis | null>(null)
  const [topic, setTopic] = useState('')
  const [instructions, setInstructions] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState(0)
  const [genError, setGenError] = useState<string | null>(null)
  const [viralReels, setViralReels] = useState<ReelWithAnalysis[]>([])
  const [loadingReels, setLoadingReels] = useState(true)
  const [profileFilter, setProfileFilter] = useState<string>('all')

  const modelProvider = useAppStore((s) => s.modelProvider)
  const modelId = useAppStore((s) => s.modelId)

  // Only reference profiles (concorrentes)
  const referenceProfiles = profiles.filter((p) => p.profile_type === 'reference')

  // Reels agrupados por perfil (concorrente), só perfis que têm reels analisados.
  const reelsByProfile = referenceProfiles
    .map((p) => ({
      profile: p,
      reels: viralReels.filter((r) => r.profile_id === p.id),
    }))
    .filter((g) => g.reels.length > 0)

  const visibleGroups =
    profileFilter === 'all'
      ? reelsByProfile
      : reelsByProfile.filter((g) => g.profile.id === profileFilter)

  // Fetch analyzed reels from reference profiles, ordered by engagement
  useEffect(() => {
    const refIds = referenceProfiles.map((p) => p.id)
    if (refIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadingReels(false)
      return
    }

    async function load() {
      setLoadingReels(true)

      // Get reels that have been analyzed (have content_analyses)
      const { data: analyses } = await supabase
        .from('content_analyses')
        .select('reel_id, hook, development, cta')

      const analyzedReelIds = (analyses ?? []).map((a: { reel_id: string }) => a.reel_id)

      if (analyzedReelIds.length === 0) {
        setViralReels([])
        setLoadingReels(false)
        return
      }

      // Get reels from reference profiles that are analyzed
      const { data: reels } = await supabase
        .from('reels')
        .select('*')
        .in('profile_id', refIds)
        .in('id', analyzedReelIds)
        .order('engagement_score', { ascending: false })

      // Merge analysis data
      const analysisMap = new Map<string, typeof analyses extends (infer T)[] | null ? T : never>()
      for (const a of analyses ?? []) {
        analysisMap.set((a as { reel_id: string }).reel_id, a)
      }

      const merged: ReelWithAnalysis[] = ((reels ?? []) as Reel[]).map((reel) => {
        const a = analysisMap.get(reel.id) as { hook: { type: string; effectiveness_score: number }; development: { storytelling_technique: string }; cta: { type: string; strength_score: number } } | undefined
        return { ...reel, analysis: a ?? null }
      })

      setViralReels(merged)
      setLoadingReels(false)
    }

    load()
  }, [profiles])

  function handleSelectReel(reel: ReelWithAnalysis) {
    setSelectedReel(reel)
    // Auto-fill topic from caption
    if (reel.caption) {
      const shortCaption = reel.caption.split('\n')[0].slice(0, 100)
      setTopic(shortCaption)
    }
    setStep('configure')
  }

  async function handleGenerate() {
    if (!selectedReel) return
    setGenError(null)
    setGenerating(true)
    setGenProgress(0)
    setStep('generating')

    try {
      const { job_id } = await generateScript({
        topic: topic.trim() || 'Baseado no reel viral selecionado',
        voice_profile_id: voiceProfile?.id,
        reference_reel_ids: [selectedReel.id],
        additional_instructions: instructions.trim() || undefined,
        model_provider: modelProvider,
        model_id: modelId,
      })

      // Poll until done
      let done = false
      while (!done) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          const job = await getJobStatus(job_id)
          setGenProgress(job.progress)

          if (job.status === 'completed') {
            setStep('done')
            done = true
          } else if (job.status === 'failed') {
            setGenError(job.error_message ?? 'Falha na geração do roteiro')
            setStep('configure')
            done = true
          }
        } catch {
          // continue polling
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setGenError(msg)
      setStep('configure')
    }
    setGenerating(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        {step !== 'generating' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (step === 'configure') setStep('select')
              else navigate('/scripts')
            }}
          >
            <ArrowLeft className="size-4" />
            {step === 'configure' ? 'Voltar' : 'Roteiros'}
          </Button>
        )}
        <div>
          <h1 className="text-xl font-bold text-foreground">Novo Roteiro</h1>
          <p className="text-sm text-muted-foreground">
            {step === 'select' && 'Selecione um reel viral como referência'}
            {step === 'configure' && 'Configure e gere o roteiro'}
            {step === 'generating' && 'Gerando seu roteiro...'}
            {step === 'done' && 'Roteiro gerado com sucesso!'}
          </p>
        </div>
      </div>

      {/* Step 1: Select viral reel */}
      {step === 'select' && (
        <>
          {loadingReels ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          ) : viralReels.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[rgba(59,130,246,0.2)] bg-[rgba(59,130,246,0.03)] py-16">
              <p className="text-sm text-muted-foreground">
                Nenhum reel de concorrente analisado
              </p>
              <p className="text-xs text-muted-foreground">
                Processe perfis de referência e analise os reels primeiro
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Filtro por perfil */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Perfil:</span>
                <button
                  onClick={() => setProfileFilter('all')}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-all',
                    profileFilter === 'all'
                      ? 'border-[rgba(59,130,246,0.45)] bg-[rgba(59,130,246,0.1)] text-primary'
                      : 'border-[rgba(59,130,246,0.12)] text-muted-foreground hover:border-[rgba(59,130,246,0.3)] hover:text-[#60A5FA]',
                  )}
                >
                  Todos ({viralReels.length})
                </button>
                {reelsByProfile.map(({ profile, reels }) => (
                  <button
                    key={profile.id}
                    onClick={() => setProfileFilter(profile.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-all',
                      profileFilter === profile.id
                        ? 'border-[rgba(59,130,246,0.45)] bg-[rgba(59,130,246,0.1)] text-primary'
                        : 'border-[rgba(59,130,246,0.12)] text-muted-foreground hover:border-[rgba(59,130,246,0.3)] hover:text-[#60A5FA]',
                    )}
                  >
                    @{profile.instagram_username} ({reels.length})
                  </button>
                ))}
              </div>

              {/* Grupos por perfil */}
              {visibleGroups.map(({ profile, reels }) => (
                <div key={profile.id} className="space-y-3">
                  {/* Separador do perfil */}
                  <div className="flex items-center gap-3">
                    {profile.profile_pic_url ? (
                      <img
                        src={profile.profile_pic_url}
                        alt=""
                        className="size-7 rounded-full object-cover"
                      />
                    ) : (
                      <div className="size-7 rounded-full bg-gradient-to-br from-primary/40 to-accent/30" />
                    )}
                    <h3 className="text-sm font-semibold text-foreground">
                      @{profile.instagram_username}
                    </h3>
                    <Badge variant="secondary" className="text-[10px]">
                      {reels.length} {reels.length === 1 ? 'reel' : 'reels'}
                    </Badge>
                    <div className="h-px flex-1 bg-[rgba(59,130,246,0.12)]" />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {reels.map((reel) => (
                      <Card
                        key={reel.id}
                        className="cursor-pointer overflow-hidden transition-all hover:border-[rgba(59,130,246,0.45)] hover:ring-1 hover:ring-primary/20"
                        onClick={() => handleSelectReel(reel)}
                      >
                        {/* Thumbnail */}
                        <div className="relative aspect-[9/16] max-h-48 w-full overflow-hidden">
                          {reel.thumbnail_url ? (
                            <img
                              src={reel.thumbnail_url}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : (
                            <div className="size-full bg-gradient-to-br from-primary/30 to-accent/20" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                          <div className="absolute bottom-2 left-2 right-2">
                            <Badge className="bg-accent/90 text-accent-foreground text-[10px]">
                              {formatNumber(reel.engagement_score)} engagement
                            </Badge>
                          </div>
                        </div>

                        <CardContent className="space-y-2 pt-3">
                          {/* Caption */}
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {reel.caption?.slice(0, 100) ?? 'Sem legenda'}
                          </p>

                          {/* Metrics */}
                          <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
                            <div className="flex items-center gap-0.5">
                              <Heart className="size-2.5 text-red-400" />
                              {formatNumber(reel.likes_count)}
                            </div>
                            <div className="flex items-center gap-0.5">
                              <MessageCircle className="size-2.5 text-blue-400" />
                              {formatNumber(reel.comments_count)}
                            </div>
                            <div className="flex items-center gap-0.5">
                              <Share2 className="size-2.5 text-green-400" />
                              {formatNumber(reel.shares_count)}
                            </div>
                            <div className="flex items-center gap-0.5">
                              <Eye className="size-2.5 text-yellow-400" />
                              {formatNumber(reel.views_count)}
                            </div>
                          </div>

                          {/* Analysis tags */}
                          {reel.analysis && (
                            <div className="flex flex-wrap gap-1">
                              <Badge className="bg-red-500/20 text-red-400 text-[9px]">
                                Hook: {reel.analysis.hook.type}
                              </Badge>
                              <Badge className="bg-blue-500/20 text-blue-400 text-[9px]">
                                {reel.analysis.development.storytelling_technique}
                              </Badge>
                              <Badge className="bg-green-500/20 text-green-400 text-[9px]">
                                CTA: {reel.analysis.cta.type}
                              </Badge>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Step 2: Configure and generate */}
      {step === 'configure' && selectedReel && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Config form */}
          <div className="space-y-4">
            {/* Selected reel summary */}
            <Card className="border-[rgba(59,130,246,0.3)]">
              <CardContent className="flex items-center gap-3 pt-4">
                {selectedReel.thumbnail_url ? (
                  <img
                    src={selectedReel.thumbnail_url}
                    alt=""
                    className="size-14 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="size-14 shrink-0 rounded-lg bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">
                    Reel de referência selecionado
                  </p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {selectedReel.caption?.slice(0, 80) ?? 'Sem legenda'}
                  </p>
                  <div className="mt-1 flex gap-1">
                    <Badge className="bg-accent/20 text-accent text-[10px]">
                      {formatNumber(selectedReel.engagement_score)} eng
                    </Badge>
                    {selectedReel.analysis && (
                      <>
                        <Badge className="bg-red-500/20 text-red-400 text-[9px]">
                          {selectedReel.analysis.hook.type}
                        </Badge>
                        <Badge className="bg-blue-500/20 text-blue-400 text-[9px]">
                          {selectedReel.analysis.development.storytelling_technique}
                        </Badge>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setStep('select')}
                >
                  Trocar
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="topic">Tema / Assunto do roteiro</Label>
                  <Input
                    id="topic"
                    placeholder="Ex: 5 erros que destroem seu alcance no Instagram"
                    value={topic}
                    onChange={(e) => setTopic((e.target as HTMLInputElement).value)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    O roteiro usará a estrutura viral do reel selecionado + seu tom de fala
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="instructions">Instruções adicionais (opcional)</Label>
                  <textarea
                    id="instructions"
                    className="flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Ex: Foque em dicas práticas, mantenha tom informal..."
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Modelo de IA</Label>
                  <ModelSelector compact />
                </div>

                {/* Voice profile status */}
                <div className="rounded-lg bg-[rgba(59,130,246,0.05)] border border-[rgba(59,130,246,0.12)] p-3">
                  <div className="flex items-center gap-2">
                    {voiceProfile ? (
                      <>
                        <Check className="size-3.5 text-accent" />
                        <p className="text-xs text-accent">
                          Voice Profile ativo — seu tom de fala será aplicado
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-yellow-400">
                        Voice Profile não gerado — vá em Perfis e clique "Analisar tom" no seu perfil
                      </p>
                    )}
                  </div>
                </div>

                {genError && (
                  <div className="flex items-start gap-1.5 rounded bg-destructive/5 px-2 py-1.5">
                    <AlertCircle className="mt-0.5 size-3 shrink-0 text-destructive" />
                    <p className="text-xs text-destructive">{genError}</p>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  <Sparkles className="size-4" />
                  Gerar Roteiro
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right panel: what will happen */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              O que será gerado
            </h3>
            <Card>
              <CardContent className="space-y-3 pt-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="size-2 rounded-full bg-red-500" />
                    <span className="text-xs font-medium text-foreground">Hook</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Baseado no hook "{selectedReel.analysis?.hook.type ?? 'viral'}" do reel selecionado
                    (eficácia: {selectedReel.analysis?.hook.effectiveness_score ?? '?'}/10)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="size-2 rounded-full bg-blue-500" />
                    <span className="text-xs font-medium text-foreground">Desenvolvimento</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Técnica: {selectedReel.analysis?.development.storytelling_technique ?? 'extraída do viral'}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="size-2 rounded-full bg-green-500" />
                    <span className="text-xs font-medium text-foreground">CTA</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Tipo: {selectedReel.analysis?.cta.type ?? 'do viral'}
                    (força: {selectedReel.analysis?.cta.strength_score ?? '?'}/10)
                  </p>
                </div>

                <div className="h-px bg-[rgba(59,130,246,0.08)]" />

                <div className="space-y-2">
                  <span className="text-xs font-medium text-foreground">Tom de fala</span>
                  <p className="text-[10px] text-muted-foreground">
                    {voiceProfile
                      ? voiceProfile.tone_description ?? 'Personalizado com base nos seus vídeos'
                      : 'Genérico (gere seu Voice Profile para personalizar)'}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <h4 className="mb-2 text-xs font-medium text-foreground">Inclui</h4>
                <ul className="space-y-1 text-[10px] text-muted-foreground">
                  <li>- Roteiro para teleprompter</li>
                  <li>- Roteiro anotado por seção</li>
                  <li>- Relatório de edição completo</li>
                  <li>- Sugestões de música e efeitos</li>
                  <li>- Instruções de b-roll e transições</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Step 3: Generating */}
      {step === 'generating' && (
        <Card className="border-[rgba(59,130,246,0.3)]">
          <CardContent className="space-y-6 py-12">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="size-8 text-primary animate-pulse" />
                </div>
                <div className="absolute -inset-2 animate-spin rounded-full border-2 border-transparent border-t-primary" style={{ animationDuration: '3s' }} />
              </div>

              <div className="text-center">
                <p className="text-lg font-semibold text-foreground">Gerando roteiro...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Analisando padrões virais e aplicando seu tom de fala
                </p>
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-md space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                    style={{ width: `${Math.max(genProgress, 5)}%` }}
                  />
                </div>
                <p className="text-center text-xs text-muted-foreground">{genProgress}%</p>
              </div>

              {/* Steps */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className={cn(genProgress >= 10 ? 'text-primary' : '')}>
                  {genProgress >= 25 ? <Check className="inline size-3 text-accent" /> : <Loader2 className="inline size-3 animate-spin" />}
                  {' '}Buscando padrões
                </span>
                <span>→</span>
                <span className={cn(genProgress >= 25 ? 'text-primary' : '')}>
                  {genProgress >= 80 ? <Check className="inline size-3 text-accent" /> : genProgress >= 25 ? <Loader2 className="inline size-3 animate-spin" /> : null}
                  {' '}Escrevendo roteiro
                </span>
                <span>→</span>
                <span className={cn(genProgress >= 80 ? 'text-primary' : '')}>
                  {genProgress >= 100 ? <Check className="inline size-3 text-accent" /> : genProgress >= 80 ? <Loader2 className="inline size-3 animate-spin" /> : null}
                  {' '}Relatório de edição
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Done */}
      {step === 'done' && (
        <Card className="border-[rgba(16,185,129,0.3)]">
          <CardContent className="space-y-4 py-12">
            <div className="flex flex-col items-center gap-4">
              <div className="flex size-16 items-center justify-center rounded-full bg-accent/20">
                <Check className="size-8 text-accent" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-accent">Roteiro gerado!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Estrutura viral + seu tom de fala aplicados
                </p>
              </div>
              <div className="flex gap-3">
                <Button onClick={() => navigate('/scripts')}>
                  <FileText className="size-4" />
                  Ver Roteiros
                </Button>
                <Button variant="outline" onClick={() => { setStep('select'); setSelectedReel(null); setGenProgress(0) }}>
                  Gerar outro
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
