# Self-review of Lykia's contracts

Lykia has **no paid audit**: it is an open-source project built by one
developer with no budget for one. This document is the free alternative:
automated analysis with every finding fixed or justified, invariant and
fuzz tests, and the residual risks stated plainly. It is not a substitute
for an independent audit. **The mainnet beta caps ($1,000 per step, $5,000
per day per owner, above every Fence) exist because there is no audit.**
Community review is invited in [help-us-review.md](help-us-review.md).

Review date: 2026-11-01. Commit: the working tree at that date.

## Scope

`LykiaAccount`, `LykiaAccountFactory`, `LykiaRouter`, `LykiaOrders`,
`LykiaTimelock` (`packages/contracts/contracts`). Practice venues and test
mocks are excluded (testnet stand-ins, never for real value).

## Tools and how to reproduce

| Tool | Version | Command | Result |
|---|---|---|---|
| Slither | 0.11.6 | `slither . --hardhat-ignore-compile --filter-paths "node_modules\|contracts/test\|contracts/practice" --exclude-informational` (after `npx hardhat compile`) | 64 results, many duplicated by stale build info; 30 distinct, triaged below |
| Mythril | 0.24.8 | `myth analyze -f <runtime.hex> --bin-runtime --execution-timeout 240 -t 2` on each contract's deployed bytecode (solc downloads were blocked in the review environment, so the runtime bytecode from the Hardhat artifacts was analysed) | See the Mythril table |
| Hardhat tests | 2.29.1 | `npm test -w @lykia/contracts` | All pass, including the new invariant and governance suites |
| Stateful fuzz | in repo | `LYKIA_FUZZ_RUNS=200 npx hardhat test test/invariants.test.cjs` | Default 6 seeded runs in CI; 12 runs checked during review |

## Slither findings

| # | Detector (impact / confidence) | Where | Verdict | Reason |
|---|---|---|---|---|
| S1 | arbitrary-send-erc20 (High/High) | `LykiaOrders._collect`: `safeTransferFrom(o.maker, ...)` | Justified | `o.maker` is not arbitrary: `_preflight` checks the maker's EIP-712 signature (`SignatureChecker`, ERC-1271 aware) over the whole order before `_collect`, and the amount is the signed `amountIn`. Covered by "keeps the maker whole", "lets only the maker cancel". |
| S2 | arbitrary-send-eth (High/Medium) | `LykiaAccount._call`, `LykiaAccount._send` | Justified | Reached only by the owner (`execute`, `withdraw`) or by a session key through an allowlisted call rule / allowlisted recipient (or the owner), with value charged against the session's caps. Covered by the invariant suite (I1, I6) and account tests. |
| S3 | arbitrary-send-eth (High/Medium) | `LykiaRouter._invoke`, `LykiaRouter._send` | Justified | `_invoke` calls only owner-allowlisted venues and refuses token-moving selectors; `_send` pays the caller-chosen `intent.recipient` only what the intent produced above the baseline (never pre-existing balances). Covered by router tests. |
| S4 | msg-value-loop (High/Medium) | `LykiaRouter._book`: `baseline[i] -= msg.value` | Justified | `_add` de-duplicates tokens, so the native slot appears once and `msg.value` is subtracted once. |
| S5 | reentrancy-balance (High/Medium) | `LykiaAccount._agentCall`, `LykiaRouter._step/_settle`, `LykiaOrders._swap` | Justified (by design) | These functions measure balances before and after an external call on purpose: the account charges what actually left, the router floors what arrived, orders check what reached the maker. Every entry point is `nonReentrant`; tests "a venue cannot re-enter the account mid-call", "cannot be re-entered by a venue", "cannot be re-entered through a venue". |
| S6 | incorrect-equality (Medium/High) | `_charge` (`amount == 0`), `spendable`, router `_send` (`amount == 0`) | Justified | Equality with zero as an early return; not a balance-equality check an attacker can grief. |
| S7 | uninitialized-local (Medium/Medium) | `LykiaRouter.run` `lastOut`; `LykiaOrders._swap` `intent` | Justified | `lastOut` is assigned in the loop (at least one step is required); `intent` is a memory struct whose every field is assigned before use; unset fields (`feeBps`, `integrator`) are meant to be zero. |
| S8 | unused-return (Medium/Medium) | `LykiaOrders` `latestRoundData` partial use; `router.run(intent)` | Justified | Only `answer` and `updatedAt` are needed (freshness checked against `maxPriceAge`); `run`'s return is ignored because `_swap` measures the maker's balance directly, which is stricter. `LykiaClQuoter` ignores a swap result by design (it reverts with the quote). |
| S9 | missing-zero-check (Low) | `initialize` guardian / nativeUsdc, `setGuardian`, `setNativeUsdc`, constructor `factory_` | Justified | Zero is meaningful: no guardian, or no ERC-20 face for native USDC. The owner is zero-checked. `factory_` is set by the factory's own constructor. |
| S10 | calls-loop (Low) | balance reads and venue calls in loops | Justified | Loops are bounded (router `MAX_STEPS = 12`; session tokens bounded by the owner's spec). |
| S11 | reentrancy-benign / reentrancy-events (Low) | `_agentCall`, factory `createAccount`, router `rescue` | Justified | Event order only; state written after calls is not exploitable behind `nonReentrant`, and the factory calls only its own clone. |
| S12 | timestamp (Low) | session expiry, signature deadlines, 6 h buckets, order windows | Accepted | Time is the specification (expiry, rolling window). Arc's block timestamps are set by its validators with deterministic finality; minutes of drift do not change any guarantee. |

No code change was needed for any Slither finding.

## Mythril findings

| # | Contract | SWC | Verdict | Reason |
|---|---|---|---|---|
| M1 | `LykiaAccountFactory` | SWC-123 requirement violation in `createAccount` | Justified | Mythril found that `createAccount(0x0, ...)` reverts inside the clone's `initialize` (`ZeroAddress`). That revert is the intended input check. |
| M2 | `LykiaRouter` | none | | "The analysis was completed successfully. No issues were detected." |
| M3 | `LykiaOrders` | SWC-116 timestamp dependence in `canExecute` (and `execute`) | Accepted | Order start, deadline, interval and oracle freshness are time rules by specification; same reasoning as S12. |
| M4 | `LykiaAccount` | SWC-101 "can underflow" in `createSession` (runtime PC 18957) | Justified (false positive) | Solidity 0.8 checks every arithmetic operation outside `unchecked` and reverts on underflow; the account's only `unchecked` blocks are the call counter and nonce increments, neither in `createSession`. The path Mythril found is taken by an arbitrary caller before `onlyOwner` runs, which is the compiler-generated ABI decoder for the `SessionSpec` calldata (its bounds arithmetic reverts on malformed input). No storage is written on that path. |
| M5 | `LykiaAccount` | SWC-116 timestamp dependence in `getLimit` | Accepted | The rolling window is defined in 6-hour buckets of block time; see S12. |
| M6 | `LykiaTimelock` | none | | "The analysis was completed successfully. No issues were detected." |

## Invariants and the tests that check them

| Invariant | Test |
|---|---|
| I1 An agent transfer succeeds iff every cap in the session chain allows it (per call, rolling 24-30 h window, lifetime budget), the recipient is allowed and the Whistle is not blown (or the recipient is the owner) | `invariants.test.cjs`: stateful fuzz against a reference model, seeded |
| I2 Lifetime consumption never exceeds the budget and equals the model | same, checked after every step |
| I3 A parent's consumption is at least the sum of its children's (charges go up the chain) | same |
| I4 With the Whistle blown, only transfers to the owner succeed | same, with `WhistleBlownOnlyHomeward` asserted |
| I5 Revoking a parent or `revokeAll` disables every descendant | same |
| I6 The account's balance falls by exactly what the model charged | same |
| I7 The rolling-window amount reported by `getLimit` equals the model's window | same |
| I8 A sub-session can never be created looser than its parent (caps, budget, expiry, calls, recipients) | `invariants.test.cjs`: fuzz over random specs |
| I9 Admin actions on the router and orders need the timelock delay once ownership moves; only the Safe proposes; the timelock has no admin | `governance.test.cjs` |
| Existing invariants (signatures, re-entrancy, router floors, order bounds) | see `docs/security/audit-pack.md` |

## Residual risks

- No independent audit. Automated tools and the developer's own tests miss
  classes of bugs a professional reviewer would find. Caps stay on.
- Receiver checks cover static ABI words only; recipients inside dynamic
  data are not checked on chain (see `packages/contracts/SECURITY.md`).
- Standing approvals from an account to an allowlisted venue can move a
  token that has no session limit.
- Allowlisting a general-purpose contract hands its power to the agent.
- The router and orders are owned by a single wallet until the owner moves
  them to the 2-of-3 Safe behind `LykiaTimelock` (`docs/security/ownership.md`).
- Off-chain components (planner, Fence evaluator, Circle policy compiler)
  are tested but also unaudited; the server never holds user keys and plans
  come back unsigned, which bounds the damage of an API bug to what the owner
  or a capped session signs. The optional server signers (a gas-only keeper
  and, opt-in, Circle developer-controlled wallets bound to their creator)
  are the exception: the keeper can only submit orders their owners signed,
  and a compromised server with the entity secret controls opted-in Circle
  wallets, within the Fence and beta-cap checks it runs.
- Circle wallet policies apply only to mainnet Agent Wallets and are set by
  the owner; if the owner never runs the commands, only Lykia's preflight
  enforces the Fence for that wallet.

## Credits

Community findings will be listed here with the reporter's consent.
