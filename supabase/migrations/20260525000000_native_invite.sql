-- Creator OS - Migration: Convite nativo do Supabase (magic link)
-- Migration: 20260525000000
--
-- Troca o convite por token customizado + Resend pelo convite NATIVO do Supabase
-- (auth.admin.inviteUserByEmail → magic link). Mudanças:
--   - handle_new_user: usuário criado via invite admin (invited_at != null) é
--     PERMITIDO sem token; o app_users é criado só na ACEITAÇÃO (RPC abaixo),
--     pra separar "pendente" (sem app_users) de "membro" (com app_users).
--   - accept_native_invite(): chamado pela /invite depois que o convidado define
--     a senha; cria app_users 'member' e marca o convite usado.
-- Self-signup (com owner já existente e sem convite) continua bloqueado.

BEGIN;

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
BEGIN
  SELECT COUNT(*) INTO v_user_count
  FROM public.app_users
  WHERE role IN ('owner', 'admin');

  -- Caso 1: sem owner → primeira pessoa vira owner (sem convite)
  IF v_user_count = 0 THEN
    INSERT INTO public.app_users (user_id, role)
    VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id) DO UPDATE SET role = 'owner', updated_at = now();
    RETURN NEW;
  END IF;

  -- Caso 2: convite NATIVO. inviteUserByEmail seta invited_at, que NÃO pode ser
  -- forjado num signup público. Permite o insert; o app_users é criado só quando
  -- o convidado aceitar (accept_native_invite).
  IF NEW.invited_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Caso 3 (legado): convite por token customizado na metadata
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

  UPDATE public.invites SET used_at = now() WHERE id = v_invite_record.id;

  INSERT INTO public.app_users (user_id, role)
  VALUES (NEW.id, v_invite_record.role)
  ON CONFLICT (user_id) DO UPDATE SET role = v_invite_record.role, updated_at = now();

  RETURN NEW;
END;
$$;

-- Aceitação do convite nativo: chamado pela tela /invite depois que o convidado
-- (já autenticado pelo magic link) define a senha. Cria o app_users 'member' e
-- marca o convite pendente como usado. SECURITY DEFINER + checagem de invited_at
-- garante que só quem foi de fato convidado pelo admin vira membro.
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT email, invited_at INTO v_email, v_invited_at
  FROM auth.users WHERE id = v_uid;

  IF v_invited_at IS NULL THEN
    RAISE EXCEPTION 'Usuário não foi convidado.';
  END IF;

  INSERT INTO public.app_users (user_id, role)
  VALUES (v_uid, 'member')
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
