-- Creator OS - Migration: App Users + Roles (admin/operator)
-- Migration: 20260502000000
--
-- Introduz o sistema de roles (admin/operator) para o boilerplate self-hosted.
-- Modelo: o primeiro signup vira 'admin' automaticamente; signups subsequentes
-- recebem 'operator'. RLS de tabelas de domínio (profiles, reels, scripts...)
-- permanece per-user (auth.uid() = user_id) — roles afetam apenas a tabela
-- app_users em si e rotas administrativas futuras.
--
-- Nota crítica: triggers em auth.users exigem SECURITY DEFINER e privilégios de
-- superuser. Em ambientes Supabase Cloud isso funciona via 'supabase_auth_admin'.
-- Se o fork rodar em ambiente sem esse privilégio, alternativa é chamar o insert
-- de app_users a partir de uma Edge Function pós-signup. Documentar no README.
--
-- Para promover manualmente um user a admin (caso o fork já tenha users):
--   UPDATE public.app_users SET role = 'admin' WHERE user_id = '<uuid>';

BEGIN;

-- =============================================================================
-- TABLE: app_users
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.app_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator')) DEFAULT 'operator',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_role ON public.app_users(role);

-- =============================================================================
-- HELPER: is_admin()
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- =============================================================================
-- TRIGGER: handle_new_user
-- =============================================================================
-- Quando um novo user é criado em auth.users, se a tabela app_users estiver
-- vazia esse user vira 'admin'. Caso contrário, vira 'operator'.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_role TEXT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.app_users;

  IF v_count = 0 THEN
    v_role := 'admin';
  ELSE
    v_role := 'operator';
  END IF;

  INSERT INTO public.app_users (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- SELECT: usuário pode ver a própria linha; admin pode ver todas.
DROP POLICY IF EXISTS "app_users select self or admin" ON public.app_users;
CREATE POLICY "app_users select self or admin" ON public.app_users
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

-- INSERT: bloqueado via RLS — apenas trigger (SECURITY DEFINER) ou service role
-- pode inserir. Usamos USING (false) WITH CHECK (false) para garantir.
DROP POLICY IF EXISTS "app_users insert blocked" ON public.app_users;
CREATE POLICY "app_users insert blocked" ON public.app_users
  FOR INSERT
  WITH CHECK (false);

-- UPDATE: apenas admin.
DROP POLICY IF EXISTS "app_users update admin only" ON public.app_users;
CREATE POLICY "app_users update admin only" ON public.app_users
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- DELETE: apenas admin, e admin não pode deletar a si mesmo (proteção lock-out).
DROP POLICY IF EXISTS "app_users delete admin not self" ON public.app_users;
CREATE POLICY "app_users delete admin not self" ON public.app_users
  FOR DELETE
  USING (public.is_admin() AND user_id <> auth.uid());

-- =============================================================================
-- BACKFILL
-- =============================================================================
-- Para users em auth.users sem linha em app_users, inserir como 'operator'.
-- O "primeiro vira admin" só vale a partir desta migration; bases já populadas
-- precisam promover o admin manualmente via SQL (ver header da migration).

INSERT INTO public.app_users (user_id, role)
SELECT u.id, 'operator'
FROM auth.users u
LEFT JOIN public.app_users a ON a.user_id = u.id
WHERE a.user_id IS NULL;

COMMIT;
