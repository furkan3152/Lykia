# Data and security as a service

Read endpoints for everything Lykia knows about Arc. Public, cacheable for a
short time, and keyed reads count against your key's quota like every route.

| Route | Answer | Cache |
|---|---|---|
| `GET /v1/data/tokens` | The registry: symbol, name, address, decimals, issuer, peg, pricing method, USD price and its source. | 30 s |
| `GET /v1/data/prices[?symbols=EURC,cirBTC]` | USD prices: Chainlink on Arc, fiat pegs through Chainlink fiat feeds, USYC at NAV. Unpriced is `null`, never zero. | 15 s |
| `GET /v1/data/protocols` | Every Arc protocol: status, what Lykia does with it, TVL (DefiLlama), live APYs and borrow rates (Morpho API, Aave API), and approved adapter manifests. | 60 s |
| `GET /v1/data/portfolio/:address` | The Flock: wallet balances, Morpho vaults, Aave V4 and Morpho Blue supplies and debts, the Gateway balance, positions at routable adapters, health factors, USD per venue. | 10 s in memory |
| `GET /v1/security/screen/address/:address[?owner]` | Address screening: USDC/EURC blocklists, look-alikes against the owner's contacts, address poisoning, contract Scent, Circle Compliance when configured. `decision` is `pass`, `warn` or `block`. | none |
| `GET /v1/security/scent/token/:token` | Scent: registry listing, proxy, privileged functions, owner, a simulated transfer. Scent never calls a token safe. | 60 s |
| `POST /v1/tx/explain` | `{ hash }`: who called what, decoded steps and events, status. `{ transaction }`: decoded, simulated, with the balance changes and a security verdict. | none |
| `GET /v1/tx/explain/:hash` | The same for a mined transaction. | none |

Caching is per instance and per process (no timers), so it is safe on
serverless.

```sh
curl "$LYKIA_API/v1/data/prices?symbols=EURC,cirBTC"
curl "$LYKIA_API/v1/data/portfolio/0xYourWallet"
curl "$LYKIA_API/v1/security/screen/address/0x2222222222222222222222222222222222222222?owner=0xYourWallet"
curl -X POST "$LYKIA_API/v1/tx/explain" -H "content-type: application/json" -d '{"hash":"0x..."}'
```

```ts
import { dataApi } from "@lykia/sdk/data";
import { createTransport } from "@lykia/sdk/transport";

const data = dataApi(createTransport({ baseUrl: process.env.LYKIA_API, environment: "mainnet" }));
const { prices } = await data.prices(["EURC", "cirBTC"]);
const screen = await data.screenAddress(payee, { owner: me });
if (screen.decision === "block") throw new Error("Do not pay this address.");
const { summary } = await data.explainTx({ hash });
```
