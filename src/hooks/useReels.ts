import { useCallback, useEffect, useState } from 'react'
import supabase from '@/lib/supabase'
import type { Reel } from '@/types'

export type ReelSortBy = 'engagement_score' | 'posted_at' | 'likes_count'

export function useReels(profileId: string | undefined) {
  const [reels, setReels] = useState<Reel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<ReelSortBy>('engagement_score')

  const fetchReels = useCallback(async () => {
    if (!profileId) {
      setReels([])
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('reels')
      .select('*')
      .eq('profile_id', profileId)
      .order(sortBy, { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setReels((data ?? []) as Reel[])
    }

    setLoading(false)
  }, [profileId, sortBy])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReels()
  }, [fetchReels])

  return { reels, loading, error, sortBy, setSortBy }
}
