import { useEffect, useState } from 'react'
import supabase from '@/lib/supabase'
import { useAppStore } from '@/store'
import type { AppUser } from '@/types/auth'

interface UseAppUserResult {
  appUser: AppUser | null
  isAdmin: boolean
  loading: boolean
  error: Error | null
}

export function useAppUser(): UseAppUserResult {
  const user = useAppStore((s) => s.user)
  const appUser = useAppStore((s) => s.appUser)
  const setAppUser = useAppStore((s) => s.setAppUser)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!user) {
      setAppUser(null)
      return
    }

    if (appUser && appUser.user_id === user.id) {
      return
    }

    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)

    supabase
      .from('app_users')
      .select('user_id, role, created_at, updated_at')
      .eq('user_id', user.id)
      .single()
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        if (fetchError) {
          setError(fetchError)
          setAppUser(null)
        } else {
          setAppUser(data as AppUser)
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [user, appUser, setAppUser])

  return {
    appUser,
    isAdmin: appUser?.role === 'admin',
    loading,
    error,
  }
}
