# Listing Lykia on Circle's Agent Marketplace

The Agent Marketplace is Circle's catalogue of x402 services that accept
USDC. Listing is a submission reviewed by Circle, not a self-serve publish:
there is no `services publish` command. Steps checked against
https://developers.circle.com/agent-stack/agent-marketplace/get-listed on
2026-11-01; the OpenAPI and 402 details against the twelve checks of
https://agents.circle.com/sell/score on 2026-11-17.

## What Lykia already provides

| Requirement | Lykia |
|---|---|
| Unpaid requests answer `402 Payment Required`; paid requests get the resource | `/v1/x402/fence/evaluate`, `/v1/x402/scent/{token}`, `/v1/x402/quote` (`apps/api/src/x402/x402.ts`). An unpaid request gets the 402 whatever its body holds (malformed, empty, oversized or not JSON); with a payment, an invalid request answers 400 and nothing is settled; the answer leaves only after settlement; a HEAD request only gets the offer and is never charged |
| 402 offers | x402 v2 `PaymentRequired` in the body and in `PAYMENT-REQUIRED`: `resource.url` and each `accepts[].resource` are the absolute URL discovery lists; the `bazaar` extension carries the request and answer schemas |
| OpenAPI spec for inputs and outputs | `GET /v1/openapi.json`, also at `/openapi.json` and `/.well-known/openapi.json`. Each paid operation has `x-payment-info` (price in USDC, the x402 protocol) and a described request schema; `info.x-guidance` tells agents when to call what; `externalDocs` points to the reference |
| Machine-readable manifest with Discovery API metadata (provider, category, tags, input/output JSON Schemas, `supportsVanillax402`) | `GET /.well-known/x402`: `items[]` in the Discovery API listing shape (`resource`, `type`, `x402Version`, `accepts`, `metadata`, `extensions`) and the older `services[]` |
| Docs and website | `docsUrl` is the API reference the server renders (`$API/v1/reference`, readable without scripts); `website` is `https://lykiaai.com`; the listing package also names The Forge (`https://lykiaai.com/forge/reference`) |
| Health checks (listed services stay listed only while reachable) | `GET /v1/x402/health` |
| Pricing | `LYKIA_X402_PRICE_USDC` (default 0.01 USDC per call), `exact` scheme on Arc (`eip155:5042`, testnet `eip155:5042002`). Each call is paid on the network it runs on: `facts.environment` for the Fence check, `environment` in the body for a quote, the `environment` query parameter for Scent (the last two default to the server's network) |
| Settlement | Circle's hosted facilitator `https://api.circle.com/v1/facilitator/x402` (default) |
| Contact | `LYKIA_CONTACT_EMAIL`, published as `info.contact.email`; left out while unset |
| The whole submission package | `GET /v1/circle/marketplace/listing` |

## Owner steps

1. **Pick the payout wallet.** `LYKIA_X402_PAY_TO` (defaults to the fee
   recipient). Circle sanctions-screens it during review. For Circle's
   facilitator, use an EOA developer-controlled wallet you own as the payTo
   and set `CIRCLE_X402_SELLER_WALLET_ID` to its wallet id, plus
   `CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET`. Lykia then asks Circle to
   sign the facilitator's `Facilitator-Seller-Proof` with that wallet; no
   key is held by Lykia.
2. **Deploy** with those variables (and `LYKIA_CONTACT_EMAIL`) and confirm
   `GET /v1/x402/health` answers `"status": "ok"` and
   `settlement.mode: "settled"`.
3. **Let agents through the edge.** Vercel's system DDoS mitigation
   (firewall rule `sys_dos_mitigation`, not a project rule) denies or
   challenges part of the traffic from shared cloud addresses, which is
   where agents and health checkers run; a challenge or a 403 on a paid
   route reads as "not payable". The project firewall has no custom rules,
   so nothing in this repository causes it. Exempt the machine-facing
   paths from system mitigations for `api.lykiaai.com`: a conditional
   system bypass (Firewall settings, or `POST /v1/security/firewall/bypass/rules`
   with path conditions) for `/v1/x402/`, `/.well-known/`, `/openapi.json`,
   `/v1/openapi.json` and `/v1/reference`. Where that is not available on
   the plan, ask Vercel support, or add `vercel firewall system-bypass add
   <checker CIDR> --domain api.lykiaai.com` for addresses Circle names. The
   API's own per-IP rate limits still apply behind the bypass.
4. **Collect evidence** (commands are in the listing package):
   - `curl -si -X POST $API/v1/x402/fence/evaluate -H 'content-type: application/json' -d '{}'` answers `HTTP/1.1 402`, and so do the same call on `/v1/x402/quote` and `curl -si $API/v1/x402/scent/0x3600000000000000000000000000000000000000`;
   - the readiness check at https://agents.circle.com/sell/score for the API's domain (nothing is paid);
   - optional: `circle services inspect $API/v1/x402/quote` with the Circle CLI;
   - one paid call that answers 200 (a small payment from your own agent wallet).
5. **Submit** the intake form https://forms.gle/7YFzvdmMcn1JH5tF6 with:
   - endpoint URL: `$API/.well-known/x402` (and the three endpoint URLs);
   - payout wallet address: the `payoutWallet` from the package;
   - description: the package's `description`;
   - OpenAPI URL `$API/v1/openapi.json`, health URL `$API/v1/x402/health`,
     categories `FINANCIAL_ANALYSIS` and `INFRASTRUCTURE`.
6. **Wait for review.** After approval the services appear in the catalogue
   and in the Discovery API (`GET https://api.circle.com/v2/x402/discovery/resources?network=eip155:5042&query=lykia`).

Say "listed on Circle's Agent Marketplace" only after approval.

## Consumer side: agents buying services inside the Fence

1. `GET /v1/circle/marketplace/services?category=&query=&maxUsdPrice=`
   lists services payable on Arc (Circle's public Discovery API, keyless).
2. `POST /v1/circle/x402/prepare { resource, owner, signer: "agent" }`
   reads the service's 402 and runs the price and payee through the Fence
   as a transfer step: per-step, daily and weekly caps, the recipient
   allowlist and the beta cap all apply. A denied payment returns no typed
   data.
3. The wallet signs the EIP-3009 authorization, then
   `POST /v1/circle/x402/pay { paymentId, signature }` relays the paid
   request and returns the service's answer.

An agent on a Circle Agent Wallet with a compiled spending policy (see
[policies.md](policies.md)) is capped twice: by Circle on the wallet and by
the Fence before signing.
