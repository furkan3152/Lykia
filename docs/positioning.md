# Positioning

> Built on Arc Network and Circle's products: every Arc protocol routable on
> Lykia, every agent inside its Fence.

Lykia is the unifier and amplifier of the Arc Network ecosystem. Circle is
not a competitor: Lykia is built on Circle's products, and wherever Circle
already runs something (wallet policies, CCTP, Gateway, StableFX, the x402
facilitator, the Agent Marketplace) Lykia integrates it instead of
rebuilding it (`docs/circle/README.md`). It sends traffic to every protocol
and links each one to its official entry on https://www.arc.io/ecosystem.

## Three parts, one sentence

| Part | What it means | Where it shows |
|---|---|---|
| Built on Circle's rails | USDC is Arc's gas and Lykia's unit of account. CCTP, Gateway, StableFX, Circle Wallets, Compliance screening, the x402 facilitator and the Agent Marketplace do the moving; Lykia uses every one that is live on Arc. | `GET /v1/circle/status`, the Circle quay on `/ecosystem` |
| Routing value to every Arc protocol | Every protocol on Arc is in the registry. Lykia compares the routable ones for each move and records why it chose one. Teams can integrate in an afternoon. | `GET /v1/ecosystem`, `/ecosystem`, `docs/integrate-your-protocol.md` |
| Keeping every agent inside its Fence | The Fence checks every step before it can be signed: caps, recipients, venues, tokens, health factor, FX band, Scent and the Whistle. Each verdict is filed as an ERC-8354 policy attestation. | `docs/fence.md`, `POST /v1/fence/evaluate` |

## Words to use

- "Built on Arc Network" (first mention), then "Arc".
- "Powered by Circle" for Circle's products. Text only; no partner logos
  without the brand kit and permission.
- "Routes to", "brings together", "sends traffic to" for protocols.
- "Fence", "Tag", "Scent", "Whistle", "Flock" as in `docs/brand.md`.

## Words to avoid

- "Partner", "partnership", "endorsed by", "official partner" about Circle or Arc:
  there is no signed agreement. Say "built on Circle's products".
- "Competitor" about Circle, or any copy that sets Lykia against a Circle
  product.
- Anything that positions Lykia against Circle, Arc or a protocol
  ("replaces", "instead of", "better than").
- "Arc" inside Lykia's own name, logo or page titles (Arc's brand rules).
- "Safe" about a token: Scent says what can be proven, never "safe".

## Mainnet beta

Lykia's own contracts have not had a paid audit: it is a one-person,
unfunded project. That is why every mainnet move
is capped at $1,000 per step and $5,000 per day per owner, above every Fence.
Moves that bring value home are never capped. The cap is in `GET /v1/health`
and `GET /v1/fees`, and the app shows "Beta · contracts not yet audited · caps
apply" in the deck and on every plan.
