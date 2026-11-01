# Agents API

Developers create and configure Lykia agents over the API and run them from
their own servers. The agent plans; the owner (or an agent session the owner
created on chain) signs.

## Configuration

| Field | Meaning |
|---|---|
| `name`, `owner` | The agent's name and the address it plans for. |
| `tools` | Any of `plan`, `flock`, `scent`, `venues`, `prices`, `search_routes`, `knowledge`, `outrun`. Without `plan` it cannot propose moves. |
| `kinds`, `venues` | Step kinds and venue ids it may touch (they narrow the Fence). |
| `fence` | Must sit inside the project's Fence (400 `FENCE_NOT_SUBSET` with the violations otherwise). |
| `budget` | `perRunUsd` and `dailyUsd` become Fence caps (only ever lower); `maxRunsPerDay` limits runs. |
| `pack` | Pack agent ids it may delegate to; each one's Fence must sit inside the agent's. |
| `persona` | Tone and context, sanitised like project prompts; it cannot change rules, the Fence or confirmations. |
| `memory` | `true` reads with the owner's memory (contacts, habits); `false` uses the plain reader. |
| `autoPrepare` | Return the first step's unsigned calls (with the security report) for `allow` verdicts. `confirm` verdicts are never prepared automatically. |
| `llm.provider` | `lykia` (the server's model when configured and the `agents.llm` flag is on) or `none` (the deterministic reader). |

The effective Fence and its hash are on the agent (`fence`, `fenceHash`).

## Routes

| Route | |
|---|---|
| `POST /v1/agents` · `GET /v1/agents` | Create (scope `agents`), list. |
| `GET` · `PATCH` · `DELETE /v1/agents/:id` | Read, reconfigure, delete. |
| `POST /v1/agents/:id/run` | `{ message, threadId?, autoPrepare?, dryRun? }`: reply, proposals with verdicts, prepared calls, thread id. |
| `GET /v1/agents/:id/threads` · `/threads/:threadId` | Conversation threads (last 40 messages, 90 days). |
| `POST /v1/agents/:id/tag` | ERC-8004 registration: a card pinning the agent's Fence hash and the unsigned `register` call. |
| `GET /v1/verdicts/:digest` | Recompute a Fence verdict from the stored plan and say whether it matches (public). |
| `POST /v1/verdicts/verify` | The same from a Fence and facts you hold (public). |

## curl

```sh
curl -X POST https://<api>/v1/agents -H "Lykia-Key: lk_live_…" -H "content-type: application/json" \
  -d '{ "name": "Payroll agent", "owner": "0xOwner…", "kinds": ["transfer"],
        "budget": { "perRunUsd": "200", "maxRunsPerDay": 20 }, "persona": "Short answers." }'
curl -X POST https://<api>/v1/agents/agt_…/run -H "Lykia-Key: lk_live_…" -H "content-type: application/json" \
  -d '{ "message": "send 50 USDC to ada" }'
curl https://<api>/v1/verdicts/sha256:…
```

## SDK

```ts
const agent = await lykia.agents.create({ name: "Payroll agent", owner, kinds: ["transfer"], budget: { perRunUsd: "200" } });
const run = await lykia.agents.run(agent.id, { message: "send 50 USDC to ada", autoPrepare: true });
const check = await lykia.agents.verifyVerdict(digest); // { found, match, intentId, … }
```

`@lykia/agent-tools` has `run_agent` and `verify_verdict` (opt-in by name).
