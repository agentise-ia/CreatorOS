import { useEffect } from 'react'
import supabase from '@/lib/supabase'
import { useAppStore } from '@/store'
import type { ProcessingJob } from '@/types'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

export function useProcessingJobs() {
  const user = useAppStore((s) => s.user)
  const activeJobs = useAppStore((s) => s.activeJobs)
  const setActiveJobs = useAppStore((s) => s.setActiveJobs)
  const updateJob = useAppStore((s) => s.updateJob)

  useEffect(() => {
    if (!user) {
      setActiveJobs([])
      return
    }

    // Fetch current active jobs on mount
    async function fetchActiveJobs() {
      const { data, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('user_id', user!.id)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })

      if (!error && data) {
        setActiveJobs(data as ProcessingJob[])
      }
    }

    fetchActiveJobs()

    // Subscribe to realtime changes
    const channel = supabase
      .channel('processing-jobs-realtime')
      .on<ProcessingJob>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'processing_jobs',
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<ProcessingJob>) => {
          if (payload.new && 'id' in payload.new) {
            updateJob(payload.new as ProcessingJob)
          }
        }
      )
      .on<ProcessingJob>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'processing_jobs',
          filter: `user_id=eq.${user.id}`,
        },
        (payload: RealtimePostgresChangesPayload<ProcessingJob>) => {
          if (payload.new && 'id' in payload.new) {
            updateJob(payload.new as ProcessingJob)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, setActiveJobs, updateJob])

  return { activeJobs }
}
