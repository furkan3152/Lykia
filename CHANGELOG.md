# Changelog

All notable changes to this project are documented here. The API has its
own dated version history in [docs/platform/changelog.md](docs/platform/changelog.md).

## 0.1.0 (2026-11)

First public release on Arc mainnet.

### Added

- The League: Lykia's products as cities, each a real project
  (`project.league`), with public `GET /v1/league`, developer listing
  requests and an audited admin council; an idempotent seed for Lykia Pay,
  Lykia Agents and the coming Lykia Perps. Cities run on their own subdomain
  (`LYKIA_ROOT_DOMAIN`, `/c/<slug>`) with task-first city shells.
- The Mint (the developer portal as seven steps) and Letoon (the team
  console, admins only, enforced on the server).
- Intent engine with a protocol knowledge model and route search that
  scores routes net of fees, gas, slippage and risk, with on-chain
  self-check simulation.
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
- Circle-native execution paths (CCTP, Gateway, StableFX, Circle Wallets),
  Fence-to-Circle policy compilation and Agent Marketplace readiness.
- Pre-sign security layer: simulation and balance diff, address
  protection, approval hygiene, agent monitoring, audit log and circuit
  breakers.
- TypeScript and Python SDKs, CLI, React widget, web components, AI
  framework adapters and an MCP server.
