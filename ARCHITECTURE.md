# Architecture — Creator OS

> Documento técnico de arquitetura. Derivado de `.claude/CLAUDE.md`, mantido como referência pública para quem dá fork ou contribui.

---

## 1. Visão geral do sistema

Creator OS é uma aplicação web self-hosted que automatiza o ciclo de criação de Reels:

1. **Extrai** os Reels mais virais de perfis-referência fornecidos pelo usuário (Apify).
2. **Analisa** estrutura narrativa (hook, desenvolvimento, CTA) e elementos de edição (transições, b-rolls, música, efeitos sonoros, texto na tela), tudo com timestamps.
3. **Aprende** o "tom de fala" do criador a partir dos próprios vídeos dele (Voice Profile).
4. **Gera** roteiros para teleprompter combinando padrões virais identificados + Voice Profile.
5. **Entrega** um relatório de edição estruturado para guiar o editor de vídeo.

A aplicação é single-tenant por instância (`auth.uid() = user_id` em todas as policies RLS). Pode ser usada por uma pessoa ou por um time pequeno (criador + editor + assistente) — ver seção de **Roles**.

---

## 2. Diagrama de fluxo

```
[Frontend - React]
    │
    ├── 1. Usuário insere @perfis de referência
    ├── 2. Usuário conecta/insere seu próprio @perfil
    │
    ▼
[Edge Function: scrape-profiles]
    │
    ├── Chama Apify Instagram Reel Scraper via API
    ├── Recebe vídeos, métricas, captions, transcrições, áudio
    ├── Ordena por engagement (likes + comments*3 + shares*5)
    ├── Salva metadados em PostgreSQL
    └── Faz download dos vídeos para Supabase Storage
    │
    ▼
[Edge Function: analyze-content]
    │
    ├── Para cada Reel viral:
    │   ├── Whisper API → transcrição word-level com timestamps
    │   ├── OpenAI → análise estrutural (hook, dev, CTA, padrões) a partir do texto
    │   └── Consolida em JSON estruturado em content_analyses
    │
    ▼
[Edge Function: generate-voice-profile]
    │
    ├── Recebe transcrições dos vídeos do PRÓPRIO perfil
    └── Gera Voice Profile (vocabulário, ritmo, expressões, estilo)
    │
    ▼
[Edge Function: generate-script]
    │
    ├── Recebe Voice Profile + padrões virais + tema
    ├── Gera roteiro para teleprompter
    └── Gera relatório de edição (instruções para o editor)
    │
    ▼
[Frontend - Exibição]
    ├── Dashboard com métricas e ranking viral
    ├── Breakdown de cada Reel (timeline visual)
    ├── Voice Profile com word cloud e comparação
    ├── Visualizador de roteiro (modo teleprompter)
    └── Relatório de edição exportável (PDF/Markdown)
```

---

## 3. Stack técnico

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite 8 + TypeScript 5.9 + Tailwind 4 + shadcn/ui + Zustand 5 + React Router 7 |
| Estado/dados | Zustand (estado global), hooks customizados (`useProfiles`, `useReels`, ...) |
| Backend | Supabase (PostgreSQL + Edge Functions Deno + Storage + Auth + Realtime) |
| Hosting frontend | Vercel |
| Scraping | Apify Instagram Reel Scraper |
| Transcrição | OpenAI Whisper (word-level timestamps) |
| Geração de roteiros | OpenAI (GPT-4.1 / GPT-4o) |
| Fila de jobs | Tabela `processing_jobs` + Supabase Realtime (sem polling) |
| Auth | Supabase Auth (email/senha) — primeiro signup vira admin via trigger |

---

## 4. Modelo de dados

Todas as tabelas têm RLS habilitado e usam `auth.uid() = user_id` (direto ou via subquery por `profile_id`/`reel_id`) para isolamento per-user.

| Tabela | Propósito | Chaves principais |
|---|---|---|
| `app_users` | Roles (`admin` / `operator`). Primeiro signup vira admin via trigger `on_auth_user_created`. | `user_id` (FK auth.users), `role` |
| `profiles` | Perfis Instagram monitorados (referências e próprio). | `user_id`, `instagram_username`, `profile_type` |
| `reels` | Reels extraídos por perfil, com métricas. `engagement_score` é coluna gerada (`likes + comments*3 + shares*5`). | `profile_id`, `instagram_id`, `engagement_score` |
| `transcriptions` | Output do Whisper (texto + segments com word-level timestamps). | `reel_id` |
| `content_analyses` | Resultado consolidado da análise: `hook`, `development`, `cta`, `transitions`, `music_segments`, `sound_effects`, `broll_segments`, `text_overlays`, `viral_patterns` (todos JSONB com timestamps). | `reel_id` |
| `voice_profiles` | Voice Profile do criador: vocabulário, ritmo, expressões, documento full. | `user_id`, `profile_id`, `source_reel_ids` |
| `scripts` | Roteiros gerados: teleprompter + roteiro anotado + relatório de edição. | `user_id`, `voice_profile_id`, `reference_reel_ids` |
| `script_versions` | Versionamento de roteiros (snapshot por versão). | `script_id`, `version` |
| `processing_jobs` | Fila assíncrona de jobs com `status`, `progress`, `error_message`. Publicada em `supabase_realtime`. | `user_id`, `job_type`, `status` |

Detalhes de SQL ficam nas migrations em `supabase/migrations/`. Ordem atual:

1. `20260403000000_initial_schema.sql` — tabelas core, índices, RLS, policies.
2. `20260406000000_editing_visual_effects_script_versions.sql` — `script_versions` e ajustes em `content_analyses`.
3. `20260502000000_app_users_and_roles.sql` — tabela `app_users` e trigger primeiro-user-vira-admin.

---

## 5. APIs externas

| Provider | Uso | Modelo / Endpoint | Custo aproximado |
|---|---|---|---|
| **Apify** | Scraping de perfis e Reels | `apify/instagram-reel-scraper` | ~$2.60 / 1.000 resultados |
| **OpenAI Whisper** | Transcrição de áudio com timestamps por palavra | `whisper-1`, `verbose_json`, `timestamp_granularities=word` | ~$0.006 / minuto |
| **OpenAI GPT** | Análise estrutural narrativa, geração de roteiros, voice profile | `gpt-4.1` ou `gpt-4o` | ~$0.03 / análise |

**Custo médio por Reel analisado:** ~$0.35–0.70 (varia com duração do vídeo).
**Custo médio por perfil completo (50 Reels):** ~$2.00–3.50.

URLs de vídeo retornadas pelo Apify expiram em **3 dias** — o Edge Function `scrape-profiles` baixa imediatamente para Supabase Storage.

---

## 6. Edge Functions

Todas em Deno, em `supabase/functions/`. Padrão consistente: validação JWT do usuário, retry com exponential backoff em chamadas externas, logs estruturados em JSON, CORS headers reutilizados.

| Function | Responsabilidade |
|---|---|
| `scrape-profiles` | Recebe lista de `@usernames`, chama Apify, persiste `reels` e baixa vídeos para Storage. |
| `scrape-reel-url` | Variante para um Reel avulso a partir de URL. |
| `analyze-content` | Pipeline `Whisper → OpenAI` (texto) para gerar `transcriptions` + `content_analyses`. Sem análise visual de vídeo. |
| `generate-voice-profile` | Consolida transcrições do próprio perfil em um `voice_profiles` (vocabulário, ritmo, expressões). |
| `generate-script` | Combina Voice Profile + padrões virais + tema → `scripts` (teleprompter + relatório de edição). |
| `job-status` | Leitura utilitária de `processing_jobs` (complementa o Realtime). |

---

## 7. Padrão async de jobs

Edge Functions de processamento longo nunca bloqueiam o request. Padrão:

1. Frontend chama a Edge Function.
2. Function cria registro em `processing_jobs` com `status = 'pending'` ou `'processing'` e retorna `job_id` imediatamente.
3. Processamento real acontece em seguida (mesma invocação ou worker), atualizando `progress` (0–100) e `status` na linha do job.
4. Frontend escuta a tabela via **Supabase Realtime** (`ALTER PUBLICATION supabase_realtime ADD TABLE processing_jobs`), sem polling.
5. Ao concluir, `status` vira `'completed'` ou `'failed'` (com `error_message` populado em caso de erro).

Em todas as chamadas a APIs externas há retry com exponential backoff (3 tentativas) e circuit breaker: 3 falhas seguidas marcam o job como `failed` com mensagem detalhada.

---

## 8. Estrutura do frontend

```
src/
├── pages/                    # 11 telas: Dashboard, Profiles, ProfileReels,
│                             #          Analysis, ReelAnalysis, VoiceProfile,
│                             #          Scripts, NewScript, ScriptDetail,
│                             #          Teleprompter, Settings
├── components/
│   ├── auth/                 # AuthProvider, AuthGuard, LoginPage
│   ├── layout/               # Sidebar, Header, MainLayout
│   ├── profiles/             # ProfileCard, AddProfileModal, ProfileReelsList
│   ├── reels/                # ReelCard, métricas, EngagementChart, ViralRanking
│   ├── analysis/             # StructureTimeline, EditingElementsMap, TranscriptViewer, VideoPlayer
│   ├── shared/               # ProcessingStatus (Realtime), ErrorBoundary, EmptyState, LoadingState
│   └── ui/                   # shadcn/ui base components
├── hooks/                    # useProfiles, useReels, useAnalysis, useVoiceProfile,
│                             # useScripts, useScriptVersions, useProcessingJobs
├── store/                    # Zustand store (estado global)
├── lib/
│   ├── supabase.ts           # client Supabase
│   ├── api.ts                # chamadas às Edge Functions
│   └── utils.ts
└── types/                    # tipos TypeScript globais
```

**Design system:** dark glassmorphism Agentise — `#0A0A0F` background, `#3B82F6` primary, blur 40px, borders `rgba(59, 130, 246, 0.x)`, fontes Geist + Inter. Tema fixo (sem white-label dinâmico). O nome da marca exibido vem de `VITE_APP_NAME` (default `Creator OS`).

**Roteamento:** React Router 7. Rotas relevantes:

```
/                          → Dashboard
/profiles                  → Gerenciar perfis (referência + próprio)
/profiles/:id/reels        → Lista de reels com métricas
/analysis                  → Análises em andamento e concluídas
/analysis/:reelId          → Breakdown completo do Reel
/voice-profile             → Voice Profile + reels-base
/scripts                   → Lista de roteiros
/scripts/new               → Gerar novo roteiro
/scripts/:id               → Roteiro + relatório de edição
/scripts/:id/teleprompter  → Modo teleprompter fullscreen
/settings                  → Settings (API keys são read-only — vivem em env vars das Edge Functions)
```

---

## 9. Decisões técnicas e limitações

- **Single-tenant por instância.** Não há `tenant_id` nem multi-tenancy. Cada deployment é uma instância independente. RLS isola dados entre `user_id`s na mesma instância.
- **Tema fixo, sem white-label dinâmico.** Para rebrandar, troque `VITE_APP_NAME` no `.env` e edite `src/index.css` se quiser cores diferentes.
- **API keys em env vars das Edge Functions.** O frontend nunca tem acesso direto. Inputs visíveis em `SettingsPage` são read-only (apenas referência).
- **Apify URLs expiram em 3 dias.** Vídeos são baixados imediatamente para Supabase Storage após scraping.
- **Whisper limite 25MB por arquivo.** Reels do Instagram costumam ficar dentro do limite; se exceder, comprimir com ffmpeg antes do upload.
- **Sem análise visual de vídeo.** O pipeline `analyze-content` opera só sobre a transcrição. Os campos visuais de `content_analyses` (`transitions`, `broll_segments`, `text_overlays`, etc.) ficam vazios.
- **Edge Functions têm timeout.** Por isso o padrão async é obrigatório para qualquer pipeline pesado.
- **Engagement score é heurística.** `likes + comments*3 + shares*5`. Shares pesam 5x porque correlacionam melhor com viralidade. Ajuste os pesos na coluna gerada de `reels` se quiser.
- **Voice Profile melhora com mais vídeos.** Mínimo recomendado: 5 vídeos do próprio perfil.
- **Custos.** Análise completa por Reel: ~$0.35–0.70. Perfil de 50 Reels: ~$2.00–3.50.

---

## 10. Próximos passos para quem dá fork

Para customizar a sua instância:

- Renomear marca: ajustar `VITE_APP_NAME` no `.env`.
- Trocar paleta: editar variáveis em `src/index.css`.
- Trocar provider de LLM: a lógica de geração de roteiros/análise está concentrada nos Edge Functions `analyze-content`, `generate-script` e `generate-voice-profile`. Substituir o cliente Anthropic/OpenAI por outro provider é mecânico.
- Promover usuário a admin manualmente: ver o snippet em `README.md` (seção "Roles").

Para arquitetura mais detalhada (incluindo prompts usados nas chamadas a LLMs e formato exato dos JSONBs), consultar `.claude/CLAUDE.md`.
