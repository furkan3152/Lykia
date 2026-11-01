# The Fence (`lykia.fence/v1`)

The Fence is the set of hard limits an owner puts around an agent, or around
their own wallet. Circle's agent wallets decide how much an agent may spend.
The Fence decides whether a particular DeFi move makes sense at all.

It is a small typed JSON document with no expressions or code, so it can be
validated, hashed and pinned on-chain. Its canonical `sha256:` hash is what a
Künye (ERC-8004 identity) points to.

## Principles

- **Fail closed.** A rule that needs a fact it does not have denies the plan.
  A token without a USD price is never treated as worth zero.
- **The Whistle.** `mode: "whistle"` stops every new risk. Moves that bring
  value home still pass: repaying debt, withdrawing to the owner and sending
  to the owner. Caps, schedules and venue lists do not apply to these moves.
  The hard floor (environment, signer, the recipient deny list, unlisted tokens
  being acquired) still holds.
- **No strangers for agents.** An agent can only pay recipients that are on
  the allowlist, whatever the recipient mode says.
- **Loosening needs the owner.** `loosenedRules(previous, next)` lists every
  edit that makes a Fence looser. Only the owner's wallet may approve those
  edits.

## Document

| Field | Meaning |
|---|---|
| `schema` | Always `"lykia.fence/v1"`. |
| `label` | A name, up to 64 characters. |
| `mode` | `live`, `dry-run` (plans everything and signs nothing) or `whistle`. |
| `environments` | `mainnet`, `testnet`, or both. |
| `kinds.allow` | Step kinds that are allowed (`transfer`, `fx`, `deposit`, `borrow`, `bridge` and so on). |
| `venues.allow` / `venues.deny` | Venue ids from the registry. The deny list wins. |
| `tokens.allow` / `tokens.unlisted` | Registry symbols the plan may acquire. `unlisted: "deny"` refuses any token outside the registry. |
| `recipients.mode` / `allow` / `deny` | `own` (owner only), `allowlist` or `any`. |
| `bridges.destinations` | CCTP destination keys (`base`, `ethereum`, ...). |
| `caps.perStepUsd` / `perIntentUsd` / `dailyUsd` / `weeklyUsd` | USD limits, written as strings. |
| `limits.maxSteps` / `limits.maxSlippageBps` | Size of a plan and the slippage ceiling. |
| `lending.minHealthFactor` | The lowest health factor allowed after a borrow or a withdraw, for example `"1.5"`. |
| `fx.maxDeviationBps` | How far a StableFX quote may be from the reference rate. |
| `scent.require` | `verified`, `no-red-flags` or `off`: the lowest Scent result a token may have before it can be acquired. |
| `confirm.aboveUsd` / `confirm.when` | When the owner has to confirm: above an amount, for external recipients, for cross-chain moves, for agent proposals and for unlisted tokens. |
| `schedule` | An IANA time zone and weekly windows. |
| `signers` | `wallet`, `agent`, or both. |

## Verdict (`lykia.verdict/v1`)

`evaluateFence(fence, facts)` returns:

- `decision`: `allow`, `confirm` or `deny`
- `signable`: false in dry-run mode or when the decision is `deny`
- `reasons`: one line per rule, each with its rule id and the step it applies to
- `waived`: the reasons that were set aside because a step brings value home
- `fenceHash`, `factsDigest` and `digest`

The `digest` ties together the Fence, the facts and the decision. Lykia puts it
in the Arc Memo of every step and files it to the ERC-8004
ValidationRegistry. That way anyone can check afterwards that an agent stayed
inside its Fence.

## Templates

| Key | Name | Use |
|---|---|---|
| `lamb` | Kuzu | Watching and learning. Dry-run only, wallet signer only, verified tokens only. |
| `shepherd` | Çoban | The default. Careful caps, agents allowed, strangers refused. |
| `treasury` | Hazine | A business treasury. USDC and EURC only, named payees, office hours, a tight FX band. |
| `caravan` | Kervan | An autonomous agent that pays for services. Small caps, no lending, no bridges, agent signer only. |
