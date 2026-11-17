# API changelog

## Unreleased (additive, under `2026-11-01`)

- Paid x402 routes (`/v1/x402/fence/evaluate`, `/v1/x402/quote`,
  `/v1/x402/scent/{token}`): an unpaid request answers `402` whatever its
  body holds (before, an invalid body answered `400` first). With a payment,
  an invalid request answers `400` and nothing is settled; the answer is
  sent only after settlement. The 402 body and `PAYMENT-REQUIRED` gain
  x402 v2 `resource` (`url`, `description`, `mimeType`) and
  `extensions.bazaar`; `accepts[].resource` is the absolute URL.
  `Idempotency-Key` is ignored on these routes (the payment nonce is their
  replay guard), under every path spelling that reaches them. Each call is
  paid on the Arc network it runs on: `facts.environment` for the Fence
  check, `environment` in the quote body, `?environment=` for Scent. `HEAD`
  only gets the offer. A call with a live key is not billed overage on top
  of the route's own payment, and is not counted against the plan.
- The OpenAPI document: each paid operation's `200` has its answer schema,
  `PAYMENT-SIGNATURE` is listed beside `X-PAYMENT`, and `0x` address fields
  carry their pattern.
- The OpenAPI document is also served at `/openapi.json` and
  `/.well-known/openapi.json`, with `x-payment-info` on paid operations,
  `info.x-guidance` and `externalDocs`. `/.well-known/x402` adds `items[]`
  and `pagination`.
- Overage and credit 402s carry the absolute resource URL and x402 v2
  `resource`.

- Lyko Autopilot ([../autopilot.md](../autopilot.md)), for signed-in owners
  only:
  - Routes: `GET /v1/autopilot`, `POST /v1/autopilot/(enable|stop|pause|resume)`,
    `POST /v1/autopilot/tasks`,
    `POST /v1/autopilot/tasks/:id/(pause|resume|remove|run)`.
  - Error codes: `AUTOPILOT_ACK_REQUIRED` and `INVALID_AUTOPILOT` (400),
    `CIRCLE_SERVER_WALLETS_OFF` (403), `CIRCLE_NOT_CONFIGURED` (503).
  - Webhook events: `autopilot.signed`, `autopilot.paused`,
    `autopilot.stopped`.
  - `POST /v1/pack/whistle` also stops Autopilot and answers `autopilot`.

- Staged plans: `POST /v1/intents/:id/steps/:sid/prepare` takes `stage: true`
  (a stage's steps as one transaction, `stepIds`) and answers `replanned` when
  a step was rebuilt from what the step before delivered; steps carry
  `stage`, `received` and `replanned`. `POST /v1/intents/:id/steps/:sid/retry`
  puts a paused step back to ready. Prepare refusals `FENCE_DENIED`,
  `NO_ROUTE` and `INSUFFICIENT_BALANCE` are recorded on the step.
- Agent instructions: `GET|POST /v1/agent/instructions`,
  `POST /v1/agent/instructions/:id/(pause|resume|remove)`; Fold insights may
  carry `origin` and `sent`; Herding lists watch tasks (`source: "watch"`).
- Venue `across` (adapter `bridge-across`) and its position reader.

- Leashes: `POST /v1/leashes`, `GET /v1/leashes`, `GET /v1/leashes/templates`,
  `GET /v1/leashes/:id`, `GET /v1/leashes/:id/trail`,
  `POST /v1/leashes/:id/(session|revoke|renew|plan|submit)`
  ([leashes.md](leashes.md)).
- Leash keys (`lk_leash_live_`, `lk_leash_test_`): one leash's routes and MCP only.
- Webhook events `leash.budget.threshold`, `leash.expiring`, `leash.revoked`,
  `leash.denied`.
- Error codes `LEASH_DENIED` (422), `LEASH_KEY_SCOPE`, `LEASH_REVOKED`,
  `LEASH_EXPIRED` (403), `INVALID_LEASH` (400).
- Gateway leashes (Stile): `POST /v1/leashes` takes `spendFrom` (`"arc"`, the
  default, or `"gateway"`), `destinations` and `maxGatewayFeeUsd`; the
  response may carry `stile` (with `deployment`, a creation without `to`) and
  `session: null`. `POST /v1/leashes/:id/plan` takes `forward`; for a Gateway
  leash `intent` is null and `prepared.gateway` holds the burn intents, the
  digest and the signature. Submit answers `gateway` (transfer id,
  attestation, unsigned `gatewayMint`); trail items may carry `gateway`;
  revoke answers `more` (pause, `removeDelegate`). `GET /v1/leashes/templates`
  answers `gateway` (availability per environment, destinations, ceilings).
  New deny codes `leash.gateway.*` and `leash.stile.*`; `NOT_AVAILABLE` (409)
  while `LYKIA_STILE` is off ([../stile.md](../stile.md)).

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
