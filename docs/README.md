# Lykia documentation

Lykia is the policy layer for money that agents and apps move on Arc: say
the outcome, Lykia compiles it into a route across Arc protocols and Circle
rails, the Fence checks every step, and the same engine is an API for every
builder. Start with [product.md](product.md) for the story and the app's
structure.

## Start here

- [Product: story, pillars and structure](product.md)
- [Mainnet flow proofs](flows.md): the money flows, simulated on Arc mainnet
- [Circle integration](circle/README.md): which Circle product each feature uses

## Concepts

- [Fence](fence.md): the typed policy every plan is checked against
- [Agents and sub-agents](pack.md): nested Fences and budgets (the API calls them the Pack)
- [Tag](tag.md): agent identity on ERC-8004 and policy verdict attestations
- [Leash](leash.md): a budget an outside agent cannot exceed, on chain and at the API
- [Stile](stile.md): a leash that spends from a Circle Gateway balance through an ERC-1271 policy contract
- [Lyko Autopilot](autopilot.md): Lyko signs the owner's own automations inside a leash, with a Circle developer-controlled wallet as the key
- [Knowledge model and routing](knowledge.md)
- [The intent compiler: goals, time and abstract wording](intents.md)
- [Memory](memory.md)
- [Fees](fees.md)

## Building on Lykia

- [Developer platform](platform/README.md): keys, webhooks, SDKs, CLI and
  every API family
- [Integrating a protocol](integrate-your-protocol.md)
- [Circle products in Lykia](circle.md) (endpoint-level detail)
- [Hosting](hosting.md)

## Security

- [Security layer](security/layer.md)
- [Self-review](security/self-review.md)
- [Contract ownership](security/ownership.md)
- [Audit pack](security/audit-pack.md)
- [Help us review](security/help-us-review.md)

## Project

- [Positioning](positioning.md) and [brand](brand.md)
- [Software notice](legal/software-notice.md) and [privacy note](legal/privacy-note.md)
