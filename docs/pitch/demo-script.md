# Three-minute demo on Arc mainnet

The demo runs on the live app at https://lykia-akdogan1.vercel.app, on Arc mainnet. Part one is a dry run and needs no wallet. Part two is optional: one real transaction for a few dollars.

## Before you start

- Open the app in a browser where the network toggle shows **MAINNET**.
- For part two: a browser wallet with a few USDC on Arc mainnet (USDC is the gas token), connected to the app.
- Check `https://lykia-api-akdogan1.vercel.app/v1/health` shows `"status":"ok"`.
- Quotes and yields change. Read the numbers off the screen; do not quote numbers from this script.

## 0:00 – 0:20 · The valley

**Screen:** the landing page. The bay scene shows Arc's live block in the Patara strip, pens whose grass height is the live yield of Arc venues, the flock of tokens and wolves outside the fence.

**Say:** "Arc gives agents money. Lykia gives them judgment. Every pen here is a live Arc protocol, and its grass height is its yield right now."

## 0:20 – 1:00 · One intent, many protocols

**Type in Ask Lyko:**

> Keep 50 USDC liquid, put the rest of 200 USDC to work and convert 20% to EURC

**Screen:** the composer grows into the chat. Lyko assigns parts to specialists (yield keeper, FX hedger) and the route panel slides in:

- one stop per part, with the venue that won and a "why this route" table of the alternatives it beat
- the Lykia fee line on each value-moving step
- the Fence seal: allow, confirm or deny, with its reasons

**Say:** "One sentence became a plan across Arc's venues. Every step was quoted live, and the Fence checked it before anything can be signed."

## 1:00 – 1:30 · The Fence says no

**Type:**

> Send 25 USDC to 0x1111111111111111111111111111111111111111

**Screen:** the plan is denied: the recipient is not the owner and not on the allowlist. Wolves appear at the fence edge.

**Say:** "Spending limits cap how much an agent spends. The Fence decides whether the move makes sense at all: recipients, health factor, FX band, slippage, token checks."

Optional: open **Fence**, blow the Whistle, and show the scene turning to night. Repay and withdrawals home still pass.

## 1:30 – 2:10 · Agents with sub-agents

**Screen:** open **Pack**. Show the kennel scene and the role templates (treasurer, payroll, FX hedger, yield keeper, bill payer, sentinel, researcher).

**Say:** "An owner gives agents a role and a Fence. An agent can spawn sub-agents, but a child's Fence and budget must fit inside its parent's. The same rule holds on chain: a sub-session on LykiaAccount can never exceed its parent."

Optional: try to spawn a pup with a higher cap than its parent and show the field-by-field refusal.

## 2:10 – 2:40 · On Circle rails

**Screen:** open **Circle** (or Build → Circle). Show the product grid: CCTP, Gateway, Nanopayments and x402, Agent Marketplace, Compliance, developer-controlled wallets, Gas Station, StableFX.

**Say:** "Lykia runs on Circle's products and sends flow to Arc's protocols. We are the layer that ties them together for agents."

## 2:40 – 3:00 · Proof on chain (optional real transaction)

**Type:**

> Convert 5 USDC to EURC

Connect the browser wallet, press sign once, and approve in the wallet.

**Screen:** the step settles in under a second. Open the explorer link: one transaction holding the approval, the protocol fee transfer, the swap and the Arc Memo carrying the outrun id and verdict digest.

**Say:** "One signature, final on Arc in under a second, and the memo ties the transaction to the Fence decision."

## If something goes wrong

- **The route panel is empty or slow:** the API may be cold; ask again.
- **A plan is denied for a missing fact (no price, unreadable health factor):** that is fail-closed behaviour; say so and continue.
- **Testnet is selected:** switch to mainnet. Practice venues on testnet only work once they are deployed.
