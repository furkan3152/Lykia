# Privacy note

> **DRAFT.** Written by the developer, not reviewed by a lawyer.
> Last updated 2026-11-01.

Lykia's API stores only what it needs to work. No names, emails or phone
numbers are required.

| What | Why | How long |
|---|---|---|
| Wallet addresses you sign in with (SIWE) | Sessions and your settings | While your session and settings exist |
| Plans (intents), their steps and transaction hashes | Tracking moves to the Fold, history, routed-value totals | 30 days by default |
| Your Fence, profile preferences, Lyko's memory (venues, named contacts, habits) | Planning the way you asked | Until you delete them (`/app/memory` lets you forget them) |
| Agents (Pack), Tags and verdict digests | Agent limits and public verdicts | Until you delete them; on-chain records are permanent |
| Developer keys (hashed), usage counters, webhook URLs | API access and limits | While the key exists |
| Request logs (path, status, timing, no bodies) | Abuse prevention and debugging | Short-lived |
| Alerts and Telegram link (if you connect it) | Notifications | Until you disconnect |

- Everything on Arc (addresses, transactions, memos) is public by design.
- `GET /v1/stats` publishes aggregate counts only, never addresses of users.
- Third parties the API calls on your behalf: Circle (Compliance Engine,
  Gateway, CCTP, StableFX, wallets, Discovery API), Arc RPC providers,
  DefiLlama, and the AI model provider if the operator configured one.
  They see the data needed for that call.
- No tracking cookies and no advertising.
- If you run your own deployment, you are the operator of its data.

Questions or deletion requests: open a private report as described in
`SECURITY.md`, or delete your data from the app.
