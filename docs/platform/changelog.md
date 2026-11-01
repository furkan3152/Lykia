# API changelog

## 2026-11-01

Platform release. No breaking changes for clients on `2026-06-01`.

- Live and test keys (`lk_live_`, `lk_test_`); test keys never reach mainnet.
- Fine-grained scopes: `read`, `quote`, `build`, `execute`, `agents`,
  `automation`, `payouts`, `admin` (legacy scopes still work).
- Key rotation with an overlap window, IP allowlists, `PATCH` for keys.
- Per-project rate limits; IETF `RateLimit` headers; monthly quota headers.
- `Idempotency-Key` on every POST.
- Webhook event catalogue, payload `type`, `livemode`, `apiVersion` and
  `project` fields, delivery attempts, replay, test events, the event feed.
- Request logs (`GET /v1/logs`), usage per endpoint, plans, credits.
- `Lykia-Version` header; `GET /v1/versions`.
- Full OpenAPI 3.1 at `GET /v1/openapi.json`, rendered at `GET /v1/reference`.

## 2026-06-01

The first public version: intents, the Fence, Scent, Tags, the Pack, Circle
routes, projects, legacy `lk_sk_`/`lk_pk_` keys and signed webhooks.
