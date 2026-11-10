# KEY MANAGER — Documentação da API

Base URL: `https://SEU-DOMINIO` (local: `http://localhost:3000`). Todas as respostas são JSON.

- **Endpoint público** (para o seu software): `POST /api/licenses/validate` — sem autenticação.
- **Demais endpoints**: usados pelo painel. Autenticam por **cookie de sessão httpOnly** (definido em `/api/auth/login`) e exigem o cabeçalho `X-Requested-With: KeyManager` em requisições que alteram dados (proteção CSRF).

Formato de erro (endpoints do painel):

```json
{ "error": { "code": "INSUFFICIENT_CREDITS", "message": "Créditos insuficientes para esta operação.", "details": null } }
```

---

## 1. Validação de licença (público)

### `POST /api/licenses/validate`

Corpo:

```json
{ "key": "ABCD-EFGH-JKMN-PQRS" }
```

A chave é normalizada (maiúsculas; espaços e hífens são ignorados). Alfabeto das chaves: `A–Z` e `2–9` (sem `0`, `1`, `I`, `O`).

| HTTP | `valid` | `status` | `reason` | Quando |
|---|---|---|---|---|
| 200 | `true` | `ACTIVE` | `null` | Licença existe e está ativa |
| 200 | `false` | `NOT_FOUND` | `LICENSE_NOT_FOUND` | Licença não existe |
| 200 | `false` | `EXPIRED` | `LICENSE_EXPIRED` | Licença expirou |
| 200 | `false` | `REVOKED` | `LICENSE_REVOKED` | Licença revogada |
| 400 | `false` | `INVALID_FORMAT` | `INVALID_FORMAT` | Chave fora do formato |
| 429 | `false` | `RATE_LIMITED` | `RATE_LIMITED` | Excedeu o limite por IP (padrão 60/min) |
| 503 | `false` | `ERROR` | `SERVICE_UNAVAILABLE` | Falha temporária |

**Licença válida**

```json
{
  "valid": true,
  "status": "ACTIVE",
  "reason": null,
  "message": "Licença válida.",
  "key": "ABCD-EFGH-JKMN-PQRS",
  "expires_at": "2026-12-01T15:04:05.000Z",
  "checked_at": "2026-11-08T12:00:00.000Z"
}
```

**Expirada**

```json
{
  "valid": false,
  "status": "EXPIRED",
  "reason": "LICENSE_EXPIRED",
  "message": "A licença expirou.",
  "key": "ABCD-EFGH-JKMN-PQRS",
  "expires_at": "2026-11-01T15:04:05.000Z",
  "checked_at": "2026-11-08T12:00:00.000Z"
}
```

**Inexistente**

```json
{ "valid": false, "status": "NOT_FOUND", "reason": "LICENSE_NOT_FOUND", "message": "Licença não encontrada.", "expires_at": null }
```

A resposta **nunca** inclui usuário, créditos ou qualquer dado privado. CORS está liberado (`*`) apenas neste endpoint.

Exemplo cURL:

```bash
curl -X POST https://SEU-DOMINIO/api/licenses/validate \
  -H "Content-Type: application/json" \
  -d '{"key":"ABCD-EFGH-JKMN-PQRS"}'
```

Exemplo Node.js:

```js
const r = await fetch('https://SEU-DOMINIO/api/licenses/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key })
});
const { valid, reason, expires_at } = await r.json();
```

> Recomendação: no seu software, trate qualquer resposta diferente de `valid: true` (incluindo 429/503) como "não validado" e tente novamente com intervalo crescente.

---

## 2. Autenticação

| Método | Rota | Corpo | Descrição |
|---|---|---|---|
| POST | `/api/auth/login` | `{ username, password }` | Inicia sessão (cookies httpOnly). Limite: 10 tentativas falhas / 15 min por IP |
| POST | `/api/auth/refresh` | — | Renova a sessão com o refresh token (cookie) |
| POST | `/api/auth/logout` | — | Encerra e revoga a sessão |

Resposta do login: `{ "user": { "id", "username", "display_name", "role", "status", "credits", "created_at" } }`.

---

## 3. Usuário autenticado (`/api/me`)

Sempre restrito aos dados do próprio usuário.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/me` | Perfil e saldo |
| PATCH | `/api/me` | `{ display_name }` — único campo editável |
| POST | `/api/me/password` | `{ current_password, new_password }` |
| GET | `/api/me/stats` | Totais e séries diárias (14 dias) |
| GET | `/api/me/licenses?page&limit&status&search` | Minhas licenças |
| GET | `/api/me/transactions?page&limit` | Meu extrato de créditos |

Listagens retornam `{ items, page, limit, total }`.

---

## 4. Licenças (autenticado)

### `GET /api/licenses/plans`

```json
{ "plans": [ { "days": 1, "credits": 1, "label": "1 dia" }, { "days": 7, "credits": 4, "label": "7 dias" }, { "days": 30, "credits": 10, "label": "30 dias" } ], "max_quantity": 100 }
```

### `POST /api/licenses/generate`

```json
{ "quantity": 5, "days": 7, "idempotency_key": "b8b1c0aa-5c0e-4a6e-9a8e-6a3f0c1d2e3f" }
```

Débito de créditos e criação das licenças ocorrem em **uma única transação** (linha do usuário travada). Saldo insuficiente → `402 INSUFFICIENT_CREDITS` e nada é gerado. `idempotency_key` (UUID, opcional) evita cobrança duplicada em reenvios: repetir a mesma chave devolve o lote original (HTTP 200, `replayed: true`).

Resposta `201`:

```json
{
  "batch_id": "…", "quantity": 5, "duration_days": 7, "unit_cost": 4, "total_cost": 20,
  "balance": 30, "replayed": false,
  "licenses": [ { "id": "…", "code": "ABCD-EFGH-JKMN-PQRS", "duration_days": 7,
                  "created_at": "…", "expires_at": "…", "status": "ACTIVE" } ]
}
```

Erros: `400 INVALID_QUANTITY | INVALID_PLAN`, `402 INSUFFICIENT_CREDITS`, `403 ACCOUNT_SUSPENDED`, `429 RATE_LIMITED`.

---

## 5. Administração (`/api/admin`) — somente ADMIN

O papel é verificado no banco a cada requisição. Usuários comuns recebem `403 FORBIDDEN`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/admin/stats` | Totais, gráficos, últimos usuários e atividades |
| GET | `/api/admin/users?search&status&page&limit` | Lista/pesquisa por nome ou username |
| POST | `/api/admin/users` | `{ username, password, display_name?, role?, credits? }` |
| GET | `/api/admin/users/:id` | Detalhes + estatísticas |
| PATCH | `/api/admin/users/:id/status` | `{ status: "ACTIVE" \| "SUSPENDED" }` |
| POST | `/api/admin/users/:id/credits` | `{ operation: "add" \| "remove", amount, note? }` |
| POST | `/api/admin/users/:id/password` | `{ password }` |
| DELETE | `/api/admin/users/:id?revoke_licenses=true` | Exclui o usuário |
| GET | `/api/admin/users/:id/activity` | Histórico de atividades |
| GET | `/api/admin/users/:id/transactions` | Extrato de créditos |
| GET | `/api/admin/licenses?status&search&user_id&page&limit` | Todas as licenças |
| POST | `/api/admin/licenses/:id/revoke` | Revoga uma licença |
| GET | `/api/admin/activity?action&page&limit` | Trilha de auditoria |
| GET | `/api/admin/access-logs?search&filter&page&limit` | Histórico de acessos (`filter`: `success`, `failed` ou `suspicious`; `search`: usuário ou IP) |
| GET | `/api/admin/access-logs/summary` | Totais das últimas 24 h: logins, falhas, suspeitos, IPs distintos |

Cada item de `access-logs` traz: `username`, `success`, `reason` (`OK`, `INVALID_CREDENTIALS`, `SUSPENDED`), `ip`, `device`, `device_type`, `os`, `browser`, `country`, `region`, `city`, `flags`, `suspicious` e `created_at`. A localização é aproximada (cabeçalhos de geolocalização da Vercel). Sinais em `flags`: `NEW_IP`, `NEW_DEVICE`, `NEW_COUNTRY`, `AFTER_FAILURES`, `BRUTE_FORCE`, `UNKNOWN_USER`. Um acesso é `suspicious` quando tem `NEW_COUNTRY`, `AFTER_FAILURES`, `BRUTE_FORCE` ou `NEW_IP` + `NEW_DEVICE` juntos.

Regras: não é possível suspender/excluir a si mesmo nem o último administrador ativo; créditos nunca ficam negativos; senhas nunca são retornadas.

---

## 6. Saúde

`GET /api/health` → `{ "ok": true, "service": "key-manager", "time": "…" }` (`ok: false` se faltarem variáveis de ambiente).

## 7. Códigos de erro comuns

`VALIDATION_ERROR` (400) · `UNAUTHENTICATED` / `SESSION_INVALID` (401) · `INSUFFICIENT_CREDITS` (402) · `FORBIDDEN` / `ACCOUNT_SUSPENDED` / `CSRF_REJECTED` (403) · `NOT_FOUND` / `USER_NOT_FOUND` / `LICENSE_NOT_FOUND` (404) · `USERNAME_TAKEN` / `LAST_ADMIN` / `ALREADY_REVOKED` (409) · `RATE_LIMITED` (429) · `INTERNAL_ERROR` (500).
