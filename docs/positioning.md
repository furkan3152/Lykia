# Positioning

> Lykia is the policy layer for money that agents and apps move on Arc: say
> the outcome, Lykia compiles it into a route across Arc protocols and Circle
> rails, the Fence checks every step, and the same engine is an API for every
> builder.

The full story, the three pillars and the app's structure are in
[product.md](product.md).

Lykia brings the Arc Network ecosystem together. Circle is not a
competitor: Lykia is built on Circle's products, and wherever Circle already
runs something (wallet policies, CCTP, Gateway, StableFX, the x402
facilitator, the Agent Marketplace) Lykia integrates it instead of
rebuilding it ([circle/README.md](circle/README.md)). It sends traffic to
the protocols it can route through and links each protocol it maps to its
official entry on https://www.arc.io/ecosystem.

## Three parts, one sentence

| Part | What it means | Where it shows |
|---|---|---|
| Built on Circle's rails | USDC is Arc's gas and Lykia's unit of account. CCTP and Gateway are routes in the engine. Circle Wallets (optional, off by default), Compliance screening, StableFX (RFQ taker endpoints), the USYC Teller, the x402 facilitator and the Agent Marketplace are integrated beside it. | `GET /v1/circle/status`, the Circle quay on `/ecosystem` |
| Mapping the protocols on Arc, routing through the executable ones | Each protocol Lykia knows on Arc is in the registry, marked routable, read-only or mapped. Only venues with an executable adapter are routable; Lykia compares them for each move and records why it chose one. Teams can integrate in an afternoon. | `GET /v1/ecosystem`, `/ecosystem`, `docs/integrate-your-protocol.md` |
| Keeping every agent inside its Fence | The Fence checks every step before it can be signed: caps, recipients, venues, tokens, health factor, FX band, token checks and the Whistle (emergency stop). Each verdict is filed as an ERC-8354 policy attestation. | `docs/fence.md`, `POST /v1/fence/evaluate` |

## Words to use

- "Built on Arc Network" (first mention), then "Arc".
- "Powered by Circle" for Circle's products. Text only; no partner logos
  without the brand kit and permission.
- "Routes to", "brings together", "sends traffic to" for protocols.
- "Fence" and "Tag" as product terms, explained on first use. Plain words
  elsewhere: "holdings" (not Flock), "agents" (not Pack), "token check"
  (not Scent), "plan" (not Outrun), "emergency stop" next to "Whistle".
  See [product.md](product.md#vocabulary).

## Words to avoid

- "Partner", "partnership", "endorsed by", "official partner" about Circle or Arc:
  there is no signed agreement. Say "built on Circle's products".
- "Competitor" about Circle, or any copy that sets Lykia against a Circle
  product.
- Anything that positions Lykia against Circle, Arc or a protocol
  ("replaces", "instead of", "better than").
- "Arc" inside Lykia's own name, logo or page titles (Arc's brand rules).
- "Safe" about a token: the token check says what can be proven, never "safe".

## Mainnet beta

Lykia's own contracts have not had a paid audit: it is a one-person,
unfunded project. That is why every mainnet move
is capped at $1,000 per step and $5,000 per day per owner, above every Fence.
Moves that bring value home are never capped. The cap is in `GET /v1/health`
and `GET /v1/fees`, and the app shows "Beta · contracts not yet audited · caps
apply" in the deck and on every plan.
