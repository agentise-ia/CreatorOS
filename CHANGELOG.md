# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Changed
- Lista de modelos OpenAI no seletor (`src/types/index.ts` → `MODEL_OPTIONS`) deixa de oferecer `gpt-5` e `gpt-5-mini`. Modelos de reasoning fazem chamadas que excedem o wall-time do worker das Edge Functions do Supabase em prompts longos (voice profile com 10 transcrições, análise de 8 reels), deixando jobs órfãos em status `processing`. Restam: `gpt-4.1`, `gpt-4o`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`.
- Default do seletor de modelo em `src/store/index.ts` passa de `gpt-5` para `gpt-4.1`. Versão do storage Zustand bumpada de `2` para `3` para forçar a migração de quem já tinha `gpt-5` persistido em `localStorage`.
- Default interno de `model_id` nas Edge Functions `generate-voice-profile`, `analyze-content` e `generate-script` passa de `gpt-5` para `gpt-4.1` (defensivo, caso o frontend não envie `model_id`).

### Fixed
- Edge Functions `generate-voice-profile`, `analyze-content` e `generate-script` agora enviam `generationConfig.thinkingConfig = { thinkingBudget: 0 }` quando o `modelId` casa com `^gemini-2\.5`. Sem isso, prompts longos consumiam todos os 8192 `maxOutputTokens` em raciocínio interno do modelo e a chamada retornava texto vazio — voice profile ficava com `full_profile_document: "Profile generation failed."` e campos `null`, sem erro aparente.
- `analyze-content` agora processa reels com concorrência limitada (`CONCURRENCY = 3`) em vez de loop sequencial (`for...of`). Para um lote de 8 reels o tempo cai de ~8–24 min para ~3–8 min. Concorrência mantida em 3 para respeitar o rate-limit do tier gratuito do Gemini (15 RPM).

### Known issues / débitos
- Bundle principal (`dist/assets/index-*.js`) acima de 500 kB após minificação (~734 kB / gzip 214 kB). Não é bloqueante para `v1.0.0` — Vite/Rolldown apenas avisa. Sugestão de melhoria: code-splitting via dynamic `import()` em rotas pesadas (`TeleprompterPage`, `AnalysisPage`, `ReelAnalysisPage`). Identificado durante o smoke test (Caso 12), em `migration/SMOKE_TEST_RESULTS.md`.
- Edge Functions do Supabase têm wall-time fixo do worker (~150–400 s no plano Free). Modelos de reasoning (`gpt-5`, série `o`) podem exceder esse limite em prompts longos e deixar jobs órfãos em `processing` sem nunca virar `failed`/`completed`. Mitigado removendo esses modelos do seletor; o código `isReasoningModel` permanece nas Edge Functions caso `model_id` seja sobrescrito via API direta.

## [1.0.0] — 2026-05-02

Primeira release pública self-hosted. Migração concluída de produto interno (SaaS-like) para boilerplate Open Source distribuível.

### Added
- Branding configurável via env var `VITE_APP_NAME` (default: `Creator OS`). Substitui o literal `"Creator OS"` antes hardcoded em telas como `LoginPage`.
- Sistema de roles `admin` / `operator` na tabela `app_users` com trigger `on_auth_user_created`: o **primeiro** signup vira `admin`, os subsequentes viram `operator`. Migration `20260502000000_app_users_and_roles.sql`.
- `.env.example` completo, dividido em duas seções: variáveis do frontend (`VITE_*`) e secrets das Edge Functions (`SUPABASE_SERVICE_ROLE_KEY`, `APIFY_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`).
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
- API keys de provedores (Apify, OpenAI, Gemini, Anthropic) continuam vivendo apenas em env vars das Edge Functions; inputs em `SettingsPage` permanecem `disabled` (read-only) como referência visual.
- Tema mantém o glassmorphism dark Agentise (`#0A0A0F` background, `#3B82F6` primary, blur 40px, borders `rgba(59, 130, 246, 0.x)`). Para customizar visualmente, edite `src/index.css`.

## [0.1.0-saas] — 2026-04 (pré-migração)

Estado pré-migração marcado pela tag `v0-saas-final`. Releases iniciais de Creator OS como projeto interno da Agentise. Sem changelog formal anterior — histórico disponível em `git log`.
