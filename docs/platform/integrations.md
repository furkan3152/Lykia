# Protocol and contract integrations

Two ways to build on any contract on Arc through Lykia: describe your
protocol once with an **adapter manifest** so Lykia routes to it, or use the
**generic contract endpoints** for any call.

## Adapter manifests (`lykia.adapter/v1`)

The spec, the flow and the field reference are in
[docs/integrate-your-protocol.md](../integrate-your-protocol.md); a complete
example is [`examples/adapter-manifest/manifest.json`](../../examples/adapter-manifest/manifest.json).

| Route | Who | What |
|---|---|---|
| `GET /v1/integrations/manifest` | anyone | Verbs, templates, statuses and the example. |
| `POST /v1/integrations/adapters` | secret key or session | Submit or re-submit; `validate: true` validates right away. |
| `GET /v1/integrations/adapters` | anyone | Approved and routable adapters; `?mine=true` your own. |
| `GET /v1/integrations/adapters/:id` | anyone once approved; the submitter or an admin before | One adapter. |
| `GET /v1/integrations/adapters/:id/status` | same | Status, last validation, history. |
| `POST /v1/integrations/adapters/:id/validate` | the submitter or an admin | On-chain validation. |
| `POST /v1/integrations/adapters/:id/review` | Lykia admin session | `approve`, `reject`, `route`, `suspend`. |

Records are kept in the store, so an approved adapter reaches every API
instance without a redeploy (each instance re-reads routable adapters every
30 seconds).

```sh
curl -X POST "$LYKIA_API/v1/integrations/adapters" -H "content-type: application/json" \
  -H "Lykia-Key: $LYKIA_SECRET_KEY" \
  -d "{\"manifest\": $(cat examples/adapter-manifest/manifest.json), \"validate\": true}"
curl "$LYKIA_API/v1/integrations/adapters/example-usdc-vault/status" -H "Lykia-Key: $LYKIA_SECRET_KEY"
```

```ts
import { integrationsApi } from "@lykia/sdk/integrations";
import { createTransport } from "@lykia/sdk/transport";

const t = createTransport({ baseUrl: process.env.LYKIA_API, apiKey: process.env.LYKIA_SECRET_KEY });
const record = await integrationsApi(t).adapters.submit(manifest, { validate: true, environment: "mainnet" });
console.log(record.status, record.validation?.checks);
```

## Generic contract endpoints

| Route | What it does |
|---|---|
| `POST /v1/contracts/encode` | `{ abi, function, args }` -> `{ data, selector, signature }`. The ABI is human-readable fragments or JSON; integers are decimal strings. |
| `POST /v1/contracts/read` | Up to 50 view calls in one multicall; results are JSON (integers as strings). |
| `POST /v1/contracts/simulate` | A call batch from an address in one Multicall3From `eth_call`: per-call results, the balance diff of every registry token (read before and after inside the same batch), decoded calls in plain English, events when the RPC offers `eth_simulateV1` (Arc's public RPC does not today, and the answer says so), and a security verdict. |
| `POST /v1/contracts/decode` | Calldata and logs -> plain English, using the engine's ABIs, routable adapters, your ABI and the knowledge model. |

The simulate verdict blocks unlimited approvals, `setApprovalForAll`,
`transferFrom` and reverts; unknown contracts and receivers are warnings
there (you may be simulating your own contract). Recipients of transfers go
through address protection (issuer blocklists, look-alikes, poisoning,
contract Scent).

```sh
curl -X POST "$LYKIA_API/v1/contracts/encode" -H "content-type: application/json" \
  -d '{"abi":["function transfer(address to, uint256 amount) returns (bool)"],"function":"transfer","args":["0x2222222222222222222222222222222222222222","2500000"]}'

curl -X POST "$LYKIA_API/v1/contracts/simulate" -H "content-type: application/json" \
  -d '{"from":"0xYourWallet","calls":[{"to":"0x3600000000000000000000000000000000000000","abi":["function approve(address spender, uint256 amount) returns (bool)"],"function":"approve","args":["0x2222222222222222222222222222222222222222","1000000"]}]}'
```

```ts
const lykia = new Lykia({ baseUrl: process.env.LYKIA_API });
const { data } = await lykia.integrations.contracts.encode({ abi: ["function deposit(uint256 assets, address receiver)"], function: "deposit", args: ["1000000", me] });
const sim = await lykia.integrations.contracts.simulate({ from: me, calls: [{ to: vault, data }] });
console.log(sim.ok, sim.balanceChanges, sim.security.decision);
```
