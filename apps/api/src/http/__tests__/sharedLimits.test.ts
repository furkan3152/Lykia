import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApp } from "../../app.js";
import { systemClock } from "../../clock.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "../../__tests__/support.js";
import { agentServices, setLlmClient } from "../../agents/index.js";
import type { LlmClient } from "../../agents/llm.js";
import { MemoryStore } from "../../store/memory.js";
import { modelBudget } from "../sharedLimits.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

describe("shared limits across instances", () => {
  const store = new MemoryStore(systemClock);
  const instances: { ctx: AppContext; served: Served }[] = [];

  before(async () => {
    // Two "function instances" that share one store, like two Vercel instances on one Postgres.
    for (let i = 0; i < 2; i++) {
      const ctx = createContext(testConfig({ LYKIA_RATE_LIMIT_SHARED: "3", LYKIA_RATE_LIMIT_HEAVY: "1000" }), { store, chains: new FakeArc().asChains(), pulse: idlePulse, fetch: offlineFetch() });
      setLlmClient(ctx, null);
      instances.push({ ctx, served: await serve(createApp(ctx)) });
    }
  });
  after(async () => {
    for (const { ctx, served } of instances) {
      await served.close();
      await closeContext(ctx);
    }
  });

  it("counts chat requests from one address across every instance", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const { served } = instances[i % 2]!;
      const res = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ message: "hello" }) });
      await res.text();
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });
});

describe("daily model budget", () => {
  it("trips a global breaker: past the cap llm() answers null and callers use the deterministic reader", async () => {
    const ctx = createContext(testConfig({ LYKIA_MODEL_DAILY_CALLS: "2" }), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: offlineFetch() });
    try {
      let calls = 0;
      const scripted: LlmClient = { model: "test-model", turn: async () => ((calls += 1), { content: [], stopReason: "end_turn" }) as never };
      setLlmClient(ctx, scripted);
      for (let i = 0; i < 2; i++) await agentServices(ctx).llm()!.turn({} as never);
      assert.equal(calls, 2);
      assert.equal(agentServices(ctx).llm(), null, "the breaker is open after the cap");
      const status = await modelBudget(ctx).status();
      assert.deepEqual([status.used, status.limit, status.open], [2, 2, false]);
    } finally {
      await closeContext(ctx);
    }
  });
});
