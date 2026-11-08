---
name: lykia-circle-policy
description: "Use when an owner wants their Lykia Fence enforced natively by a Circle Agent Wallet: compile the Fence into Circle spending limits (per-tx, daily, weekly) and recipient/contract allow and block lists, then hand the owner the verbatim `circle wallet limit set` commands. Triggers on: circle wallet limits from fence, agent wallet policy, spending policy, allowlist, blocklist, compile fence."
requirements:
  runtimes: []
  connectors: []
---

# Fence to Circle wallet policy

## Steps

1. `POST https://api.lykiaai.com/v1/circle/policies/compile`
   with `{ fence | template, wallet, owner }`.
2. Show the owner `policy.limits`, `policy.rules` and the `coverage` table:
   which rules Circle enforces, which Lykia's preflight enforces, which both.
3. Hand the owner the `commands` to run in their own terminal. Each one asks
   for an email OTP.
4. After they report done, run `circle wallet limit --address <wallet> --chain ARC --output json` to confirm.

## Rules

- Never ask for, store or relay the OTP. It goes from the owner's email to their terminal only.
- Spending policies apply to mainnet agent wallets only.
- Circle requires per-tx <= daily <= weekly <= monthly; do not edit the commands to break that.
- Rules Circle does not cover (slippage, health factor, Scent, schedule, venues by verb) still need the Lykia preflight skill.
