# Adding a position kind

The Fold shows everything through one shape (`Position` in `packages/core/src/positions.ts`) and a small set of generic detail blocks. A new kind of venue appears in the Fold, in Lyko on watch and in Lyko's answers without a screen of its own.

## The kinds tracked today

| Kind | Reader | What it is, in plain words |
| --- | --- | --- |
| `wallet` | `positions/wallet.ts` | money resting in your wallet |
| `lending`, `market` | `positions/lending.ts` | money lent out, or borrowed against collateral |
| `vault`, `treasury` | `positions/vaults.ts`, `positions/wallet.ts` | a fund that lends your deposit for you; a tokenized Treasury fund |
| `lp` | `positions/lp.ts` | money that earns swap fees inside a price band |
| `gateway`, `bridge` | `positions/circle.ts`, `positions/bridges.ts` | one USDC balance on several chains; money on its way over CCTP, Across or Relay |
| `orders` | `positions/herding.ts` | money set aside for an order waiting for its price |
| `payments` | `positions/herding.ts` | money promised to a payment that runs on its own |
| `leash` | `positions/leashes.ts` | budgets you gave to outside bots, from the Arc wallet or a Gateway balance (LykiaStile) |
| `plan` | `positions/tracked.ts` | step-by-step plans with steps still to sign |
| `watch` | `positions/tracked.ts` | things Lyko on watch keeps an eye on for you |

Leash budgets, plans in progress and watches are built only from the generic blocks below: they are the proof that a kind needs no screen of its own.

## The three steps

1. **Name the kind.** Add it to `PositionVenueKind` and give it one line in `POSITION_KINDS`: a short label and what it is in plain words. The Fold uses that line as the venue's subtitle. A kind missing there still renders, with a generic name and tile.
2. **Write a reader.** A reader is `(ReadContext, PositionVenueInfo) => Promise<ReaderOutput>` (`apps/api/src/positions/context.ts`). Return one `Position` per position, built with `finish()` so the one-line "what it is doing" comes from core. Put the kind-specific detail in `blocks`. Register the reader in `READERS` (`apps/api/src/positions/service.ts`) and the venue in `POSITION_VENUES` (mark it `personal` when it reads Lykia's own records). Money already counted elsewhere (set aside, promised, or nothing at stake) is `counts: "overlay"`, never added twice.
3. **That is it.** The web reads a venue no request group names yet with the last group, draws its blocks and falls back to a generic tile. Lyko on watch reads the same blocks; Lyko's `positions` tool passes them on.

## The generic blocks

| Block | Use it for | Lyko on watch flags |
| --- | --- | --- |
| `gauge` | A value with a danger threshold: a budget used, a margin | Within 12% of the scale from the threshold, or past it |
| `range` | A value against a band it must stay in | |
| `timeline` | Ordered stages: a transfer in flight, a plan's steps | |
| `facts` | Label and value pairs, each with an optional one-line meaning | |
| `countdown` | Time until something happens; set `ends: true` when the position or its budget ends then | Inside 72 hours when `ends` is set |
| `pnl` | Profit or loss so far, with the basis it is measured on | |

Two more fields are read generically: `claimable` (something to collect now, flagged as "ready to claim") and the state `idle` outside the wallet (flagged as idle money). The insights are `genericPositionInsights` in `packages/core/src/positionKinds.ts`.

Every block may carry a `meaning`: one plain sentence of what it means for the owner, in their terms ("Invoice bot can spend $12 more today; past the cap the chain refuses.").

## States

Use the existing states. Each has a plain meaning in `STATE_MEANINGS` (`packages/core/src/plain.ts`), shown when someone hovers or taps the badge.
