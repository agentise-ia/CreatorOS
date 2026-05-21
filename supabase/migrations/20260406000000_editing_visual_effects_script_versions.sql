-- Creator OS - Migration: Editing Analysis Status, Visual Effects, Script Versions
-- Migration: 20260406000000

-- =============================================
-- Problema 1: Novas colunas em content_analyses
-- =============================================

-- Coluna para efeitos visuais (zoom, speed ramp, shake, etc)
ALTER TABLE content_analyses ADD COLUMN IF NOT EXISTS visual_effects JSONB DEFAULT '[]';

-- Status da análise de elementos de edição
ALTER TABLE content_analyses ADD COLUMN IF NOT EXISTS editing_analysis_status TEXT DEFAULT 'pending'
  CHECK (editing_analysis_status IN ('pending', 'processing', 'completed', 'failed'));

-- =============================================
-- Problema 2: Tabela script_versions
-- =============================================

CREATE TABLE IF NOT EXISTS script_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  script_id UUID REFERENCES scripts(id) ON DELETE CASCADE NOT NULL,
  version_number INTEGER NOT NULL,

  -- Snapshot do conteúdo nesta versão
  script_teleprompter TEXT NOT NULL,
  script_annotated JSONB NOT NULL,
  editing_report JSONB NOT NULL,

  -- Metadados da versão
  change_description TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('initial', 'manual_edit', 'ai_regeneration')),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(script_id, version_number)
);

-- RLS
ALTER TABLE script_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own script versions" ON script_versions FOR ALL USING (
  script_id IN (SELECT id FROM scripts WHERE user_id = auth.uid())
);

-- Índice
CREATE INDEX IF NOT EXISTS idx_script_versions_script_id ON script_versions(script_id, version_number DESC);
