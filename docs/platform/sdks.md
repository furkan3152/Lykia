# SDKs

## TypeScript: `@lykia/sdk`

```ts
import { Lykia, constructEvent } from "@lykia/sdk";

const lykia = new Lykia({ baseUrl, apiKey: process.env.LYKIA_KEY, apiVersion: "2026-11-01" });
await lykia.intents.create({ owner, text: "swap 100 USDC to EURC" });
await lykia.platform.keys.rotate(keyId, 3600);
for await (const entry of lykia.platform.logs.all({ statusClass: "error" })) console.log(entry.requestId);
```

- Modular imports keep working: `@lykia/sdk/intents`, `/fence`, `/agents`,
  `/circle`, `/ecosystem`, `/projects`, `/webhooks`, plus `/platform`
  (keys, webhooks, events, logs, billing) and `/operations`.
- `operations(transport).call("postIntents", { body })` calls any documented
  route by operationId, typed from the generated table in
  `src/generated/openapi.ts`.
- Retries 429/502/503/504 honouring `Retry-After`, one Idempotency-Key per
  logical POST, typed errors (`LykiaError` with `code`, `status`, `requestId`).
- `constructEvent` / `verifyWebhook` check `Lykia-Signature`.

## Python: `lykia` (sdks/python)

```python
from lykia import Lykia, construct_event

with Lykia(os.environ["LYKIA_KEY"], base_url=BASE, api_version="2026-11-01") as lykia:
    plan = lykia.intents.create(owner, "send 5 USDC to alice", environment="testnet")
    for entry in lykia.logs.iterate(statusClass="error"):
        print(entry["requestId"])
    lykia.call("getVenues", query={"environment": "testnet"})
```

Typed (`py.typed`), built on httpx, sync `Lykia` and async `AsyncLykia`,
retries with backoff, idempotency keys, cursor pagination, and
`construct_event` / `verify` for webhooks. Tests run offline:

```sh
cd sdks/python && pip install -e '.[test]' && pytest
```

## Regenerating from OpenAPI

```sh
npm run openapi -w @lykia/api
```

writes `docs/platform/openapi.json`, the SDK operation table, the Python
operation table and the Postman collection
(`docs/platform/lykia.postman_collection.json`; Bruno imports it too).
