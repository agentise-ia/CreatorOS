-- Adiciona 'cancelled' ao enum de status de processing_jobs.
-- Permite que o usuário cancele jobs em andamento via UI.

ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status_check;

ALTER TABLE processing_jobs
  ADD CONSTRAINT processing_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));
