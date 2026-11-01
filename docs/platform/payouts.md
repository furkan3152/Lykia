# Payouts

`POST /v1/payouts` pays up to 100 recipients in as few transactions as the
Fence allows. Each row has its own token (USDC, EURC or a partner
stablecoin priced on Arc), amount, reference and memo. Lykia signs nothing:
the payer signs each batch, or the payout is executed from the developer's
own Circle developer-controlled wallet.

## What happens

1. **Rows are checked**: a registry token on the network, the token's
   precision, a recipient address, a reference of 1 to 64 characters.
2. **Every payee goes through the security layer's address checks**:
   look-alikes and address poisoning, the USDC/EURC blocklist, Circle
   Compliance screening when `CIRCLE_API_KEY` is set. A blocking finding
   refuses the row.
3. **Balances**: the payer must hold every amount plus Lykia's 1% fee (and
   the project's app fee). A short balance refuses the whole payout (409
   `INSUFFICIENT_BALANCE`); an unreadable one too (503). It fails closed.
4. **Plan**: rows are planned in chunks of at most the Fence's `maxSteps`
   (12 at most) as one intent each, so Lykia's fee, the Fence and the
   mainnet beta cap ($1,000 per step, $5,000 per day) apply as for any plan.
   A row the Fence denies is refused with the reason, and the rest of its
   chunk is planned again. A `confirm` verdict needs `confirm: true`.
5. **Build**: each chunk becomes one `Multicall3From.aggregate3` transaction
   (`allowFailure: false`, so it settles whole or not at all): the fee
   transfers and every transfer wrapped in its own Arc Memo. The memo note
   reads `payout po_… · ref <reference> · <memo>`. The batch is checked with
   `eth_call` against live state; a revert refuses its rows.
6. **Settle**: report the broadcast hash. The transaction must be exactly
   the prepared batch; each row settles from the receipt's Memo event
   (`memoId` on the row). The intent's steps settle too, so the spend counts
   toward the daily caps. `payout.created`, `payout.settled` and
   `payout.failed` go to your webhooks.

The Fence defaults to the project's Fence (or the Shepherd). Payees must be
on its recipient allowlist: send a `fence` with `recipients.mode:
"allowlist"` that names them.

## Routes

| Route | |
|---|---|
| `POST /v1/payouts` | Create (scope `payouts`). `dryRun: true` plans without storing or building. |
| `POST /v1/payouts/import` | The same from CSV (`to,token,amount,reference,memo`, header optional). |
| `POST /v1/payouts/parse-csv` | Preview a CSV. |
| `GET /v1/payouts` · `GET /v1/payouts/:id` | List; one payout row by row. |
| `POST /v1/payouts/:id/batches/:index/submit` | `{ hash }` after the payer broadcast batch `index`. |
| `POST /v1/payouts/:id/execute` | Execute ready batches from the payout's Circle wallet (`circleWalletId` at creation; needs `CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET` on the server). |

Late receipts and Circle transactions are picked up by the reconciliation
pass (`/cron/standing` on Vercel, or `POST /v1/reconcile/tick`).

## curl

```sh
curl -X POST https://<api>/v1/payouts \
  -H "Lykia-Key: lk_live_…" -H "content-type: application/json" \
  -H "Idempotency-Key: march-payroll-01" \
  -d '{
    "payer": "0xPayer…",
    "environment": "mainnet",
    "fence": { "schema": "lykia.fence/v1", "recipients": { "mode": "allowlist", "allow": ["0xAda…", "0xBo…"] }, "confirm": { "when": [] } },
    "rows": [
      { "to": "0xAda…", "token": "USDC", "amount": "120", "reference": "INV-1001" },
      { "to": "0xBo…",  "token": "EURC", "amount": "80.5", "reference": "INV-1002", "memo": "March" }
    ]
  }'
```

The answer carries `batches[].transaction` (chainId, from, to, data, value).
Send it from the payer, then:

```sh
curl -X POST https://<api>/v1/payouts/po_…/batches/0/submit -H "Lykia-Key: lk_live_…" \
  -H "content-type: application/json" -d '{ "hash": "0x…" }'
```

## SDK

```ts
import { Lykia } from "@lykia/sdk"; // or: import { payoutsApi } from "@lykia/sdk/payouts"
const lykia = new Lykia({ apiKey: process.env.LYKIA_KEY, environment: "mainnet" });
const payout = await lykia.payouts.create({ payer, fence, rows });
for (const batch of payout.batches) {
  if (!batch.transaction) continue;
  const hash = await wallet.sendTransaction(batch.transaction);
  await lykia.payouts.submit(payout.id, batch.index, hash);
}
```

Agents can use the `create_payout` and `payout_status` tools in
`@lykia/agent-tools` (opt-in by name).

Proven on Arc mainnet: a 3-recipient, 2-token batch runs as one transaction
(see [../flows.md](../flows.md)).
