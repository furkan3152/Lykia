# Invoices and payment links

An invoice names a payee, a token and an amount (or line items). It comes
with a hosted, mobile-first pay page at `/pay/:id` on the web app, with a QR
code of the page. Payments reconcile from the Arc Memo that names the
invoice; partial payments add up.

## Flow

1. `POST /v1/invoices` (scope `payouts`) returns the invoice and its `url`.
   `invoice.created` goes to your webhooks.
2. The payer opens the link. The page plans the transfer with
   `POST /v1/invoices/:id/pay`: the normal planner with Lykia's 1% fee, the
   project's app fee, the beta cap and an invoice Fence that admits only this
   payee and this token. The memo note is `invoice inv_… [ref <reference>]`.
3. The payer's wallet signs through the usual `prepare` and `submit` steps.
4. The page reports the hash to `POST /v1/invoices/:id/payments`. The
   receipt must have succeeded, carry a Lykia memo naming the invoice and
   move the invoice token to the payee; the amount is what reached the
   payee. A reconciliation pass also scans transfers to open invoices'
   payees for the memo, so a payment from any wallet that sets the memo is
   found. `invoice.paid` fires once the invoice is paid in full.

Statuses: `open`, `partially-paid`, `paid`, `overdue` (past `dueDate`),
`void`. Overpayments are kept on the record.

## Routes

| Route | |
|---|---|
| `POST /v1/invoices` | `{ token, payee, amount?, lineItems?, payer?, dueDate?, reference?, memo?, allowPartial? }` |
| `GET /v1/invoices` · `GET /v1/invoices/:id` | List (filter `status`, `projectId`); one invoice with its payments. |
| `POST /v1/invoices/:id/void` | Void an unpaid invoice. |
| `GET /v1/invoices/:id/public` | What the pay page reads (no key). |
| `POST /v1/invoices/:id/pay` | `{ payer, amount? }`: the unsigned plan (no key). |
| `POST /v1/invoices/:id/payments` | `{ hash }`: reconcile one transaction (no key; checked on chain). |

## curl

```sh
curl -X POST https://<api>/v1/invoices -H "Lykia-Key: lk_live_…" -H "content-type: application/json" \
  -d '{ "token": "USDC", "payee": "0xYou…", "reference": "INV-77",
        "lineItems": [{ "description": "Design", "quantity": "2", "unitAmount": "60" }] }'
# -> { "id": "inv_…", "amount": "120", "url": "https://<web>/pay/inv_…", … }
```

## SDK

```ts
import { invoicesApi } from "@lykia/sdk/invoices"; // or lykia.invoices
const invoice = await lykia.invoices.create({ token: "USDC", payee, amount: "120", reference: "INV-77" });
share(invoice.url);
const status = await lykia.invoices.get(invoice.id);
```

Proven on Arc mainnet: a full and a partial invoice payment as the page
plans them (see [../flows.md](../flows.md)).
