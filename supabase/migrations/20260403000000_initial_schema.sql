-- Creator OS - Initial Database Schema
-- Migration: 20260403000000_initial_schema
--
-- Idempotente: pode ser re-executada sem efeito colateral. Usada pelo
-- /api/bootstrap (wizard de setup) que controla checkpoints em
-- _bootstrap_state mas faz fallback de re-execução em caso de retry.

-- =============================================================================
-- TABLES
-- =============================================================================

-- Perfis monitorados (referencias e proprio)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  profile_type TEXT NOT NULL CHECK (profile_type IN ('reference', 'own')),
  full_name TEXT,
  followers_count INTEGER,
  bio TEXT,
  profile_pic_url TEXT,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, instagram_username)
);

-- Reels/videos extraidos
CREATE TABLE IF NOT EXISTS reels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  instagram_id TEXT UNIQUE NOT NULL,
  shortcode TEXT,
  caption TEXT,
  video_url TEXT,
  storage_path TEXT,
  thumbnail_url TEXT,
  duration_seconds NUMERIC CHECK (duration_seconds > 0),
  likes_count INTEGER DEFAULT 0 CHECK (likes_count >= 0),
  comments_count INTEGER DEFAULT 0 CHECK (comments_count >= 0),
  shares_count INTEGER DEFAULT 0 CHECK (shares_count >= 0),
  views_count INTEGER DEFAULT 0 CHECK (views_count >= 0),
  engagement_score NUMERIC GENERATED ALWAYS AS (
    COALESCE(likes_count, 0) +
    COALESCE(comments_count, 0) * 3 +
    COALESCE(shares_count, 0) * 5
  ) STORED,
  music_name TEXT,
  music_artist TEXT,
  hashtags TEXT[],
  mentions TEXT[],
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transcricoes (Whisper)
CREATE TABLE IF NOT EXISTS transcriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reel_id UUID REFERENCES reels(id) ON DELETE CASCADE UNIQUE,
  full_text TEXT NOT NULL,
  language TEXT DEFAULT 'pt',
  segments JSONB NOT NULL,
  whisper_model TEXT DEFAULT 'large-v3',
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analise de conteudo (resultado consolidado por video)
CREATE TABLE IF NOT EXISTS content_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reel_id UUID REFERENCES reels(id) ON DELETE CASCADE UNIQUE,

  -- Estrutura narrativa
  hook JSONB NOT NULL,
  development JSONB NOT NULL,
  cta JSONB NOT NULL,

  -- Elementos de edicao (arrays com timestamps)
  transitions JSONB DEFAULT '[]',
  music_segments JSONB DEFAULT '[]',
  sound_effects JSONB DEFAULT '[]',
  broll_segments JSONB DEFAULT '[]',
  text_overlays JSONB DEFAULT '[]',

  -- Padroes identificados
  viral_patterns JSONB DEFAULT '{}',

  -- Metadados da analise
  gemini_model TEXT,
  claude_model TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Voice Profile (tom de fala do criador)
CREATE TABLE IF NOT EXISTS voice_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  -- Caracteristicas extraidas
  vocabulary_style TEXT,
  sentence_structure TEXT,
  filler_words TEXT[],
  common_expressions TEXT[],
  tone_description TEXT,
  pacing_style TEXT,
  emotional_range TEXT,
  speech_patterns JSONB,

  -- Documento completo de referencia
  full_profile_document TEXT NOT NULL,

  -- Reels usados como base
  source_reel_ids UUID[],

  generated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Roteiros gerados
CREATE TABLE IF NOT EXISTS scripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_profile_id UUID REFERENCES voice_profiles(id),

  -- Input
  topic TEXT NOT NULL,
  reference_reel_ids UUID[],
  additional_instructions TEXT,

  -- Output: Roteiro
  title TEXT NOT NULL,
  script_teleprompter TEXT NOT NULL,
  script_annotated JSONB NOT NULL,
  estimated_duration_seconds INTEGER,

  -- Output: Relatorio de Edicao
  editing_report JSONB NOT NULL,

  -- Metadados
  generation_model TEXT DEFAULT 'claude-sonnet',
  viral_patterns_used JSONB,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'recorded', 'published')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs de processamento assincrono
CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('scrape', 'analyze', 'voice_profile', 'generate_script')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  input_data JSONB,
  output_data JSONB,
  error_message TEXT,
  progress INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reels ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies: user so ve seus proprios dados
DROP POLICY IF EXISTS "Users see own profiles" ON profiles;
CREATE POLICY "Users see own profiles" ON profiles FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own reels" ON reels;
CREATE POLICY "Users see own reels" ON reels FOR ALL USING (
  profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Users see own transcriptions" ON transcriptions;
CREATE POLICY "Users see own transcriptions" ON transcriptions FOR ALL USING (
  reel_id IN (SELECT id FROM reels WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
);

DROP POLICY IF EXISTS "Users see own analyses" ON content_analyses;
CREATE POLICY "Users see own analyses" ON content_analyses FOR ALL USING (
  reel_id IN (SELECT id FROM reels WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
);

DROP POLICY IF EXISTS "Users see own voice_profiles" ON voice_profiles;
CREATE POLICY "Users see own voice_profiles" ON voice_profiles FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own scripts" ON scripts;
CREATE POLICY "Users see own scripts" ON scripts FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own jobs" ON processing_jobs;
CREATE POLICY "Users see own jobs" ON processing_jobs FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_reels_profile_id ON reels(profile_id);
CREATE INDEX IF NOT EXISTS idx_reels_engagement ON reels(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_reels_posted_at ON reels(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_reels_profile_posted ON reels(profile_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_analyses_reel_id ON content_analyses(reel_id);
CREATE INDEX IF NOT EXISTS idx_scripts_user_id ON scripts(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_voice_profiles_user_id ON voice_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON processing_jobs(user_id, created_at DESC);

-- =============================================================================
-- REALTIME
-- =============================================================================

-- Enable Realtime for job status updates (idempotente: ignora se ja membro)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE processing_jobs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;
