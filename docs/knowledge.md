# What Lykia knows, and how it finds a route

Lykia keeps a knowledge model of every venue it executes on Arc. The route
search uses that model to turn a goal into the best executable route. This
page describes the model, the search, the API and real mainnet runs.

## The knowledge model

`packages/core/src/knowledge.ts` holds the types and the graph functions.
`packages/core/src/knowledgeData.ts` holds the rows. Each row describes one
venue:

| Part | What it holds |
|---|---|
| `contracts` | Registry contract keys and their role. `any:token` and `any:vault` stand for a class, such as any registry token or any listed Morpho vault. |
| `functions` | Every call Lykia may make: the exact ABI fragment, the engine adapters that encode it, tokens in and out, units, who receives the output, approvals, preconditions, failure modes with their revert reasons, a gas estimate, the fee model, and whether it settles instantly or async. |
| `reads` | How state is read: quotes, rates, health, liquidity. |
| `risk` | Tier, oracle, curator, admin keys, upgradeability, TVL source, audits and notes. |
| `capabilities` | Edges of the form `verb from -> to`, with the adapter, gas, settlement and delay. |

Every fact carries evidence: the docs page, the verified source or the
on-chain read. The rows are validated when the module loads. A row fails if:

- a contract is not in the venue's registry row;
- a function lacks evidence, failure modes, gas or a recipient;
- a capability names an adapter that no function encodes;
- an executable venue has no capabilities or no state read.

The API tests also check two more things. Every engine adapter is described.
Every ABI fragment's selector matches an ABI the engine actually encodes.

### Asset notation

| Notation | Meaning |
|---|---|
| `USDC` | A registry token in the wallet. |
| `USDC@morpho-vaults` | A position at a venue: vault shares or a supply. |
| `debt:USDC@morpho-blue` | A debt at a venue. |
| `USDC@cctp` | USDC minted on another chain (async). |
| `USDC@gateway` | The Circle Gateway unified balance. |
| `*` | Any registry token. |

### Composability

`composes(a, b)` holds when `a`'s output is `b`'s input. Some examples:

- `fx EURC -> USDC` then `deposit USDC -> USDC@morpho-vaults`;
- `borrow cirBTC -> USDC` then `supply USDC -> USDC@aave-v4`, or `transfer`,
  or `bridge USDC -> USDC@cctp`;
- `withdraw USDC@morpho-vaults -> USDC` then `send`.

Two helpers walk the graph. `assetPaths` lists every simple path of up to
four hops between two assets. `tokenRoutes` lists distinct token-level
conversions, such as `cirBTC > USDC > EURC`.

### Tokens

The token registry in `packages/core/src/assets.ts` lists 19 tokens:

- **Circle tokens, on both environments:** USDC, EURC, USYC and cirBTC.
- **Bridged WETH**, on both environments.
- **Fourteen partner fiat stablecoins, mainnet only:** AUDD, AUDF, BRLA,
  CADD, CHFAU, EURAU, GBPA, JPYC, KRW1, MXNB, QCAD, SEKAU, TRYB and ZARU.

Each token's name, symbol and decimals were read on chain.

Pricing works as follows:

- USDC is the unit of account.
- EURC, cirBTC and WETH use Chainlink feeds on Arc.
- AUD, BRL, CAD, EUR, JPY, KRW and MXN stablecoins are priced at their peg
  through Chainlink's fiat feeds.
- USYC is priced at its NAV from Circle's USYC oracle.
- GBP, CHF, SEK, TRY and ZAR stablecoins have no feed on Arc and stay
  unpriced. They never count as zero: Fence caps fail closed for them.

## The route search

The search lives in `apps/api/src/engine/search.ts` and runs in five stages:

1. **Candidates.** It builds a candidate list:
   - the plan as asked;
   - the top three earn venues for the asset, pinned one at a time;
   - convert-then-earn, when another earnable asset yields more;
   - a conversion as two hops through an intermediate token;
   - every borrow venue.

   Each change is made alone against the plan as asked. The search is
   bounded (10 candidates by default, 24 at most) and deterministic.
2. **Pruning.** Candidates are dropped before quoting when:
   - the Fence's kinds, venues or tokens rule them out;
   - a venue cannot execute on this environment;
   - a venue's risk is above the owner's appetite;
   - the conversion cannot win.
3. **Planning.** Each survivor goes through the real planner as a dry run,
   with live quotes, rates, fees and the Fence verdict (the beta cap
   included). Denied plans are dropped with the Fence's reasons. Plans that
   produce the same steps are merged.
4. **Objective.** The search scores net USD over the horizon (90 days by
   default):

   ```
   yield − borrow cost − Lykia fee − gas − slippage − risk penalty − async delay
   ```

   The risk penalty is the venue tier (low 0, medium 50, high 200 bps a
   year) times the appetite multiplier (low 3×, medium 1×, high 0.25×). Ties
   go to fewer steps, then fewer signatures.
5. **Self-check.** The winner's prepared calldata runs as one
   `Multicall3From.aggregate3` eth_call from the account. Each step is
   shaped exactly as it would be signed: approvals, fee transfer, then the
   venue call wrapped in its Memo. If the account does not hold the inputs
   yet, they are funded with state overrides: native USDC through the
   balance, other tokens through their balance mapping slot. A route that
   fails is reported with the failing call and its revert reason, and the
   next route is checked.

## API

| Route | Answer |
|---|---|
| `GET /v1/knowledge` | Every venue in brief, the environment's tokens, earnable assets. |
| `GET /v1/knowledge/venues/:venue` | One venue in full, with contract addresses and function selectors. |
| `GET /v1/knowledge/contracts/:address` | Which venue and contract an address is, and what Lykia may call on it. |
| `GET /v1/knowledge/paths?from=cirBTC&to=EURC` | Ways from one asset to another. |
| `POST /v1/routes/search` | `{ owner, text \| actions, appetite?, horizonDays?, simulate?, maxCandidates?, plan? }`. Returns the best route, its alternatives, the pruned candidates and the failed checks. `plan: true` stores the winner as an intent. |

Lyko gets two tools:

- `knowledge`: venues, one venue, paths, tokens.
- `search_routes`: a goal sentence in, the best route and its alternatives
  out.

## Real mainnet runs (2026-11-01)

These runs used the in-process API against Arc mainnet with the default
Shepherd Fence, a 90-day horizon and medium appetite. The sender was
0xada5…f7cb, a funded EOA used only as the eth_call sender. Inputs the
account did not hold were funded with state overrides.

**"earn the best yield on 1000 USDC with medium risk"**

- **Best route:** deposit 990 USDC into the Aave V4 Main Spoke (2.92% APY,
  $98.3M TVL, low risk). The self-check passed.
- **Alternatives:**
  - Morpho Galaxy USDC at 2.14%;
  - Morpho Steakhouse Prime USDC, which carries a medium-risk penalty.
- **Pruned:**
  - Gauntlet Balanced, Gauntlet Prime, Bitwise Premium RWA and Galaxy EURC:
    high risk, above the medium appetite;
  - convert to EURC and earn: EURC yields 0.51%, below USDC's 2.92%.
- **Note:** over 90 days the 1% fee is larger than the yield. The
  explanation says how long the fee takes to earn back.

**"borrow 1000 USDC on my cirBTC and put it to work with health ≥ 1.8"**

- **Best route:**
  1. On Morpho cirBTC/USDC 86%, post 0.02749 cirBTC and borrow 1000 USDC
     at 2.39% APR. Health is 1.836 after the step; the floor is 1.8.
  2. Deposit 980.1 USDC into the Aave V4 Main Spoke at 2.92%.
- **Self-check:** passed, with cirBTC funded by a storage override.
- **Alternatives:**
  - deposit into Morpho Galaxy instead (−1.89 USD);
  - borrow on Aave V4 at 3.75% APR instead (−3.36 USD).

**"convert 500 USDC to EURC and pay 0x1111…1111 200 EURC for invoice 7"**

- **Default Fence:** refused, because Shepherd pays only the owner.
- **With the payee allowlisted** (as a named payee would be):
  1. Convert 495 USDC to 443.68 EURC on Aerodrome Slipstream (min 441.46).
     This beat Uniswap v3 0.05% by 4 bps.
  2. Send 200 EURC with the memo "invoice 7".
- **Self-check:** passed.

**"swap 0.005 cirBTC to EURC"**

- **Best route:** one Uniswap v3 path transaction, cirBTC→USDC→EURC
  (0.01% + 0.05%). The self-check passed.
- **Runner-up:** the same conversion as two separate swaps. It pays the fee
  twice and loses by 4.16 USD.

## The capability map

`GET /v1/capabilities?environment=mainnet` returns what Lyko can do on a network, built from code: every action (send, convert, swap, earn, withdraw, borrow, repay, bridge, Gateway) with the venues it routes through, each bridge route (CCTP, Across, Relay, Gateway) with its destination chains and when it is picked, what each token can do and where USDC can be bridged, and the features with when to use them (Fence presets, Stress test, Leash, watches, step-by-step plans, Whistle, orders, alerts, recurring rules, payouts). It is assembled by `buildCapabilityMap` (`packages/core/src/capabilities.ts`) from the registry, the engine's executable venues, the bridge tables and routable adapter manifests, so a new adapter or venue appears in it without an edit. Lyko reads the same map: the model path through its `capabilities` tool and a compact summary in its instructions, the reader without a model through `readAssist`, which answers capability questions, offers the feature that fits the words and asks one question with options when something essential is missing.

