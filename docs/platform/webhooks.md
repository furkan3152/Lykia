# Webhooks and events

## The catalogue

`GET /v1/webhooks/events` lists every event type. Built in:

| Group | Events |
|---|---|
| intents | `intent.planned`, `intent.settled`, `step.prepared`, `step.settled`, `step.failed` |
| agents | `agent.spawned`, `agent.revoked`, `agent.whistle`, `leash.budget.threshold`, `leash.expiring`, `leash.revoked`, `leash.denied`, `autopilot.signed`, `autopilot.paused`, `autopilot.stopped` |
| automation | `standing.fired`, `order.filled`, `alert.fired` |
| payouts | `payout.created`, `payout.sent`, `payout.failed`, `invoice.created`, `invoice.paid` |
| security | `security.blocked` |
| platform | `key.rotated`, `test.ping` |

Older names still subscribe to the same events (`intent.step.settled`,
`whistle.blown`, `order.executed`, `pack.agent.spawned`, …). Modules may add
types at runtime with `registerEventTypes`.

## Endpoints

```http
POST  /v1/developers/webhooks        { "url": "https://example.com/lykia", "events": ["step.settled","payout.sent"], "projects": ["prj_…"] }
PATCH /v1/developers/webhooks/:id    { "events": [...] }
POST  /v1/developers/webhooks/:id/disable | enable | rotate-secret
```

The signing secret (`whsec_…`) is shown once. Endpoints must be https and
resolve to public addresses. Without `events` an endpoint gets every
catalogue event.

## Deliveries

Each delivery is a JSON POST:

```json
{ "id": "evt_…", "type": "step.settled", "event": "step.settled", "createdAt": "…",
  "owner": "0x…", "project": null, "livemode": true, "apiVersion": "2026-11-01", "data": { … } }
```

Headers: `Lykia-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`,
`Lykia-Event`, `Lykia-Event-Id`, `Lykia-Delivery-Id`, `Lykia-Webhook-Attempt`.
Answer any 2xx within 10 s. Deduplicate on `Lykia-Event-Id`.

Failures are retried with exponential backoff: 30 s, 2 min, 10 min, 1 h,
6 h, then the delivery is marked failed. Retries are drained by a store
queue on ordinary API traffic, by `/cron/standing`, and by a timer on
long-running servers, so serverless hosts need no extra process.

| Route | Does |
|---|---|
| `GET /v1/developers/webhooks/deliveries?status=&endpointId=&event=` | Delivery log, newest first |
| `GET /v1/developers/webhooks/deliveries/:id` | Attempts (time, status, duration, error) and the body |
| `POST /v1/developers/webhooks/deliveries/:id/replay` | Send again, same event id |
| `POST /v1/developers/webhooks/test` `{ endpointId?, type? }` | A test event, whatever the subscription |
| `GET /v1/events`, `GET /v1/events/:id` | The event feed (30 days) |

## Verify

```ts
import { constructEvent } from "@lykia/sdk";
const event = await constructEvent(secret, rawBody, req.headers["lykia-signature"]);
```

```python
from lykia import construct_event
event = construct_event(secret, request.body, request.headers["Lykia-Signature"])
```

Reject timestamps older than five minutes (both helpers do). Always verify
the raw body, not re-serialized JSON.

## Local development

`lykia webhooks listen --forward-to http://localhost:3000/hooks` polls your
event feed and forwards each new event to your machine, signed with a
session secret it prints at start.

## Emitting events (module authors)

```ts
import { emitEvent } from "../platform/events.js";

await emitEvent("payout.sent", { payoutId, amount, token: "USDC" }, { owner, ctx });
await emitEvent("invoice.paid", { invoiceId }, { project: "prj_…", ctx });
```

`emitEvent` stores the event in the owner's feed (the project owner's for
project events), delivers it to every subscribed endpoint and the project's
own webhook, and never throws. `livemode` is false when `data.environment`
is `"testnet"` unless given.
