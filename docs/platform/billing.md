# Plans and billing

API plans are about API usage. Lykia's protocol fee on money moves (1% by
default, paid inside each step's own transaction) is separate and unchanged.

| Plan | Included live requests / month | Above that | Per project | Logs kept |
|---|---|---|---|---|
| Free | 100,000 | stops: 429 `QUOTA_EXCEEDED` | 120/min, 20,000/day | 7 days |
| Pay as you go | 100,000 | 0.0002 USDC per request | 600/min, 500,000/day | 30 days |
| Enterprise | 10,000,000 | 0.0001 USDC per request | custom | 90 days |

Test-key (sandbox) requests are never billed.

## Pay as you go

Above the free quota each live request is paid one of two ways:

1. **Prepaid credits.** `POST /v1/billing/credits { "amountUsdc": "10" }`
   answers 402 with x402 requirements; retry with an `X-PAYMENT` header
   (an EIP-3009 authorization in USDC on Arc) and the credits are added.
2. **Per call over x402.** Without credits a request answers
   `402 PAYMENT_REQUIRED` with `details.accepts`; retry it with `X-PAYMENT`.

Payments are verified locally and settled through the configured
facilitator (Circle's x402 facilitator by default). A server without
`LYKIA_X402_PAY_TO` records overage as owed instead of collecting it.

## Routes

| Route | |
|---|---|
| `GET /v1/billing/plans` | Every plan (public) |
| `GET /v1/billing/plan` / `PUT /v1/billing/plan { plan }` | Current plan, credits; switch Free / Pay as you go |
| `GET /v1/billing/usage?days=30` | Month to date, per day, per endpoint |
| `POST /v1/billing/credits` | Buy credits (x402) |
| `GET /v1/billing/ledger` | Credit purchases and paid overage |

Enterprise is set by a Lykia admin (`PUT /v1/billing/plan` with `owner`).
