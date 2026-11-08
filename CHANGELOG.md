# Changelog

All notable changes to this project are documented here. The API has its
own dated version history in [docs/platform/changelog.md](docs/platform/changelog.md).

## Unreleased

### Changed

- The developer portal is now **The Forge** (it was The Mint, which read
  as minting an NFT). It lives at `/forge/:section`; every `/mint` path
  redirects to its `/forge` twin with its query and hash (a 308 from
  `vercel.json`, then the app's own redirect). The nav icon is an anvil and
  the Strike animation is a hammer on an anvil. `forge` joins the reserved
  city slugs; `mint` stays reserved.
- The landing page leads with what Lykia is in one line and the three ways
  in (Ask Lyko, The Fold, The Forge), followed by "Where USDC and Circle sit
  in Lykia": one USDC through a Lykia step, each stop tagged with the
  Circle, Arc or Lykia primitive it uses, and the integrations beside the
  router. The pillars and "Better together" sections are folded into it.
- The README and `docs/circle/README.md` carry the same primitive table,
  with the file or endpoint for each row; a web test keeps them in step
  with the landing. Circle Wallets are described as what they are:
  optional and off by default.
- Contrast and tap targets: sea tags and the network toggle use the darker
  sea, footer headings and notes meet WCAG AA, small buttons and footer
  links are 44 px tall on phones, and a link to `/#section` scrolls to it.

## 0.1.0 (2026-11)

First public release on Arc mainnet.

### Added

- The League, which hosts cities: each a real project
  (`project.league`), with public `GET /v1/league`, developer listing
  requests and an audited admin council; an idempotent seed for the official
  cities (Lykia Pay, Lykia Agents, later Lykia Perps), which are being
  launched and are not listed yet. Cities run on their own subdomain
  (`LYKIA_ROOT_DOMAIN`, `/c/<slug>`) with task-first city shells.
- The developer portal as seven steps (now The Forge) and Letoon (the team
  console, admins only, enforced on the server).
- Ask Lyko (every action from one sentence) and The Fold (Flock, Trails,
  Herding, Pack and Fence tabs, with Lyko on watch), including a position
  map over every protocol Lykia reads on Arc.
- Intent engine with a protocol knowledge model and route search that
  scores routes net of fees, gas, slippage and risk, with on-chain
  self-check simulation. 13 protocols are routable (Arc transfers, CCTP,
  Gateway, Morpho vaults, Morpho Blue, Aave V4, Uniswap v3, Uniswap v4,
  Aerodrome Slipstream, Archery, Unitflow Finance V3, SushiSwap and Relay),
  plus the vaults of 5 curators reached through Morpho (Galaxy, Keyrock,
  Steakhouse, Gauntlet, Bitwise); 0x joins only with `ZEROX_API_KEY`. The
  registry maps 94 protocols on Arc.
- The Fence policy engine, the Whistle kill switch and verdict digests in
  Arc Memos; ERC-8004 agent identities (Tag) and ERC-8354 verdict
  attestations.
- `LykiaAccount`, `LykiaAccountFactory`, `LykiaRouter` and `LykiaOrders`
  contracts on Arc mainnet.
- Aggregator API (quote and build for every action kind), natural-language
  routing, protocol adapter manifests and generic contract tools.
- Developer platform: test and live keys, scopes, quotas, idempotency,
  signed webhooks, request logs, billing and an OpenAPI 3.1 document.
- Payouts, invoices with hosted payment links, an agents API and unified
  automations.
- Circle-native routes (CCTP, Gateway) and integrations (Circle Wallets,
  StableFX RFQ taker endpoints, USYC Teller, the x402 facilitator),
  Fence-to-Circle policy compilation and Agent Marketplace readiness.
- Lykia's protocol fee (1%, paid in the same transaction as the step) and
  the mainnet beta cap ($1,000 per step and $5,000 per day per owner) while
  the contracts are unaudited.
- The app at https://lykiaai.com, the API at https://api.lykiaai.com and
  League cities at `<slug>.lykiaai.com`.
- Pre-sign security layer: simulation and balance diff, address
  protection, approval hygiene, agent monitoring, audit log and circuit
  breakers.
- TypeScript and Python SDKs, CLI, React widget, web components, AI
  framework adapters and an MCP server.
