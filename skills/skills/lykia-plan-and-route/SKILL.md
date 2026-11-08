---
name: lykia-plan-and-route
description: "Use when a person or agent wants to move stablecoins on Arc Network (send, swap, FX USDC/EURC, earn, borrow, repay, bridge with CCTP or Gateway): get a Fence-checked plan across every executable Arc venue with unsigned transactions. Triggers on: put my USDC to work, best route, swap on Arc, bridge USDC from Arc, earn yield on Arc, Lykia plan."
requirements:
  runtimes: []
  connectors: []
---

# Plan and route on Arc with Lykia

## Steps

1. Ask Lykia's MCP server (`lykia`) to plan the sentence or typed actions,
   or call `POST /v1/intents` with `{ owner, environment, actions | sentence, fence? }`.
2. Read the plan: each step names its venue, why it won, its fee and the
   Fence verdict. Circle-native paths (CCTP, Gateway) are labelled "Powered by
   Circle".
3. If the verdict is signable, the owner's wallet or the agent's Circle
   wallet signs the unsigned transactions in order.
4. Track the steps until they settle (`GET /v1/intents/{id}`).

## Rules

- Lykia never signs the owner's plans. Show the owner what will be signed.
- Respect the mainnet beta caps: contracts are not audited.
- Do not change the recipient or amounts after the plan was checked.
