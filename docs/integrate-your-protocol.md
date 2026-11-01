# Integrate your protocol

Lykia is built on Circle's rails, routes value to every Arc protocol and keeps
every agent inside its Fence. When your protocol is integrated, every Lykia
user, every agent that uses Lykia over MCP or x402 and every app built on the
SDK can reach it in one sentence. Each move is checked against the user's
Fence before it can be signed, so the traffic that reaches you is traffic its
owner allowed.

Integration is free and open to every team building on Arc Network.

## What you get

- **Routing.** Ask Lyko, the SDK, MCP (`lykia_plan`) and the x402 route quote
  compare your venue with every other one and send users to it when it gives
  them the best result.
- **A stall on `/ecosystem`.** Your name, category, status, TVL on Arc
  (DefiLlama) and the value Lykia has routed to you, live. The same data is
  public at `GET /v1/ecosystem` and in the embeddable "Routed by Lykia" strip
  (`examples/embed`).
- **Free developer keys.** Sign in on `/build` with your wallet: 120 requests
  per minute and 20,000 per day per key, no charge.
- **No lock-in.** Users sign every transaction in their own wallets, directly
  against your contracts. Lykia never holds funds.

## Levels

| Level | What Lykia does | What it needs |
|---|---|---|
| Listed | Shows you in the registry and on `/ecosystem`. | A registry row with `status: "announced"`. |
| Read | Prices and positions in the Flock, Scent on your tokens. | Verified addresses (checklist below). |
| Routed | Plans, checks and executes through you. | Verified addresses plus one typed adapter. |

## Checklist for a verified registry entry

Open a pull request against `packages/core/src/protocolData.ts`, or send the
same details to the Lykia team.

1. **Addresses from your own docs**, per network (Arc mainnet 5042, Arc
   testnet 5042002), with the link.
2. **`eth_getCode` is non-empty** for every address on the network it is
   listed for. Write the date in `evidence`.
3. **An `eth_call` simulation** of your main action (deposit, swap, supply)
   from a funded address, through Multicall3From with the Arc Memo, as
   `src/scripts/smoke.ts` does. Write the date and the result in `evidence`.
4. **Category, a one-sentence summary and your website.**
5. **Verified source** on the Arc explorer, when you have it.

A row marked `live` without evidence fails validation at load time.

## The adapter

The full walkthrough, with the code, is in
[`apps/api/src/engine/venues/TEMPLATE.md`](../apps/api/src/engine/venues/TEMPLATE.md).
In short: a venue module with a quote (reads only, `null` when it cannot
answer) and call builders (unsigned calls), one `case` in `adapters.ts`, one
candidate in `router.ts`, a unit test and a mainnet simulation. The engine adds
approvals, Lykia's fee transfer and the Arc Memo around your calls and batches
them into one transaction.

## Testing your integration

```bash
npm run verify                       # types, lint, every test
npm run smoke -w @lykia/api          # live reads and simulations on Arc
npm run smoke:e2e -w @lykia/api      # plan -> verdict -> prepare -> eth_call on mainnet
```

## Listing Lykia's paid endpoints on Circle's Agent Marketplace

Lykia sells three endpoints per call in USDC on Arc over x402 (scheme
`exact`, EIP-3009 on USDC, domain `USDC` version `2`):

| Service | Route | Price |
|---|---|---|
| Fence check | `POST /v1/x402/fence/evaluate` | 0.01 USDC |
| Deep Scent report | `GET /v1/x402/scent/{token}` | 0.01 USDC |
| Route quote | `POST /v1/x402/quote` | 0.01 USDC |

Requests are validated before a payment is asked for, so a malformed request
never costs anything. Payments go to `LYKIA_X402_PAY_TO`, which defaults to
the protocol fee recipient. Circle's x402 facilitator settles each payment on
Arc before the answer is sent; settlement uses the server's `CIRCLE_API_KEY`.
Without that key the routes keep answering `402` rather than serving unpaid.

Machine-readable descriptions:

- `GET /.well-known/x402`: the service manifest (pay-to wallet, price,
  networks, settlement mode, every resource).
- `GET /v1/openapi.json`: OpenAPI 3.1 for the paid and public routes, with
  `x-x402` on each paid operation.

To list the services, the owner of the payout wallet:

1. Checks that `GET /v1/health` shows `features.x402Settlement: true` and
   that `/.well-known/x402` shows the right `payTo`.
2. Makes one paid call from a funded wallet (the `circle/x402/pay` flow in
   the Lykia app does this) and confirms the USDC arrived.
3. Submits the listing through Circle's Agent Marketplace intake form with
   the API's base URL, the OpenAPI URL above, the payout wallet and a short
   description, then completes Circle's review.

Lykia does not submit the listing itself; the payout wallet's owner does.
