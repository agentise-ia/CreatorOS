import { useCallback, useEffect, useState } from 'react'
import supabase from '@/lib/supabase'
import { useAppStore } from '@/store'
import type { Profile } from '@/types'

export function useProfiles() {
  const user = useAppStore((s) => s.user)
  const profiles = useAppStore((s) => s.profiles)
  const setProfiles = useAppStore((s) => s.setProfiles)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchProfiles = useCallback(async () => {
    if (!user) {
      setProfiles([])
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setProfiles((data ?? []) as Profile[])
    }

    setLoading(false)
  }, [user, setProfiles])

  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchProfiles()
    }
  }, [user, fetchProfiles])

  return { profiles, loading, error, refetch: fetchProfiles }
}
