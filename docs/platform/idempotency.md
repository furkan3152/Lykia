# Idempotency

Send `Idempotency-Key: <8 to 128 of A-Z a-z 0-9 _ - . :>` on any POST.

- The first request claims the key for 24 hours.
- A retry with the same key and the same body gets the stored answer and
  `Idempotent-Replayed: true`. Nothing runs twice.
- The same key with a different body is `409 IDEMPOTENCY_CONFLICT`.
- While the first request is still running, a retry is also `409`.
- 5xx answers are not stored, so a failed attempt can be retried with the
  same key.
- Keys are scoped to your credentials and the path.

Every POST under `/v1` is covered, except sign-in, MCP, the agent chat stream
and callbacks. The SDKs send a fresh key per logical call and reuse it on
retries.

## For module authors

The router applies this to every POST automatically. A route that must never
run without a key opts in:

```ts
import { idempotent } from "../http/idempotency.js";

router.post("/payouts", idempotent(ctx, { required: true }), async (req, res) => { ... });
```

`idempotent()` is safe to combine with the router-level middleware (a request
is handled once) and also works on apps mounted outside `/v1`. Without the
header a required route answers `400 IDEMPOTENCY_KEY_REQUIRED`.
