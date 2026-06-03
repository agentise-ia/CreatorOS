# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Removed
- **Integração com Google Gemini removida do projeto.** Inclui (1) campo `gemini_api_key` do wizard `/setup` e do `/settings`, (2) provider `gemini` do `ModelSelector`, dos types (`ModelProvider`, `MODEL_OPTIONS`) e do Zustand store, (3) todo o código Gemini das Edge Functions `analyze-content`, `generate-script` e `generate-voice-profile`, (4) `validateGemini` em `setup.config.ts`. **Impacto no pipeline:** `analyze-content` deixa de fazer análise visual de vídeo (cortes, transições, b-rolls, text overlays, efeitos visuais, segmentos de música/sons). Esses campos em `content_analyses` (`transitions`, `music_segments`, `sound_effects`, `broll_segments`, `text_overlays`, `visual_effects`) são gravados como arrays vazios. A análise estrutural (hook/development/CTA/viral_patterns) continua, operando só sobre a transcrição do Whisper via OpenAI.
- Coluna `content_analyses.gemini_model` dropada via migration `20260603000000_drop_gemini_model.sql`.

### Changed
- `model_provider` aceita apenas `'openai'` em todas as Edge Functions. Versão do storage Zustand bumpada de `3` para `4` pra resetar preferências de quem tinha modelo Gemini selecionado.
- Lista de modelos OpenAI no seletor (`src/types/index.ts` → `MODEL_OPTIONS`) deixa de oferecer `gpt-5` e `gpt-5-mini`. Modelos de reasoning fazem chamadas que excedem o wall-time do worker das Edge Functions do Supabase em prompts longos (voice profile com 10 transcrições, análise de 8 reels), deixando jobs órfãos em status `processing`. Restam: `gpt-4.1`, `gpt-4o`.
- Default do seletor de modelo em `src/store/index.ts` passa de `gpt-5` para `gpt-4.1`.
- Default interno de `model_id` nas Edge Functions `generate-voice-profile`, `analyze-content` e `generate-script` passa de `gpt-5` para `gpt-4.1` (defensivo, caso o frontend não envie `model_id`).

### Fixed
- `analyze-content` agora processa reels com concorrência limitada (`CONCURRENCY = 3`) em vez de loop sequencial (`for...of`). Para um lote de 8 reels o tempo cai de ~8–24 min para ~3–8 min.
- **Jobs travados em status `processing`**: três defesas em camadas:
  - (1) Edge Functions agora têm wall-clock timeout de **10 minutos** que finaliza o job mesmo se algo trava internamente (`analyze-content`, `generate-script`, `generate-voice-profile`). No caso do `analyze-content`, os reels já processados são preservados — o job vira `completed` com `output_data.partial=true` listando quantos foram analisados.
  - (2) `fetchWithRetry` em todas as Edge Functions agora usa `AbortSignal.timeout(90_000)` por request, prevenindo conexões TCP penduradas que ignoravam o timeout in-process.
  - (3) Frontend watchdog em `useProcessingJobs`: a cada 30s detecta jobs em `processing` cujo `updated_at` está > 3 min atrás e marca como `failed` com mensagem descritiva. Cobre o caso do worker da Edge Function ser terminado pela plataforma Supabase (wall-time) antes da finalização in-function disparar.

### Added
- Coluna `processing_jobs.updated_at` (com trigger `BEFORE UPDATE`) via migration `20260603000001_processing_jobs_updated_at.sql`. Necessária pro watchdog do frontend detectar jobs stale. Inclui cleanup automático de "zombies" (jobs em `pending`/`processing` com `created_at < now() - 5min`) — recupera jobs órfãos de execuções anteriores. Índice parcial `idx_processing_jobs_stale_lookup` acelera a busca. `NOTIFY pgrst, 'reload schema'` no final pra evitar erro "column not found" no frontend logo após o deploy.
- Migration `20260603000000_drop_gemini_model.sql` faz também `DELETE FROM app_settings WHERE key = 'gemini_api_key'` (dentro de `DO $$ ... $$` que checa existência de tabela) pra limpar a credencial órfã de instâncias bootstrapped antes da remoção do campo no wizard.

### Deployment
Todas as mudanças são disparadas automaticamente ao rodar `/setup` no app — o bootstrap é idempotente e cobre tanto fresh installs quanto re-bootstraps:
- **Fresh install**: as 2 migrations novas rodam junto com as demais.
- **Instância já bootstrapped**: o wizard pula migrations já aplicadas (via `_bootstrap_state`) e roda apenas as novas. Edge Functions são SEMPRE re-deployadas (deploy é upsert), então o código novo de `analyze-content`/`generate-script`/`generate-voice-profile` substitui o antigo. Frontend é redeployado pela Vercel ao final do bootstrap.
- **Jobs travados antes do deploy**: o cleanup dentro da migration `_processing_jobs_updated_at` marca como `failed` imediatamente. Não precisa esperar 4 min do watchdog do frontend.

### Known issues / débitos
- Bundle principal (`dist/assets/index-*.js`) acima de 500 kB após minificação (~734 kB / gzip 214 kB). Não é bloqueante para `v1.0.0` — Vite/Rolldown apenas avisa. Sugestão de melhoria: code-splitting via dynamic `import()` em rotas pesadas (`TeleprompterPage`, `AnalysisPage`, `ReelAnalysisPage`). Identificado durante o smoke test (Caso 12), em `migration/SMOKE_TEST_RESULTS.md`.
- Edge Functions do Supabase têm wall-time fixo do worker (~150–400 s no plano Free). Modelos de reasoning (`gpt-5`, série `o`) podem exceder esse limite em prompts longos e deixar jobs órfãos em `processing` sem nunca virar `failed`/`completed`. Mitigado removendo esses modelos do seletor; o código `isReasoningModel` permanece nas Edge Functions caso `model_id` seja sobrescrito via API direta.

## [1.0.0] — 2026-05-02

Primeira release pública self-hosted. Migração concluída de produto interno (SaaS-like) para boilerplate Open Source distribuível.

### Added
- Branding configurável via env var `VITE_APP_NAME` (default: `Creator OS`). Substitui o literal `"Creator OS"` antes hardcoded em telas como `LoginPage`.
- Sistema de roles `admin` / `operator` na tabela `app_users` com trigger `on_auth_user_created`: o **primeiro** signup vira `admin`, os subsequentes viram `operator`. Migration `20260502000000_app_users_and_roles.sql`.
- `.env.example` completo, dividido em duas seções: variáveis do frontend (`VITE_*`) e secrets das Edge Functions (`SUPABASE_SERVICE_ROLE_KEY`, `APIFY_TOKEN`, `OPENAI_API_KEY`).
- `.gitignore` agora protege explicitamente `.env` (além do `.env.local` que já estava coberto).
- `LICENSE` MIT (2026, Creator OS Contributors).
- `CONTRIBUTING.md` com convenções de commit, branch model, style guide TypeScript/React/Edge Functions, checklist de PR.
- `ARCHITECTURE.md` derivado de `.claude/CLAUDE.md`: visão geral, diagrama de fluxo, modelo de dados resumido, APIs externas com custos, lista de Edge Functions, padrão async de jobs, estrutura do frontend, decisões técnicas e limitações.
- `CHANGELOG.md` (este arquivo) em formato Keep a Changelog.

### Changed
- `README.md` substituído. Antes era o boilerplate genérico do `npm create vite`. Agora documenta self-host completo: pré-requisitos, setup numerado (clone → `.env` → `supabase db push` → deploy de Edge Functions → Vercel), comandos úteis, custos estimados por análise, troubleshooting comum, snippet SQL para promover admin manualmente.

### Removed
- Nenhuma feature de domínio removida. O domínio nuclear (scraping → análise → voice profile → roteiro) permanece intacto.

### Notes
- O esquema continua single-tenant por instância. Não há `tenant_id`, `tenants`, subdomínio, white-label dinâmico, billing ou BYOK — nada disso existia no produto antes da migração, conforme `AUDIT_REPORT.md`.
- API keys de provedores (Apify, OpenAI) continuam vivendo apenas em env vars das Edge Functions; inputs em `SettingsPage` permanecem `disabled` (read-only) como referência visual.
- Tema mantém o glassmorphism dark Agentise (`#0A0A0F` background, `#3B82F6` primary, blur 40px, borders `rgba(59, 130, 246, 0.x)`). Para customizar visualmente, edite `src/index.css`.

## [0.1.0-saas] — 2026-04 (pré-migração)

Estado pré-migração marcado pela tag `v0-saas-final`. Releases iniciais de Creator OS como projeto interno da Agentise. Sem changelog formal anterior — histórico disponível em `git log`.
