# Changelog

All notable changes to this project are documented here. The API has its
own dated version history in [docs/platform/changelog.md](docs/platform/changelog.md).

## Unreleased

### Added

- **Stile: Spend from Gateway balance**, an option inside Leash. A
  pay-invoices leash with `"spendFrom": "gateway"` spends the owner's Circle
  Gateway USDC deposited on Arc, on the chains it names, through
  `LykiaStile` (`packages/contracts/contracts/stile/`), a new ERC-1271
  contract the owner creates from their own wallet and adds as a Gateway
  delegate. The agent's key reserves each transfer on the Stile, which
  checks per-transfer, rolling daily and lifetime caps, payees,
  destinations, Gateway's fee and Lykia's fee leg and records the EIP-712
  digest; Gateway's read-only `isValidSignature` check answers only for
  reserved digests of live sessions. Lykia's fee is a second burn intent in
  the same attested set. Plan, submit (to Gateway's `/v1/transfer` with
  `contractSigner: true`), trail (Reserved on Arc, Gateway's record,
  `AttestationUsed` on the destination) and revoke (`revokeSession`, pause,
  `removeDelegate`) are the existing leash endpoints. The Fold's leash sheet
  gains a "Spend from" step with the balance per chain and the chains to
  pay on; cards show the source and the chains. Off until `LYKIA_STILE` and
  a reference deployment are set; unaudited, so at most $100 per transfer
  and $300 a day. Unit, fuzz and invariant tests; owner steps and the
  staleness window in [docs/stile.md](docs/stile.md).
- **Staged plans**: a plan whose later step spends what an earlier one
  delivers is signed stage by stage. One plan card in the chat shows "Step 1
  of 2" active and the next step dimmed; after a stage settles, the next
  step is rebuilt at prepare time from the amount its receipt shows (net
  Transfer logs, never the quote), and the Fence and the beta cap are
  checked again. A refusal or a revert pauses the plan at that step, says
  why, and offers "Retry this step" (`POST /v1/intents/:id/steps/:sid/retry`)
  or "Stop here". Independent steps of a stage go out as one Multicall3From
  transaction (`prepare` with `stage: true`). A reload resumes at the right
  stage.
- **Agent instructions** between Lyko on watch and Ask Lyko on the shared
  thread (`GET|POST /v1/agent/instructions`, `POST
  /v1/agent/instructions/:id/(pause|resume|remove)`): "Send to Ask Lyko" on an
  insight plans it as a staged plan marked "From Lyko on watch"; a watch
  request in Ask Lyko ("tell me if health drops below 1.5", "keep an eye on
  this LP") or "Watch this position" after a plan settles becomes a watch
  task in the Fold, marked "From Ask Lyko", that raises an insight when it is
  met. Lyko's tools `watch_position` and `read_instructions`; eval cases for
  the watch reader.
- **Across** as a bridge-out venue beside CCTP and Relay: quote from
  app.across.to, every field checked, `depositV3` encoded by Lykia, simulated
  on Arc mainnet; route search compares what each delivers and keeps CCTP
  when it delivers as much; a position reader for Across transfers in flight.

- **Leash**: a budget an outside agent cannot exceed. `POST /v1/leashes`
  makes a Pack agent whose Fence is a strict subset of its parent's, carves
  its daily budget from the parent (or, for a root leash, from the owner's
  own Fence), and returns the unsigned LykiaAccount session transaction
  (`createSession` from the owner, or `createSubSession` from a parent
  agent's session key) with per-token caps, payees, call rules, the expiry
  and the Fence hash, a leash key (`lk_leash_…`) shown once, an MCP config
  and optionally an ERC-8004 Tag registration. Templates: `pay-invoices`,
  `trade-small`, `earn` and `custom`.
- Leash routes: list and read with live usage from `getLimit()` and
  `spendable()` on chain, `trail` (each action marked chain-proven from its
  receipt and `AgentMemo`), `revoke` (the key stops at once; returns
  `revokeSession`), `renew` (a new carve, never an increase in place),
  `session` (bind from the `SessionCreated` event), and for the leash key
  only `plan` and `submit`. A plan outside the leash is `422 LEASH_DENIED`
  with reason codes and the remaining budget.
- Leash keys reach their own leash's routes and MCP and nothing else; with
  one, `/v1/mcp` lists only the leash's tools.
- Webhooks: `leash.budget.threshold` (50, 80, 100%), `leash.expiring`,
  `leash.revoked`, `leash.denied`.
- `lykia.leashes` in `@lykia/sdk` (and `@lykia/sdk/leashes`), `leashes` in
  the Python SDK, `lykia leash create | ls | get | trail | revoke | bind` in
  the CLI (it makes the agent's session key on your machine), and
  `examples/leash-agent`.
- The Fold's Pack tab has a Leashes section: a card per leash with budget
  meters for today and the whole leash, time left, venues or payees, the
  last actions and Revoke; and a New leash sheet (who, limits, review, then
  the keys, shown once). The Forge has a "Leash an agent" quickstart.
- Ask Lyko reads "give my bot $20 a day for a week to pay invoices" as a
  leash draft that opens the New leash sheet prefilled. Three intent-eval
  cases cover it.
- `npm run prove:leash -w @lykia/api` simulates a leash's session,
  over-cap transfers and revocation on Arc mainnet with `eth_call`.

### Changed

- Session call rules now also cover Archery's and Unitflow V3's
  `exactInputSingle`, which take the recipient at a fixed ABI word like
  Uniswap v3's, so the account can pin the output.
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
