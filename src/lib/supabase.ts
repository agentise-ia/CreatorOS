import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isInitialized = Boolean(supabaseUrl && supabaseAnonKey)

// Quando as envs ainda não foram preenchidas (estado uninitialized do template
// recém-deployado na Vercel), criamos um client "stub" apenas para o wizard
// poder renderizar. Qualquer chamada real falhará com 401, mas o wizard nunca
// chama o supabase client — usa só fetch para as Vercel API Routes.
const supabase: SupabaseClient = isInitialized
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : createClient('https://placeholder.supabase.co', 'placeholder-anon-key')

export default supabase
