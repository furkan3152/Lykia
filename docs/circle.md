# Circle products in Lykia

Lykia is built on Arc Network and uses Circle's own rails wherever they
exist. Run `GET /v1/circle/status` to see what is live and what needs a
key. Nothing in this list signs for the user: every step that moves value
comes back as an unsigned call or as typed data for the owner's or the
agent's wallet.

## Agent Stack, providers, Marketplace, mandates

See [docs/circle/README.md](circle/README.md): which Circle product each
Lykia feature uses, the Fence -> Circle Agent Wallet policy compiler (the
default agent setup is a Circle wallet plus Lykia's Fence preflight), the
Circle execution providers registered with the aggregator, the Agent
Marketplace listing and consumer flow, Arc mandate drafts, and Circle MCP
next to Lykia MCP.

## Works without a key

| Product | What Lykia does |
|---|---|
| USDC and EURC | Every plan settles in them. Native USDC (18 decimals) and ERC-20 USDC (6 decimals) are handled as one balance. |
| CCTP V2 | Bridges out of Arc and mints inbound transfers. From Arc a burn is a Standard Transfer (0 bps, attested in about half a second); Circle lists Fast Transfer as not applicable from Arc. Fees come live from Circle's API per route; `GET /v1/circle/cctp/status` follows a burn. |
| CCTP Forwarding Service | `approve` plus `depositForBurnWithHook` with the `cctp-forward` hook, in intent bridge steps and in `POST /v1/circle/cctp/forward`. Circle performs the destination mint, so the recipient needs no gas there. `maxFee` covers the protocol fee and the `med` forwarding fee; the step settles when Iris reports the forwarded mint. |
| Gateway | Shows the unified balance per chain. Deposits are part of plans. Transfers out work in three steps: the depositor signs the EIP-712 burn intent (its `maxFee` and expiry come from Gateway's `/v1/estimate`), Gateway returns an attestation, and Lykia returns the unsigned `gatewayMint` for the destination; with `forward: true` Circle's Forwarding Service submits that mint. The fee is 0.5 bps across chains plus the Arc source gas fee; same-chain transfers pay no transfer fee. |
| Agent Marketplace discovery | Lists x402 services that accept USDC on Arc, with price, payee and provider. |
| x402 on Arc (buyer side) | Reads a service's 402. The Fence judges the price and the payee: agents only pay allowlisted payees within their caps. The wallet signs an EIP-3009 authorization, then Lykia relays the paid request and the service's answer. Discovery also shows which services accept Gateway nanopayments. |
| ERC-8183 jobs (testnet) | Builds the calls to create, fund, complete, reject and refund USDC escrow jobs between agents. |

## Needs a key

| Product | Variables | What Lykia does |
|---|---|---|
| Compliance Engine | `CIRCLE_API_KEY` with Compliance Engine access | Screens external recipients before planning. A DENIED address joins the Fence's deny list, so the plan is refused with a reason. A screening that cannot run is reported as "not screened", never as approved. Circle's Compliance chain list does not name Arc yet, so Lykia asks for `ARC` and falls back to the same EVM address as `ETH`. |
| Developer-controlled wallets | `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` (optional `CIRCLE_WALLET_SET_ID`) | Creates an SCA agent wallet on ARC or ARC-TESTNET for a Pack agent, tagged with the agent id. The entity secret travels only as fresh RSA-OAEP ciphertext. |
| Gas Station | the same, plus a policy in the Circle Console | Sponsors gas for those SCA wallets (Gas Station contract `0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25` on both Arc networks). |
| StableFX | `CIRCLE_API_KEY` with StableFX access, or `STABLEFX_API_KEY` | Runs the RFQ taker flow: quote, the taker signs the quote's Permit2 typed data, the trade, then funding (presign, signature, fund) and its status. Testnet calls go to Circle's sandbox host. Without access, USDC to EURC routes through Uniswap. Lykia never makes up a quote. |

## Not used, and why

- **Circle Paymaster.** It lets users pay gas in USDC on chains where gas
  is something else. Arc's gas is already USDC.
- **Circle Paymaster on Arc.** Its published addresses have no code on
  Arc (checked 2026-11-04).

## USYC (entitled wallets only)

USYC is for eligible non-US institutions. `GET /v1/circle/usyc/eligibility`
reads Arc's Entitlements contract (`canCall(wallet, Teller, selector)`, the
check the Teller applies). `POST /v1/circle/usyc/prepare` builds approve +
`Teller.deposit` (subscribe) or `Teller.redeem` only for entitled wallets,
with the Teller's own preview and a Fence verdict (USYC must be an allowed
token). Everyone else gets a clear refusal and the onboarding route.

## Oracle cross-check

`GET /v1/oracles` compares Chainlink with Pyth, read on chain from the Pyth
contract on Arc mainnet. Pyth is a pull oracle: on 2026-11-01 Arc carried
only BTC/USD there, and it was older than the one-hour freshness limit,
so the cross-check shows "unpriced" until someone pushes fresh prices to
Arc. Hermes' public price endpoints now answer "unauthorized", so Lykia
does not depend on them.

## Registering the entity secret from a phone

Developer-controlled wallets need `CIRCLE_ENTITY_SECRET`. Circle's usual
route is to generate it locally (openssl or the SDK) and register its
ciphertext. Owners without a computer can let the API do it once:

1. Set `CIRCLE_API_KEY` on the API deployment and redeploy.
2. Sign in to Lykia with a wallet listed in `LYKIA_ADMIN_ADDRESSES`.
3. `POST /v1/admin/circle/entity-secret` with an empty JSON body (the owner
   console calls it).

The API generates 32 random bytes (64 hex characters), fetches the entity
public key (`GET /v1/w3s/config/entity/publicKey`), encrypts the secret
with RSA-OAEP and SHA-256, and registers the ciphertext
(`POST /v1/w3s/config/entity/entitySecret { entitySecretCiphertext }`), the
same steps as `registerEntitySecretCiphertext` in Circle's Node SDK
(checked against @circle-fin/developer-controlled-wallets 10.8.1). The
response carries `entitySecret`, `recoveryFile` (base64 of Circle's
recovery file) and `recoveryFileName`, once, with `Cache-Control: no-store`.
Lykia never logs or stores either value.

Save the recovery file somewhere safe, set `CIRCLE_ENTITY_SECRET` to the
returned value in the API's environment and redeploy. When the variable is
already set the endpoint refuses with 409; `{ "replace": true }` registers a
new one only if Circle accepts it (an entity with a secret must rotate it in
the Circle Console with its recovery file).
