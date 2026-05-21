import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@supabase/supabase-js'
import type { Profile, ProcessingJob, ModelProvider } from '@/types'
import { MODEL_OPTIONS } from '@/types'
import type { AppUser } from '@/types/auth'

interface AppState {
  // Auth
  user: User | null
  setUser: (user: User | null) => void

  // App user (role)
  appUser: AppUser | null
  setAppUser: (appUser: AppUser | null) => void

  // Auth loading
  authLoading: boolean
  setAuthLoading: (loading: boolean) => void

  // Profiles
  profiles: Profile[]
  setProfiles: (profiles: Profile[]) => void
  addProfile: (profile: Profile) => void

  // Active jobs (from Supabase Realtime)
  activeJobs: ProcessingJob[]
  setActiveJobs: (jobs: ProcessingJob[]) => void
  updateJob: (job: ProcessingJob) => void

  // Model preference
  modelProvider: ModelProvider
  modelId: string
  setModel: (provider: ModelProvider, modelId: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Auth
      user: null,
      setUser: (user) => set({ user }),

      // App user (role)
      appUser: null,
      setAppUser: (appUser) => set({ appUser }),

      // Auth loading
      authLoading: true,
      setAuthLoading: (authLoading) => set({ authLoading }),

      // Profiles
      profiles: [],
      setProfiles: (profiles) => set({ profiles }),
      addProfile: (profile) =>
        set((state) => ({ profiles: [...state.profiles, profile] })),

      // Active jobs
      activeJobs: [],
      setActiveJobs: (activeJobs) => set({ activeJobs }),
      updateJob: (job) =>
        set((state) => {
          const exists = state.activeJobs.some((j) => j.id === job.id)
          if (exists) {
            return {
              activeJobs: state.activeJobs.map((j) =>
                j.id === job.id ? job : j
              ),
            }
          }
          return { activeJobs: [...state.activeJobs, job] }
        }),

      // Model preference
      modelProvider: 'openai',
      modelId: 'gpt-4.1',
      setModel: (modelProvider, modelId) => set({ modelProvider, modelId }),
    }),
    {
      name: 'viralscript-settings',
      version: 3,
      partialize: (state) => ({
        modelProvider: state.modelProvider,
        modelId: state.modelId,
      }),
      // Reset preference when persisted modelId is no longer in MODEL_OPTIONS
      // (e.g. invalid model names like gpt-5.5 / gemini-3-flash from earlier builds)
      migrate: (persisted) => {
        const s = persisted as { modelProvider?: ModelProvider; modelId?: string }
        const valid = MODEL_OPTIONS.some(
          (o) => o.provider === s.modelProvider && o.model === s.modelId
        )
        if (!valid) {
          return { modelProvider: 'openai', modelId: 'gpt-4.1' }
        }
        return s
      },
    }
  )
)
