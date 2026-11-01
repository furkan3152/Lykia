# Security layer (`lykia.security/v1`)

Lykia puts six checks between a plan and the owner's wallet. The **Security
center** (`/app/security`) shows all six in one place. Every check follows three
rules:

- **Fail closed.** An outflow the layer cannot explain is a block, never a
  warning.
- **Explainable.** Each finding is one plain English sentence with a stable
  rule id.
- **Tested.** Core rules are covered in `packages/core/test/security.test.mjs`,
  the API in `apps/api/src/security/__tests__` and the web in
  `apps/web/src/features/security/__tests__`.

Moves that bring value home (repay, withdraw) follow the same rule as the
Whistle. Breakers, pauses and monitor limits only warn on them.

## Where it runs

| Hook | Called from | What it does |
|---|---|---|
| `securityPreflight(ctx, { intentId, stepId, prepared })` | `POST /v1/intents/:id/steps/:sid/prepare` (`modules/intents.ts`) | Runs layers 1 to 5. On a block it throws `409 SECURITY_BLOCKED` with the full report in `details.security`. Otherwise the report rides on the response as `security`. |
| `securityPostflight(ctx, { intentId, stepId, result, references })` | `POST /v1/intents/:id/steps/:sid/submit` | Writes the audit entry, records the activity for the monitor and learns the recipient once a payment goes through. It never throws. |

Prepare is the only place calls leave the API. That makes it the signing gate:
nothing reaches a wallet without passing preflight.

## Layer 1: pre-sign simulation and balance diff

Code: `packages/core/src/security/diff.ts`, `apps/api/src/security/decode.ts`
and `apps/api/src/security/simulate.ts`.

**Decoding.** Multicall3From batches and Arc Memo wrappers are unwrapped, and
every leaf call is classified:

- ERC-20 `transfer`, `approve`, `increaseAllowance` and `transferFrom`
- Permit and Permit2 `approve`
- `setApprovalForAll`
- native value
- venue calls, with every receiver their ABI names (`receiver`, `recipient`,
  `onBehalfOf`, `mintRecipient`, `to`)

The decoder reads the engine's own ABIs, so a venue the engine learns is decoded
here too, with no second list to maintain.

**Diff against the plan.** Each of these blocks the step:

| Rule | What it refuses |
|---|---|
| `unexpected-transfer` | A transfer to anyone other than the plan's recipient, the owner or the quoted fee recipients. |
| `fee-overcharge` | A fee transfer above the quoted fee. |
| `outflow-exceeds-plan` | More of a token leaving the wallet than the inputs plus the fees. |
| `unlimited-approval` | Any approval of 2^255 or more. |
| `approval-exceeds-need` | An approval larger than the step spends. Repay-all may carry 0.1 % + 1000 units of headroom, which is a warning plus a reset. |
| `unknown-spender` | An approval to a contract the step never calls and Lykia does not list. |
| `transfer-from` | Any `transferFrom`. |
| `approval-for-all` | Any `setApprovalForAll(…, true)`. |
| `permit-exceeds-need` | A Permit or Permit2 signature above the step's need, or to an unknown spender. |
| `native-value` | Native value the plan did not send. |
| `changed-recipient` | A venue call that names a receiver other than the signer, the owner or the plan's recipient. |
| `unknown-contract` | A call to a contract that is not a registry venue, an Arc system contract, a verified Lykia deployment or a plan parameter. Recipient fields do not count as plan parameters here. |

**Simulation.** `eth_simulateV1` runs the step's transactions in order and traces
asset changes. When it is not available, `eth_call` runs a single transaction.

- A revert blocks the step.
- An RPC that cannot simulate gives a `simulation.unavailable` warning, and the
  decoded diff decides on its own.

**What you will sign.** `security.summary` carries one plain line per call, the
balance changes, the approvals (marked exact or not) and the contracts touched.
The route panel shows it under each step (`features/security/SecurityBlock.tsx`).

## Layer 2: address protection

Code: `packages/core/src/security/address.ts`, `packages/core/src/security/bytecode.ts`
and `apps/api/src/security/recipients.ts`.

**Look-alikes.** The recipient is compared with the owner's contacts and past
recipients, using the characters wallets show.

- 3 matching characters at both ends: a warning.
- 4 or more at both ends: a block.
- A look-alike that also sent the owner a zero-value transfer (USDC/EURC
  `Transfer` logs from the last 20k blocks) is a block: that is poisoning.

**Other recipient checks:**

- A first payment to a new recipient gets a warning.
- The USDC/EURC on-chain blocklist (`isBlacklisted`) is read, and a blocklisted
  recipient is blocked.
- Circle Compliance screening is reused: `DENIED` blocks and `REVIEW` warns.
- A recipient that is a contract, not a wallet, gets a warning.

**Contract Scent.** For contract recipients the bytecode is walked opcode by
opcode, skipping PUSH data. It flags:

- SELFDESTRUCT
- DELEGATECALL
- EIP-1167 minimal proxies
- EIP-7702 delegated accounts
- EIP-1967 implementation and admin slots
- unverified source and deployment age, when known

Contracts in the registry are reported as info only.

`POST /v1/security/check-address` runs the same checks on any address before a
payment.

## Layer 3: approval hygiene

- The diff verifies that every approval is exact. The only exception is the
  documented repay headroom.
- Any approval that could leave an allowance behind gets a ready-to-sign reset to
  zero in `security.cleanup`.
- `GET /v1/security/approvals` reuses the stale-approval scanner. Every leftover
  allowance to a registry venue comes with a one-tap revoke, shown in the
  Security center.
- Permit and Permit2 approvals are reviewed with the same rules as `approve`.

## Layer 4: agent safety monitor and audit log

Code: `packages/core/src/security/monitor.ts`, `packages/core/src/security/audit.ts`,
`apps/api/src/security/activity.ts` and `apps/api/src/security/audit.ts`.

**Subjects.** The subject is the agent address when an agent signs, and the
owner otherwise.

**Velocity limits block.** By default they are 6 moves per minute and $5,000 per
hour. The owner sets their own with `PUT /v1/security/policy`.

**Anomalies warn:**

- a spend above 5× the rolling average
- a venue never used before (once there is history)
- 3 new recipients within 10 minutes
- 3 failures within 15 minutes
- activity outside the owner's active hours

**Auto-Whistle.** An anomaly raises a security alert (`GET /v1/security/alerts`).
With `onAnomaly: "pause"`, an agent-signed session is also paused: the pause is
written, the step is blocked, and the owner resumes it with
`POST /v1/security/resume`. Owners can pause their own wallet or their own
agents with `POST /v1/security/pause`. Ownership is checked against the Pack.

**Audit log.** It is append-only and hash-chained, with one chain per owner and
one platform chain.

- Each entry's `hash` covers its sequence number, time, kind, actor, subject,
  data and the previous hash.
- Entries are created with compare-and-set on their sequence number, so a chain
  cannot fork.
- `verifyAuditChain` proves an exported page is intact.
- What gets recorded: prepare and blocked verdicts (with the report and Fence
  verdict digests), submits, pauses, resumes, halts and venue switches.
- `auditAppend` is exported for keepers.

## Layer 5: protocol circuit breakers

Code: `packages/core/src/security/breaker.ts` and `apps/api/src/security/breakers.ts`.

**Venue states.** Each registry venue gets one of three states:

- `healthy`
- `degraded`: a warning on the step
- `blocked`: the step is refused, unless it brings value home

**What feeds the state:**

- the global kill switch: feature flag `routing.halt`, set with
  `POST /v1/security/halt` (admin)
- the per-venue switch: `PUT /v1/security/venues/:id` (admin)
- Chainlink staleness, and the Chainlink vs Pyth gap for venues that price
  through oracles
- `paused()` read live from every contract the step calls
- `VenueHealthFacts` also accepts TVL drops, utilization and admin or upgrade
  events. Feeds for those can be added without changing the rules.

## Layer 6: platform hardening

| Check | Where |
|---|---|
| Helmet with CSP `default-src 'none'; frame-ancestors 'none'` on the API | `apps/api/src/app.ts` |
| Exact-origin CORS plus verified project origins; no wildcard, no credentials | `apps/api/src/http/cors.ts` |
| SIWE: single-use nonces, expiry, issuedAt window, domain binding | `apps/api/src/platform/siwe.ts`; replay is tested |
| Rate limits: prepare and submit on `heavy`; halt, venue switches, pause and resume on `auth` | modules |
| SSRF: user-supplied URLs go through the DNS-pinned public-address guard | `apps/api/src/http/netguard.ts`, `pinnedFetch.ts` |
| No secrets in responses: a test sets sentinel secrets and scans admin and public responses | `security.test.ts` |
| Web CSP: inline scripts allowed only by hash, framing refused except for `/embed/*` (which checks its parent itself), HSTS, nosniff | `apps/web/vercel.json`; a test keeps the hashes in sync with `index.html` |

### `npm audit --omit=dev` (2026-11-01)

- **API workspace:** 1 high. `zod@3.25.76` is affected by GHSA-mrhx-c7xc-m3w5,
  memory exhaustion on oversized constrained collections. It is mitigated by the
  256 KB body cap and the `.max()` on every array schema. The fix is the zod 4
  major upgrade.
- **Whole tree:** 47 findings (33 high, 0 critical), all in the browser wallet
  stack:
  - wagmi connectors, WalletConnect/Reown, the MetaMask SDK and the Circle
    modular-wallets SDK
  - the transitive `ws`, `uuid`, `decode-uri-component`, `zod` and `deepmerge`
    packages

  The fixes need major upgrades of wagmi and RainbowKit.

## Security center API

| Route | Access |
|---|---|
| `GET /v1/security/status` | Public. Layers, halt, venue breakers, hardening checks; no secrets. |
| `GET /v1/security/audit[?owner&chain=platform&after&limit&format=ndjson]` | The owner. The platform chain is for admins. |
| `POST /v1/security/halt { halt, reason }` | Admin |
| `PUT /v1/security/venues/:id { disabled, reason }` | Admin |
| `GET /v1/security/approvals?owner&environment` | Public (allowances are public on chain) |
| `POST /v1/security/check-address` | Public, heavy rate limit |
| `GET /v1/security/alerts`, `GET/PUT /v1/security/policy`, `GET /v1/security/pauses`, `POST /v1/security/pause`, `POST /v1/security/resume` | The signed-in owner |
