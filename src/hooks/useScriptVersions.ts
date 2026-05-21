import { useCallback, useEffect, useState } from 'react'
import supabase from '@/lib/supabase'
import type { ScriptVersion } from '@/types'

export function useScriptVersions(scriptId: string | undefined) {
  const [versions, setVersions] = useState<ScriptVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchVersions = useCallback(async () => {
    if (!scriptId) {
      setVersions([])
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('script_versions')
      .select('*')
      .eq('script_id', scriptId)
      .order('version_number', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setVersions((data ?? []) as ScriptVersion[])
    }

    setLoading(false)
  }, [scriptId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchVersions()
  }, [fetchVersions])

  return { versions, loading, error, refetch: fetchVersions }
}
