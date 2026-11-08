# Lyko Autopilot

Autopilot lets Lyko sign the owner's own automations without asking for a
signature each time: repay a loan when its health drops, buy on a schedule,
sweep idle USDC into a vault, pay a recurring invoice, or act when a watch is
met. It is a leash that the owner puts on Lyko itself.

- The money stays in the owner's own LykiaAccount. Lykia never holds it.
- The signing key is a Circle developer-controlled wallet (MPC), one per
  owner per network. Circle holds the key. The private key never exists on
  Lykia's servers.
- The key is a session key on the owner's LykiaAccount, with on-chain caps
  per call, per day and in total, payees, call rules and an expiry. The
  owner signs that session once and can revoke it on chain at any time.
- It is off by default, and turning it on takes three things. The operator
  must opt in, the owner must accept the acknowledgement, and the owner's
  wallet must sign once.

Code: `packages/core/src/autopilot.ts` (pure rules, ceilings, guard, tasks),
`apps/api/src/autopilot/` (service, Circle signer, records),
`apps/api/src/modules/autopilot.ts` (routes),
`apps/web/src/features/fold/autopilot/` (the Fold card and sheet).

## Who holds what

| Who | Holds |
|---|---|
| You | Your funds, in your own LykiaAccount. Only your wallet can create, widen or revoke the session, withdraw, or blow the Whistle. |
| Circle | The signing key, as an MPC developer-controlled wallet under the operator's Circle entity. |
| Lykia | The right to ask Circle to sign, through the operator's API key and entity secret. Lykia asks only for steps that passed every check below, and stops asking the moment you press Stop. |
| Chain | Your LykiaAccount enforces the session: per-call, daily and lifetime caps per token, payees, call rules that pin outputs to your account, a call count and the expiry. |

What this means in practice:

- **If Lykia's server is compromised**, an attacker who has the API key and
  the entity secret can ask Circle to sign from Autopilot wallets. They
  still cannot exceed what each owner's session allows on chain:
  - at most the per-call cap in one call and the daily cap in 24 hours,
    per token;
  - only to the session's payees, the owner and Lykia's fee recipient;
  - only through call rules whose output goes back to the owner's account;
  - only until the session expires or the owner revokes it.

  See [Risks](#risks) for what that bound leaves open.
- **If Circle is compromised or unavailable**, the same caps hold. When
  Circle is down, nothing is signed.
- **What Lykia cannot do at all:** withdraw from the account, widen a
  session, add a payee or a call rule, or sign without Circle.

Vercel KMS was considered for the signer and rejected. It signs with issuer
keys for JWT and JWKS, and has no per-user Ethereum signers.

## Turning it on

### Operator setup (once per deployment)

1. In the Circle Console, create an API key that may use Wallets. Use a
   `TEST_API_KEY:` for Arc testnet and a `LIVE_API_KEY:` for Arc mainnet.
   Remove any IP allowlist, because hosted IPs change.
2. Register an entity secret. You can generate it yourself and register its
   ciphertext with Circle's SDK, or use `POST /v1/admin/circle/entity-secret`
   from an admin wallet (see [circle.md](circle.md#registering-the-entity-secret-from-a-phone)).
   Keep the recovery file offline.
3. Create a wallet set and note its id. Use the Circle Console, or
   `POST /v1/w3s/developer/walletSets` with a fresh `entitySecretCiphertext`.
   Set it as `CIRCLE_WALLET_SET_ID`. Without it, Lykia creates a new
   "Lykia Pack" set for each wallet it makes.
4. Set these in the API's environment and redeploy:

   ```
   CIRCLE_API_KEY=...
   CIRCLE_ENTITY_SECRET=...        # 64 hex characters
   CIRCLE_WALLET_SET_ID=...        # the wallet set's UUID
   LYKIA_CIRCLE_SERVER_WALLETS=true
   ```

5. Keep the background check running. Autopilot runs inside the flow tick,
   next to payouts, invoices, automations and leash expiry
   (`apps/api/src/devflows/tick.ts`). On Vercel Hobby the crons run once a
   day, so point a pinger at `POST /v1/reconcile/tick` with
   `Authorization: Bearer $CRON_SECRET` every few minutes (see
   [hosting.md](hosting.md)). Without one, schedules hold only to the next
   pass.
6. Check that Circle offers EOA developer-controlled wallets on `ARC`
   (mainnet) or `ARC-TESTNET` for your entity. Autopilot asks for
   `accountType: "EOA"` and refuses anything else (see
   [Why an EOA](#why-an-eoa)).
7. Run it end to end on testnet first, then on mainnet with the smallest
   limits.

`GET /v1/autopilot` reports `offer.available: false` with the reason until
steps 1 to 4 are done. `POST /v1/autopilot/enable` answers 403
`CIRCLE_SERVER_WALLETS_OFF` without the opt-in, and 503
`CIRCLE_NOT_CONFIGURED` without the credentials.

### Owner steps (in the Fold, Pack tab, Autopilot)

1. **Turn on Autopilot**, then pick the limits. Each limit can be lowered,
   never raised:
   - per step: at most $100 in beta;
   - per day: at most $300 in beta;
   - days: 1 to 30;
   - optional payees for recurring invoices.

   On mainnet the global beta cap also applies, whichever is lower.
2. **Read** what Autopilot means, then tick "I understand". The API accepts
   `enable` only with the digest of exactly that text (`autopilotAckDigest()`),
   so what the owner accepted is on record. The text:
   - Lyko signs for you up to these limits.
   - Lykia never holds your funds: they stay in your own LykiaAccount.
   - The signing key is a Circle wallet made for you; Circle holds it, Lykia
     asks Circle to sign.
   - The server can act within these caps until you revoke, even if Lykia's
     server is compromised.
   - Stop Autopilot ends server signing at once; signing revokeSession ends
     it on chain.
3. **Sign once.** This is `createSession` on the LykiaAccount, plus
   `createAccount` when the account does not exist yet. Until the session
   lands, Autopilot signs nothing. If the sheet is closed before signing,
   the card offers "Sign the session".
4. Send about 1 USDC to the Autopilot key for gas. Arc pays gas in USDC, and
   Circle's Gas Station sponsors smart-contract wallets only. Fund the
   LykiaAccount with what Autopilot may use.
5. **Add tasks.**

## The leash Autopilot signs under

`enable` makes the owner's Circle EOA wallet once, then reuses it. It then
creates an ordinary root leash: `template: "custom"` with the Fence from
`autopilotFence()`. The leash is listed with the other leashes as
"Lyko Autopilot", and its Pack agent with the Pack.

| Limit | Value |
|---|---|
| Kinds | transfer, fx, swap, deposit, withdraw, supply, repay. Never borrow or bridge. |
| Venues | arc-transfer; the swap venues a session can pin (Uniswap v3, Archery, Unitflow); Morpho vaults and Aave V4. |
| Tokens | USDC and EURC. |
| Payees | Those named at `enable`, else the owner only. |
| Caps | The per-step and per-day limits. The total is the daily cap times the days. |
| Slippage | At most 0.5%. |
| Calls | At most 500 over the session's life. |
| Expiry | The chosen days. |

The leash's own API key is revoked the moment it is made. Nothing outside
the Autopilot service can plan under this leash.

## What happens before Circle is asked

Every step passes all of these, in this order. A failure at any point is a
refusal, and nothing is signed.

1. Autopilot is `on`: not pending, paused or stopped.
2. The leash and its Pack agent are live. A revoked or expired leash stops
   Autopilot.
3. The Whistle is not blown on the account (`whistle()` read on Arc). If it
   is, Autopilot stops. If the account cannot be read, the step is refused.
4. Autopilot's own daily count still has room.
5. The leash's own plan:
   - the Fence, with the leash's spend;
   - the leash's total;
   - `spendable()` per token, plus the session's call rules and payees, read
     from the account;
   - a simulation from the Autopilot key.
6. The prepared transaction is checked:
   - it comes from the Autopilot key;
   - it calls only the owner's LykiaAccount, directly or through Arc's
     Multicall3From with every call to the account;
   - it carries no value and uses the right chain id.
7. The step's USD is at or under the per-step limit (and the ceiling), and
   adding it stays under Autopilot's daily limit.
8. The anomaly guard (below) does not pause it.
9. The record is read again: if Stop was pressed a moment ago, nothing is
   signed.

Only then does Lykia call Circle's `POST /v1/w3s/developer/transactions/contractExecution`
with that exact calldata. The background check then follows Circle's
transaction. It hands the hash to the leash's `submit`, which:

- binds the hash to the prepared transaction (sender, target, data);
- settles it from the receipt;
- counts it against the leash;
- prepares the next step of a multi-step plan, which goes through steps 6
  to 9 again.

## Labels and the trail

Every signed step carries the Arc Memo
`lykia:1:<intent>:<step>:<verdict tag>`, the Fence verdict digest of its
plan. The Fold shows it as **"Signed by Lyko under your Autopilot leash"**,
with the verdict's first characters. The leash trail
(`GET /v1/leashes/:id/trail`) marks the step **chain-proven** when all three
hold:

- the receipt succeeded;
- it carries `AgentTransfer` or `AgentCall` for the session;
- its `AgentMemo` names the same intent, step and verdict.

The same trail lists session events Lykia has no record of as
`source: "chain"`.

Webhooks:

| Event | Carries |
|---|---|
| `autopilot.signed` | Run id, intent, step, verdict digest, USD, the Circle transaction id, the memo and the label. |
| `autopilot.paused` | The code and the reason. |
| `autopilot.stopped` | Who stopped it, the reason and `revokeSession`. |

## Stop, the Whistle and the anomaly guard

**Stop Autopilot** is one tap in the Fold and in Ask Lyko ("stop autopilot"
shows a card with the button). It:

1. sets the record to `stopped` first;
2. revokes the leash, so its Pack agent and key end and the carve returns;
3. returns `revokeSession(id)` for the owner's wallet, which the app offers
   to sign right away.

A step already handed to Circle before that moment can still land, inside
the caps.

**The Whistle** stops Autopilot too:

- `POST /v1/pack/whistle` stops it on the server.
- The app's Whistle calls stop on both networks.
- On chain, `blowWhistle()` makes the account refuse every non-homeward
  agent call.

**The anomaly guard** (`guardVerdict`, `AUTOPILOT_GUARD`) pauses Autopilot
and tells the owner (an `autopilot.paused` webhook and a line in their
latest Ask Lyko thread) when any of these happens:

- three refusals that reached the leash within an hour;
- a seventh signed step within an hour;
- signing more than half the daily limit within 15 minutes. Velocity is
  checked before signing, so the burst is never signed.

A paused Autopilot keeps its session but signs nothing until the owner
resumes it.

## Tasks

| Kind | When | What Lyko plans |
|---|---|---|
| `repay` | The account's Aave health factor drops below the floor | `repay <amount> USDC on Aave` |
| `dca` | Every day, week or month | `convert <amount> USDC to EURC` (or back) |
| `sweep` | Idle USDC in the account is above what you keep | `deposit <the excess, at most amount> USDC into <vault>` |
| `pay` | Every day, week or month, to a payee named at `enable` | `send <amount> USDC to <payee>` |
| `watch` | One of the owner's watches is met | The owner's sentence, e.g. `repay 30 USDC on Aave` |

- **Conditions are read on the LykiaAccount**, where Autopilot's money and
  positions are: its USDC and EURC balance, and the position map for health
  factors and rates. A condition task runs once each time its condition
  becomes true, and again only after it was clear.
- **A watch that ends in an Autopilot action** keeps its own condition, read
  from the watch. The Fold's watch card shows "Then Autopilot: …".
- **Run now** plans a task at once, with the same checks.

## API

| Route | Does |
|---|---|
| `GET /v1/autopilot` | The offer (whether this server can sign, ceilings, the acknowledgement and its digest, who holds what), the owner's Autopilot, its leash, today's spend and the last runs. |
| `POST /v1/autopilot/enable` | `{ ack, limits: { perStepUsd, perDayUsd, days }, payees? }`: returns the transactions to sign once. |
| `POST /v1/autopilot/stop` | The kill switch. Returns `signingStopped: true` and `revokeSession`. |
| `POST /v1/autopilot/pause` | The owner pauses it. |
| `POST /v1/autopilot/resume` | Resumes it after a pause. |
| `POST /v1/autopilot/tasks` | Adds a task. |
| `POST /v1/autopilot/tasks/:id/(pause\|resume\|remove\|run)` | Pauses, resumes, removes or runs a task. |

Every route needs the owner signed in with their wallet (a Lykia-Session).
API keys are refused.

## Why an EOA

LykiaAccount checks `msg.sender` against the session key for `agentExecute`
and `agentTransfer`, and Arc's Multicall3From keeps the EOA caller as the
sender of each batched call. Only an EOA sends the calls itself; a Circle
SCA wallet's calls arrive from a bundler. The leash's `submit` binds the
transaction's sender, target and data, so with an EOA the transaction
Circle broadcasts is exactly the one the leash prepared.

## Evidence on Arc mainnet

`npm run prove:autopilot -w @lykia/api` runs the calldata the API builds
against the deployed LykiaAccountFactory
(`0x810e8db89f4c4e8fa814ed3ed0d636d3416dd7f9`). It uses `eth_call` through
Multicall3From from the owner, and the only state override is the owner's
native USDC balance. `AUTOPILOT_EVIDENCE=path` writes the JSON.

The session transaction and the revoke are exactly what `POST /v1/autopilot/enable`
and `POST /v1/autopilot/stop` build. The Circle Wallets API is answered
locally with a stand-in wallet, so Circle is never called.

The stand-in key is Multicall3 (`0xcA11…CA11`):

- In one `eth_call` from the owner, only a contract can call the account as
  itself.
- Each Autopilot step is the exact account calldata the leash builds for a
  transfer step (`wrapForSession`: the payment and Lykia's 1% fee, each an
  `agentTransfer` with the Arc Memo), sent through Multicall3.
- In production the Circle EOA sends the same account calldata.

Run of 2026-11-08 at block 30209823. The owner is
`0xada5bb90d0de0bd1b6f3938708f49295a8d1f7cb` and the account
`0x437E6d21573D33dEeFDFF13653EcA9E516156b06`. The limits are the beta
ceilings: $100 a step, $300 a day, 7 days, one payee.

| Call | Result |
|---|---|
| `createAccount` (the API's first transaction) | account `0x437E…6b06` |
| `createSession` (from enable): USDC caps 100 / 300 / 2100, EURC caps 89.79635 / 269.389052 / 1885.723367, the payee and the fee recipient, 39 call rules, 500 calls | session `0x8777…58c5` |
| `spendable(session, USDC)` | 100000000 |
| Pay 50 USDC + 0.50 fee | success (2 account calls) |
| Pay 150 USDC | reverted `PerCallCapExceeded(USDC, 150000000, 100000000)` |
| Pay 99 USDC + 0.99 fee, twice | success (250.48 of 300 today) |
| Pay 60 USDC | reverted `DailyCapExceeded(USDC, 310480000, 300000000)` |
| Pay 1 USDC to a stranger | reverted `RecipientNotAllowed(0x3333…3333)` |
| `spendable(session, USDC)` | 49520000 |
| `blowWhistle`, then pay the payee 1 USDC | reverted `WhistleBlownOnlyHomeward()` |
| Under the Whistle, 1 USDC home to the owner | success |
| `releaseWhistle`, then `revokeSession` (from stop) | success |
| `isSessionValid`, `spendable` | false, 0 |
| Pay 1 USDC after Stop | reverted `SessionInvalid(0x8777…58c5)` |

## Tests

`apps/api/src/autopilot/__tests__/autopilot.test.ts` runs over HTTP against
a fake Arc with a modelled LykiaAccount and a mocked Circle Wallets API. It
covers:

- Opt-in gating: the server flag, the acknowledgement, limits under the
  ceilings, signed-in owners only.
- The session key is the owner's Circle EOA.
- Nothing is signed before the session lands.
- Circle signs exactly the prepared step, with the verdict in the memo, and
  the step settles chain-proven.
- Refusals outside the leash never reach Circle, and three refusals pause
  Autopilot.
- The velocity pause, and Autopilot's own daily cap.
- The kill switch returns `revokeSession`, and Stop wins a race with a step
  being planned.
- The Whistle stops it, from the API and on chain.
- A watch that ends in an Autopilot action runs from the background check,
  once each time its condition becomes true.

`packages/core/test/autopilot.test.mjs` covers the rules, and
`apps/web/src/features/fold/__tests__/autopilot.test.ts` the card's model.

## Risks

- **Server compromise is bounded, not prevented.** With the API key and the
  entity secret, an attacker can spend up to each owner's caps until the
  session expires or is revoked:
  - The caps are per token: an owner with both USDC and EURC in the account
    can lose up to the daily cap in each.
  - Payees and outputs are pinned on chain.
  - Swap slippage is set by the API in the calldata, not checked by the
    chain. A malicious swap can lose value up to the per-call cap per call.
- **One entity secret signs for every Autopilot wallet** under the
  operator's entity. Rotate it in the Circle Console if it may have leaked,
  and stop Autopilot for everyone by unsetting `LYKIA_CIRCLE_SERVER_WALLETS`.
  Owners revoke on chain.
- **A step already handed to Circle** before Stop or a pause can still land,
  inside the caps.
- **Schedules depend on the background check.** Without a pinger on Vercel
  Hobby, a schedule holds only to the next pass.
- **Conditions fail closed.** If the account's balances or positions cannot
  be read, the task does not run.
- **The anomaly guard is a heuristic.** It counts refusals and velocity. It
  does not judge whether a step is wise; the Fence and the caps do.
- **The Autopilot key needs USDC for gas.** If it runs out, Circle's
  transaction fails and the run is recorded as failed.
- **The contracts are not audited.** The beta ceilings stay at $100 a step
  and $300 a day until they are.
