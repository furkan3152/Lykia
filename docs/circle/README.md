# Lykia and Circle: better together

Circle is not a competitor; Lykia is built on Circle's products and sends
them traffic. Wherever Circle already runs something, Lykia uses it instead
of rebuilding it, and adds what an agent still needs on top: a DeFi-aware
Fence, routing through every Arc venue with an executable adapter, and records of every decision.

Wording: "Built on Arc Network", "Powered by Circle", "built on Circle's
products". Lykia does not claim to be a Circle or Arc partner, and does not
claim endorsement.

## Which Circle product each Lykia feature uses

| Lykia feature | Circle product | How | Doc |
|---|---|---|---|
| Agent wallets (default path) | Developer-controlled wallets, Agent Wallets | A Circle wallet signs; Lykia's Fence preflight checks every step first. A Lykia smart account is optional. | [policies.md](policies.md) |
| Fence caps and allow/block lists | Agent Wallets spending policies | `POST /v1/circle/policies/compile` turns a Fence into the Circle policy and the CLI commands | [policies.md](policies.md) |
| Bridging | CCTP V2 + Forwarding Service, Gateway (+ Forwarding Service) | Intent bridge steps and execution providers `circle-cctp`, `circle-gateway`; Circle mints on the destination | [providers.md](providers.md) |
| FX | StableFX | Provider `circle-stablefx` (with access); quote, trade, funding presign and fund | [providers.md](providers.md) |
| Yield (restricted) | USYC Teller | Entitled wallets only: `GET /v1/circle/usyc/eligibility`, `POST /v1/circle/usyc/prepare` (Fence verdict + unsigned calls) | [../arc-circle-coverage.md](../arc-circle-coverage.md) |
| Gas | Gas Station | SCA agent wallets, sponsored by a Console policy | [providers.md](providers.md) |
| Recipient screening | Compliance Engine | DENIED becomes a Fence deny; an unscreened recipient is reported, never treated as approved | [../legal/software-notice.md](../legal/software-notice.md) |
| Paid API routes | x402 Facilitator | Settles Lykia's x402 routes on Arc; seller proof signed by a Circle wallet | [marketplace-listing.md](marketplace-listing.md) |
| Buying services | Agent Marketplace Discovery API + x402 | Discover, then pay inside the Fence (caps apply) | [marketplace-listing.md](marketplace-listing.md) |
| Front-end flows | App Kit (send / swap / bridge / earn), Onramp Kit | Client-side; pair with `POST /v1/fence/evaluate` | [providers.md](providers.md) |
| Developer tooling | Circle MCP (docs/codegen), Circle Skills | Side by side with Lykia MCP (execution planning) and Lykia skills | [mcp-and-skills.md](mcp-and-skills.md) |
| Agent mandates | Arc typed mandates and execution proofs (announced) | Adapter ready, status pending | [mandates.md](mandates.md) |

Live status: `GET /v1/circle/status` and `GET /v1/circle/providers`.
Coverage of every Arc and Circle capability, with the page each row was
checked against: [../arc-circle-coverage.md](../arc-circle-coverage.md).
