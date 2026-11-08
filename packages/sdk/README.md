# @lykia/sdk

A typed client for the Lykia API, built on Arc Network. It works anywhere `fetch` and Web Crypto exist: Node 20 and later, browsers, Deno, Bun and edge runtimes. It has one dependency, `@lykia/core`, which supplies the contract types.

```sh
npm install @lykia/sdk
```

```ts
import { Lykia } from "@lykia/sdk";

const lykia = new Lykia({
  baseUrl: "https://api.lykiaai.com",
  apiKey: process.env.LYKIA_API_KEY,   // lk_sk_… on servers, lk_pk_… in browsers
  environment: "testnet",          // Arc testnet (5042002) or mainnet (5042)
});
```

The client sends an `Idempotency-Key` with every POST. Rate limits and transient failures are retried with backoff:

- GET requests are always retried.
- POST requests are retried only when the server never processed them: a 429, 502, 503 or 504 response, or a network error before any response.

Every other failure throws a `LykiaError` with the API's stable `code`, the HTTP `status`, `details` and the `requestId`.

## Plan, sign, submit

The server never signs intents. It plans an intent, the Fence judges the plan, and the API hands out unsigned transactions. You sign them in the owner's wallet and submit the transaction hashes. On Arc, finality is deterministic, so a same-chain step is settled as soon as its receipt exists.

```ts
import { createWalletClient, custom } from "viem";

const owner = "0x…";
const { intent, outrun } = await lykia.intents.create({ owner, text: "put half my USDC to work then convert 100 USDC to EURC" });
if (intent.verdict.decision === "deny") throw new Error(intent.verdict.reasons.map((r) => r.message).join(" "));

const wallet = createWalletClient({ transport: custom(window.ethereum) });
for (const step of intent.steps) {
  const prepared = await lykia.intents.prepare(intent.id, step.id, { confirm: intent.verdict.decision === "confirm" });
  const hashes = [];
  for (const tx of prepared.transactions) {
    hashes.push(await wallet.sendTransaction({ account: tx.from, to: tx.to, data: tx.data, value: BigInt(tx.value), chain: null }));
  }
  const { outrun: now } = await lykia.intents.submit(intent.id, step.id, hashes);
  console.log(now.waypoints.map((w) => `${w.name}: ${w.status}`).join(" → "));
}
```

`lykia.intents.follow(id)` streams live updates for an intent as an async iterator.

## Protocol fee

Every value-moving step pays Lykia's protocol fee (1% by default) inside its own
transaction; repay, withdrawals home, approvals and Tag steps are free. Each
step carries `fee` and the outrun carries `fees` totals, so you can show it
before the owner signs.

```ts
const { percent, recipient, policy } = await lykia.fees();
const { intent, outrun } = await lykia.intents.create({ owner, text: "swap 100 USDC to EURC" });
intent.steps[0]?.fee; // { amount: "1000000", symbol: "USDC", basis: "input", ... }
outrun.fees;          // ["1 USDC"]
```

## Lyko and the Pack

To talk to Lyko, stream a turn with `agent.chat`. The stream contains these events: `thread`, `reading`, `task` (one per specialist), `tool`, `step` (one step of Lyko at work, sent when it starts and again with the same id when it ends), `block` (a typed answer card such as a gas gauge or a Fence refusal, built from server data), `thinking-summary`, `proposal`, `clarify`, `draft` (an alert or automation Lyko saved, or a link to its prefilled form), `text`, `error` and `done`.

```ts
for await (const { event, data } of lykia.agent.chat({ message: "pay the March invoices and keep 30% of the rest in EUR", owner })) {
  if (event === "task") console.log("delegated:", data);
  if (event === "proposal") console.log("proposal:", data);
}
```

If you only want the result, `agent.ask` returns the reply, the proposals and every event in one response.

### Spawn a sub-agent with a carved budget

Pack writes need a `Lykia-Session` for the owner (sign in with `auth.nonce` and `auth.verify`), or a secret key with the `agents` scope that may act for that owner: the key's own developer address, or an owner who granted the key's project consent with `POST /v1/consents` from their own session (see docs/platform/keys-and-scopes.md).

A sub-agent's Fence must sit inside its parent's Fence: every limit is equal or tighter, and every list is a subset. Its caps are reserved out of the parent's free budget.

```ts
const treasurer = await lykia.pack.create({ owner, name: "Treasury", role: "treasurer" });
const payroll = await lykia.pack.spawn(treasurer.id, { name: "Payroll", role: "payroll", signer: "0xSessionKey…" });
console.log(payroll.budget.caps, (await lykia.pack.budget(treasurer.id)).free);

// Optional: bind it on chain. This returns an unsigned createSession call to the owner's LykiaAccount.
const { transaction } = await lykia.pack.sessionTx(payroll.id, { account: "0xLykiaAccount…", validDays: 30 });
```

A sub-agent that asks for more than its parent allows is refused:

- `SUB_FENCE_VIOLATION`: its Fence is not inside the parent's Fence.
- `BUDGET_EXCEEDED`: its caps are more than the parent has free.

The `details` of the error list every violating field.

## Webhooks

Verify the `Lykia-Signature` header against the raw request body:

```ts
import { verifyWebhook } from "@lykia/sdk";

export async function POST(request: Request) {
  const body = await request.text();
  if (!(await verifyWebhook(process.env.LYKIA_WEBHOOK_SECRET!, body, request.headers.get("Lykia-Signature")))) {
    return new Response("bad signature", { status: 400 });
  }
  const event = JSON.parse(body); // intent.step.settled, intent.settled, pack.agent.spawned, pack.agent.revoked, whistle.blown, standing_order.fired
  return new Response("ok");
}
```

Signatures older than five minutes are rejected.

## Modular imports

Import only what you use. Each module takes a transport, so bundlers drop
the rest:

```ts
import { createTransport } from "@lykia/sdk/transport";
import { intentsApi } from "@lykia/sdk/intents";
import { projectsApi } from "@lykia/sdk/projects";

const t = createTransport({ apiKey: process.env.LYKIA_API_KEY, project: "prj_…" });
const plan = await intentsApi(t).create({ owner, text: "send 25 USDC to 0x…" });
const brand = await projectsApi(t).public(); // the project's brand, modules and disclosed fee
```

| Subpath | What it covers |
|---|---|
| `@lykia/sdk/intents` | Parse, plan, prepare, submit, follow. |
| `@lykia/sdk/fence` | Validate (with loosened-rule lines) and evaluate. |
| `@lykia/sdk/agents` | Lyko's chat, threads, insights, automations, the Pack, standing orders, orders. |
| `@lykia/sdk/circle` | CCTP, Gateway, x402 services, Compliance screening. |
| `@lykia/sdk/ecosystem` | The ecosystem map, venues, the Flock, Scent. |
| `@lykia/sdk/projects` | White-label projects: brand, origins, keys, usage, webhook. |
| `@lykia/sdk/webhooks` | Verify `Lykia-Signature`. |

`new Lykia()` still bundles every module (`lykia.intents`, `lykia.projects`,
`lykia.ecosystem`, ...).

## Typed events

```ts
lykia.on("plan-created", (e) => console.log(e.intentId, e.decision));
lykia.on("step-signed", (e) => console.log(e.stepId, e.hashes));
lykia.on("settled", (e) => console.log(e.stepId, e.status));
lykia.on("error", (e) => console.error(e.path, e.error.code));
```

`request`, `response` and `retry` events help with logging and metrics.
