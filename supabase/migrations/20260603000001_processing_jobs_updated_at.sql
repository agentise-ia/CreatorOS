-- Adiciona updated_at + trigger em processing_jobs.
-- Motivação: permite detectar jobs travados ("zombie processing").
-- O worker da Edge Function do Supabase pode ser morto pela plataforma
-- antes da função finalizar (wall-time limit). Quando isso acontece,
-- o job fica com status='processing' pra sempre. Com updated_at, o
-- frontend (ou um sweeper futuro) consegue identificar e finalizar.
--
-- 100% idempotente — pode rodar via wizard /setup quantas vezes for.
-- O wizard registra cada migration em _bootstrap_state e pula as já aplicadas,
-- mas como defesa em profundidade, cada DDL aqui usa IF [NOT] EXISTS / OR REPLACE.

-- 1. Coluna updated_at.
ALTER TABLE processing_jobs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Cleanup de "zombies": jobs órfãos em pending/processing há mais de 5 min,
-- de execuções anteriores ao deploy desse watchdog. São jobs onde o worker
-- foi morto pela plataforma e nunca finalizou. Marca como failed pra que o
-- user veja o erro e possa re-tentar.
-- Idempotente: após primeira execução, não restam jobs nesse estado.
UPDATE processing_jobs
SET status = 'failed',
    error_message = COALESCE(error_message, 'Job órfão detectado pela migration de cleanup. O worker da Edge Function provavelmente foi terminado pela plataforma. Re-execute a análise — os reels já processados continuam salvos.'),
    completed_at = COALESCE(completed_at, NOW())
WHERE status IN ('pending', 'processing')
  AND created_at < NOW() - INTERVAL '5 minutes';

-- 3. Trigger function — CREATE OR REPLACE é idempotente.
CREATE OR REPLACE FUNCTION set_processing_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger — DROP IF EXISTS antes de CREATE evita "already exists" no re-run.
DROP TRIGGER IF EXISTS trg_processing_jobs_updated_at ON processing_jobs;
CREATE TRIGGER trg_processing_jobs_updated_at
  BEFORE UPDATE ON processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_processing_jobs_updated_at();

-- 5. Índice parcial pra acelerar o watchdog do frontend.
CREATE INDEX IF NOT EXISTS idx_processing_jobs_stale_lookup
  ON processing_jobs(status, updated_at)
  WHERE status IN ('pending', 'processing');

-- 6. Recarrega cache do PostgREST pra que o frontend veja a coluna updated_at
-- imediatamente (sem isso, queries podem retornar erro "column not found"
-- por alguns minutos até o auto-reload).
NOTIFY pgrst, 'reload schema';
