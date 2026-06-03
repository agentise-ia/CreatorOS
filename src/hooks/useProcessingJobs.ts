import { useEffect } from 'react'
import supabase from '@/lib/supabase'
import { useAppStore } from '@/store'
import type { ProcessingJob } from '@/types'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

// Tempo máximo que um job pode ficar sem update antes do watchdog
// considerar ele "morto" e marcar como failed. O worker da Edge Function
// pode ser morto pela plataforma Supabase (wall-time) sem nunca finalizar
// o job. Esse watchdog é a rede de segurança.
//
// Threshold = 4 min. Justificativa: per-reel timeout in-function é 150s (2.5min).
// Worst case legítimo entre updates = 150s. 4 min dá ~60% de margem pra evitar
// falso-positivo em reel lento. O timeout principal (10 min wall-clock por job)
// vive dentro da Edge Function.
const STALE_JOB_THRESHOLD_MS = 4 * 60_000 // 4 minutos sem progresso
const WATCHDOG_INTERVAL_MS = 30_000 // checa a cada 30s

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

    // Watchdog: a cada 30s, busca jobs em 'pending'/'processing' cujo
    // updated_at é mais antigo que STALE_JOB_THRESHOLD_MS. Marca como failed.
    // Isso recupera jobs órfãos quando o worker da Edge Function é morto
    // pela plataforma sem chance de finalizar via Promise.race in-function.
    async function sweepStaleJobs() {
      const cutoffIso = new Date(Date.now() - STALE_JOB_THRESHOLD_MS).toISOString()
      const { data: staleJobs, error } = await supabase
        .from('processing_jobs')
        .select('id, job_type, progress')
        .eq('user_id', user!.id)
        .in('status', ['pending', 'processing'])
        .lt('updated_at', cutoffIso)

      if (error || !staleJobs || staleJobs.length === 0) return

      for (const job of staleJobs) {
        const errorMsg = `Job inativo por mais de ${STALE_JOB_THRESHOLD_MS / 60_000} min em ${job.progress}% de progresso. O worker da Edge Function provavelmente foi terminado pela plataforma. Tente novamente — os reels já processados foram salvos.`
        await supabase
          .from('processing_jobs')
          .update({
            status: 'failed',
            error_message: errorMsg,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .in('status', ['pending', 'processing'])
      }
    }

    sweepStaleJobs() // roda imediatamente no mount
    const watchdog = setInterval(sweepStaleJobs, WATCHDOG_INTERVAL_MS)

    return () => {
      clearInterval(watchdog)
      supabase.removeChannel(channel)
    }
  }, [user, setActiveJobs, updateJob])

  return { activeJobs }
}
