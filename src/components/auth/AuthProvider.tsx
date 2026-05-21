import { useEffect } from 'react'
import supabase from '@/lib/supabase'
import { useAppStore } from '@/store'
import type { AppUser } from '@/types/auth'

interface AuthProviderProps {
  children: React.ReactNode
}

async function fetchAppUser(userId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('user_id, role, created_at, updated_at')
    .eq('user_id', userId)
    .single()

  if (error) {
    console.error('Failed to fetch app_user', error)
    return null
  }
  return data as AppUser
}

export function AuthProvider({ children }: AuthProviderProps) {
  const setUser = useAppStore((s) => s.setUser)
  const setAppUser = useAppStore((s) => s.setAppUser)
  const setAuthLoading = useAppStore((s) => s.setAuthLoading)

  useEffect(() => {
    let mounted = true

    async function syncAuth(userId: string | null) {
      if (!userId) {
        if (mounted) setAppUser(null)
        return
      }
      const appUser = await fetchAppUser(userId)
      if (mounted) setAppUser(appUser)
    }

    // Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      const sessionUser = session?.user ?? null
      setUser(sessionUser)
      setAuthLoading(false)
      void syncAuth(sessionUser?.id ?? null)
    })

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null
      setUser(sessionUser)
      setAuthLoading(false)
      void syncAuth(sessionUser?.id ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [setUser, setAppUser, setAuthLoading])

  return <>{children}</>
}
