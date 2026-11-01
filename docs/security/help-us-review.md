# Help us review Lykia

Lykia's contracts are live on Arc mainnet with small caps, and they have
**not** been audited by a paid firm: this is a one-person, unfunded
project. Until enough independent eyes have looked at them, mainnet moves
stay capped at $1,000 per step and $5,000 per day per owner. That cap is the
honest answer to "is it audited?".

If you review Solidity or agent-security code, we would love your help.

## Where to look first

1. `packages/contracts/contracts/LykiaAccount.sol`: sessions and
   sub-sessions, per-token caps over a rolling window, outflow measurement
   in `_agentCall`, receiver-word checks, the Whistle, EIP-712 session
   signatures.
2. `packages/contracts/contracts/LykiaRouter.sol`: baseline accounting,
   forbidden selectors, venue allowlist, the sweep in `_settle`.
3. `packages/contracts/contracts/orders/LykiaOrders.sol`: signed orders,
   keeper tip and fee bounds, oracle freshness.
4. `packages/core/src/fenceEvaluate.ts`: the fail-closed Fence evaluator.
5. `apps/api/src/circle/policy.ts`: the Fence to Circle wallet policy
   compiler (does any mapping loosen a rule?).

## What is already done

- Slither and Mythril runs with every finding triaged in
  [self-review.md](self-review.md).
- Unit tests plus stateful fuzz and invariant tests
  (`npm test -w @lykia/contracts`; `LYKIA_FUZZ_RUNS=200` for longer runs).
- Known limitations in `packages/contracts/SECURITY.md`.

## How to help

- Read, run the tests, try to break an invariant listed in self-review.md.
- Report privately (see `SECURITY.md`). Credit is public if you want it.
- Non-security feedback (docs, design) can go in a normal issue.

Built on Arc Network, powered by Circle's products. Not affiliated with
Circle or Arc.
