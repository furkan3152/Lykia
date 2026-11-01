# Lykia: a brief for the Arc and Circle teams

Lykia is built on Arc Network and on Circle's products. Arc gives agents money. Lykia gives them judgment, and sends their stablecoins to the protocols already live on Arc. It is open source and built by one developer, without a company. It is not affiliated with Circle or Arc.

## The problem

Arc is built for agents that move stablecoins. An agent that only has a spending limit can still make bad DeFi moves: it can swap into a look-alike token, borrow down to a dangerous health factor, take a bad FX rate, or send funds to a stranger. Today every team building an agent on Arc has to write its own planning, routing and safety code, and then integrate each protocol one by one.

## What Lykia is

Lykia sits between agents and the Arc ecosystem. It does not compete with any part of it.

- **One intent reaches every Arc protocol.** A sentence or a typed action ("put half my USDC to work, convert 20% to EURC, bridge the rest to Base") becomes a plan across the venues that are live on Arc. Each step is quoted live, and the plan explains why each venue won.
- **Every plan passes a Fence.** The Fence is a typed rule document: caps, recipients, venues, tokens, slippage, health factor, FX band against Chainlink, token checks (Scent), hours and signers. If a fact is missing, it denies. The Whistle stops new risk and still lets value come home.
- **Agents are a tree.** An owner's agents can spawn sub-agents whose Fence and budget must fit inside the parent's. The rule holds off chain (`packages/core/src/pack.ts`) and on chain (`LykiaAccount` sub-sessions).
- **The server never signs.** Lykia prepares unsigned transactions. The owner's wallet, a passkey smart account or a bounded agent session signs.

## Circle and Arc products Lykia uses

| Product | How Lykia uses it | Code |
|---|---|---|
| USDC as gas, deterministic finality | A step on Arc settles as soon as its receipt exists; native USDC (18 decimals) and the ERC-20 face (6 decimals) are handled as one balance | `packages/core/src/amounts.ts`, `packages/core/src/networks.ts` |
| Arc Memo | Each value-moving call carries a memo with the outrun id, the step and the Fence verdict digest | `packages/core/src/memo.ts`, `apps/api/src/engine/calls.ts` |
| Multicall3From | Approve, action, protocol fee and memo go out as one transaction with the owner as `msg.sender` | `apps/api/src/engine/calls.ts` |
| ERC-8004 registries | An agent's Tag is its ERC-8004 identity with the Fence hash pinned; verdicts can be filed to the ValidationRegistry in the ERC-8354 format | `packages/core/src/erc8354.ts`, the Tag module in core and the Tag service in `apps/api/src` |
| CCTP V2 and Forwarding Service | Bridging USDC out of Arc, inbound mints, live fees per route | `apps/api/src/engine/adapters.ts`, `apps/api/src/circle/` |
| Gateway | Unified balance in the Flock, deposits in plans, transfers out (burn intent, attestation, unsigned mint) | `apps/api/src/circle/` |
| Gateway Nanopayments and x402 | Paid API routes in USDC on Arc, and an x402 buyer whose price and payee the Fence checks | `apps/api/src/x402/`, `apps/api/src/circle/` |
| Agent Marketplace | Agents discover services and pay them inside the Fence; Lykia's own x402 routes are listing-ready | `apps/api/src/circle/`, `docs/circle/marketplace-listing.md` |
| Agent Wallets policies | A Fence compiles into the Circle wallet's spending policy; Lykia's preflight covers the rest (default agent setup) | `apps/api/src/circle/policy.ts` |
| x402 Facilitator | Settles Lykia's paid routes on Arc | `apps/api/src/x402/` |
| Compliance Engine | Screening results feed the Fence's recipient deny list | `apps/api/src/circle/` |
| Developer-controlled wallets and Gas Station | Agent wallets for Pack agents, with sponsored gas | `apps/api/src/circle/` |
| Modular Wallets (passkeys) | Passkey smart accounts on Arc as a sign-in and signing option | `apps/web/src/features/wallet/` |
| StableFX | Taker flow wired behind Circle credentials; until access is granted, FX routes through on-chain pools checked against Chainlink | `apps/api/src/circle/` |
| App Kit, Circle Skills, Arc docs MCP, Arc Studio | Listed in the Build page's Arc tools tab for developers | `apps/web/src/pages/build/` |

Full product status: `GET https://lykia-api-akdogan1.vercel.app/v1/circle/status` and `docs/circle.md`.

## What Lykia gives back to the ecosystem

- **Flow to Arc protocols.** Every plan routes to venues on Arc: Aave V4, Morpho Vault V2 and Morpho Blue, Uniswap v3 and v4, Aerodrome Slipstream, Circle's own rails. Lykia keeps no custody.
- **Open developer surface.** REST API, server-sent events, an MCP server (`/v1/mcp`) and a typed SDK (`packages/sdk`), so any agent framework can plan inside a Fence.
- **Standards.** An implementation of ERC-8004 Tags and ERC-8354-format policy verdicts on Arc mainnet.
- **A path for protocols.** Arc protocol teams can be added through a documented integration program (`docs/integrate-your-protocol.md`).
- **Demand for Circle services.** Agents find and pay for Agent Marketplace services within their Fence.

## Live today on Arc mainnet

- App: https://lykia-akdogan1.vercel.app
- API: https://lykia-api-akdogan1.vercel.app (`/v1/health`)
- Contracts, created directly by the owner wallet `0x8c5281055b197443ff01dbbdfbf29fd63946ca1e` and code-verified against the artifacts:
  - `LykiaAccountFactory` `0x810e8db89f4c4e8fa814ed3ed0d636d3416dd7f9`
  - `LykiaRouter` `0xc9c0ea4d22ddbef4504a634759fb78334efc5d18`
- Executable venues and simulated batches: see `apps/api/README.md`, "What is live".
- Lyko, the orchestrator, runs with a model when a key is configured and deterministically without one.

## Next

- Deploy `LykiaOrders` (limit, stop, take-profit, TWAP, DCA) and allowlist venues on `LykiaRouter`.
- Move the API to an always-on host so standing orders and keepers run every 30 seconds.
- First real end-to-end transactions with small amounts, then pilots with teams building agents on Arc.
- Community review of the contracts. There is no budget for a paid audit; the self-review is `docs/security/self-review.md` and the beta caps stay on because of that.

## Our asks

1. **Builder programs open to individuals.** Arc microgrants, hackathons and, if eligible, Circle Developer Grants.
2. **Review.** Security-minded builders reviewing the contracts (`docs/security/help-us-review.md`).
3. **Introductions.** Contacts at Arc protocol teams to make their venues executable and verified in the registry.
4. **Agent Marketplace listing.** Review of Lykia's submission (Fence check, Scent and route quotes as x402 services).
5. **Co-marketing.** A joint post or demo once pilots are live.
