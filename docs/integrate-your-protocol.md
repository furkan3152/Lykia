# Integrate your protocol

Lykia is built on Circle's rails, routes value through every Arc venue it has an adapter for and keeps
every agent inside its Fence. When your protocol is integrated, every Lykia
user, every agent that uses Lykia over MCP or x402 and every app built on the
SDK can reach it in one sentence. Each move is checked against the user's
Fence before it can be signed, so the traffic that reaches you is traffic its
owner allowed.

Integration is free and open to every team building on Arc Network.

## What you get

- **Routing.** Ask Lyko, the SDK, MCP (`lykia_plan`) and the x402 route quote
  compare your venue with every other one and send users to it when it gives
  them the best result.
- **A stall on `/ecosystem`.** Your name, category, status, TVL on Arc
  (DefiLlama) and the value Lykia has routed to you, live. The same data is
  public at `GET /v1/ecosystem` and in the embeddable "Routed by Lykia" strip
  (`examples/embed`).
- **Free developer keys.** Sign in on The Mint (`/mint`) with your wallet: 120 requests
  per minute and 20,000 per day per key, no charge.
- **No lock-in.** Users sign every transaction in their own wallets, directly
  against your contracts. Lykia never holds funds.

## Levels

| Level | What Lykia does | What it needs |
|---|---|---|
| Listed | Shows you in the registry and on `/ecosystem`. | A registry row with `status: "announced"`. |
| Read | Prices and positions in the Flock, Scent on your tokens. | Verified addresses (checklist below). |
| Routed | Plans, checks and executes through you. | A validated and approved adapter manifest, or a typed adapter in code. |

## Checklist for a verified registry entry

Open a pull request against `packages/core/src/protocolData.ts`, or send the
same details to the Lykia team.

1. **Addresses from your own docs**, per network (Arc mainnet 5042, Arc
   testnet 5042002), with the link.
2. **`eth_getCode` is non-empty** for every address on the network it is
   listed for. Write the date in `evidence`.
3. **An `eth_call` simulation** of your main action (deposit, swap, supply)
   from a funded address, through Multicall3From with the Arc Memo, as
   `src/scripts/smoke.ts` does. Write the date and the result in `evidence`.
4. **Category, a one-sentence summary and your website.**
5. **Verified source** on the Arc explorer, when you have it.

A row marked `live` without evidence fails validation at load time.

## Adapter manifests: integrate without a pull request

The fastest way to be **Routed** is a Lykia Adapter Manifest
(`lykia.adapter/v1`). It describes your protocol in the same model as Lykia's
own knowledge rows, and the API merges it into the knowledge model, the route
search and the aggregator at runtime, with no redeploy.

A manifest holds:

| Part | What it says |
|---|---|
| `protocol` | id (kebab-case, not a registry id), name, category, summary, website, docs, contact. |
| `contracts` | Addresses per environment (`mainnet`, `testnet`), by key. |
| `abi` | Human-readable fragments for every function Lykia may call or read. |
| `capabilities` | One per action: `verb` (swap, fx, deposit, withdraw, supply, borrow, repay), contract, function, argument templates, `tokenIn`, `tokenOut` (a token or `SYMBOL@<your id>`), receiver (always `$account`), exact approvals, preconditions, failure modes, gas, venue fee, and the reads that price it (`quote` for swaps, `apy` for deposits, `position` for withdrawals). |
| `reads` | View functions with their scale (`raw`, `bps`, `wad`, `ray`, `1e6`): quotes, APYs, positions, TVL. |
| `risk` | Tier, oracle, admin keys, upgradeability, audits, notes. |
| `evidence` | Where the facts come from. |

Argument templates: `$amount` (what your contract receives, after Lykia's
fee), `$minOut` (slippage floor, required for swaps), `$account` (the
signer), `$tokenIn`, `$tokenOut`, `$deadline` and `$contract:<key>`. Every
other argument is a literal. Output always goes back to the signer.

A complete example that validates on Arc mainnet is in
[`examples/adapter-manifest/manifest.json`](../examples/adapter-manifest/manifest.json).

### The flow

```
submitted --validate--> validated --admin approve--> approved --admin route--> routable
                                   \--admin reject--> rejected     routable --admin suspend--> suspended
```

1. `POST /v1/integrations/adapters { manifest, validate: true }` with a secret
   key (`Lykia-Key`) or a signed-in session. Structural problems come back as
   `400 INVALID_MANIFEST` with one issue per field.
2. Validation runs on chain: `eth_getCode` for every contract, every selector
   in your ABI (and, as information, in the bytecode), every read called with
   sample values, and a dry simulation of each capability with its sample
   amount: the exact batch the engine would build (exact approvals, the call,
   the Arc Memo) in one Multicall3From `eth_call` from a probe account funded
   with state overrides. A withdraw is simulated after your deposit for the
   same token. `POST /v1/integrations/adapters/:id/validate` runs it again.
3. A Lykia admin reviews it (`POST /v1/integrations/adapters/:id/review`
   with `approve`, then `route`). Approved adapters appear in
   `GET /v1/knowledge`; routable ones are quoted by the router next to every
   other venue, pass through the Fence and the security layer like them, and
   pay Lykia's fee in the same batch.

`GET /v1/integrations/adapters/:id/status` shows the status, the last
validation report and the history. See
[docs/platform/integrations.md](platform/integrations.md) for curl and SDK
examples.

## The adapter in code

The full walkthrough, with the code, is in
[`apps/api/src/engine/venues/TEMPLATE.md`](../apps/api/src/engine/venues/TEMPLATE.md).
In short: a venue module with a quote (reads only, `null` when it cannot
answer) and call builders (unsigned calls), one `case` in `adapters.ts`, one
candidate in `router.ts`, a unit test and a mainnet simulation. The engine adds
approvals, Lykia's fee transfer and the Arc Memo around your calls and batches
them into one transaction.

### Venues routed this way on Arc mainnet

Each row below went through the checklist: addresses from the protocol's own
address book or deployment config, cross-checked on chain (code present,
`factory()` relationships, recent events), and the real adapter batch
simulated through Multicall3From with the Arc Memo. The block and the result
are in the registry row's `evidence`; entries Lykia does not route carry
`notes` saying why.

| Venue | Adapter | How it is verified | Position reader |
|---|---|---|---|
| `galaxy-curation`, `keyrock`, `steakhouse-financial`, `gauntlet`, `bitwise` | `vault-deposit` / `vault-withdraw` (Morpho Vault V2, `via: "morpho-vaults"`) | Vaults listed under the curator in api.morpho.org; on-chain `curator()` is one of the curator's addresses; deposit 100 then redeem simulated per vault | `readMorphoVaults`, each venue reading only its curator's vaults |
| `archery` | `swap-archery` (SwapRouter `exactInputSingle` by tick spacing, QuoterV2) | archery.wtf address book; router, quoter, position manager and pools share the factory | `readArchery` (Slipstream-style position NFTs) |
| `unitflow-finance-v3` | `swap-unitflow` (SwapRouter v1, Quoter v1) | docs.unitflow.finance contract page; Swap events with the router as sender | `readUnitflow` |
| `sushiswap` | `swap-sushi` (api.sushi.com route, RedSnwapper `snwap`) | npm `sushi` config for Arc; RedSnwapper verified on Etherscan; Lykia re-encodes the minimum | `readSushiswap` (SushiSwap V3 positions) |
| `relay` | `bridge-relay` (RelayDepository `depositErc20`) | api.relay.link chain list; depository source verified on Base at the same address; Relay deposit events on Arc. Cross-chain: delivered on the destination | `readRelay` (owner's Relay transfers in flight) |
| `zerox` | `swap-zerox` (AllowanceHolder `exec`) | Canonical AllowanceHolder; keyed API. Routable only when `ZEROX_API_KEY` is set | `readZeroX` (holds nothing) |

Thin venues stay routable but are compared on output after gas like every
other venue, so route search never prefers one that nets less. API routes
(Sushi, 0x, Relay) are re-fetched and decoded at build time: the target must
be the registry contract, and the tokens, amount and recipient must match the
step before anything is signed.

## Testing your integration

```bash
npm run verify                       # types, lint, every test
npm run smoke -w @lykia/api          # live reads and simulations on Arc
npm run smoke:e2e -w @lykia/api      # plan -> verdict -> prepare -> eth_call on mainnet
```

## Listing Lykia's paid endpoints on Circle's Agent Marketplace

Lykia sells three endpoints per call in USDC on Arc over x402 (scheme
`exact`, EIP-3009 on USDC, domain `USDC` version `2`):

| Service | Route | Price |
|---|---|---|
| Fence check | `POST /v1/x402/fence/evaluate` | 0.01 USDC |
| Deep Scent report | `GET /v1/x402/scent/{token}` | 0.01 USDC |
| Route quote | `POST /v1/x402/quote` | 0.01 USDC |

Requests are validated before a payment is asked for, so a malformed request
never costs anything. Payments go to `LYKIA_X402_PAY_TO`, which defaults to
the protocol fee recipient. Circle's x402 facilitator settles each payment on
Arc before the answer is sent; settlement uses the server's `CIRCLE_API_KEY`.
Without that key the routes keep answering `402` rather than serving unpaid.

Machine-readable descriptions:

- `GET /.well-known/x402`: the service manifest (pay-to wallet, price,
  networks, settlement mode, every resource).
- `GET /v1/openapi.json`: OpenAPI 3.1 for the paid and public routes, with
  `x-x402` on each paid operation.

To list the services, the owner of the payout wallet:

1. Checks that `GET /v1/health` shows `features.x402Settlement: true` and
   that `/.well-known/x402` shows the right `payTo`.
2. Makes one paid call from a funded wallet (the `circle/x402/pay` flow in
   the Lykia app does this) and confirms the USDC arrived.
3. Submits the listing through Circle's Agent Marketplace intake form with
   the API's base URL, the OpenAPI URL above, the payout wallet and a short
   description, then completes Circle's review.

Lykia does not submit the listing itself; the payout wallet's owner does.
