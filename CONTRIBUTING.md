# Contribuindo com Creator OS

Obrigado por considerar contribuir! Este guia descreve como reportar problemas, propor mudanças e abrir Pull Requests.

---

## Reportando bugs

- Abra uma issue no repositório no GitHub.
- Inclua:
  - **Descrição** clara do problema.
  - **Passos para reproduzir** (idealmente com URL/perfil de teste, se aplicável).
  - **Comportamento esperado vs observado**.
  - **Ambiente**: navegador, Node version, Supabase region, sistema operacional.
  - **Logs relevantes**: console do browser, `supabase functions logs <nome>`.
- Se for bug de uma Edge Function, inclua o `job_id` afetado quando possível — facilita inspecionar `processing_jobs.error_message`.

## Sugerindo features

Abra uma issue com a tag `enhancement`. Descreva:
- O problema que a feature resolve.
- A solução proposta.
- Alternativas consideradas.

---

## Convenção de commits

Usamos prefixos no padrão Conventional Commits, em pt-BR ou en (escolha um e mantenha consistência no PR):

| Prefixo | Quando usar |
|---|---|
| `feat:` | Nova feature de domínio. |
| `fix:` | Correção de bug. |
| `chore:` | Manutenção (deps, configs, build). |
| `refactor:` | Refatoração sem mudança de comportamento. |
| `docs:` | Apenas documentação. |
| `test:` | Apenas testes. |
| `migration:` | Mudanças de migração SaaS → OSS (uso interno do plano em `migration/`). |

Exemplos:
```
feat: adicionar export do roteiro em formato Markdown
fix: corrigir parsing de transcrição quando segments vem vazio
docs: ampliar troubleshooting de timeout de Edge Function
```

---

## Branch model

- `main` é produção. Não comitar direto.
- `oss-self-hosted` é a branch ativa da migração SaaS → OSS deste projeto. Mudanças do plano de migração ficam aqui até o merge final.
- Feature branches: `feat/<nome-curto>`, `fix/<nome-curto>`.
- Abra PR contra `main` (ou contra `oss-self-hosted` enquanto a migração não fechou).

---

## Rodando local antes do PR

1. Instale dependências: `npm install`.
2. Copie `.env.example` para `.env` e preencha as variáveis (ver `README.md`).
3. `npm run dev` — frontend em modo dev.
4. `npm run build` — confirmar que o build passa.
5. `npm run lint` — confirmar que não há erros novos de lint.
6. Para testar Edge Functions modificadas: `supabase functions serve <nome>` (Supabase CLI).

PRs com `npm run build` quebrado ou erros de tipo serão rejeitados.

---

## Style guide

### TypeScript
- Strict mode é obrigatório (`tsconfig` já configurado).
- Nunca usar `any`. Em parsings de JSONB use `Record<string, unknown>` e valide antes de usar.
- Tipos explícitos em props de componentes (`interface` ou `type`).
- Nomes de componentes em `PascalCase`, hooks em `useCamelCase`, utilitários em `camelCase`.
- Um componente por arquivo.

### React
- Functional components com hooks.
- Props desestruturadas no parâmetro.
- Hooks customizados em `src/hooks/`.
- Estado global em `src/store/` (Zustand) — use só quando o estado for compartilhado entre rotas.

### Estilo
- Tailwind utility-first.
- shadcn/ui como base de componentes — customize via Tailwind, não com CSS override.
- Manter o design system Agentise dark glassmorphism: background `#0A0A0F`, primary `#3B82F6`, blur 40px, borders `rgba(59, 130, 246, 0.x)`. Não introduzir cores fora dessa paleta sem discussão prévia.

### Edge Functions (Deno)
- TypeScript estrito.
- `try/catch` em toda chamada externa (Apify, OpenAI, Gemini, Claude).
- Logs estruturados em JSON: `console.log(JSON.stringify({ ... }))`.
- Retry com exponential backoff (3 tentativas) em chamadas a APIs externas.
- Circuit breaker: 3 falhas seguidas → marcar `processing_jobs.status = 'failed'` com `error_message` detalhado.
- Padrão async é obrigatório para qualquer processamento longo: criar job, retornar `job_id` imediatamente, processar em seguida.
- Usar `SUPABASE_SERVICE_ROLE_KEY` para escrita em tabelas com RLS. Nunca expor essa key no frontend.

---

## Pull Requests

Antes de abrir o PR:
- [ ] `npm run build` passa.
- [ ] `npm run lint` sem erros novos.
- [ ] Mudanças em SQL acompanhadas de migration nova em `supabase/migrations/` (nunca editar migration já aplicada).
- [ ] Variáveis de ambiente novas documentadas no `.env.example`.
- [ ] Documentação relevante atualizada (`README.md` para setup, `ARCHITECTURE.md` para mudanças estruturais).
- [ ] CHANGELOG.md atualizado com a entrada na seção `[Unreleased]`.

Descreva no corpo do PR:
- O que mudou e por quê.
- Como testou.
- Screenshots de UI quando aplicável.

---

## Customizando sem conflitos

Toda customização que você fizer deve ficar em `src/customizations/`. Esse diretório é "zona livre" — o upstream nunca edita nada lá. Garante que `git sync fork` não gere conflito quando você puxar atualizações.

Para mais detalhes, leia [`src/customizations/README.md`](./src/customizations/README.md).

---

## Código de conduta

Seja respeitoso. Discussões técnicas são bem-vindas; ataques pessoais não.
