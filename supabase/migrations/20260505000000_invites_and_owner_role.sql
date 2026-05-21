-- Creator OS - Migration: Invites + Owner/Member Roles
-- Migration: 20260505000000
--
-- Substitui o modelo "primeiro signup vira admin" por convites com role owner/member:
--   - O primeiro signup vira 'owner' automaticamente (sem convite).
--   - Após existir owner, self-signup fica fechado: novos users só entram via
--     convite gerado pelo owner (token único, expira em 7 dias).
--   - Roles antigos 'admin'/'operator' permanecem aceitos no CHECK por compat,
--     mas dados existentes são migrados: admin → owner, operator → member.

BEGIN;

-- =============================================================================
-- 1. Ampliar CHECK de role em app_users (compat com 'admin'/'operator' antigos)
-- =============================================================================

ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'operator', 'owner', 'member'));

ALTER TABLE public.app_users ALTER COLUMN role SET DEFAULT 'member';

-- =============================================================================
-- 2. Tabela de convites
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invites_token_idx
  ON public.invites(token)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS invites_email_idx ON public.invites(email);

-- =============================================================================
-- 3. Helpers: is_owner() + atualiza is_admin() para compat (owner conta como admin)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE user_id = auth.uid() AND role = 'owner'
  );
$$;

-- is_admin() agora retorna true também para owner (compat com policies/UI legadas)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
  );
$$;

-- =============================================================================
-- 4. RLS em invites (apenas owner gerencia)
-- =============================================================================

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites owner all" ON public.invites;
CREATE POLICY "invites owner all" ON public.invites
  FOR ALL
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

-- =============================================================================
-- 5. Função pública: has_owner() — usada pela tela de signup pra decidir se
--    self-signup público está aberto (false) ou fechado (true)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_owner()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users WHERE role IN ('owner', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_owner() TO anon, authenticated;

-- =============================================================================
-- 6. Função pública: validate_invite_token(token) — pré-valida convite na UI
--    de /invite. Retorna email + valid sem expor outros campos.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_invite_token(p_token TEXT)
RETURNS TABLE(email TEXT, valid BOOLEAN)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    i.email,
    (i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) AS valid
  FROM public.invites i
  WHERE i.token = p_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.validate_invite_token(TEXT) TO anon, authenticated;

-- =============================================================================
-- 7. Trigger novo: handle_new_user com lógica de convite + owner inicial
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_count INTEGER;
  v_invite_token TEXT;
  v_invite_record public.invites%ROWTYPE;
  v_role TEXT;
BEGIN
  SELECT COUNT(*) INTO v_user_count
  FROM public.app_users
  WHERE role IN ('owner', 'admin');

  -- Caso 1: ainda não há owner — esta pessoa vira owner sem precisar de convite
  IF v_user_count = 0 THEN
    INSERT INTO public.app_users (user_id, role)
    VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id) DO UPDATE SET role = 'owner', updated_at = now();
    RETURN NEW;
  END IF;

  -- Caso 2: já existe owner — exigir token de convite válido
  v_invite_token := NEW.raw_user_meta_data ->> 'invite_token';

  IF v_invite_token IS NULL OR v_invite_token = '' THEN
    RAISE EXCEPTION 'Self-signup desabilitado. Solicite um convite ao owner desta instância.';
  END IF;

  SELECT * INTO v_invite_record
  FROM public.invites
  WHERE token = v_invite_token
    AND used_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
    AND lower(email) = lower(NEW.email);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite inválido, expirado, já utilizado ou email não corresponde.';
  END IF;

  v_role := v_invite_record.role;

  UPDATE public.invites
  SET used_at = now()
  WHERE id = v_invite_record.id;

  INSERT INTO public.app_users (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id) DO UPDATE SET role = v_role, updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- 8. Migrar dados existentes: admin → owner, operator → member
-- =============================================================================

UPDATE public.app_users SET role = 'owner', updated_at = now()
WHERE role = 'admin';

UPDATE public.app_users SET role = 'member', updated_at = now()
WHERE role = 'operator';

COMMIT;
