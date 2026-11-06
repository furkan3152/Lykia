# Lykia API: from a skyscraper to an ant

Lykia turns money moves on Arc Network into API calls. A sentence becomes a
plan, the plan is checked against a Fence, and every step comes back
unsigned for the owner's wallet. The server never holds user keys. Built on Arc
Network and Circle's rails.

The same API serves a weekend script and a bank's payout system. You climb
only as far as you need.

## The ant: one line

```sh
curl -s "https://lykia-api-akdogan1.vercel.app/v1/venues?environment=testnet"
```

Public reads need no key. Add a key when you want your own limits, logs and
webhooks.

## A small app: a test key and a plan

1. Sign in on `/build` with your wallet and press **Become a developer**.
2. On the **Keys** tab create a **test** key (`lk_test_…`). It only reaches
   Arc testnet and is never billed.
3. Plan something:

```sh
curl -s https://lykia-api-akdogan1.vercel.app/v1/intents \
  -H "Lykia-Key: $LYKIA_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"owner":"0xYourWallet","text":"send 5 USDC to 0xFriend","dryRun":true}'
```

Or with an SDK:

```ts
import { Lykia } from "@lykia/sdk";
const lykia = new Lykia({ apiKey: process.env.LYKIA_KEY, environment: "testnet" });
const { intent } = await lykia.intents.create({ owner, text: "send 5 USDC to 0xFriend" });
```

```python
from lykia import Lykia
lykia = Lykia(os.environ["LYKIA_KEY"], base_url="https://lykia-api-akdogan1.vercel.app", environment="testnet")
plan = lykia.intents.create(owner, "send 5 USDC to 0xFriend")
```

## A product: live keys, webhooks and logs

- Create a **live** key (`lk_live_…`) with only the scopes the server needs
  ([keys-and-scopes.md](keys-and-scopes.md)), and an IP allowlist.
- Add a webhook endpoint and verify every delivery
  ([webhooks.md](webhooks.md)).
- Send `Idempotency-Key` on every POST ([idempotency.md](idempotency.md)).
- Watch the **Logs** and **Usage** tabs, or `lykia logs tail`
  ([cli.md](cli.md)).

## A platform: projects, versions and billing

- White-label projects carry your brand, origins, modules and a default
  Fence ([projects.md](projects.md)); each project has its own rate limits.
- Pin a `Lykia-Version` so upgrades are deliberate ([versioning.md](versioning.md)).
- Move to **Pay as you go**: usage above the free quota is paid in USDC on
  Arc, per call over x402 or from prepaid credits ([billing.md](billing.md)).

## The skyscraper: enterprise

Custom limits and retention on the Enterprise plan, per-project limits, key
rotation with overlap windows, IP allowlists, signed webhooks with replay,
an event feed, request logs queryable by request id, and the full OpenAPI
3.1 document for code generation.

## Reference

| Topic | Page |
|---|---|
| Authentication | [authentication.md](authentication.md) |
| Keys and scopes | [keys-and-scopes.md](keys-and-scopes.md) |
| Idempotency | [idempotency.md](idempotency.md) |
| Webhooks and events | [webhooks.md](webhooks.md) |
| Errors | [errors.md](errors.md) |
| Rate limits and quotas | [rate-limits.md](rate-limits.md) |
| Versioning and changelog | [versioning.md](versioning.md), [changelog.md](changelog.md) |
| Plans and billing | [billing.md](billing.md) |
| SDKs (TypeScript, Python) | [sdks.md](sdks.md) |
| CLI | [cli.md](cli.md) |
| OpenAPI | `GET /v1/openapi.json`, `GET /v1/reference`, [openapi.json](openapi.json), [Postman collection](lykia.postman_collection.json) |
