# The Lykia engine

The engine turns outcomes into routed, Fence-checked plans on Arc, and keeps
standing orders. It never signs and never prepares a transaction on its own
initiative: signing always happens in the owner's or the agent's own wallet.

## The three calls other layers use

They are exported from `engine/api.ts`. The Lyko agent, sub-agents, the MCP
server and standing orders all go through them.

### `compileGoals(text, options?) => CompiledGoals`

Takes an English sentence and returns plan actions for now,
standing orders for later, or questions. It is deterministic and does no I/O.

```ts
compileGoals("put 40% of my USDC in the best vault, convert 20% to EURC and bridge the rest to Base");
// actions: earn 40%, fx 20%, bridge all (shares are shares of the starting balance)
compileGoals("if EURC/USD goes above 1.12 convert 1000 EURC to USDC");
// standing: [{ trigger: { kind: "price", feed: "EURC/USD", op: "above", value: "1.12" }, actions: [fx …] }]
compileGoals("convert 100");
// clarify: ["Swap which token into which?"], clarifyChoices: [{ choices: ["USDC to EURC", …] }]
```

`options.timezone` sets the IANA zone for schedules. The default is UTC.

Result: `{ actions, standing, clarify, clarifyChoices }`.

Requests with several goals, a time dimension or abstract wording ("keep
three months of payroll liquid and put the rest to work somewhere safe") go
to the intent compiler instead (`src/compiler/`, `POST /v1/ai/compile`): a
typed `lykia.program/v1`, resolved against live balances into these same plan
actions plus drafts for later. See `docs/intents.md`.

### `planActions(intents, input) => Promise<CreateIntentResponse>`

Equivalent to `IntentService.create`. It reads balances and prices, routes
every action to a venue, attaches `step.route` (the chosen option, the
alternatives and the reason), evaluates the Fence, and stores the plan unless
`dryRun` is set.

| Input | Meaning |
|---|---|
| `environment`, `owner`, `actions`, `source` | Required. |
| `fence` | The owner's Fence. Defaults to Shepherd. |
| `signer` | `"wallet"` or `"agent"`. |
| `agent` | `{ address, agentId? }`. The account that acts. |
| `proposedByAgent` | Set by agents. Fences can require the owner's confirmation for these plans. |
| `dryRun` | Plans past a short balance, with a warning, so a route can be previewed before funding. |
| `account` | `"eoa"` (the default) or `"smart"` (plain calls instead of Memo / Multicall3From). |

### `quoteVenues(router, request) => Promise<QuoteResponse>`

Returns every live venue's option for one action, priced the same way, plus
the engine's pick. Use it to answer "why this route?" without planning.

```ts
quoteVenues(router, { kind: "swap", environment: "mainnet", from: "USDC", to: "EURC", amount: "1000" });
quoteVenues(router, { kind: "earn", environment: "mainnet", token: "USDC", maxRisk: "medium" });
quoteVenues(router, { kind: "borrow", environment: "mainnet", token: "USDC", amount: "1000", collateral: "cirBTC", minHealth: "1.8", account });
```

Result: `{ kind, environment, options: VenueOption[], choice: RouteChoice | null }`.
`VenueOption` and `RouteChoice` are defined in `@lykia/core` (`routes.ts`).

The same data is served over HTTP as `POST /v1/quote`.

## Routing ("neyi nereye")

`router.ts` (`VenueRouter`) asks every live venue that can do an action and
ranks the answers.

- **Swap and FX.** The router quotes Uniswap v3 on every fee tier (QuoterV2),
  two-hop paths through USDC, and hookless Uniswap v4 pools (V4Quoter). On
  testnet it also quotes the Lykia practice swap. Options are compared by
  output after gas: gas is priced in USDC at the live gas price, plus the
  Memo/Multicall3From overhead. When the two best options sit in different
  pools, the router re-quotes a 50/50 split and takes it if it wins by at
  least 5 bps. Aerodrome Slipstream (Metarouter), Archery (its own
  QuoterV2 and SwapRouter), Unitflow V3 (thin pools) and Sushi's swap API
  (RedSnwapper) are quoted the same way; 0x joins when `ZEROX_API_KEY` is
  set. A venue wins only by output after gas.
- **Bridge.** CCTP is the default for USDC. Relay is quoted beside it on
  mainnet and wins only when it delivers more on the destination chain (or
  the owner names it). Relay is cross-chain: the money arrives on the other
  chain, filled by Relay's solver.
- **Earn.** The router compares Morpho Vault V2 (net APY from the Morpho API;
  each vault is named under its curator: Galaxy, Keyrock, Steakhouse,
  Gauntlet, Bitwise)
  with the Aave V4 Main Spoke (supply APY from the Aave API), and the Lykia
  practice vault on testnet. Risk tiers come from TVL: low at $10M or more,
  medium at $1M or more, high below that. The default ceiling is medium;
  `maxRisk` changes it ("safest" → low, "highest" → high). Vaults under $50k
  are never picked automatically. When an API does not answer, the APY is
  shown as unknown and options are ranked by size.
- **Borrow.** The router compares the Aave V4 Main Spoke and Morpho Blue
  (cirBTC/USDC or cirBTC/EURC, 86% LLTV), and Lykia Practice Lending on
  testnet. Collateral is sized so the health factor reaches the floor, plus a
  2% buffer, capped at the wallet balance. The health factor is projected
  from the venue's own math: the Spoke's account data for Aave, and the
  oracle price times LLTV for Morpho. The cheapest borrow rate that keeps the
  floor wins. The floor is `minHealth`, otherwise the Fence's
  `lending.minHealthFactor`, otherwise 1.5.

## Amounts across clauses

A share is a share of the balance the plan starts with, minus whatever
`reserve` actions keep liquid. "all" or "the rest" means whatever is still
spendable at that point in the plan. Reserves apply to the whole plan,
wherever they appear in the sentence. `rebalance` becomes the fewest fx/swap
steps that reach the target weights (`@lykia/core` `allocation.ts`, USD
values from Chainlink).

Slippage defaults to 50 bps and never exceeds the Fence's
`limits.maxSlippageBps`. An explicit slippage in the action is kept as asked,
and the Fence judges it.

## Executable venues

| Adapter | Venue | Environment |
|---|---|---|
| `transfer` | ERC-20 transfer with an Arc Memo | both |
| `bridge` | CCTP V2 `depositForBurn` (attestation tracked; inbound mints via `POST /v1/cctp/inbound`) | both |
| `gateway` | Circle Gateway deposit | both |
| `vault-deposit` / `vault-withdraw` | Morpho Vault V2 (ERC-4626); the step names the curator (Galaxy, Keyrock, Steakhouse, Gauntlet, Bitwise) | mainnet |
| `aave-supply` / `aave-withdraw` / `aave-borrow` / `aave-repay` | Aave V4 Spokes | mainnet |
| `morpho-borrow` / `morpho-repay` | Morpho Blue (repay all by shares) | mainnet |
| `swap` / `swap-path` | Uniswap v3 single pool / two hops | mainnet |
| `swap-v4` | Uniswap v4 through UniversalRouter + Permit2 | mainnet |
| `swap-aerodrome` | Aerodrome Slipstream through its Metarouter | mainnet |
| `swap-archery` | Archery SwapRouter (Slipstream-style pools, by tick spacing) | mainnet |
| `swap-unitflow` | Unitflow Finance V3 router (thin pools) | mainnet |
| `swap-sushi` | Sushi swap API, settled by RedSnwapper with Lykia's minimum | mainnet |
| `swap-zerox` | 0x Swap API through AllowanceHolder, only with `ZEROX_API_KEY` | mainnet |
| `bridge-relay` | Relay depository deposit, filled on the destination chain | mainnet |
| `practice-*` | Lykia practice vault, swap, lending | testnet, once deployed |

Calls are shaped by `calls.ts`. An EOA signs one Multicall3From transaction
`[approvals…, calls…, Memo(last call)]`, or a single Memo-wrapped call. Smart
accounts get plain calls. Every adapter's batch was simulated with `eth_call`
on Arc mainnet on 2026-11-01.

## Knowledge and route search

The engine knows what every venue is for, not only how to call it.
`@lykia/core` `knowledgeData.ts` describes each executable venue: its
contracts, every function Lykia may call (the exact ABI fragment, tokens in
and out, who receives the output, approvals, preconditions, failure modes,
gas, fees, settlement), how its state is read, its risk facts (oracle,
curator, admin, upgradeability, TVL source, audits) and its capabilities:
`verb from -> to` edges such as `deposit USDC -> USDC@morpho-vaults` or
`borrow cirBTC -> USDC`. The rows are validated when the module loads, and a
test checks every fragment's selector against the ABIs in `abis.ts`.

`search.ts` (`RouteSearch`) walks that graph for a goal:

1. **Candidates.** The plan as asked; the top three earn venues pinned one
   at a time; convert-then-earn when another asset yields more; a
   conversion as two hops through an intermediate token; every borrow venue.
   One change at a time, so the search stays small (`maxCandidates`, 10 by
   default) and deterministic.
2. **Early pruning.** Fence kinds, venues and tokens, venues not executable
   on the environment, venue risk above the owner's appetite, conversions
   that cannot win (the target yields no more than the source).
3. **Planning.** Every survivor goes through the real planner as a dry run,
   with live quotes, rates, fees and the Fence verdict (the beta cap
   included). Denied plans are dropped with the Fence's reasons. Quotes are
   cached for 15 seconds (`QUOTE_CACHE_MS`); prepare always re-quotes.
4. **Objective.** Net USD over the horizon (90 days by default) = yield −
   borrow cost − Lykia fee − gas − slippage − risk penalty − async delay.
   The risk penalty is `RISK_PENALTY_BPS` (low 0, medium 50, high 200 bps a
   year) times the appetite multiplier (low 3×, medium 1×, high 0.25×).
   Ties go to fewer steps, then fewer signatures. Unpriced routes rank last.
5. **Self-check.** `simulate.ts` flattens the winner's prepared calls into
   one `Multicall3From.aggregate3` eth_call from the account. Arc has no
   `eth_simulateV1`, but CallFrom keeps msg.sender, so the steps run in order
   against the same state. Dry runs are funded with state overrides: native
   USDC through the balance, other tokens through their balance slot. A
   failing route is reported with the failing call and its revert reason,
   and the next route is checked.

The result has the best route, up to six alternatives, the pruned
candidates with their reasons, the failed checks, and an explanation: why
this route, each step, what could fail (from the knowledge rows) and how the
Fence judged it.

HTTP: `GET /v1/knowledge`, `GET /v1/knowledge/venues/:venue`,
`GET /v1/knowledge/contracts/:address`, `GET /v1/knowledge/paths?from&to`,
`POST /v1/routes/search` (`plan: true` stores the winner as an intent).
Lyko's tools: `knowledge` and `search_routes`. See `docs/knowledge.md`.

Amounts gained `{ previous: true }`: exactly what the step before produced.
"Borrow 1000 USDC and put it to work" deposits the borrowed amount after the
fee, never the rest of the wallet.

## Standing orders

`standing.ts` (`StandingService`) stores orders and checks them every 30
seconds.

- **Triggers:** Chainlink prices (EURC, BTC, ETH, EUR, JPY, BRL, MXN, PAXG
  against USD), daily/weekly/monthly schedules, or a lending health factor
  falling below a value.
- **When an order fires:** it plans an intent with the owner's Fence and
  emits `standing.fired` on the bus. It does not sign.
- **Unknown facts never fire an order:** a stale price or an unreadable health
  factor means the order waits.
- **Repeated failures:** after three failed plans in a row, the order pauses
  itself.

HTTP routes are in `modules/standing.ts`.
