import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ReelCard } from '@/components/reels/ReelCard'
import { useReels } from '@/hooks/useReels'
import type { ReelSortBy } from '@/hooks/useReels'
import supabase from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'
import type { Profile } from '@/types'

const SORT_OPTIONS: { value: ReelSortBy; label: string }[] = [
  { value: 'engagement_score', label: 'Engagement' },
  { value: 'posted_at', label: 'Data' },
  { value: 'likes_count', label: 'Curtidas' },
]

export default function ProfileReelsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { reels, loading: reelsLoading, error: reelsError, sortBy, setSortBy } =
    useReels(id)

  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set())

  const reloadAnalyzedIds = useCallback(async () => {
    if (reels.length === 0) {
      setAnalyzedIds(new Set())
      return
    }
    const { data } = await supabase
      .from('content_analyses')
      .select('reel_id, hook')
      .in('reel_id', reels.map((r) => r.id))
    // Treat timeout/error placeholders as "not analyzed" so the card shows
    // "Analisar este reel" again, letting the user retry.
    const validAnalyses = ((data ?? []) as { reel_id: string; hook: { type?: string } }[])
      .filter((a) => a.hook?.type !== 'timeout' && a.hook?.type !== 'error')
    setAnalyzedIds(new Set(validAnalyses.map((a) => a.reel_id)))
  }, [reels])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadAnalyzedIds()
  }, [reloadAnalyzedIds])

  const fetchProfile = useCallback(async () => {
    if (!id) return
    setProfileLoading(true)

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single()

    if (!error && data) {
      setProfile(data as Profile)
    }
    setProfileLoading(false)
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProfile()
  }, [fetchProfile])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Back + Profile info */}
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => navigate('/profiles')}
        >
          <ArrowLeft className="size-4" />
          Voltar para Perfis
        </Button>

        {profileLoading && (
          <div className="h-16 animate-pulse rounded-xl bg-card ring-1 border border-[rgba(59,130,246,0.15)]" />
        )}

        {profile && (
          <div className="flex items-center gap-4">
            {profile.profile_pic_url ? (
              <img
                src={profile.profile_pic_url}
                alt={profile.instagram_username}
                className="size-14 rounded-full object-cover border border-[rgba(59,130,246,0.15)]"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground border border-[rgba(59,130,246,0.15)]">
                {profile.instagram_username.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-foreground">
                  @{profile.instagram_username}
                </h1>
                <Badge
                  variant="secondary"
                  className={
                    profile.profile_type === 'own'
                      ? 'bg-accent/20 text-accent'
                      : 'bg-blue-500/20 text-blue-400'
                  }
                >
                  {profile.profile_type === 'own' ? 'Meu Perfil' : 'Referência'}
                </Badge>
              </div>
              {profile.full_name && (
                <p className="text-sm text-muted-foreground">
                  {profile.full_name}
                </p>
              )}
              {profile.followers_count !== null && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="size-3" />
                  <span>{formatNumber(profile.followers_count)} seguidores</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sort + Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {reels.length} {reels.length === 1 ? 'reel' : 'reels'}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Ordenar por:</span>
          {SORT_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={sortBy === opt.value ? 'default' : 'outline'}
              size="xs"
              onClick={() => setSortBy(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Error */}
      {reelsError && (
        <p className="text-sm text-destructive">{reelsError}</p>
      )}

      {/* Loading */}
      {reelsLoading && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[9/16] animate-pulse rounded-xl bg-card ring-1 border border-[rgba(59,130,246,0.15)]"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!reelsLoading && reels.length === 0 && !reelsError && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[rgba(59,130,246,0.2)] bg-[rgba(59,130,246,0.03)] py-16">
          <p className="text-sm text-muted-foreground">
            Nenhum reel encontrado para este perfil.
          </p>
          <p className="text-xs text-muted-foreground">
            O scraping pode ainda estar em andamento.
          </p>
        </div>
      )}

      {/* Reels grid */}
      {!reelsLoading && reels.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {reels.map((reel) => (
            <ReelCard
              key={reel.id}
              reel={reel}
              analyzed={analyzedIds.has(reel.id)}
              onAnalyzed={reloadAnalyzedIds}
            />
          ))}
        </div>
      )}
    </div>
  )
}
