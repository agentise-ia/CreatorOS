-- Creator OS - Migration: Convite com a mesma role do convidante
-- Migration: 20260627000000
--
-- Antes, todo convite criava um 'member' (CHECK fixo em 'member' e
-- accept_native_invite hardcoded). Agora o convidado herda a MESMA role de
-- quem o convidou (definida pela Edge Function create-invite a partir do
-- app_users.role do caller). Mudanças:
--   - Amplia o CHECK de invites.role para aceitar as 4 roles válidas.
--   - accept_native_invite() passa a ler a role do convite pendente do email,
--     em vez de assumir 'member'.
-- Herdar a própria role não permite escalonamento de privilégio: o convidante
-- só pode conceder o que já possui.

BEGIN;

-- =============================================================================
-- 1. Ampliar CHECK de invites.role (antes só 'member')
-- =============================================================================

ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE public.invites
  ADD CONSTRAINT invites_role_check
  CHECK (role IN ('admin', 'operator', 'owner', 'member'));

-- =============================================================================
-- 2. accept_native_invite(): herda a role do convite pendente
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_native_invite()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_invited_at TIMESTAMPTZ;
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT email, invited_at INTO v_email, v_invited_at
  FROM auth.users WHERE id = v_uid;

  IF v_invited_at IS NULL THEN
    RAISE EXCEPTION 'Usuário não foi convidado.';
  END IF;

  -- Role do convite pendente mais recente deste email; fallback 'member'.
  SELECT role INTO v_role
  FROM public.invites
  WHERE lower(email) = lower(v_email)
    AND used_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  v_role := COALESCE(v_role, 'member');

  INSERT INTO public.app_users (user_id, role)
  VALUES (v_uid, v_role)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.invites
  SET used_at = now()
  WHERE lower(email) = lower(v_email)
    AND used_at IS NULL
    AND revoked_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_native_invite() TO authenticated;

COMMIT;
