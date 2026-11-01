# Automations

One API for Lykia's triggers. An automation has a **trigger** and an
**action**.

| Trigger | |
|---|---|
| `price` | A Chainlink feed on Arc above or below a value (`EURC/USD`, `BTC/USD`, ...). |
| `schedule` | Every day, week (with `weekday`) or month (with `day`) at `HH:MM` in a time zone. |
| `balance` | A token balance of the owner (or `address`) above or below a value. |
| `event` | `payout.created`, `payout.settled`, `payout.failed`, `invoice.created`, `invoice.paid`. |

| Action | |
|---|---|
| `plan` | Plan `actions` (or a `sentence`) under the automation's Fence. The result is an intent the owner signs; nothing executes by itself. |
| `notify` | Fire `automation.fired` to your webhooks. |

`price` or `schedule` with `plan` is backed by a standing order (the same
engine as `/v1/standing`); the others run in Lykia's reconciliation pass or
on the event itself. Each automation fires at most `maxFiresPerDay` times
(1 by default, 24 at most). On Vercel, `/cron/standing` drives both.

Standing orders, alerts, agent automations and LykiaOrders keep their own
routes. `GET /v1/automations?owner=0x…` lists them beside unified
automations, and pause, resume and delete work on standing orders, alerts
and agent automations too (LykiaOrders are cancelled with a signed
transaction).

## Routes

| Route | |
|---|---|
| `POST /v1/automations` | Create (scope `automation`). |
| `GET /v1/automations` · `GET /v1/automations/:id` | List (with `?owner=` for the older objects), read. |
| `POST /v1/automations/:id/pause` · `/resume` | Pause or resume (`?owner=` for alerts). |
| `DELETE /v1/automations/:id` | Delete. |

## curl

```sh
curl -X POST https://<api>/v1/automations -H "Lykia-Key: lk_live_…" -H "content-type: application/json" \
  -d '{ "owner": "0xOwner…", "name": "Friday top-up",
        "trigger": { "type": "schedule", "every": "week", "weekday": "fri", "at": "10:00", "timezone": "Europe/Istanbul" },
        "action": { "type": "plan", "actions": [{ "verb": "send", "token": "USDC", "amount": { "exact": "50" }, "to": "0xOwner…" }] } }'
```

## SDK

```ts
await lykia.automations.create({ owner, name: "Cash alert", trigger: { type: "balance", token: "USDC", op: "below", value: "500" }, action: { type: "notify", channel: "webhook" } });
const { entries } = await lykia.automations.list(owner);
```
