-- Cria o bucket 'thumbnails' público para hospedar capas de Reels.
-- Necessário porque Instagram CDN serve com Cross-Origin-Resource-Policy:
-- same-origin, bloqueando renderização direta no browser. Re-hospedar no
-- Supabase Storage resolve o CORP e a expiração das URLs.

INSERT INTO storage.buckets (id, name, public, created_at, updated_at)
VALUES ('thumbnails', 'thumbnails', true, NOW(), NOW())
ON CONFLICT (id) DO UPDATE
  SET public = true, updated_at = NOW();
