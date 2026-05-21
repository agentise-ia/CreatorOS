-- Creator OS - Migration: Setup Wizard Infrastructure
-- Migration: 20260521000000
--
-- Cria as duas tabelas de infra usadas pelo wizard /setup:
--   - app_settings        → credenciais de aplicação criptografadas (AES-256-GCM)
--   - _bootstrap_state    → checkpoint dos passos do /api/bootstrap (idempotência)
--
-- Ambas com RLS habilitado e sem policies públicas: acesso exclusivamente via
-- service_role nas API Routes do Vercel (que detém CRYPTO_KEY para decriptar).

BEGIN;

-- =============================================================================
-- TABLE: app_settings
-- =============================================================================
-- Formato de value_encrypted: "<iv_hex>:<tag_hex>:<ciphertext_hex>" (AES-256-GCM).
-- Chave de cripto vive em CRYPTO_KEY (env Vercel) — fora desta tabela. Se a
-- CRYPTO_KEY for perdida/trocada, os dados desta tabela viram lixo (não
-- recuperáveis); ao refazer /setup os valores são re-escritos.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value_encrypted TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy pública. service_role bypassa RLS por padrão.

-- =============================================================================
-- TABLE: _bootstrap_state
-- =============================================================================
-- Cada step do /api/bootstrap escreve um row aqui ao concluir. Retentativas
-- consultam esta tabela para pular o que já foi feito (idempotência).

CREATE TABLE IF NOT EXISTS public._bootstrap_state (
  step TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public._bootstrap_state ENABLE ROW LEVEL SECURITY;
-- Sem policies. service_role lê/escreve.

COMMIT;
