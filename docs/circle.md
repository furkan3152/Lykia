# Circle products in Lykia

Lykia is built on Arc Network and uses Circle's own rails wherever they
exist. Run `GET /v1/circle/status` to see what is live and what needs a
key. Nothing in this list signs for the user: every step that moves value
comes back as an unsigned call or as typed data for the owner's or the
agent's wallet.

## Works without a key

| Product | What Lykia does |
|---|---|
| USDC and EURC | Every plan settles in them. Native USDC (18 decimals) and ERC-20 USDC (6 decimals) are handled as one balance. |
| CCTP V2 | Bridges out of Arc and mints inbound transfers. Fees come live from Circle's API per route. |
| CCTP Forwarding Service | `approve` plus `depositForBurnWithHook` with the `cctp-forward` hook. Circle performs the destination mint, so the recipient needs no gas there. `maxFee` covers the protocol fee and the medium forwarding fee. |
| Gateway | Shows the unified balance per chain. Deposits are part of plans. Transfers out work in three steps: the depositor signs the EIP-712 burn intent, Gateway returns an attestation, and Lykia returns the unsigned `gatewayMint` for the destination. The fee is 0.5 bps across chains plus the Arc source gas fee; same-chain transfers pay no transfer fee. |
| Agent Marketplace discovery | Lists x402 services that accept USDC on Arc, with price, payee and provider. |
| x402 on Arc (buyer side) | Reads a service's 402. The Fence judges the price and the payee: agents only pay allowlisted payees within their caps. The wallet signs an EIP-3009 authorization, then Lykia relays the paid request and the service's answer. Discovery also shows which services accept Gateway nanopayments. |
| ERC-8183 jobs (testnet) | Builds the calls to create, fund, complete, reject and refund USDC escrow jobs between agents. |

## Needs a key

| Product | Variables | What Lykia does |
|---|---|---|
| Compliance Engine | `CIRCLE_API_KEY` | Screens external recipients before planning. A DENIED address joins the Fence's deny list, so the plan is refused with a reason. |
| Developer-controlled wallets | `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` (optional `CIRCLE_WALLET_SET_ID`) | Creates an SCA agent wallet on ARC or ARC-TESTNET for a Pack agent, tagged with the agent id. The entity secret travels only as fresh RSA-OAEP ciphertext. |
| Gas Station | the same, plus a policy in the Circle Console | Sponsors gas for those SCA wallets (Gas Station contract `0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25` on both Arc networks). |
| StableFX | `CIRCLE_API_KEY` with StableFX access, or `STABLEFX_API_KEY` | Runs the RFQ taker flow: quote, the taker signs the quote's Permit2 typed data, then the trade and its status. Without access, USDC to EURC routes through Uniswap. Lykia never makes up a quote. |

## Not used, and why

- **Circle Paymaster.** It lets users pay gas in USDC on chains where gas
  is something else. Arc's gas is already USDC.
- **Agent Wallets (Circle CLI).** These run through Circle's CLI with an
  email session. Lykia's Fence and LykiaAccount sessions play the same
  role on chain, and a Circle CLI wallet can join the Pack by its address.
- **USYC.** Shown in the Flock. Subscribing and redeeming stay off until
  the teller contract's source is verified and eligibility (non-US,
  minimums) is handled.

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
