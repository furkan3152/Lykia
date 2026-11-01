# Circle execution providers

`apps/api/src/circle/providers.ts` exports `circleProviders` and registers
them with the aggregator (`apps/api/src/engine/providers.ts`,
`registerProvider`). The aggregator plans the action first, the Fence judges
it, then providers quote and build beside Lykia's own engine. Every quote
and build carries `poweredBy: "Circle"`, shown as "Powered by Circle".
Nothing signs or broadcasts.

| Provider | Kinds | Needs | Quote | Build |
|---|---|---|---|---|
| `circle-cctp` | bridge | nothing | Live fee from Circle's Iris API (Fast Transfer + forwarding fee) | `approve` + `depositForBurnWithHook` with the Forwarding Service hook |
| `circle-gateway` | bridge | a Gateway balance | Max fee (0.5 bps crosschain + source gas) | Burn intent stored as a draft; finish at `POST /v1/circle/gateway/transfer/attest` |
| `circle-stablefx` | fx | `CIRCLE_API_KEY` with StableFX access | Reference RFQ quote | Taker signs Permit2 via `/v1/circle/stablefx/quote` and `/trade` |
| `circle-wallets` | transfer, swap, fx, deposit, withdraw, supply, repay, bridge | `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` | Signer option (Gas Station sponsorship) | Your server executes with its own entity secret |
| `circle-app-kit` | transfer, swap, bridge, deposit | client SDK | never available server-side | never |

Controls around them (`GET /v1/circle/providers` lists all with status):
Gas Station (sponsor), Compliance Engine (screening), x402 Facilitator
(settlement), Agent Marketplace (discovery), Onramp Kit (client-side).

## App Kit with Lykia

App Kit (`@circle-fin/app-kit`) runs in the integrator's front end; Circle
publishes no server endpoint for it, so Lykia does not pretend to execute
it. To use both, check the plan first and then call the kit:

```ts
const verdict = await lykia.fence.evaluate({ fence, facts });
if (verdict.signable) await kit.send({ /* App Kit parameters */ });
```
