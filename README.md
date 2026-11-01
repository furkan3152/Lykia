# Lykia

**Arc gives agents money. Lyko keeps them in line.**

> Built on Circle's rails, routing value to every Arc protocol, keeping every
> agent inside its Fence.

Lykia is the agent and stablecoin desk of the Kletia family, built on Arc
Network. Say an outcome in plain words, and Lykia does four things:

1. Plans it across the venues that are live on Arc.
2. Checks the plan against your **Fence**, a typed rule book around an
   agent or around yourself.
3. Hands each step to your own wallet, or to an agent wallet, to sign.
4. Tracks every step until it is final, which on Arc takes under a second.

Lyko is a big Anatolian shepherd dog. He keeps the flock (your
agents and assets) inside the Fence and the wolves (scam tokens, rug pulls,
exploits) outside it.

| Product | Focus |
|---|---|
| Kletia | Flagship: multi-chain intent infrastructure |
| Elyia | Trading |
| Lykia | Agents and stablecoins, built on Arc Network |

## What makes it Arc-native

| Arc feature | How Lykia uses it |
|---|---|
| USDC as gas, deterministic finality | A step on Arc is settled once its receipt exists, so the Outrun follows the money live. Lykia handles both forms of USDC: native (18 decimals) and ERC-20 (6 decimals). |
| Arc Memo | Every value-moving call carries a memo with the outrun id, the step and the Fence verdict digest, or an invoice reference for payments. |
| Multicall3From (CallFrom) | The approve, the action and the memo go out as one final transaction while the user stays `msg.sender`. |
| ERC-8004 | A **Tag** is an agent identity whose card pins the hash of the Fence it follows. Fence verdicts can be filed to the ValidationRegistry. |
| CCTP V2, Gateway | Bridging USDC out of Arc with attestation tracking, and deposits into the unified Gateway balance. |
| StableFX, Chainlink | USDC/EURC conversion, checked against the Chainlink EURC/USD reference rate (the Fence's FX band). |
| x402 | Paid routes priced per call in USDC on Arc. |

Every Circle and protocol address in the registry was checked on-chain with
`eth_getCode` on Arc mainnet (5042) and testnet (5042002).

## Why Lykia

Lykia brings the Arc ecosystem together. It is built on Circle's rails, it
routes value to every Arc protocol, and it keeps every agent inside its
Fence.

| Part | What it means | Where to see it |
|---|---|---|
| Built on Circle's rails | USDC, CCTP, Gateway, StableFX, Circle Wallets, Compliance screening, the x402 facilitator and the Agent Marketplace move the value. Lykia uses every Circle product that is live on Arc and sends more traffic their way. | `GET /v1/circle/status` |
| Routing value to every Arc protocol | Every Arc protocol is in the registry. For each move Lykia compares the routable ones and records why it chose one. Any team can integrate (`docs/integrate-your-protocol.md`). | `/ecosystem`, `GET /v1/ecosystem` |
| Keeping every agent inside its Fence | Every step is checked before it can be signed, and each verdict is filed as an ERC-8354 policy attestation. | `docs/fence.md` |

**Mainnet beta.** Lykia's contracts have not had a paid audit (an open-source,
one-person project with no budget for one; see `docs/security/self-review.md`).
That is why every mainnet move is capped at $1,000 per step and $5,000 per day per owner,
above every Fence (`LYKIA_BETA_CAP_USD`). Moves that bring value home are
never capped.

What sets Lykia apart:

- **A DeFi-aware Fence.** It checks health factor, FX band, slippage, Scent
  results, venues, hours, recipients and caps. If a fact it needs is
  missing, it denies.
- **The Pack.** A sub-agent's Fence and budget must sit inside its parent's.
  This is checked by the API and enforced on chain by LykiaAccount
  sub-sessions.
- **Policy-checked routing.** Every capable Arc venue is compared, and the
  chosen route must pass the Fence before anything can be signed.
- **Memory.** Lyko remembers venues, payees and habits, and asks before
  trusting anything new.
- **Public verdicts.** Each verdict can be filed to the ERC-8004 Validation
  Registry as an [ERC-8354](https://eips.ethereum.org/EIPS/eip-8354) policy
  attestation. The attestation commits to the Fence without revealing it.
  See [docs/tag.md](docs/tag.md) and
  [docs/positioning.md](docs/positioning.md).

## Better together with Circle

Lykia is built on Circle's products and integrates them instead of
duplicating them. The default agent setup is a **Circle wallet plus Lykia's
Fence preflight**: `POST /v1/circle/policies/compile` turns a Fence into
the wallet's Circle spending policy and reports which rules Lykia enforces
on top. A Lykia smart account (`LykiaAccount`) is optional, for on-chain
enforcement. Circle execution providers (CCTP, Gateway, StableFX, Circle
wallets) are offered beside Lykia's own routes and labelled "Powered by
Circle". See [docs/circle/README.md](docs/circle/README.md). Lykia is not
affiliated with or endorsed by Circle or Arc.

## Pillars

- **Fence**: limits on caps, recipients, venues, tokens, slippage, health
  factor, FX band, Scent level, hours and signers. If a fact it needs is
  missing, it denies. The **Whistle** stops all new risk but still lets value
  come home. See [docs/fence.md](docs/fence.md).
- **Tag**: an on-chain licence for agents (ERC-8004 plus the Fence hash),
  so anyone can check which rules an agent follows.
- **Outrun**: a plan drawn as an arc from the start to the **Fold**. Each
  waypoint is named after a stop on the Lycian Way.
- **Scent**: what can be proven about a token before anyone touches it:
  registry and look-alike checks, proxies, privileged functions, the owner
  and a simulated transfer. Scent never calls a token safe.
- **Flock**: one balance sheet for the wallet, the Gateway balance and
  venue positions, priced with Chainlink. A token without a price shows as
  "unpriced", never as zero.
- **Lyko agent, MCP, x402**: agents can plan and inspect through REST or MCP.
  The server never signs.

## Workspaces

```
packages/core/   @lykia/core — zero-I/O spec: networks, contracts, tokens, venues,
                 intent graph, Fence, verdicts, Tag, memos, Outrun, lore
packages/sdk/    @lykia/sdk  — typed client; modular subpaths (/intents, /fence, /agents,
                 /circle, /ecosystem, /projects) and typed events
packages/widget/ @lykia/widget — React components + headless hooks, in the host's brand
packages/embed/  @lykia/embed — <lykia-assistant>, <lykia-swap>…: one script tag
packages/agent-tools/ @lykia/agent-tools — JSON Schema tools + AI SDK, LangChain,
                 OpenAI and Anthropic adapters; MCP as the zero-code path
apps/api/        @lykia/api  — Express 5 service on Arc (see its README)
apps/web/        @lykia/web  — the pixel deck: Lyko, the valley, Deck, Flock, Fence,
                 Scent, Tag, developers (see its README)
docs/            the Fence spec, brand notes, positioning, the integration guide and
                 docs/platform (projects, embeds, agents: building on Lykia)
examples/        agent over MCP, SDK in Node, embed, nextjs-widget, html-embed,
                 headless-hooks, ai-sdk-agent
```

## Quick start

Requires Node 22.12 or newer.

```sh
npm ci
npm run dev:api        # http://localhost:3002
npm run dev:web        # http://localhost:5176
```

`npm run verify` runs the whole gate: package build and tests, lint,
typecheck, the API and web test suites, and both app builds.
`npm run smoke:e2e -w @lykia/api` runs a mainnet dry run end to end: plan with
the fee, Fence verdict, prepared calldata and an `eth_call` simulation of
every call, plus the beta cap and the x402 challenge. It signs nothing.

## Status

Lykia is non-custodial and fails closed. It has not been independently
audited.

**Live on mainnet:**

- Transfers with memos
- Morpho Vault V2 deposits and withdrawals
- Uniswap v3 swaps and USDC/EURC conversion
- CCTP and Gateway deposits

**Live on testnet:** the Circle venues only. Morpho and Uniswap are not
deployed on Arc testnet.

**Listed but not executable yet:**

- **Borrowing and repaying.** Arc runs Aave V4 and Morpho Blue; both are in
  the registry, but Lykia cannot execute them yet.
- **The StableFX taker flow.** It needs Circle credentials.

The [API README](apps/api/README.md#what-is-live) has the details.

## License

[MIT](LICENSE)
