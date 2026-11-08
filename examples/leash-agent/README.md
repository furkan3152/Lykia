# An agent on a leash

An agent that runs outside Lykia (your backend, a bot, an MCP client) and
spends only inside its leash. It holds a leash key (`lk_leash_…`), which
works for that one leash and nothing else, and its own session key, which
the owner's LykiaAccount accepts within the leash's on-chain caps.

```js
import { Lykia, LykiaError } from "@lykia/sdk";

const lykia = new Lykia({ apiKey: process.env.LYKIA_LEASH_KEY });
try {
  const plan = await lykia.leashes.plan(leashId, { text: "swap 5 USDC to EURC" });
  const hash = await wallet.sendTransaction(plan.prepared.transaction); // signed by the session key
  await lykia.leashes.submit(leashId, { intentId: plan.prepared.intentId, stepId: plan.prepared.stepId, hash });
} catch (error) {
  if (error instanceof LykiaError && error.code === "LEASH_DENIED") console.log(error.details.reasons, error.details.remaining);
}
```

`agent.mjs` runs two tasks: a small swap, then one far over the cap, which
comes back as a refusal with reason codes (`fence.caps.step`,
`leash.chain.spendable`, …) and the budget left.

```bash
LYKIA_LEASH_KEY=lk_leash_live_… LYKIA_LEASH_ID=lsh_… node examples/leash-agent/agent.mjs              # plans only
SEND=1 AGENT_PRIVATE_KEY=0x… LYKIA_LEASH_KEY=… LYKIA_LEASH_ID=… node examples/leash-agent/agent.mjs   # signs and submits
node --test examples/leash-agent/test                                                                 # offline, mocked API
```

Make a leash from the Fold (Pack tab, New leash), with
`lykia leash create --template trade-small --per-day 50 --days 7`, or with
`POST /v1/leashes`. The session key is the agent's own: `lykia leash create`
makes one on your machine and writes it to a file only you can read.

## Over MCP

With a leash key, `/v1/mcp` offers only the leash's tools: `leash_status`,
`leash_plan`, `leash_submit`, and `leash_trail`, `lykia_venues` and
`lykia_scent` when the leash allows them. Point any MCP client at it with
`mcp.json`; `mcp.mjs` lists the tools and asks for something over the cap.

See [docs/leash.md](../../docs/leash.md) for what the chain enforces and
what the API enforces.
