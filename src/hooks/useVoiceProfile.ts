import { useCallback, useEffect, useState } from 'react'
import supabase from '@/lib/supabase'
import { useAppStore } from '@/store'
import type { VoiceProfile } from '@/types'

export function useVoiceProfile() {
  const user = useAppStore((s) => s.user)
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchVoiceProfile = useCallback(async () => {
    if (!user) {
      setVoiceProfile(null)
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('voice_profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setVoiceProfile((data as VoiceProfile) ?? null)
    }

    setLoading(false)
  }, [user])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchVoiceProfile()
  }, [fetchVoiceProfile])

  return { voiceProfile, loading, error, refetch: fetchVoiceProfile }
}
