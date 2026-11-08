---
name: lykia-fence-preflight
description: "Use before an agent on Arc Network moves value with a Circle wallet (Agent Wallet or developer-controlled wallet): check the planned steps against the owner's Lykia Fence and only sign when the verdict is signable. Triggers on: fence check, preflight, policy check before paying, agent spending rules, is this transfer allowed, Lykia."
requirements:
  runtimes: []
  connectors: []
---

# Lykia Fence preflight

## Overview

A Circle wallet enforces spending caps and allow/block lists. The owner's
Fence (`lykia.fence/v1`) also covers venues, step kinds, tokens, slippage,
health factor, FX band, Scent (token checks), hours and signers. Check the
Fence first; let the Circle wallet sign only what passed.

## Steps

1. Describe each step as a fact: `{ id, kind, venue, usd, tokens: [{ symbol, address, listed, acquired }], recipient? }`.
2. Call `POST https://api.lykiaai.com/v1/fence/evaluate` with
   `{ fence, facts: { environment: "mainnet", owner, signer: "agent", steps } }`
   (or the MCP tool on the `lykia` server).
3. Read the verdict:
   - `decision: "allow"` and `signable: true`: sign with the Circle wallet;
   - `decision: "confirm"`: ask the human owner first;
   - `decision: "deny"`: stop and report every `reasons[].message`.
4. Put `verdict.digest` in the transaction memo when the venue supports it.

## Rules

- Never sign a step that was not in the evaluated facts.
- A missing fact denies; do not invent prices or Scent results.
- Never loosen a Fence on the owner's behalf. Loosening needs the owner's wallet.
- Lykia never holds the owner's keys and never signs the owner's plans: they come back unsigned.
