# USDC and Circle in Lykia

This page is the authoritative map of where USDC, Circle and Arc sit in
Lykia. The README and the landing page ("Where USDC and Circle sit in
Lykia") show the same rows; a web test keeps the three in step
(`apps/web/src/features/circle/usdcPath.ts`). Every row names the file or
endpoint that does it.

USDC is what Lykia moves, the unit it works in and what every step pays gas
with on Arc. Circle's rails carry it; Lykia adds the route (across the Arc
venues it has an executable adapter for), the Fence and a record of every
verdict.

Wording: "Built on Arc Network", "Powered by Circle", "built on Circle's
products". Lykia is an independent project. It does not claim to be a
Circle or Arc partner, and does not claim endorsement.

## One USDC through a Lykia step

1. **USDC in the wallet.** The owner's wallet or agent holds it; Lykia never
   holds keys.
2. **The Fence checks it in USD.** Caps per step, intent, day and week,
   recipients, tokens. The mainnet beta cap ($1,000 per step, $5,000 per
   day) sits above any Fence.
3. **The route is simulated.** Candidate routes are scored on what the owner
   ends up with after Lykia's fee, gas and slippage; the winner runs as one
   `eth_call` on Arc before it is offered.
4. **One transaction.** From a wallet, approve, act and an Arc Memo with the
   verdict digest go out as one Multicall3From transaction (a single call
   with no approval needs only the Memo). Gas is paid in USDC. Lykia's 1%
   fee is a transfer in the same transaction, in the token the step spends
   (a borrow pays it in the borrowed token). A `LykiaAccount` smart account
   runs the same calls as plain calls after its on-chain Fence check.
5. **Settled.** Arc's finality is deterministic: the step is final when its
   block is included.
6. **Optionally out.** CCTP V2 burns the USDC on Arc and it is minted on the
   destination, or Gateway holds it as one unified balance.

## Primitive by primitive

The first nine rows are the path above; the rest sit beside the router and
are not routes (EURC is a token that routes convert to).

| Primitive | From | Where Lykia uses it | File or endpoint |
|---|---|---|---|
| USDC | Circle | The token Lykia moves and the unit it works in: amounts, quotes and Fence caps are in USD, and routes are scored on what the owner ends up with. | `packages/core/src/assets.ts`, `apps/api/src/engine/search.ts` |
| USD caps | Lykia | The Fence checks every step in USD before signing. The mainnet beta cap is $1,000 per step and $5,000 per day, above any Fence. | `packages/core/src/fence.ts`, `LYKIA_BETA_CAP_USD` in `apps/api/src/config.ts` |
| eth_call | Arc | The winning route runs as one `eth_call` on Arc before it is offered. | `apps/api/src/engine/simulate.ts` |
| Multicall3From | Arc | From a wallet, approve, act and the Memo go out as one transaction with one signature. Lykia's smart account runs the same calls after its on-chain Fence check. | `apps/api/src/engine/calls.ts` |
| Arc Memo | Arc | From a wallet, the value-moving call of every step carries its intent id and the Fence verdict digest. | `apps/api/src/engine/calls.ts`, `packages/core/src/memo.ts` |
| Gas in USDC | Arc | Arc's gas token is USDC, so every Lykia step pays gas in USDC. Lykia's 1% fee is a transfer in the same transaction, in the token the step spends (a borrow pays in the borrowed token). | `packages/core/src/networks.ts`, `apps/api/src/engine/planner.ts`, `GET /v1/fees` |
| Deterministic finality | Arc | A step is final when its block is included; Lykia waits for no confirmations. | `packages/core/src/networks.ts` |
| CCTP V2 | Circle | Bridge steps burn USDC on Arc; after Circle's attestation it is minted on the destination, and Circle's Forwarding Service can submit that mint. | `apps/api/src/circle/cctp.ts`, `POST /v1/circle/cctp/forward` |
| Gateway | Circle | Gateway deposits and transfers: one unified USDC balance across chains. | `apps/api/src/circle/gateway.ts`, `GET /v1/circle/gateway/balance` |
| EURC | Circle | Circle's euro stablecoin. USDC to EURC conversions route on Arc and are checked against the Fence's FX band. | `packages/core/src/assets.ts`, `packages/core/src/fence.ts` |
| Compliance Engine | Circle | With `CIRCLE_API_KEY`, a send recipient it denies becomes a Fence deny. An unscreened recipient is reported, never treated as approved. | `apps/api/src/circle/compliance.ts`, `POST /v1/circle/screen` |
| Circle Wallets | Circle | Optional, off by default (`LYKIA_CIRCLE_SERVER_WALLETS=true`): developer-controlled SCA wallets on Arc, each bound to the address that created it. | `apps/api/src/circle/walletRegistry.ts`, `POST /v1/circle/wallets/agent` |
| Agent Wallet policy | Circle | A Fence exports as a Circle Agent Wallet spending policy. Lykia never applies it: the owner runs the returned Circle CLI commands. | `apps/api/src/circle/policy.ts`, `POST /v1/circle/policies/compile` |
| StableFX | Circle | RFQ endpoints (quote, trade, funding) for USDC and EURC, with Circle StableFX access. A reference quote beside the engine's, not a route. | `apps/api/src/circle/stablefx.ts`, `POST /v1/circle/stablefx/quote` |
| USYC Teller | Circle | Subscribe and redeem for wallets Circle has entitled; Lykia reads the entitlement first and refuses otherwise. | `apps/api/src/circle/usyc.ts`, `POST /v1/circle/usyc/prepare` |
| x402 facilitator | Circle | Settles Lykia's paid API routes in USDC; Circle's facilitator is the default. | `apps/api/src/x402/x402.ts`, `GET /.well-known/x402` |
| Agent Marketplace | Circle | Agents discover x402 services and pay them in USDC, inside their Fence caps. | `apps/api/src/circle/discovery.ts`, `POST /v1/circle/x402/prepare` |
| ERC-8004 | Arc | Agent identities (Tags) in the ERC-8004 registries on Arc, each pinning the hash of its Fence. | `apps/api/src/tag/tag.ts`, `packages/core/src/contracts.ts` |

## Beside Lykia, not used by it

These Circle tools work well next to Lykia, but Lykia's code does not call
them, so they are not in the table above:

- **App Kit and Onramp Kit**: client-side flows; a front end that uses them
  can still ask `POST /v1/fence/evaluate` before signing
  ([providers.md](providers.md)).
- **Circle MCP and Circle Skills**: docs and code generation, side by side
  with Lykia's MCP server, which plans and checks
  ([mcp-and-skills.md](mcp-and-skills.md)).
- **Gas Station**: an operator who turns Circle Wallets on can sponsor their
  gas with a Gas Station policy in the Circle Console; Lykia does not set it.
- **Arc typed mandates and execution proofs**: announced, no public
  specification yet; an adapter is ready and its status is pending
  ([mandates.md](mandates.md)).

More detail: Fence to Circle wallet policy in [policies.md](policies.md),
execution providers in [providers.md](providers.md), the Agent Marketplace
listing in [marketplace-listing.md](marketplace-listing.md).

Live status: `GET /v1/circle/status` and `GET /v1/circle/providers`.
Coverage of every Arc and Circle capability, with the page each row was
checked against: [../arc-circle-coverage.md](../arc-circle-coverage.md).
