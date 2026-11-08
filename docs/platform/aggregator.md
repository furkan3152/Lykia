# Aggregator API

Lykia's aggregator is the best-execution layer for every Arc venue it can execute through: one
"quote -> build" shape for every action, built on the same planner, router,
Fence and security layer the Lykia app uses. Built on Arc Network.

| Route | What it does | Key scope |
|---|---|---|
| `GET /v1/aggregator/quote` | Swap quote from query parameters | `quote` |
| `POST /v1/aggregator/quote` | Quote any action (`kind`) | `quote` |
| `POST /v1/aggregator/build` | Ready-to-sign calls from `quoteId` or params | `build` |
| `POST /v1/quote/:kind` | Quote, kind in the path | `quote` |
| `POST /v1/build/:kind` | Build, kind in the path | `build` |

`kind` is one of `transfer`, `swap`, `fx`, `bridge`, `deposit`, `withdraw`,
`supply`, `borrow`, `repay`, `batch`.

## What a quote holds

- `route.steps`: each step's venue, summary and the reason it won;
- `best` and `alternatives`: every venue the router priced (Uniswap v3/v4,
  Aerodrome Slipstream, Archery, Unitflow Finance V3, SushiSwap, Morpho,
  Aave V4, Relay, Across, 0x with `ZEROX_API_KEY`, routable adapter manifests);
- `priceImpactBps`: input value after fees against output value, at
  Chainlink prices (negative = better than the reference);
- `gas`: units, price and the cost in USDC (Arc's gas token);
- `fees`: Lykia's fee (1%, `lykiaBps`) and your integrator fee, per step and
  in USD;
- `fence`: the verdict (`allow`, `confirm`, `deny`) with reasons, beta caps
  included;
- `id` and `expiresAt` (60 seconds): build from it.
- `providers`: other execution paths for the same action from registered
  providers (`apps/api/src/engine/providers.ts`). Circle-native paths carry
  `poweredBy: "Circle"` and the badge "Powered by Circle".

## Request fields

| Field | Meaning |
|---|---|
| `taker` | The signing address (alias `owner`). Required. |
| `tokenIn`, `tokenOut`, `amount` | Swaps and FX. `amount` is whole tokens or `"all"`. |
| `token`, `amount`, `venue`, `maxRisk` | Deposit, withdraw, supply, repay. |
| `collateral`, `minHealth` | Borrow. |
| `to`, `memo` | Transfer (the memo rides in the Arc Memo). |
| `destination`, `recipient` | Bridge (CCTP V2). |
| `actions` | Batch: Lykia plan actions. |
| `slippageBps` | 0 to 1000; the Fence judges it. |
| `integratorFee` | `{ bps, recipient }`, at most 50 bps, paid on chain in the same batch as Lykia's fee. A project key's app fee applies when this is absent. |
| `venues` | `{ include, exclude }` venue ids. |
| `split` | `false` never splits a swap across two pools. |
| `fence` | Your own `lykia.fence/v1` document; otherwise the project's or the owner's. |

Build options: `format` (`transactions` for EOAs: Arc Memo plus
Multicall3From; `calls` for smart accounts; `eip5792` for
`wallet_sendCalls`), `batch: "single"` (one transaction for the whole route),
`confirm` (the owner confirmed what the Fence asked), `preview` (the taker
does not hold the inputs yet: the self-check funds them with state overrides;
fund the wallet before signing), `provider` (a registered execution provider).

## What a build guarantees

Every build is refused, never weakened, when something does not check out:

1. **Fence first.** A deny is `422 FENCE_DENIED`; a confirm without
   `confirm: true` is `409 CONFIRMATION_REQUIRED`; a dry-run Fence is
   `409 NOT_SIGNABLE`. Lykia's beta caps apply above every Fence.
2. **Fresh quotes.** A build from a quote id re-plans with live quotes and
   refuses (`409 PRICE_MOVED`) when the guaranteed output fell below the
   quoted minimum. An expired quote is `410 QUOTE_EXPIRED`.
3. **Self-check.** The whole route runs as one `Multicall3From.aggregate3`
   `eth_call` from the taker, every step exactly as it will be signed.
4. **Security layer.** Every step is decoded, diffed against the plan
   (unexpected transfers, fee overcharge, unlimited or oversized approvals,
   unknown contracts), checked for paused venues, breakers, pauses and the
   recipient. Any block is `409 SECURITY_BLOCKED` with the full report.
5. **Lykia's fee** is a transfer inside each step's own batch. Nothing is
   signed or broadcast by Lykia.

The answer carries `transactions` (or `calls` / `walletSendCalls`), the
`steps` with their own `security` reports and memo, the `simulation`, and the
quote fields.

## curl

```sh
# Quote a swap
curl "$LYKIA_API/v1/aggregator/quote?tokenIn=USDC&tokenOut=EURC&amount=100&taker=0xYourWallet"

# Build from the quote id
curl -X POST "$LYKIA_API/v1/aggregator/build" -H "content-type: application/json" \
  -H "Lykia-Key: $LYKIA_API_KEY" -d '{"quoteId":"q_..."}'

# A deposit for a smart account, as EIP-5792 wallet_sendCalls
curl -X POST "$LYKIA_API/v1/build/deposit" -H "content-type: application/json" \
  -d '{"taker":"0xYourAccount","token":"USDC","amount":"500","format":"eip5792"}'

# Bridge to Base (the default Fence asks to confirm cross-chain moves)
curl -X POST "$LYKIA_API/v1/build/bridge" -H "content-type: application/json" \
  -d '{"taker":"0xYourWallet","amount":"50","destination":"base","confirm":true}'
```

## SDK

```ts
import { Lykia } from "@lykia/sdk";
// or, modular: import { aggregatorApi } from "@lykia/sdk/aggregator"; import { buildApi } from "@lykia/sdk/build";

const lykia = new Lykia({ baseUrl: process.env.LYKIA_API, apiKey: process.env.LYKIA_API_KEY, environment: "mainnet" });
const quote = await lykia.aggregator.quote("swap", { taker, tokenIn: "USDC", tokenOut: "EURC", amount: "100", integratorFee: { bps: 20, recipient: myTreasury } });
console.log(quote.best?.label, quote.priceImpactBps, quote.fees.totalUsd);
const built = await lykia.aggregator.build(quote.id);
for (const tx of built.transactions) await wallet.sendTransaction(tx); // the user's wallet signs

const deposit = await lykia.build.deposit({ taker, token: "USDC", amount: "250", format: "calls" });
```

## AI routing

`POST /v1/ai/route { text, owner, constraints?, build? }` turns a request in
any language (when the server has a model key; the deterministic English
reader otherwise) into plan actions, runs the route search and returns the
best route with an `explain` block. Constraints (`fence`, `venues.allow`,
`venues.deny`, `appetite`, `maxSteps`, `maxCandidates`, `horizonDays`) only
tighten the Fence. `build: true` adds the aggregator build of the best route.
`POST /v1/ai/explain-route { route }` or `{ quoteId }` explains a route in
plain words.

```sh
curl -X POST "$LYKIA_API/v1/ai/route" -H "content-type: application/json" \
  -d '{"text":"put 500 USDC to work, low risk","owner":"0xYourWallet","constraints":{"appetite":"low","maxSteps":2}}'
```

## MCP and agent tools

The MCP server (`/v1/mcp`) adds `lykia_aggregator_quote`, `lykia_build`,
`lykia_ai_route`, `lykia_explain_route`, `lykia_contract_encode`,
`lykia_contract_read`, `lykia_contract_simulate`, `lykia_decode`,
`lykia_data_tokens`, `lykia_data_prices`, `lykia_data_protocols`,
`lykia_portfolio`, `lykia_screen_address`, `lykia_tx_explain` and
`lykia_adapters`. `@lykia/agent-tools` exports them as opt-in
`LYKIA_BUILDER_TOOLS` (`aggregator_quote`, `build_action`, `ai_route`,
`simulate_calls`, `decode_calldata`, `token_prices`, `portfolio`,
`screen_address`, `explain_tx`).

## Execution providers

`apps/api/src/engine/providers.ts` defines the `ExecutionProvider`
interface. Lykia's engine is always present; other providers (Circle App
Kit, Gateway, CCTP, StableFX reference quotes, Circle Wallets as the
signer) register with `registerProvider` and are quoted beside it. A provider build still passes
the Fence first; on-chain provider transactions get Lykia's fee transfers in
front and go through the security layer like any build.

Mainnet results are in [docs/flows.md](../flows.md).
