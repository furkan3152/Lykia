# Keys and scopes

## Key formats

| Prefix | Kind | Reaches |
|---|---|---|
| `lk_test_<id>_<secret>` | secret, sandbox | Arc testnet only. Never billed. |
| `lk_live_<id>_<secret>` | secret | Mainnet and testnet. |
| `lk_pk_test_…` / `lk_pk_live_…` | publishable (browser) | Only from allowed origins; `read`, `quote`, `build` at most. |
| `lk_sk_…` / `lk_pk_…` | legacy | Unchanged behaviour and legacy scopes. |

Only an HMAC of each key is stored; the full key is shown once.

**A test key can never touch mainnet.** An explicit `environment=mainnet`
(query or body) is refused with `403 LIVE_MODE_REQUIRED`; without an
environment the request is served on testnet; acting on a stored mainnet
plan is refused too.

## Scopes

| Scope | Grants |
|---|---|
| `read` | Every GET. |
| `quote` | Quotes and checks that move nothing: `/quote`, `/routes/search`, Fence evaluate and validate, sentence parsing. |
| `build` | Plans and unsigned transactions: `POST /intents`, step prepare, Tag drafts, MCP. |
| `execute` | Submit signed hashes, stop plans. |
| `agents` | The Pack and Lyko's agent. |
| `automation` | Standing orders, limit orders, alerts, automations, jobs. |
| `payouts` | Payouts, invoices and treasury flows. |
| `admin` | Keys, webhooks, projects, billing. |

New secret keys default to `read, quote, build, execute, agents, automation`.
`payouts` and `admin` must be asked for. Legacy scopes map onto these:
`plan` = `quote + build + execute`, `agents` = `agents + automation`.

A module that documents its routes with `documentRoutes({ scope })` gets that
scope enforced for new keys automatically.

## Manage keys

```http
POST  /v1/developers/keys            { "label": "api", "mode": "live", "scopes": ["read","quote"], "allowedIps": ["203.0.113.0/24"], "apiVersion": "2026-11-01" }
PATCH /v1/developers/keys/:id        { "allowedIps": [...], "scopes": [...], "perMinute": 300 }
POST  /v1/developers/keys/:id/rotate { "overlapSeconds": 3600 }
POST  /v1/developers/keys/:id/revoke
```

**Rotation** returns a new secret at once; the old one keeps working for
`overlapSeconds` (default 86400, at most 7 days, 0 for immediate). A
`key.rotated` event is emitted. Revocation ends the overlap too.

**IP allowlists** take exact IPv4/IPv6 addresses or CIDR ranges (up to 20).
Requests from elsewhere get `403 IP_NOT_ALLOWED`.
