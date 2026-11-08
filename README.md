# KEY MANAGER

Plataforma SaaS para gerenciar **usuários, créditos e licenças digitais** do seu software.
Frontend em HTML/CSS/JS (módulos ES, sem build), backend Node.js + Express, banco **Supabase PostgreSQL** com **Supabase Auth** e **RLS**, pronto para a **Vercel**.

## Recursos

- Login com usuário e senha, sessão em cookies `httpOnly` + `SameSite=Strict` (tokens nunca ficam acessíveis ao JavaScript).
- Dois níveis: **ADMIN** (tudo) e **USER** (apenas os próprios dados). O papel é lido do banco a cada requisição.
- Dashboard admin: usuários, créditos totais, licenças geradas/ativas/expiradas, últimos usuários, atividades e gráficos.
- Gestão de usuários: criar, excluir, pesquisar, suspender/reativar, ajustar créditos, redefinir senha, histórico.
- Créditos: 1 dia = 1, 7 dias = 4, 30 dias = 10 (tabela `license_plans`). Geração **atômica**: licenças + débito na mesma transação, com trava de linha e chave de idempotência.
- Licenças: código aleatório de 80 bits (`XXXX-XXXX-XXXX-XXXX`), ATIVA/EXPIRADA/REVOGADA, copiar individual/todas, histórico.
- API pública `POST /api/licenses/validate` com limite de requisições.
- Auditoria completa (`activity_logs`) e extrato de créditos (`credit_transactions`).

## Estrutura

```
key-manager/
├─ api/index.js              # entrada serverless (Vercel)
├─ src/                      # backend Express
│  ├─ app.js · server.js · config.js
│  ├─ lib/                   # supabase, validação (zod), erros, auditoria, consultas
│  ├─ middleware/            # auth (sessão + papel), segurança (CSRF, rate limit, CORS)
│  └─ routes/                # auth, me, licenses, admin
├─ public/                   # frontend (index.html, css, js/views)
├─ supabase/migrations/      # 3 migrações SQL (esquema, funções, RLS)
├─ scripts/create-admin.js   # cria o primeiro administrador
├─ docs/API.md               # documentação dos endpoints
├─ tests/                    # testes unitários (node --test)
├─ vercel.json · package.json · .env.example
```

## 1. Configurar o Supabase

1. Crie um projeto em <https://supabase.com> (anote a senha do banco).
2. Em **SQL Editor**, execute **na ordem** o conteúdo de:
   1. `supabase/migrations/20260101000001_schema.sql`
   2. `supabase/migrations/20260101000002_functions.sql`
   3. `supabase/migrations/20260101000003_rls.sql`

   (Alternativa com a CLI: `supabase link --project-ref SEU_REF && supabase db push`.)
3. Em **Authentication → Providers → Email**: mantenha **Email habilitado**. Você pode **desativar “Confirm email”** e **“Allow new users to sign up”** (cadastro público desligado — contas são criadas só pelo admin, via API de administração). Nenhum e-mail é enviado: o “usuário” é mapeado internamente para `usuario@AUTH_EMAIL_DOMAIN`.
4. Em **Project Settings → API**, copie: **Project URL**, chave **anon/publishable** e chave **service_role/secret**.

> ⚠️ A chave `service_role` ignora a RLS. Use-a **somente** em variáveis de ambiente do servidor. Ela nunca é enviada ao navegador.

## 2. Rodar localmente

```bash
cd key-manager
npm install
cp .env.example .env        # preencha SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY
npm run create-admin        # cria o primeiro ADMIN (pergunta usuário e senha)
npm start                   # http://localhost:3000
npm test                    # testes unitários
```

Entre com o administrador, crie usuários em **Usuários → Novo usuário** e adicione créditos.

## 3. Publicar na Vercel

1. Envie o projeto para um repositório Git (o `.env` está no `.gitignore`).
2. Na Vercel: **Add New → Project** → importe o repositório (Framework: *Other*; sem build command).
3. Em **Settings → Environment Variables**, cadastre (Production, e Preview se quiser):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_EMAIL_DOMAIN`, `APP_TIMEZONE`, `NODE_ENV=production`.
4. **Deploy**. O `vercel.json` serve `public/` como estático e encaminha `/api/*` para `api/index.js`.
5. Crie o primeiro admin rodando `npm run create-admin` **localmente** com o `.env` apontando para o mesmo projeto Supabase.
6. Teste: `https://SEU-APP.vercel.app/api/health` deve retornar `"ok": true`.

## 4. Segurança — o que foi implementado

| Requisito | Como |
|---|---|
| Senhas nunca em texto puro | Gerenciadas exclusivamente pelo Supabase Auth (bcrypt). Nenhuma tabela nossa guarda senha; nenhuma consulta as retorna. |
| Controle de acesso no servidor | `authenticate` valida o token no Supabase Auth e carrega `role`/`status` do banco; `requireAdmin` protege `/api/admin/*`. O frontend só esconde menus. |
| RLS | Ativa em todas as tabelas; clientes só têm `SELECT` das próprias linhas (admin vê tudo via `is_admin()`); sem políticas de escrita. |
| Créditos invioláveis | Trigger bloqueia qualquer `UPDATE` em `profiles.credits` fora das funções `generate_licenses`/`adjust_credits` (inclusive com service_role). `CHECK (credits >= 0)`. |
| Geração atômica | `generate_licenses` trava a linha do usuário (`FOR UPDATE`), confere o saldo, debita e cria as licenças numa transação; idempotência evita cobrança duplicada. |
| SERVICE_ROLE | Só em variáveis de ambiente do servidor. |
| Abuso | Limite por IP no login, na API geral, na validação pública e por usuário na geração. |
| CSRF | Cookies `SameSite=Strict` + cabeçalho obrigatório `X-Requested-With` + checagem de `Origin`. |
| Headers | Helmet + CSP restritiva (sem scripts inline), HSTS, `frame-ancestors 'none'`. |
| Auditoria | Toda operação administrativa, login (inclusive falhas), geração e alteração de senha grava em `activity_logs`. |
| Último admin | Trigger impede remover/suspender/rebaixar o último ADMIN ativo. |

## 5. Operação

- **Status das licenças** são calculados em tempo real (`licenses_view`); não há jobs para “expirar”.
- **Excluir usuário** preserva licenças e auditoria (`user_id` vira nulo; `owner_username` permanece). Opcionalmente revoga as licenças ativas.
- **Alterar preços**: edite a tabela `license_plans` no SQL Editor (frontend e backend leem dela).
- **Limites** ajustáveis por variáveis `*_RATE_LIMIT_*` no `.env`.
- Limite de requisições usa memória por instância; em ambiente serverless com muitas instâncias o limite é aproximado. Para controle global, troque o *store* do `express-rate-limit` por Redis/Upstash.

## 6. Solução de problemas

| Sintoma | Causa provável |
|---|---|
| `/api/health` retorna `ok:false` | Variáveis de ambiente ausentes. |
| “Usuário ou senha inválidos” para o admin | `AUTH_EMAIL_DOMAIN` diferente do usado na criação, ou admin ainda não criado. |
| `permission denied for table` | Migração 3 (RLS/permissões) não executada. |
| `function generate_licenses ... not found` | Migração 2 não executada; rode também `notify pgrst, 'reload schema';`. |

Documentação dos endpoints: [`docs/API.md`](docs/API.md).
