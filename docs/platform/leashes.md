# Leashes API

A leash gives an outside agent a budget it cannot exceed. The concept, the
split between what LykiaAccount enforces on chain and what the API
enforces, the threat model and a mainnet simulation are in
[../leash.md](../leash.md). This page is the API reference.

| Route | Who | What |
|---|---|---|
| `GET /v1/leashes/templates` | anyone | Templates (`pay-invoices`, `trade-small`, `earn`, `custom`), the enforcement table and the limits. |
| `POST /v1/leashes` | owner | Create. Returns the leash, `transactions` (sign in order), `session`, `apiKey` (shown once), `mcp`, `tag`, `enforcement`, `notes`. |
| `GET /v1/leashes?owner&environment` | owner | Every leash with live usage. |
| `GET /v1/leashes/:id` | owner or leash key | One leash, its usage and its last actions. |
| `GET /v1/leashes/:id/trail` | owner or leash key | Every action, each with `chainProven` and `source`. |
| `POST /v1/leashes/:id/session` | owner | `{ txHash? }`: bind the session from its `SessionCreated` event, or find it. |
| `POST /v1/leashes/:id/revoke` | owner | The key stops now. Returns `transaction` (`revokeSession`, from the owner) or `null` when nothing is on chain yet. |
| `POST /v1/leashes/:id/renew` | owner | `{ expiresAt, budget?, recipients?, venues?, signer? }`: a new leash; the old one is revoked. |
| `POST /v1/leashes/:id/plan` | leash key (or owner) | `{ text }` or `{ actions }`, `dryRun?`. Inside: `intent` and `prepared` (one transaction for the session key). Outside: `422 LEASH_DENIED`. |
| `POST /v1/leashes/:id/submit` | leash key (or owner) | `{ intentId, stepId, hash }`. Returns `status`, `chainProven`, `next` (the next step, prepared) and `usage`. |

"Owner" is a Lykia-Session for the owner, or a secret key with the `agents`
scope that may act for the owner (its own developer, or an owner who
granted the key's project consent). A leash key never counts as the owner.

## Create

```json
POST /v1/leashes
{
  "environment": "mainnet",
  "agent": { "name": "Invoice bot", "mission": "Pay the hosting invoices.", "signer": "0x…agent's own address…" },
  "template": "pay-invoices",
  "budget": { "perStepUsd": "20", "perDayUsd": "20", "totalUsd": "140" },
  "expiresAt": "2026-11-15T00:00:00Z",
  "recipients": ["0x…payee…"],
  "tools": ["plan", "submit", "status", "trail"],
  "tag": false
}
```

For a sub-agent of a Pack agent, send `parentAgentId`, `name` and `signer`
instead of `agent`. Optional: `venues` (a subset of the template's),
`maxSlippageBps`, `maxCalls` (default 200), `fence` with `template: "custom"`.
`owner` defaults to the signed-in address or the key's own developer.

Errors: `400 INVALID_LEASH` (with `issues`), `422 SUB_FENCE_VIOLATION`
(the leash asks for more than its parent or the template's ceiling,
including the mainnet beta cap; with `violations`), `422 BUDGET_EXCEEDED`
(the parent's daily budget is carved out; with `free`), `409 LIMIT_REACHED`,
`503 UNPRICED` and `503 CHAIN_UNAVAILABLE` (nothing was made).

## Usage

```json
"usage": {
  "source": "chain", "block": "30186744", "sessionValid": true,
  "day":   { "spentUsd": "10.10", "capUsd": "20.00", "remainingUsd": "9.90", "share": 0.505 },
  "total": { "spentUsd": "10.10", "capUsd": "140.00", "remainingUsd": "129.90", "share": 0.0721 },
  "tokens": [ { "symbol": "USDC", "perCall": "20000000", "daily": "20000000", "budget": "140000000",
                "dayUsed": "10100000", "consumed": "10100000", "spendable": "9900000" } ],
  "calls": { "used": 2, "max": 200 }, "secondsLeft": 561600
}
```

`spendable` is `spendable(sessionId, token)` on the LykiaAccount: the
tightest cap on the whole session chain right now. `source: "store"` means
the session is not on chain yet or the account could not be read.

## Plan and submit

The prepared step:

```json
"prepared": {
  "intentId": "out_…", "stepId": "s1",
  "transaction": { "chainId": 5042, "from": "0x…session key…", "to": "0x…account or Multicall3From…", "data": "0x…", "value": "0" },
  "calls": [ { "kind": "agentTransfer", "target": "0x…account…", "token": "0x3600…", "to": "0x…payee…", "amount": "12000000" },
             { "kind": "agentTransfer", "target": "0x…account…", "token": "0x3600…", "to": "0x…fee recipient…", "amount": "120000" } ],
  "memo": "lykia:1:out_…:s1:0123456789abcdef",
  "simulated": true
}
```

The session key signs and sends `transaction`, then reports the hash to
`/submit`. The hash must be exactly the prepared transaction (sender,
target, data and value).

Refusals are `422 LEASH_DENIED` with `details.reasons[]` (`code`, `message`,
`stepId?`), `details.remaining` (`stepUsd`, `dayUsd`, `totalUsd`),
`verdictDigest` and `intentId`. The codes are listed in
[../leash.md](../leash.md#inside-a-leash).

## Keys and MCP

A leash key (`lk_leash_live_…`, `lk_leash_test_…` for testnet) reaches
`GET /v1/leashes/:id`, `GET /v1/leashes/:id/trail`,
`POST /v1/leashes/:id/plan`, `POST /v1/leashes/:id/submit` and `/v1/mcp`.
Anything else is `403 LEASH_KEY_SCOPE`. After revocation the key is unknown
(`401`). After expiry it is `403 LEASH_EXPIRED`, and `401` once the expiry
sweep has revoked it. It counts toward the owner's plan
quota like any key and is listed with the owner's keys.

With a leash key, `/v1/mcp` lists only the leash's tools: `leash_status`,
`leash_plan`, `leash_submit`, and when the leash allows them `leash_trail`,
`lykia_venues` and `lykia_scent`. A refusal is the tool's result with
`isError: true` and the same `LEASH_DENIED` details.

## Webhooks

`leash.budget.threshold` (`window`, `threshold`, `spentUsd`, `capUsd`,
`remainingUsd`), `leash.expiring` (`expiresAt`, `hoursLeft`),
`leash.revoked` (`reason`, `keyDisabled`, `revokeTransaction`) and
`leash.denied` (`reasons`, `remaining`, `intentId`, `verdictDigest`). Each
carries `leashId`, `agentId` and `environment`.
