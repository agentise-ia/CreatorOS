# AGENTS.md — Creator OS

> Ferramenta interna da Agentise para análise de conteúdo viral do Instagram, extração de padrões de viralização, e geração de roteiros personalizados com tom de fala do criador + relatório de edição para o editor de vídeo.

---

## 1. Visão Geral do Produto

**Creator OS** é uma ferramenta de uso interno que automatiza o ciclo completo de criação de conteúdo para Instagram Reels:

1. **Extrai** os conteúdos mais virais de perfis fornecidos pelo usuário
2. **Analisa** métricas (curtidas, comentários, compartilhamentos, views)
3. **Identifica** a estrutura narrativa (hook, desenvolvimento, CTA) com timestamps exatos
4. **Mapeia** elementos de edição (transições, música, efeitos sonoros, b-rolls) com timestamps
5. **Aprende** o tom de fala do criador a partir dos seus próprios vídeos
6. **Gera** roteiros prontos para teleprompter combinando padrões virais + tom pessoal
7. **Entrega** relatório de edição detalhado para guiar o editor de vídeo

---

## 2. Arquitetura do Sistema

### 2.1 Stack Tecnológico

| Camada | Tecnologia | Justificativa |
|---|---|---|
| **Frontend** | React + TypeScript + Vite + Tailwind + shadcn/ui + Zustand + React Router | Stack padrão Agentise + estado global + roteamento |
| **Backend** | Supabase (PostgreSQL + Edge Functions + Storage) | Auth, DB, serverless functions, file storage |
| **Hosting Frontend** | Vercel | Deploy automático, edge functions |
| **Scraping Instagram** | Apify (Instagram Reel Scraper + Instagram Post Scraper) | Extração confiável de métricas, vídeos, transcrições, sem necessidade de login |
| **Transcrição de Áudio** | OpenAI Whisper API (word-level timestamps) | Transcrição precisa em PT-BR com timestamps por palavra |
| **Análise Estrutural** | OpenAI GPT (gpt-4.1 / gpt-4o) | Identifica hook, desenvolvimento, CTA e padrões virais a partir do texto da transcrição |
| **Geração de Roteiros** | OpenAI GPT | Geração de texto criativo, adaptação de tom, roteiros estruturados |
| **Orquestração** | Supabase Edge Functions (Deno) | Pipeline de processamento assíncrono |
| **Fila de Jobs** | Supabase (tabela processing_jobs + Realtime) | Async job queue com notificação via Realtime (não polling) |
| **Autenticação** | Supabase Auth (Magic Link + Google OAuth) | Auth nativo, sem dependência externa |
| **Storage de Vídeos** | Supabase Storage (buckets) | Armazenamento temporário de vídeos baixados |

### 2.2 Diagrama de Fluxo

```
[Frontend - React]
    │
    ├── 1. Usuário insere @perfis de referência
    ├── 2. Usuário conecta/insere seu próprio @perfil
    │
    ▼
[Supabase Edge Function: scrape-profiles]
    │
    ├── Chama Apify Instagram Reel Scraper via API
    ├── Recebe: vídeos, métricas, captions, transcrições, áudio
    ├── Ordena por engagement (likes + comments + shares + views)
    ├── Seleciona top N vídeos virais
    ├── Salva metadados no PostgreSQL
    ├── Faz download dos vídeos para Supabase Storage
    │
    ▼
[Supabase Edge Function: analyze-content]
    │
    ├── Para cada vídeo viral:
    │   ├── Whisper API → Transcrição word-level com timestamps
    │   ├── OpenAI GPT → Análise estrutural (hook, desenvolvimento, CTA, padrões narrativos) a partir do texto
    │   └── Consolida em JSON estruturado (campos de análise visual ficam vazios)
    │
    ├── Para os vídeos do PRÓPRIO perfil:
    │   ├── Whisper API → Transcrição completa
    │   ├── Codex API → Extração do "tom de fala" (vocabulário, ritmo, expressões, estilo)
    │   └── Gera "Voice Profile" (documento de referência do tom)
    │
    ▼
[Supabase Edge Function: generate-scripts]
    │
    ├── Codex API recebe:
    │   ├── Padrões de viralização extraídos (hooks, estruturas, CTAs que funcionam)
    │   ├── Voice Profile do criador
    │   ├── Tema/assunto desejado (input do usuário)
    │   └── Gera:
    │       ├── Roteiro completo para teleprompter (com marcações de timing)
    │       └── Relatório de edição (guia para o editor de vídeo)
    │
    ▼
[Frontend - Exibição]
    ├── Dashboard com métricas dos perfis analisados
    ├── Ranking de conteúdos virais com breakdown
    ├── Visualizador de roteiro (formato teleprompter)
    └── Relatório de edição (exportável PDF/Markdown)
```

---

## 3. Modelo de Dados (Supabase PostgreSQL)

### 3.1 Tabelas Principais

```sql
-- Perfis monitorados (referências e próprio)
CREATE TABLE profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  profile_type TEXT NOT NULL CHECK (profile_type IN ('reference', 'own')),
  full_name TEXT,
  followers_count INTEGER,
  bio TEXT,
  profile_pic_url TEXT,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, instagram_username)
);

-- Reels/vídeos extraídos
CREATE TABLE reels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  instagram_id TEXT UNIQUE NOT NULL,
  shortcode TEXT,
  caption TEXT,
  video_url TEXT,                    -- URL do Apify (expira em 3 dias)
  storage_path TEXT,                 -- path no Supabase Storage (vídeo baixado)
  thumbnail_url TEXT,
  duration_seconds NUMERIC CHECK (duration_seconds > 0),
  likes_count INTEGER DEFAULT 0 CHECK (likes_count >= 0),
  comments_count INTEGER DEFAULT 0 CHECK (comments_count >= 0),
  shares_count INTEGER DEFAULT 0 CHECK (shares_count >= 0),
  views_count INTEGER DEFAULT 0 CHECK (views_count >= 0),
  engagement_score NUMERIC GENERATED ALWAYS AS (
    COALESCE(likes_count, 0) + 
    COALESCE(comments_count, 0) * 3 + 
    COALESCE(shares_count, 0) * 5
  ) STORED,
  music_name TEXT,
  music_artist TEXT,
  hashtags TEXT[],
  mentions TEXT[],
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transcrições (Whisper)
CREATE TABLE transcriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reel_id UUID REFERENCES reels(id) ON DELETE CASCADE UNIQUE,
  full_text TEXT NOT NULL,
  language TEXT DEFAULT 'pt',
  segments JSONB NOT NULL,           -- [{start, end, text, words: [{word, start, end, confidence}]}]
  whisper_model TEXT DEFAULT 'large-v3',
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Análise de conteúdo (resultado consolidado por vídeo)
CREATE TABLE content_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reel_id UUID REFERENCES reels(id) ON DELETE CASCADE UNIQUE,
  
  -- Estrutura narrativa
  hook JSONB NOT NULL,               -- {text, start_ts, end_ts, type, effectiveness_score}
  development JSONB NOT NULL,        -- {text, start_ts, end_ts, key_points: [], storytelling_technique}
  cta JSONB NOT NULL,                -- {text, start_ts, end_ts, type, strength_score}
  
  -- Elementos de edição (arrays com timestamps)
  transitions JSONB DEFAULT '[]',    -- [{type, timestamp, description}]
  music_segments JSONB DEFAULT '[]', -- [{start_ts, end_ts, mood, energy_level, genre}]
  sound_effects JSONB DEFAULT '[]',  -- [{timestamp, type, description}]
  broll_segments JSONB DEFAULT '[]', -- [{start_ts, end_ts, description, visual_type}]
  text_overlays JSONB DEFAULT '[]',  -- [{start_ts, end_ts, text, style, position}]
  
  -- Padrões identificados
  viral_patterns JSONB DEFAULT '{}', -- {hook_type, pacing, retention_technique, emotional_arc}
  
  -- Metadados da análise
  claude_model TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Voice Profile (tom de fala do criador)
CREATE TABLE voice_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Características extraídas
  vocabulary_style TEXT,             -- ex: "informal, técnico-acessível, gírias cariocas"
  sentence_structure TEXT,           -- ex: "frases curtas, diretas, intercaladas com perguntas"
  filler_words TEXT[],               -- ex: ["tipo", "né", "olha", "cara"]
  common_expressions TEXT[],         -- ex: ["bora lá", "presta atenção nisso"]
  tone_description TEXT,             -- ex: "energético, didático, com humor sutil"
  pacing_style TEXT,                 -- ex: "rápido no hook, desacelera na explicação"
  emotional_range TEXT,              -- ex: "varia entre entusiasmo e seriedade"
  speech_patterns JSONB,            -- padrões detalhados em JSON
  
  -- Documento completo de referência
  full_profile_document TEXT NOT NULL, -- texto completo descritivo do Voice Profile
  
  -- Reels usados como base
  source_reel_ids UUID[],
  
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Roteiros gerados
CREATE TABLE scripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_profile_id UUID REFERENCES voice_profiles(id),
  
  -- Input
  topic TEXT NOT NULL,               -- tema/assunto solicitado
  reference_reel_ids UUID[],         -- reels virais usados como referência
  additional_instructions TEXT,      -- instruções extras do usuário
  
  -- Output: Roteiro
  title TEXT NOT NULL,
  script_teleprompter TEXT NOT NULL, -- texto limpo para teleprompter
  script_annotated JSONB NOT NULL,   -- roteiro com marcações de timing e ações
  estimated_duration_seconds INTEGER,
  
  -- Output: Relatório de Edição
  editing_report JSONB NOT NULL,     -- guia completo para o editor
  
  -- Metadados
  generation_model TEXT DEFAULT 'Codex-sonnet',
  viral_patterns_used JSONB,        -- quais padrões foram aplicados
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'recorded', 'published')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs de processamento assíncrono
CREATE TABLE processing_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('scrape', 'analyze', 'voice_profile', 'generate_script')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  input_data JSONB,
  output_data JSONB,
  error_message TEXT,
  progress INTEGER DEFAULT 0,        -- 0-100
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS habilitado em todas as tabelas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reels ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- Policies: user só vê seus próprios dados
CREATE POLICY "Users see own profiles" ON profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own reels" ON reels FOR ALL USING (
  profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);
CREATE POLICY "Users see own transcriptions" ON transcriptions FOR ALL USING (
  reel_id IN (SELECT id FROM reels WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
);
CREATE POLICY "Users see own analyses" ON content_analyses FOR ALL USING (
  reel_id IN (SELECT id FROM reels WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
);
CREATE POLICY "Users see own voice_profiles" ON voice_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own scripts" ON scripts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own jobs" ON processing_jobs FOR ALL USING (auth.uid() = user_id);
```

### 3.2 Índices

```sql
CREATE INDEX idx_reels_profile_id ON reels(profile_id);
CREATE INDEX idx_reels_engagement ON reels(engagement_score DESC);
CREATE INDEX idx_reels_posted_at ON reels(posted_at DESC);
CREATE INDEX idx_reels_profile_posted ON reels(profile_id, posted_at DESC);
CREATE INDEX idx_content_analyses_reel_id ON content_analyses(reel_id);
CREATE INDEX idx_scripts_user_id ON scripts(user_id);
CREATE INDEX idx_voice_profiles_user_id ON voice_profiles(user_id);
CREATE INDEX idx_processing_jobs_status ON processing_jobs(status, created_at);
CREATE INDEX idx_processing_jobs_user_id ON processing_jobs(user_id, created_at DESC);
```

---

## 4. APIs Externas — Configuração e Uso

### 4.1 Apify — Instagram Scraping

**Actors utilizados:**
- `apify/instagram-reel-scraper` — Scraping de Reels (principal)
- `apify/instagram-post-scraper` — Scraping de posts (complementar)

**Dados extraídos por Reel:**
- `likesCount`, `commentsCount`, `sharesCount`, `videoPlayCount`
- `caption`, `hashtags`, `mentions`, `taggedUsers`
- `musicInfo` (nome, artista)
- `timestamp` (data de publicação)
- `transcript` (transcrição automática do Instagram — usar como fallback)
- `videoUrl` / `downloadedVideoUrl` (download direto, expira em 3 dias)
- `duration`
- Top 10 comentários com métricas

**Exemplo de chamada:**
```typescript
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

const run = await apifyClient.actor('apify/instagram-reel-scraper').call({
  usernames: ['perfil_referencia_1', 'perfil_referencia_2'],
  resultsLimit: 50, // últimos 50 reels por perfil
  shouldDownloadVideos: true,
  shouldDownloadCovers: false,
});

const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
```

**Pricing:** ~$2.60 por 1.000 resultados no plano Free. Vídeos baixados expiram em 3 dias — fazer download para Supabase Storage imediatamente.

**Variáveis de ambiente:**
```
APIFY_TOKEN=apify_api_xxxxx
```

### 4.2 OpenAI Whisper — Transcrição

**Uso:** Transcrição de áudio com word-level timestamps para mapeamento preciso de hook/desenvolvimento/CTA.

**Endpoint:** `POST https://api.openai.com/v1/audio/transcriptions`

**Configuração:**
```typescript
const formData = new FormData();
formData.append('file', audioFile, 'audio.mp4');
formData.append('model', 'whisper-1');
formData.append('language', 'pt');
formData.append('response_format', 'verbose_json');
formData.append('timestamp_granularities[]', 'word');
formData.append('timestamp_granularities[]', 'segment');

const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
  body: formData,
});
```

**Output esperado (segments):**
```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 3.2,
      "text": "Você sabia que 90% dos reels que viralizam...",
      "words": [
        { "word": "Você", "start": 0.0, "end": 0.3 },
        { "word": "sabia", "start": 0.3, "end": 0.7 }
      ]
    }
  ]
}
```

**Variáveis de ambiente:**
```
OPENAI_API_KEY=sk-xxxxx
```

### 4.3 OpenAI GPT — Análise Estrutural + Geração de Roteiros

> **Nota histórica:** o pipeline original previa análise visual de vídeo via Google Gemini (cortes, b-rolls, text overlays). Essa integração foi removida do projeto — `analyze-content` opera apenas sobre o texto da transcrição. Os campos `transitions`, `music_segments`, `sound_effects`, `broll_segments`, `text_overlays` e `visual_effects` em `content_analyses` são gravados como arrays vazios.

**Uso 1: Análise de estrutura narrativa**

Recebe a transcrição completa (Whisper) e identifica:
- Hook (primeiros 1-3 segundos): tipo (pergunta, afirmação chocante, promessa, polêmica, curiosidade)
- Desenvolvimento: técnica narrativa (storytelling, tutorial, lista, antes/depois, problema-solução)
- CTA: tipo (seguir, comentar, compartilhar, link na bio, salvar)
- Padrões de retenção (loops, cliffhangers, payoff delays)

**Uso 2: Extração de Voice Profile**

Recebe transcrições de 5-10 vídeos do próprio perfil e gera um documento de referência do tom de fala contendo: vocabulário recorrente, construções frasais preferidas, gírias e expressões, ritmo de fala, transições verbais, nível de formalidade, uso de humor, patterns de abertura e fechamento.

**Uso 3: Geração de Roteiro para Teleprompter**

Recebe: Voice Profile + padrões virais extraídos + tema desejado. Gera:
- Roteiro limpo (texto corrido para ler no teleprompter)
- Roteiro anotado (com marcações de timing, pausas, ênfases)
- Estimativa de duração

**Uso 4: Relatório de Edição**

JSON estruturado com instruções para o editor de vídeo:
```json
{
  "total_duration_estimate": "45-60 segundos",
  "music_recommendation": {
    "mood": "energético, crescente",
    "genre": "lo-fi beat com build up",
    "reference_tracks": ["nome de track similar ao viral X"],
    "volume_curve": [
      { "start": "00:00", "end": "00:03", "volume": "baixo (fala em destaque)" },
      { "start": "00:03", "end": "00:05", "volume": "sobe no beat drop" }
    ]
  },
  "editing_instructions": [
    {
      "timestamp": "00:00-00:03",
      "section": "hook",
      "visual": "Close-up no rosto, zoom lento entrando",
      "text_overlay": "FRASE IMPACTANTE aqui (fonte bold, centro da tela)",
      "audio": "Efeito whoosh de abertura, música começa suave",
      "transition_in": "Corte seco do logo/intro"
    },
    {
      "timestamp": "00:03-00:25",
      "section": "desenvolvimento",
      "visual": "Alternar entre talking head e b-roll a cada 5-7 segundos",
      "broll_suggestions": [
        "00:08-00:11 — tela gravação mostrando [X]",
        "00:15-00:18 — imagem/gráfico ilustrando [Y]"
      ],
      "text_overlay": "Bullet points aparecem sincronizados com fala",
      "audio": "Música mantém ritmo constante, efeito de 'ding' em cada ponto-chave",
      "transitions": "Jump cuts entre frases, zoom in nos momentos de ênfase"
    },
    {
      "timestamp": "00:25-00:30",
      "section": "cta",
      "visual": "Zoom out, gesticulação apontando para botão de seguir",
      "text_overlay": "SIGA PARA MAIS em animação",
      "audio": "Música sobe, efeito sonoro de finalização",
      "transition_out": "Fade to black ou loop pro início"
    }
  ],
  "color_grading": "Tom quente, saturação leve, contraste médio-alto",
  "aspect_ratio": "9:16",
  "captions_style": "Legendas animadas word-by-word estilo hormozi/iman gadzhi"
}
```

**Modelo:** `Codex-sonnet-4-20250514`

**Variáveis de ambiente:**
```
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

---

## 5. Estrutura do Frontend

### 5.1 Páginas/Rotas

```
/                          → Dashboard principal
/profiles                  → Gerenciar perfis de referência + próprio perfil
/profiles/:id/reels        → Lista de reels de um perfil com métricas
/analysis                  → Análises em andamento e concluídas
/analysis/:reelId          → Breakdown completo de um reel (estrutura, edição, métricas)
/voice-profile             → Voice Profile atual + reels usados como base
/scripts                   → Lista de roteiros gerados
/scripts/new               → Gerar novo roteiro (selecionar padrões + tema)
/scripts/:id               → Visualizar roteiro (teleprompter) + relatório de edição
/scripts/:id/teleprompter  → Modo teleprompter fullscreen
/settings                  → API keys, preferências
```

### 5.2 Componentes Chave

```
src/
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── MainLayout.tsx
│   ├── profiles/
│   │   ├── ProfileCard.tsx          -- card com avatar, métricas, tipo
│   │   ├── AddProfileModal.tsx      -- modal para adicionar @perfil
│   │   └── ProfileReelsList.tsx     -- lista de reels com sorting
│   ├── reels/
│   │   ├── ReelCard.tsx             -- thumbnail + métricas compactas
│   │   ├── ReelMetricsBadge.tsx     -- likes/comments/shares inline
│   │   ├── EngagementChart.tsx      -- gráfico de engagement (Recharts)
│   │   └── ViralRanking.tsx         -- ranking dos mais virais
│   ├── analysis/
│   │   ├── StructureTimeline.tsx    -- timeline visual hook/dev/cta
│   │   ├── EditingElementsMap.tsx   -- mapa visual de transições/brolls/fx
│   │   ├── TranscriptViewer.tsx     -- transcrição com timestamps clicáveis
│   │   ├── VideoPlayer.tsx          -- player sincronizado com timeline
│   │   └── PatternCard.tsx          -- card de padrão viral identificado
│   ├── voice-profile/
│   │   ├── VoiceProfileSummary.tsx  -- resumo visual do tom de fala
│   │   ├── ExpressionCloud.tsx      -- word cloud de expressões
│   │   └── StyleComparison.tsx      -- comparação tom próprio vs referências
│   ├── scripts/
│   │   ├── ScriptEditor.tsx         -- editor do roteiro com anotações
│   │   ├── TeleprompterView.tsx     -- modo leitura fullscreen
│   │   ├── EditingReportView.tsx    -- relatório de edição formatado
│   │   ├── EditingReportExport.tsx  -- exportar PDF/Markdown
│   │   └── ScriptGeneratorForm.tsx  -- form para solicitar novo roteiro
│   ├── auth/
│   │   ├── LoginPage.tsx            -- login com Magic Link + Google OAuth
│   │   ├── AuthGuard.tsx            -- wrapper que redireciona se não autenticado
│   │   └── AuthProvider.tsx         -- context de autenticação (Supabase Auth)
│   └── shared/
│       ├── ProcessingStatus.tsx     -- indicador de job em andamento (Realtime)
│       ├── ErrorBoundary.tsx        -- error boundary por rota
│       ├── EmptyState.tsx
│       └── LoadingState.tsx
├── hooks/
│   ├── useProfiles.ts
│   ├── useReels.ts
│   ├── useAnalysis.ts
│   ├── useVoiceProfile.ts
│   ├── useScripts.ts
│   └── useProcessingJobs.ts        -- Supabase Realtime subscription de jobs
├── store/
│   └── index.ts                     -- Zustand store (estado global)
├── lib/
│   ├── supabase.ts                  -- client Supabase
│   ├── api.ts                       -- chamadas às Edge Functions
│   └── utils.ts
├── types/
│   └── index.ts                     -- tipos TypeScript globais
└── pages/                           -- ou App.tsx com React Router
```

### 5.3 Design System

- **Tema:** Dark mode (padrão Agentise)
- **Cores HSL (CSS Variables):**
  ```css
  --background: 222 47% 6%;
  --foreground: 210 40% 98%;
  --primary: 262 83% 58%;       /* roxo Agentise */
  --primary-foreground: 210 40% 98%;
  --accent: 170 70% 50%;        /* verde/teal para métricas positivas */
  --destructive: 0 84% 60%;     /* vermelho para métricas negativas */
  --muted: 217 33% 17%;
  --card: 222 47% 8%;
  --border: 217 33% 17%;
  ```
- **Fonte:** Inter (padrão Tailwind)
- **Componentes:** shadcn/ui como base, customizados com as cores acima

---

## 6. Supabase Edge Functions

### 6.1 Lista de Functions

```
supabase/functions/
├── scrape-profiles/index.ts       -- Chama Apify, salva reels no DB + Storage
├── analyze-content/index.ts       -- Pipeline: Whisper → OpenAI (texto) → salva análise
├── generate-voice-profile/index.ts -- Analisa vídeos próprios e gera Voice Profile
├── generate-script/index.ts       -- Gera roteiro + relatório de edição
└── job-status/index.ts            -- Retorna status de job (polling do frontend)
```

### 6.2 Padrão de Edge Function (async job)

Todas as functions pesadas seguem o padrão:

1. Frontend chama a function
2. Function cria registro em `processing_jobs` com status `pending`
3. Retorna imediatamente o `job_id`
4. Processa em background (Deno.spawn ou processamento inline com updates progressivos)
5. Frontend usa Supabase Realtime subscription em `processing_jobs` para receber updates (NÃO polling)

```typescript
// Padrão genérico de Edge Function
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { user_id, ...params } = await req.json()
  
  // Criar job
  const { data: job } = await supabase
    .from('processing_jobs')
    .insert({ user_id, job_type: 'analyze', status: 'processing', input_data: params })
    .select()
    .single()
  
  // Retornar job_id imediatamente
  // (o processamento real acontece em seguida ou via trigger)
  
  return new Response(JSON.stringify({ job_id: job.id }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

---

## 7. Variáveis de Ambiente

```env
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJxxxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxxxx

# Apify
APIFY_TOKEN=apify_api_xxxxx

# OpenAI (Whisper + GPT)
OPENAI_API_KEY=sk-xxxxx
```

---

## 8. Módulos de Implementação

O projeto deve ser implementado em **5 módulos sequenciais**, cada um entregando funcionalidade testável:

### Módulo 1 — Fundação + Scraping
- Setup do projeto (Vite + React + Tailwind + shadcn/ui + Zustand + React Router + Supabase)
- Autenticação com Supabase Auth (Magic Link + Google OAuth) + AuthGuard
- Schema do banco de dados (todas as tabelas + RLS + índices + CHECK constraints)
- Async job queue com Supabase Realtime (subscription em `processing_jobs`)
- Error Boundaries por rota
- Página de perfis + modal de adicionar perfil
- Edge Function `scrape-profiles` (Apify → DB + Storage) com retry + circuit breaker
- Dashboard básico com lista de reels e métricas
- **Entrega:** Conseguir autenticar, adicionar um perfil e ver seus reels com métricas

### Módulo 2 — Análise de Conteúdo
- Edge Function `analyze-content` (Whisper + OpenAI sobre texto)
- Pipeline completo de análise por vídeo
- Componente `StructureTimeline` (visualização hook/dev/cta)
- Componente `EditingElementsMap` (mapa de edição com timestamps)
- Componente `TranscriptViewer` com timestamps clicáveis
- Player de vídeo sincronizado com timeline
- **Entrega:** Clicar em um reel e ver análise completa com breakdown

### Módulo 3 — Voice Profile
- Edge Function `generate-voice-profile`
- Página de Voice Profile com resumo visual
- Comparação de tom vs referências
- Word cloud de expressões
- **Entrega:** Gerar Voice Profile a partir dos próprios vídeos

### Módulo 4 — Geração de Roteiros
- Edge Function `generate-script`
- Form de geração (selecionar padrões + tema + referências)
- Visualizador de roteiro com anotações
- Relatório de edição formatado
- Export PDF/Markdown do relatório
- **Entrega:** Gerar roteiro completo + relatório de edição

### Módulo 5 — Polish + Teleprompter
- Modo teleprompter fullscreen (scroll automático, velocidade ajustável)
- Dashboard com ranking viral e insights consolidados
- Refinamento de UX (loading states, empty states, error handling)
- Otimização de performance (caching, lazy loading)
- **Entrega:** Produto completo funcional

---

## 9. Convenções de Código

### 9.1 TypeScript
- Strict mode habilitado
- Tipos explícitos (não usar `any`)
- Interfaces para props de componentes
- Types para dados do Supabase (gerar com `supabase gen types typescript`)

### 9.2 Componentes React
- Functional components com hooks
- Props destruct no parâmetro
- Nomes em PascalCase
- Um componente por arquivo
- Hooks customizados em `/hooks`

### 9.3 Edge Functions (Deno)
- TypeScript
- Error handling com try/catch em toda chamada externa
- Logs estruturados (`console.log(JSON.stringify({...}))`)
- Timeout handling para APIs externas (Apify pode demorar minutos)
- Rate limiting awareness (Whisper: 50 RPM)
- **Retry com exponential backoff** (3 tentativas) em todas as chamadas a APIs externas
- **Circuit breaker**: se uma API falhar 3x seguidas, marcar job como `failed` com `error_message` detalhado
- **Padrão async obrigatório**: Edge Functions NUNCA processam inline — sempre criam job e retornam `job_id`
- Edge Functions usam `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS) para escrita em tabelas

### 9.4 Git
- Branch principal: `main`
- Branches de feature: `module-N/descricao`
- Commits em português, prefixados: `feat:`, `fix:`, `refactor:`, `docs:`
- AGENTS.md sempre atualizado a cada módulo

---

## 10. Limitações Conhecidas e Decisões Técnicas

1. **Apify video URLs expiram em 3 dias** → Baixar imediatamente para Supabase Storage após scraping
2. **Sem análise visual de vídeo** → A integração com Google Gemini foi removida. `analyze-content` opera só sobre o texto da transcrição. Os campos visuais de `content_analyses` (`transitions`, `broll_segments`, `text_overlays`, `music_segments`, `sound_effects`, `visual_effects`) ficam vazios.
3. **Whisper API tem limite de 25MB por arquivo** → Reels do Instagram geralmente estão dentro do limite; se exceder, comprimir com ffmpeg
4. **Edge Functions do Supabase têm timeout** → Para processamentos longos, usar padrão de job assíncrono
5. **Engagement score é uma heurística** → Shares pesam 5x mais que likes porque correlacionam melhor com viralidade; ajustar pesos conforme análise de resultados
6. **Voice Profile melhora com mais vídeos** → Mínimo recomendado: 5 vídeos do próprio perfil
7. **Custo por análise completa estimado:** ~$0.35-0.70 por Reel (Whisper ~$0.006/min + OpenAI GPT ~$0.03/análise). Para um perfil com 50 reels: ~$2.00-3.50 total

---

## 11. Referência Rápida de Comandos

```bash
# Dev local
npm run dev                           # Frontend dev server
supabase start                        # Supabase local
supabase functions serve              # Edge Functions local

# Deploy
vercel --prod                         # Frontend
supabase functions deploy scrape-profiles
supabase functions deploy analyze-content
supabase functions deploy generate-voice-profile
supabase functions deploy generate-script

# Database
supabase db push                      # Aplicar migrations
supabase gen types typescript --local > src/types/supabase.ts

# Logs
supabase functions logs scrape-profiles --follow
```