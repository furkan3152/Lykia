// Runs the agent loop offline: a scripted model and a mocked Lykia API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiSdkTools, createLykiaExecutor } from "@lykia/agent-tools";
import { runAgent, scriptedModel } from "../agent.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function tools(level) {
  const calls = [];
  const lykia = createLykiaExecutor({ baseUrl: "https://api.test", owner: "0x1111111111111111111111111111111111111111", environment: "mainnet", fetch: async (url, init) => {
    calls.push(`${init.method} ${new URL(url).pathname}`);
    if (url.includes("/v1/scent/")) return json({ symbol: "EURC", level, checks: [] });
    return json({ intent: { id: "out_dry", steps: [{ id: "s1", summary: "Swap 99 USDC to EURC on StableFX" }], verdict: { decision: "allow", signable: false, reasons: [] } }, outrun: { fees: ["1 USDC"], fold: ["91.2 EURC"] }, stored: false });
  } });
  return { tools: aiSdkTools(lykia, { jsonSchema: (s) => s }), calls };
}

test("the agent checks Scent, then plans, and reports the Fence verdict and fees", async () => {
  const { tools: t, calls } = tools("verified");
  const { text } = await runAgent({ model: scriptedModel(), tools: t, prompt: "Is EURC safe? Plan 100 USDC into it." });
  assert.deepEqual(calls, ["GET /v1/scent/0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", "POST /v1/intents"]);
  assert.match(text, /Swap 99 USDC to EURC/u);
  assert.match(text, /Fees: 1 USDC/u);
  assert.match(text, /Fence: allow/u);
});

test("a red flag stops the agent before it plans anything", async () => {
  const { tools: t, calls } = tools("danger");
  const { text } = await runAgent({ model: scriptedModel(), tools: t, prompt: "Buy it." });
  assert.equal(calls.length, 1);
  assert.match(text, /would not touch/u);
});
