# The Pack (`lykia.pack/v1`)

The Pack is Lykia's agent tree. Lyko, the orchestrator, sits at the root and never signs. An owner creates agents, and each agent has a role and a Fence. An agent that has the `spawn` capability can create sub-agents. Every agent works inside its own Fence, so a sub-agent can never do something its parent may not.

## Two invariants

1. **A child's Fence is inside its parent's Fence.** `subFenceViolations(parent, child)` in `@lykia/core` checks every field of the Fence. Equal values are allowed, which means a sub-agent can inherit its parent's Fence unchanged.

| Field | Rule for the child |
|---|---|
| `mode` | Can only get tighter. A `live` parent allows any mode. A `whistle` parent allows `whistle` or `dry-run`. A `dry-run` parent allows only `dry-run`. |
| `environments`, `kinds.allow`, `venues.allow`, `tokens.allow`, `bridges.destinations` | Must be a subset of the parent's list. The child can leave a list out only when the parent leaves it out too. |
| `venues.deny`, `recipients.deny`, `confirm.when` | Must keep every entry the parent has. |
| `tokens.unlisted` | If the parent denies unlisted tokens, the child must deny them too. |
| `recipients.mode` | Ranked `own` < `allowlist` < `any`. The child cannot rank higher than the parent. The child's allowlist must be a subset of the parent's, unless the parent allows `any` recipient. |
| `caps.*`, `limits.*`, `fx.maxDeviationBps`, `confirm.aboveUsd` | Must be equal or lower. If the parent sets the value, the child must set it too. |
| `lending.minHealthFactor` | Must be equal or higher. |
| `scent.require` | Must be equal or stricter: `verified` is stricter than `no-red-flags`, which is stricter than `off`. |
| `schedule` | Same time zone as the parent. Each of the child's windows must fall inside one of the parent's windows. |
| `signers` | Must be a subset of the parent's signers. |

2. **A child's budget is carved from its parent's budget.** The daily and weekly caps a child holds are reserved out of the parent's caps. "Allocated" is the sum of the parent's active children, and a new child must fit in what is still free (`carveBudget`). The per-intent cap is a ceiling for each child, not a shared pool. When an agent spends, the amount counts against that agent and against every ancestor above it.

Revoking an agent revokes its whole subtree and frees its allocation at once.

`intersectFence(a, b)` returns the tightest reading of two Fences, which is a Fence inside both. When no Fence is given, a sub-agent's Fence is `intersectFence(parentFence, roleTemplate)`.

## Roles

| Role | What it does | Capabilities |
|---|---|---|
| orchestrator (Lyko) | Splits a goal into tasks, hands them to specialists and merges their proposals. | read, propose, spawn |
| treasurer | Runs the stablecoin treasury: payees, FX, vaults and bridges, during office hours. | read, propose, spawn |
| payroll | Pays named people in USDC or EURC with an invoice memo. | read, propose |
| fx-hedger | Keeps the USDC/EURC mix inside a tight band around the Chainlink reference rate. | read, propose |
| yield-keeper | Moves idle stablecoins into vaults and back out. | read, propose |
| bill-payer | Pays recurring bills to known payees, with small caps. | read, propose |
| sentinel | Watches Scent, health factors and the pulse. It can blow the Whistle but cannot move value. | read, whistle |
| researcher | Reads venues, quotes, prices and Scent, and drafts dry-run plans. | read, propose |
| custom | Uses the Fence the owner gives it. A custom root agent can spawn sub-agents. | read, propose, spawn |

## How Lyko uses the Pack

In each turn:

1. Lyko delegates each part of a goal to the owner's agent with the matching role. If the owner has no such agent, Lyko uses a transient specialist whose Fence is the owner's Fence narrowed by the role template.
2. Each specialist sees only the tools its capabilities allow, and plans under its own Fence.
3. Before planning, a specialist's actions are shaped to its own limits. For example, a conversion uses the specialist's own slippage ceiling when that is tighter than the engine's default.
4. When plans from two or more specialists pass their Fences, Lyko merges them into one intent under the owner's Fence. The owner signs one route, and each part is attributed to the specialist that planned it.

## On chain

A Pack agent can be bound to a session on the owner's LykiaAccount:

- `POST /v1/pack/:id/session-tx` returns the unsigned call:
  - `createSession(spec)` for a root agent, signed by the owner.
  - `createSubSession(parentId, spec)` for a sub-agent, signed by the parent's session key. The contract itself refuses a sub-session that does not sit inside its parent.
- The spec carries:
  - per-call, daily and lifetime caps for each stablecoin, converted from the Fence's USD caps at the Chainlink reference price. A token without a price is left out.
  - the payee allowlist
  - the expiry
  - the Fence hash
- After the transaction lands, `POST /v1/pack/:id/session` records the session id.

Without call rules, a session can only make payments through `agentTransfer`. Vault and swap calls need explicit call rules in the request.

When no call rules are sent, they are derived from the Fence's venues for calls whose output argument sits at a fixed ABI word: ERC-4626 vault deposits and withdrawals, Aave V4 Spokes, and `exactInputSingle` on Uniswap v3's SwapRouter02 and on the Archery and Unitflow V3 routers. Each rule pins that argument to the account.

## Leashes

A leash ([leash.md](leash.md)) is a Pack agent made for an agent that runs outside Lykia: one call creates the agent with a strict-subset Fence and a carved budget, its session transaction, a key that works for that agent's leash only and an MCP config. Revoking the Pack agent revokes its leash, and revoking a leash revokes its Pack agent.
