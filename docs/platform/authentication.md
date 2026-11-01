# Authentication

Three ways to call the API, and many routes accept none at all.

| Credential | Header | Use it for |
|---|---|---|
| None | | Public reads (networks, venues, Scent, the ecosystem, the reference). Per-IP limits apply. |
| API key | `Lykia-Key: lk_live_…` / `lk_test_…` | Servers, agents, CI and the CLI. Scoped, rate limited, logged. |
| Session | `Lykia-Session: lk1.…` | The owner in a browser, after Sign-In with Ethereum on Arc. |
| x402 payment | `X-PAYMENT: <base64>` | Paid routes and pay-as-you-go overage, in USDC on Arc. |

## Wallet sessions (SIWE)

1. `POST /v1/auth/nonce` with `{ address, chainId }` returns an EIP-4361
   message.
2. The wallet signs it; `POST /v1/auth/verify` with `{ message, signature }`
   returns `{ token, roles, expiresAt }`.
3. Send the token as `Lykia-Session`. Sessions last 24 hours;
   `POST /v1/auth/logout` revokes one at once.

Tokens travel in headers, never cookies, so there is no CSRF surface.

## Account routes

Keys, webhooks, logs, events, usage and billing take either a session with
the developer role, or a secret `lk_live_`/`lk_test_` key with the scope the
route lists (`admin` for changes, `read` for reads). Legacy `lk_sk_` keys keep
working everywhere they worked before but cannot manage the account.

Every operation in `GET /v1/openapi.json` carries `x-lykia-auth` and, where
it applies, `x-lykia-scope`.
