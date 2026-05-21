import { useCallback, useEffect, useState } from 'react'
import supabase from '@/lib/supabase'
import { useAppStore } from '@/store'
import type { Script } from '@/types'

export function useScripts() {
  const user = useAppStore((s) => s.user)
  const [scripts, setScripts] = useState<Script[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchScripts = useCallback(async () => {
    if (!user) {
      setScripts([])
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('scripts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setScripts((data ?? []) as Script[])
    }

    setLoading(false)
  }, [user])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchScripts()
  }, [fetchScripts])

  return { scripts, loading, error, refetch: fetchScripts }
}

export function useScript(scriptId: string | undefined) {
  const [script, setScript] = useState<Script | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchScript = useCallback(async () => {
    if (!scriptId) {
      setScript(null)
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('scripts')
      .select('*')
      .eq('id', scriptId)
      .single()

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setScript((data as Script) ?? null)
    }

    setLoading(false)
  }, [scriptId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchScript()
  }, [fetchScript])

  return { script, loading, error, refetch: fetchScript }
}
