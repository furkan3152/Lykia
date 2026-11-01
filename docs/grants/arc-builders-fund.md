# Arc Builders Fund: application draft

Program: https://www.circle.com/blog/introducing-the-arc-builders-fund (Circle Ventures).

Published focus: teams whose products need Arc's unique attributes, that can show a path to real use cases, and that build primitives other Arc projects will want to compose with. Arc's request for builders (https://www.arc.io/blog/the-unfinished-business-of-finance-machine-commerce-and-global-money) names programmable money and machine commerce. This draft answers those three points.

Fields marked **[OWNER]** must be filled in by the owner.

## Why Lykia needs Arc

- **USDC as gas** gives agents one balance and predictable fees. Lykia treats native USDC (18 decimals) and the ERC-20 face (6 decimals) as one balance.
- **Deterministic sub-second finality** lets a multi-step plan advance step by step as soon as each receipt exists.
- **Arc Memo** ties every transaction to the plan and the Fence decision that allowed it.
- **Multicall3From** lets approve, action, fee and memo run as one transaction with the owner as sender.
- **ERC-8004 on Arc** gives agents an identity that carries the hash of the rules they follow.
- **Circle's rails** (CCTP, Gateway, Nanopayments, StableFX, Agent Marketplace) are first-class on Arc.

## A primitive others compose with

- The Fence (`lykia.fence/v1`): a typed, hashable rule document with a fail-closed evaluator, published in `@lykia/core`.
- `LykiaAccount`: an account where agents act through sessions and sub-sessions that must fit inside their parent, with a Whistle that stops new risk.
- `LykiaRouter` and `LykiaOrders`: atomic multi-venue execution and keeper-executed conditional orders on Arc venues.
- An SDK, an MCP server and a REST API so agent frameworks can plan inside a Fence without integrating each protocol.

## Path to real use cases

- Business treasuries: payees with invoice memos, FX bands, office hours (the Treasury template).
- Autonomous agents paying for services within small caps (the Caravan template) through x402.
- Yield management across Arc vaults and lending markets with a minimum health factor.

Current state and evidence: `docs/pitch/arc-circle-brief.md`. Pilot plan: `docs/pilots/pilot-kit.md`.

## Team and terms

- Team: **[OWNER]**
- Traction to date: **[OWNER: only verifiable figures]**
- Raise or support requested: **[OWNER]**
- Use of funds: **[OWNER: audit, engineering, pilots, hosting]**
