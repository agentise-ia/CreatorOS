-- Remove a integração com Google Gemini do projeto.
-- (1) Coluna gemini_model de content_analyses (não mais gravada pelo pipeline).
-- (2) Credencial órfã gemini_api_key em app_settings (não mais coletada no wizard).
--
-- Idempotente: DROP COLUMN IF EXISTS + DELETE são safe pra rodar 2x.

ALTER TABLE content_analyses DROP COLUMN IF EXISTS gemini_model;

-- DELETE de credencial órfã (caso a instância tenha sido bootstrapped antes
-- da remoção do campo no wizard). Idempotente: após primeira execução, no-op.
-- Roda dentro de DO block pra não falhar se a tabela app_settings ainda não existe
-- (fresh install onde essa migration roda antes do _bootstrap_state ter app_settings).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'app_settings') THEN
    DELETE FROM app_settings WHERE key = 'gemini_api_key';
  END IF;
END $$;

-- Avisa o PostgREST pra recarregar o cache de schema, senão queries
-- subsequentes via PostgREST podem retornar a coluna fantasma por minutos.
NOTIFY pgrst, 'reload schema';
