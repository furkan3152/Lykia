# Leash (`lykia.leash/v1`)

A leash is a budget an outside agent cannot exceed. It is for agents that
run outside Lykia: your own backend, an MCP client, a LangGraph graph, a
bot. In one call the owner says: this agent may spend up to $X per step and
$Y a day, $Z in total, until a date, only on these venues or to these
payees, with this slippage, and I can cut it off at once.

A leash is not a new kind of wallet. It is built from parts Lykia already
has, composed so that each limit is held where it can be held:

| Part | What it gives the leash |
|---|---|
| A Pack agent ([pack.md](pack.md)) | A Fence that is a strict subset of its parent's (`intersectFence`, then `subFenceViolations`), and a daily budget carved out of the parent's (`carveBudget`). |
| A LykiaAccount session | The on-chain limits: per-token caps per call, per day and over the session's life, the payee list, call rules, an expiry, a call budget and the Fence hash. `createSession` from the owner, or `createSubSession` from a parent agent's session key. |
| A leash key | An API key (`lk_leash_live_…` / `lk_leash_test_…`) that works for this leash and nothing else, and dies with it. |
| The Fence ([fence.md](fence.md)) | Dollar caps, venues, slippage, Scent and the mainnet beta cap, checked on every plan. |
| The Arc Memo verdict digest | Every call the agent makes carries a memo with the intent, the step and the first 16 hex characters of the Fence verdict that allowed it. |
| An optional Tag ([tag.md](tag.md)) | An ERC-8004 registration that pins the leash's Fence hash. |
| MCP | With a leash key, `/v1/mcp` offers only the leash's tools. |

**Spend from.** A leash spends from the owner's LykiaAccount on Arc (the
default, everything below) or, with `"spendFrom": "gateway"`, from the
owner's Circle Gateway balance through the owner's own LykiaStile, an
ERC-1271 contract that Gateway asks before every transfer. Same endpoints,
limits, Revoke and trail; see [stile.md](stile.md).

## Templates

| Template | Step kinds | Tokens | Where | Slippage |
|---|---|---|---|---|
| `pay-invoices` | transfer | USDC, EURC | named payees only (at least one), plus the owner | 0 |
| `trade-small` | swap, fx | USDC, EURC | Uniswap v3, Archery, Unitflow V3 | at most 0.5% |
| `earn` | deposit, withdraw, supply | USDC, EURC | Morpho vaults (and their curators), Aave V4 | at most 0.1% |
| `custom` | your Fence | your Fence | your Fence, narrowed to the leash | your Fence, at most 3% |

`trade-small` only uses DEXs whose swap call takes the recipient at a fixed
ABI word, so the session can pin the output to the account
(`receiverWords`). Uniswap v4's UniversalRouter, Aerodrome's router, Sushi's
route processor, Relay, Across and LykiaRouter splits carry the recipient inside
dynamic bytes or send it elsewhere; a session cannot check that, so a
leash never routes through them. Session caps exist for stablecoins only
(USDC, and EURC converted at the Chainlink reference rate when the leash is
made), which is why the templates trade and earn in USDC and EURC.

## What the chain enforces and what the API enforces

LykiaAccount counts **token units**, not dollars. It does not know prices,
slippage or venue names. The split is exact:

| Limit | Enforced by | How |
|---|---|---|
| Expiry | chain and API | The account refuses every call after `validUntil`; the API stops the key at `expiresAt`. |
| Per-step cap | chain and API | On chain: `perCall` in token units per token. At the API: USD per step (`caps.perStepUsd`). |
| Daily cap | chain and API | On chain: `daily` in token units over a rolling 24 h window (6 h buckets). At the API: USD per UTC day (`caps.dailyUsd`). |
| Total budget | chain and API | On chain: `budget` in token units over the session's life, charged to the session and every ancestor. At the API: USD over the leash's life. |
| Payees | chain and API | On chain: `agentTransfer` only to the session's recipients or the owner. At the API: the Fence's recipient allowlist. |
| Contracts and functions | chain | `agentExecute` only on `(target, selector)` call rules, each pinning its output argument to the account. `approve`, `transfer`, `transferFrom`, `permit` and the other value-moving selectors can never be allowlisted; the account approves `spendAmount` itself and resets the allowance after the call. |
| Number of calls | chain | `maxCalls` on the session, counted on every node of the session chain. |
| Revocation | chain and API | The API disables the key the moment the owner revokes. `revokeSession` ends the session, and every sub-session under it, once signed. |
| USD valuation, beta cap | API | Dollar amounts, prices and the mainnet beta cap are checked by the Fence. |
| Venues | API | The Fence's venue list and the router's choice. On chain only the call rules exist, and they are derived from these venues. |
| Slippage | API | `limits.maxSlippageBps` sets the minimum output in the calldata the agent receives. |
| Scent, schedule, step count | API | Fence rules evaluated on every plan. |

Every on-chain spend is charged up the whole session chain. A leash carved
from a Pack agent's session (`createSubSession`) can never spend more than
that agent's session, and siblings share the parent's caps.

The per-call cap applies to each call: a payment and Lykia's 1% fee are two
`agentTransfer` calls. At the API the fee counts toward the step's dollar
value, so the API's per-step check is the stricter one.

## Creating a leash

`POST /v1/leashes` takes the owner's Lykia-Session, or a secret key with
the `agents` scope that may act for the owner (its own developer, or an
owner who granted its project consent). It returns:

- the leash, `pending` until the session lands on chain;
- `transactions`: `createAccount` on the deployed LykiaAccountFactory when
  the owner has no account yet, then the session transaction;
- `apiKey.secret`, the leash key, shown once;
- `mcp`, a ready MCP config with the key in its headers;
- `tag`, an unsigned ERC-8004 registration when `tag: true`;
- `enforcement`, the table above.

The agent's own address (`agent.signer`) becomes the session key. Lykia never
sees its private key: `lykia leash create` and the Fold make one locally and
show it once.

Who signs the session transaction:

- a **root leash** (`agent: { … }`): the owner's wallet, `createSession`;
- a leash carved from a **Pack agent with an on-chain session**
  (`parentAgentId`): that agent's session key, `createSubSession`. The
  account refuses a sub-session that is not inside its parent (expiry,
  remaining calls, per-call and daily caps, remaining budget, call rules,
  payees).

A leash carved from a Pack agent without a session gets its own root
session from the owner; its Fence and daily budget still come out of the
agent's.

Where the budget comes from: a leash under a Pack agent is carved from that
agent's caps (`carveBudget`). A root leash is carved from the owner's own
Fence: all of an owner's live root leashes together can never hold more
daily budget than the owner's Fence allows. A root leash's Fence must also
sit inside the template's ceiling, which on mainnet includes the beta cap.
Asking for more than the parent allows is an error, never a silent clamp.

After the owner signs, `POST /v1/leashes/:id/session` with the transaction
hash binds the session from its `SessionCreated` event (key, Fence hash and
parent must match). Without a hash, the API checks the session ids issued
since the leash was made.

## Inside a leash

The leash key can call exactly these routes, and MCP:

| Route | What it does |
|---|---|
| `GET /v1/leashes/:id` | The leash and its usage. |
| `GET /v1/leashes/:id/trail` | Every action under the leash. |
| `POST /v1/leashes/:id/plan` | Plan a sentence or actions inside the leash. |
| `POST /v1/leashes/:id/submit` | Report the hash of a signed step. |

Anything else, including creating, renewing, revoking or widening a leash,
another leash, the Pack or any other owner's data, is `403 LEASH_KEY_SCOPE`.
The leash key never passes as its owner on any other route.

A plan goes through, in order: the leash must be alive (not revoked,
expired or paused, its session on chain and valid); the planner runs under
the leash's Fence with the leash's own spend today, routing only through the
leash's venues; the plan must fit the leash's remaining day and total;
each input token must have a session cap and fit `spendable()` on chain;
the step's calls are wrapped into `agentTransfer` / `agentExecute`; every
`agentExecute` must match a session call rule and every payee must be on the
session's list (read from the account); and the step is simulated with
`eth_call` from the session key. Only then does the first step come back:
one transaction from the session key, either a single call on the account
or a Multicall3From batch that keeps the key as `msg.sender` for each call.

Outside the leash the answer is `422 LEASH_DENIED`:

```json
{ "error": { "code": "LEASH_DENIED", "message": "…",
  "details": { "leashId": "lsh_…",
    "reasons": [ { "code": "fence.caps.step", "message": "…", "stepId": "s1" },
                 { "code": "leash.chain.spendable", "message": "The account lets this session spend 20 USDC right now; this plan needs 30.3." } ],
    "remaining": { "stepUsd": "20.00", "dayUsd": "20.00", "totalUsd": "140.00" },
    "verdictDigest": "sha256:…", "intentId": "out_…" } } }
```

Reason codes are the Fence's rules as `fence.<rule>` (`fence.caps.step`,
`fence.venues`, `fence.recipients`, …) and the leash's own:
`leash.revoked`, `leash.expired`, `leash.session.pending`,
`leash.session.invalid`, `leash.budget.day`, `leash.budget.total`,
`leash.chain.spendable`, `leash.chain.unreadable`, `leash.chain.revert`,
`leash.token.not-in-session`, `leash.call.not-in-session`,
`leash.recipient.not-in-session`, `leash.needs-owner`, `leash.unpriced`,
`leash.venue.none`, `leash.not-understood`.

It fails closed: when the account cannot be read, or the simulation does not
run, nothing is prepared.

## Usage

`GET /v1/leashes/:id` reads the session on chain: `getLimit()` for each
token (spent in the rolling 24 h window and over the session's life) and
`spendable()`, the tightest cap on the whole session chain right now. The
chain is authoritative: the dollar windows show the larger of the chain's
count (EURC at today's reference rate) and Lykia's own record, so spending
the session key did outside Lykia still shows.

## The trail

`GET /v1/leashes/:id/trail` lists every plan, refusal and transaction. Each
item with a transaction is checked against its receipt: it is
**chain-proven** when the receipt succeeded, carries `AgentCall` or
`AgentTransfer` for this session, and its `AgentMemo` names the same
intent, step and verdict. Arc's Memo contract only accepts EOA callers, so
the account emits `AgentMemo` itself. Session events in recent blocks that
Lykia has no record of (the session key acted directly) are listed as
`source: "chain"`.

## Revocation, expiry and renewal

- **Revoke** (`POST /v1/leashes/:id/revoke`): the key stops at the API on
  the very next request, the Pack agent and every leash under it are
  revoked, and the carve returns to the parent. The response carries the
  unsigned `revokeSession(id)` for the owner's wallet; once signed, the
  session and every sub-session under it end on chain. Until that
  transaction lands, the session key could still call the account directly
  within its on-chain caps; sign it promptly. `revokeAll()` on the account
  ends every session at once, and the Whistle (`blowWhistle()`) lets only
  homeward moves through.
- **Expiry**: at `expiresAt` the key stops, the Pack agent is revoked and the
  carve returns. On chain the session stops at `validUntil`, the same
  moment. `leash.expiring` fires 24 hours before.
- **Renew** (`POST /v1/leashes/:id/renew`): a new leash with a new carve, a
  new session transaction and a new key; the old one is revoked. A leash is
  never widened in place.

## Webhooks

| Event | When |
|---|---|
| `leash.budget.threshold` | The day's or the total budget crosses 50, 80 or 100%, once per window. |
| `leash.expiring` | 24 hours before expiry. |
| `leash.revoked` | The owner revoked it (or its Pack agent); the key is already dead. |
| `leash.denied` | A plan was refused; the reasons and the remaining budget are included. |

## Threat model

| If … | then … |
|---|---|
| the leash key leaks | It can plan and submit inside this leash only. Revoke it; the key dies at once. It cannot reach any other route or owner. |
| the agent's session key leaks or the agent misbehaves | The account still holds the token caps, payees, call rules, expiry and call count. It does **not** hold slippage, dollar valuation, schedules or Scent: a session key calling the account directly could, for example, swap within its caps at a bad price on an allowed router. Revoke, then sign `revokeSession`. |
| Lykia's API is down or wrong | The account's limits do not depend on Lykia. The worst case on chain is what the session's caps allow. |
| the owner's Fence is tighter than the leash asks | Creation fails with the violations; the leash is never silently clamped. |
| a parent agent is revoked | Every leash carved from it is revoked; on chain, revoking the parent session ends its sub-sessions. |

## Limits

- At most 25 live leashes per owner, 25 payees per leash, 90 days.
- `perStepUsd ≤ perDayUsd ≤ totalUsd`, the same order LykiaAccount requires
  for `perCall ≤ daily ≤ budget`.
- On chain a root session can have sub-sessions at most three levels below it
  (`MAX_DEPTH` is 3); the Pack is at most four levels deep.
- The contracts are not audited. On mainnet the beta cap sits above every
  leash.

## From Ask Lyko

"Give my bot $20 a day for a week to pay invoices" compiles into a budget
element with `days: 7` and `leash: "pay-invoices"`, which becomes a leash
draft. The answer links to the Fold's Pack tab with the New leash sheet
prefilled (`/app/fold/pack?leash=…`); nothing is created until the owner
reviews it, names the payees and signs.

## Evidence on Arc mainnet

`npm run prove:leash -w @lykia/api` runs the exact calldata the API builds
against the deployed LykiaAccountFactory
(`0x810e8db89f4c4e8fa814ed3ed0d636d3416dd7f9`) with `eth_call` through
Multicall3From from the owner. The only state override is the owner's
native USDC balance. No account had been created from the mainnet factory
yet, so each run creates the owner's account inside the simulation with the
factory's own `createAccount`, at the address the factory predicts.

Run of 2026-11-08 at block 30186744 (owner
`0xada5bb90d0de0bd1b6f3938708f49295a8d1f7cb`, account
`0x437E6d21573D33dEeFDFF13653EcA9E516156b06`, a pay-invoices leash of $25 a
step, $50 a day, $100 in total):

| Call | Result |
|---|---|
| `createAccount` (the API's first transaction) | account `0x437E…6b06` |
| `createSession` (the API's session transaction: USDC 25/50/100, EURC 22.449087/44.898175/89.79635, payees: the payee and the fee recipient, no call rules) | session `0xde4e…cc78` |
| `spendable(session, USDC)` | 25000000 |
| `agentTransferWithSig` 20 USDC to the payee | success |
| `agentTransferWithSig` 30 USDC | reverted `PerCallCapExceeded(USDC, 30000000, 25000000)` |
| `agentTransferWithSig` 25 USDC | success (45 of 50 today) |
| `agentTransferWithSig` 10 USDC | reverted `DailyCapExceeded(USDC, 55000000, 50000000)` |
| `spendable(session, USDC)` | 5000000 |
| `revokeSession` (the API's revoke transaction) | success |
| `isSessionValid`, `spendable`, `getSession` | false, 0, `revoked: true` |
| `agentTransferWithSig` 1 USDC after revocation | reverted `SessionInvalid(0xde4e…cc78)` |
| `createSession` for a parent agent, then `createSubSession` (the API's transaction for a leash under it) | sub-session `0x779a…303d`, depth 1 |
| `agentTransferWithSig` 20 USDC, then 30 USDC | success, then `PerCallCapExceeded(USDC, 30000000, 25000000)` |
| `revokeSession` of the sub-session from the owner, then a 1 USDC transfer | success; `isSessionValid` false, `spendable` 0, then `SessionInvalid(0x779a…303d)` |

In the sub-session batch the parent session's key is Multicall3
(`0xcA11…CA11`), a contract that calls with itself as `msg.sender`, so the
`createSubSession` calldata reaches the account from the parent key inside
the same `eth_call`. In production the parent key is the parent agent's own
address; the calldata is the same. The API reads the parent's session on chain
before it builds a sub-session; since that session exists only inside the
simulation, the script answers that one read with the session the batch
creates.
