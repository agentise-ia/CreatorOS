# Creator OS

> Análise de Reels virais do Instagram + geração de roteiros para teleprompter, tudo self-hosted em Supabase + Vercel.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Stack](https://img.shields.io/badge/stack-React%2019%20%7C%20Vite%208%20%7C%20Supabase-3B82F6)](./ARCHITECTURE.md)

---

## O que é

Creator OS é uma ferramenta self-hosted que automatiza o ciclo de criação de Reels para Instagram:

1. **Extrai** os Reels mais virais de perfis-referência (via Apify).
2. **Analisa** estrutura narrativa (hook, desenvolvimento, CTA) e elementos de edição (transições, b-rolls, música, efeitos sonoros, texto na tela) com timestamps — usando Whisper, Gemini e GPT.
3. **Aprende** o tom de fala do criador a partir dos próprios vídeos (Voice Profile).
4. **Gera** roteiros prontos para teleprompter + relatório de edição estruturado para o editor de vídeo.

Você roda na sua própria conta Supabase + Vercel, com suas próprias chaves de provedores. Sem SaaS, sem multi-tenant, sem billing externo.

---

## Stack

- **Frontend:** React 19, Vite 8, TypeScript 5.9, Tailwind 4, shadcn/ui, Zustand 5, React Router 7.
- **Backend:** Supabase (PostgreSQL + Auth + Storage + Realtime + Edge Functions Deno).
- **Hosting:** Vercel para o frontend; Supabase Cloud para tudo do lado do servidor.
- **Análise de conteúdo:** Apify (scraping), OpenAI Whisper (transcrição), Google Gemini (análise visual de vídeo + GPT/Gemini para análise estrutural e geração de roteiros).

Detalhes em [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 🚀 Como rodar (para alunos)

Setup zero-config: tudo pelo wizard no próprio app deployado. Sem terminal, sem Claude Code, sem edição de arquivos.

1. **Crie um projeto Supabase** novo em [supabase.com/dashboard/new](https://supabase.com/dashboard/new) e anote a URL e as chaves (API → anon + service_role).
2. **Use este template no GitHub** (botão "Use this template" → "Create a new repository") e selecione o seu fork.
3. **Importe no Vercel** em [vercel.com/new](https://vercel.com/new), apontando para o fork. Deixe as envs em branco — o wizard preenche depois.
4. **Gere os tokens auxiliares:**
   - Supabase Personal Access Token em [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
   - Vercel Token em [vercel.com/account/tokens](https://vercel.com/account/tokens)
5. **Abra a URL do seu deploy Vercel.** O app detecta o estado uninitialized e redireciona automaticamente para `/setup`.
6. **Siga o wizard.** Quatro passos: preparação → credenciais core → bootstrap automatizado (migrations, Edge Functions, envs Vercel, redeploy) → APIs da aplicação (Apify, OpenAI, Gemini).
7. **Pronto.** Após o redeploy, faça login com o email/senha que você criou no wizard.

Custos estimados abaixo. Tempo total de setup: ~5 minutos. Detalhes técnicos em [`ARCHITECTURE.md`](./ARCHITECTURE.md).

### Refazer setup ou trocar uma chave

- **Trocar uma API key específica** (Apify/OpenAI/Gemini/Resend): em `/settings`, cole o novo valor no campo correspondente e clique em "Salvar". O valor anterior é substituído.
- **Refazer todo o setup**: abra `/setup` (sempre acessível) e siga o wizard de novo. As operações são idempotentes — migrations já aplicadas são puladas.

---

## 🛠️ Desenvolvimento local

Se você quer rodar o app localmente para customizar o código (não é necessário para uso normal):

```bash
git clone https://github.com/<seu-usuario>/creator-os.git
cd creator-os
cp .env.example .env
# preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY com os do seu projeto
npm install
npm run dev
```

Para customizações que não conflitem com upstream, use `src/customizations/` (ver [`src/customizations/README.md`](./src/customizations/README.md)).

---

## 👥 Convites e roles

Esta instância usa um modelo simples de roles:

- **Owner** — criado no wizard de setup. Gerencia convites em `/team`.
- **Member** — quem entra via convite (token válido por 7 dias).

Após o owner ser criado, self-signup público fica fechado: novos usuários só entram via convite. Se você configurou Resend no wizard, convites são enviados por email; caso contrário, o owner copia o link manualmente.

---

## Custos estimados

| Item | Custo |
|---|---|
| Whisper (transcrição) | ~$0.006 / minuto |
| Gemini (análise visual) | ~$0.0075 / vídeo |
| GPT-4o (análise estrutural + geração de roteiros) | ~$0.03 / análise |
| Apify (scraping) | ~$2.60 / 1.000 resultados |
| **Total por Reel analisado** | **~$0.40–0.80** |
| **Perfil de 50 Reels** | **~$2.50–4.00** |

Supabase free tier e Vercel free tier costumam absorver o tráfego inicial.

---

## Troubleshooting

### `Edge Function retorna "Credenciais ausentes: openai_api_key (configure em /setup ou /settings)"`
A API key não foi salva ou foi perdida (CRYPTO_KEY foi deletada). Vá em `/settings`, cole a chave e clique em "Salvar".

### `Wizard /setup trava no passo 3 (Bootstrap)`
Os passos são checkpointados em `_bootstrap_state`. Clique em "Tentar de novo" — o wizard retoma do step que falhou. Se persistir, abra o console do navegador para ver o erro detalhado.

### `CRYPTO_KEY foi deletada do Vercel`
**Não delete** essa env. Sem ela, os valores em `app_settings` viram lixo (não recuperáveis). Refaça `/setup` para gerar nova chave e re-salvar todas as credenciais.

### `Apify retorna URL de vídeo, mas baixa 404 horas depois`
URLs do Apify expiram em 3 dias. O Edge Function `scrape-profiles` baixa imediatamente para Supabase Storage; se o download falhou, refaça o scrape.

### `Whisper retorna erro de "file too large"`
Limite é 25MB por arquivo. Reels do Instagram costumam ficar dentro do limite; se exceder, comprime com ffmpeg antes:
```bash
ffmpeg -i input.mp4 -vn -ac 1 -ar 16000 -b:a 64k output.mp3
```

### `CORS bloqueia chamadas do frontend`
Configure o domínio da Vercel em Supabase Dashboard → Authentication → URL Configuration → Site URL e em Additional Redirect URLs.

---

## 📚 Documentação adicional

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — modelo de dados, fluxo do pipeline, prompts usados nas chamadas a LLMs, padrão async de jobs e limitações conhecidas.
- [`src/customizations/README.md`](./src/customizations/README.md) — onde fazer customizações sem causar conflitos.
- [`CHANGELOG.md`](./CHANGELOG.md) — histórico de versões.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — como contribuir.

---

## Contribuindo

Bug reports, ideias e PRs são bem-vindos. Veja [`CONTRIBUTING.md`](./CONTRIBUTING.md) para convenções de commit, branch model e style guide.

---

## Licença

[MIT](./LICENSE) © 2026 Creator OS Contributors.
