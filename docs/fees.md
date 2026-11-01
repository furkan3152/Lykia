# Fees

Lykia takes a protocol fee on value-moving steps, paid on chain in the same
transaction as the step. Repay, withdrawals home, approvals, revokes and
Tag steps are always free. `GET /v1/fees` shows what is in force.

## Today (default, unchanged)

100 bps (1%) on every fee-bearing kind: transfer, swap, fx, deposit,
supply, borrow, bridge, gateway-deposit. Set with `LYKIA_FEE_BPS`
(0 to 300) and `LYKIA_FEE_RECIPIENT`.

## Per-kind schedule (optional)

`LYKIA_FEE_SCHEDULE` prices kinds individually, in basis points:

```sh
LYKIA_FEE_SCHEDULE='{"transfer":0,"deposit":0,"swap":30,"fx":20,"bridge":10}'
```

- Kinds left out pay `LYKIA_FEE_BPS`. Unset = the base fee everywhere, so
  nothing changes until the owner sets it.
- Exempt kinds stay free whatever the schedule says.
- Invalid JSON, unknown or exempt kinds, or values above 300 stop the API at
  start-up with a clear message.
- `GET /v1/fees` returns `schedule` (the effective bps per kind) and
  `scheduled: true` when a schedule is set.

## Plan overrides for API customers (hook)

`LYKIA_FEE_SCHEDULE_PLANS` maps a billing plan id to a schedule layered over
the global one:

```sh
LYKIA_FEE_SCHEDULE_PLANS='{"scale":{"transfer":0,"swap":20}}'
```

`apps/api/src/fees/schedule.ts` resolves it (`feePolicyForPlan(config.fee, plan)`);
billing passes the result to the planner as its fee policy. Nothing uses a
plan until billing wires it.

## A recommended B2B schedule (option, not applied)

For businesses that move stablecoins mostly between their own accounts and
payees, charging on transfers and deposits discourages the core use. An
option the owner may adopt (`RECOMMENDED_B2B_FEE_SCHEDULE` in `@lykia/core`):

| Kind | bps |
|---|---|
| transfer | 0 |
| deposit, supply, gateway-deposit | 0 |
| swap | 30 |
| fx | 20 |
| bridge | 10 |
| borrow | 25 |

```sh
LYKIA_FEE_SCHEDULE='{"transfer":0,"deposit":0,"gateway-deposit":0,"supply":0,"swap":30,"fx":20,"bridge":10,"borrow":25}'
```

Integrator (app) fees are separate: a project may add up to 50 bps, paid to
its own address in the same batch.
