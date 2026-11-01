# Positioning

Lykia is the judgment and policy layer that sits above Circle's rails on Arc
Network. It does not compete with them.

## The three layers

| Layer | What it answers | Who provides it on Arc |
|---|---|---|
| Rails | Can value move: send, bridge, swap, earn, borrow? | Circle (USDC, CCTP, Gateway, StableFX, App Kits, Agent Stack wallets), plus DEXes and lending markets |
| Limits | How much may an agent spend, and to whom? | Spending boxes such as arc-mandate (apexfaucet), AgentGuard, Agent Stack spending policies, and LykiaAccount itself |
| Judgment | Should this DeFi move happen at all, where, and is the agent still inside its owner's intent? | Lykia |

## How Lykia relates to each neighbour

- **Circle App Kit and Agent Stack.** These are rails that Lykia uses. App Kit
  is an alternative execution path, Agent Stack wallets can hold a pup's
  funds, and Marketplace services are tools Lyko can call. Lykia's
  contribution is deciding what to do with the rails, inside a Fence.
- **Spending boxes (arc-mandate, AgentGuard, Arc Guard Agent, Callipsos).**
  These cap amounts, payees and dates. Lykia includes that capability, since
  LykiaAccount enforces caps and allowlists on chain, and it adds rules that a
  spending box cannot express:
  - **Health factor** after a borrow or withdraw.
  - **FX band** against the Chainlink reference rate.
  - **Slippage ceiling.**
  - **Scent level** for any token the plan acquires.
  - **Venue allow and deny lists.**
  - **Schedules.**
  - **Fail closed** whenever a needed fact is missing.
- **Routers and aggregators.** These pick a route but do not apply policy.
  Lykia picks a route among every capable Arc venue and refuses to sign any
  route the Fence denies.
- **ERC-8004 identity providers (ArcID).** These provide identity and
  reputation. Lykia writes into the same registries: a Tag pins the Fence
  hash, and verdicts are filed as ERC-8354 attestations.
- **ERC-8354.** Lykia is an early implementer of the attestation layer. It
  uses the draft's envelope, action commitment, policy kinds and attestation
  struct, and labels its verdicts as mediated rather than zero-knowledge (see
  [tag.md](tag.md)).

## What only Lykia combines

1. **A DeFi-aware Fence that fails closed.**
2. **The Pack.** Sub-agents whose Fences and budgets are strict subsets of
   their parent's, enforced both by the API and by LykiaAccount sub-sessions
   on chain.
3. **Policy-checked routing across Arc venues,** with the reason each venue
   won.
4. **Intent memory and EN/TR intent understanding.**
5. **One developer surface:** REST, SSE, MCP, SDK and x402.

## Wording rules

- In the product UI, describe the layers generically ("rails", "spending
  boxes", "limits"). Never name competitors there; names stay in this
  document.
- Say "Built on Arc Network" or "on Arc". "Arc" never appears in Lykia's own
  brand.
- Lykia does not call its verdicts zero-knowledge, and it does not claim to be
  an ERC-8354 Guard.
