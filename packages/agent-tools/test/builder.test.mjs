// Builder tools are opt-in and build the documented calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LYKIA_BUILDER_TOOLS, LYKIA_TOOLS, createLykiaExecutor, openaiTools, validateArgs } from "../dist/index.js";

const OWNER = "0x1111111111111111111111111111111111111111";

test("builder tools are opt-in and call the aggregator, contracts and data routes", async () => {
  assert.equal(LYKIA_TOOLS.some((t) => t.name === "aggregator_quote"), false, "the default set is unchanged");
  assert.deepEqual(LYKIA_BUILDER_TOOLS.map((t) => t.name), ["aggregator_quote", "build_action", "ai_route", "simulate_calls", "decode_calldata", "token_prices", "portfolio", "screen_address", "explain_tx"]);
  for (const t of LYKIA_BUILDER_TOOLS) assert.ok(t.description.length > 40, t.name);
  const calls = [];
  const executor = createLykiaExecutor({ baseUrl: "https://api.test", owner: OWNER, environment: "mainnet", fetch: async (url, init) => (calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null }), new Response(JSON.stringify({ id: "q_abcdefghijkl" }), { status: 200 })) });
  assert.equal((await executor.execute("aggregator_quote", { kind: "swap", tokenIn: "USDC", tokenOut: "EURC", amount: "100" })).ok, true);
  assert.equal(calls[0].url, "https://api.test/v1/aggregator/quote");
  assert.equal(calls[0].body.taker, OWNER);
  assert.equal(calls[0].body.environment, "mainnet");
  await executor.execute("build_action", { quoteId: "q_abcdefghijkl", format: "calls" });
  assert.deepEqual(calls[1].body, { quoteId: "q_abcdefghijkl", format: "calls" });
  await executor.execute("token_prices", { symbols: "EURC" });
  assert.equal(calls[2].url, "https://api.test/v1/data/prices?symbols=EURC&environment=mainnet");
  await executor.execute("screen_address", { address: OWNER });
  assert.equal(calls[3].url, `https://api.test/v1/security/screen/address/${OWNER}?environment=mainnet`);
  assert.deepEqual(validateArgs(LYKIA_BUILDER_TOOLS[0], { kind: "teleport" }), ["kind must be one of transfer, swap, fx, bridge, deposit, withdraw, supply, borrow, repay."]);
  assert.deepEqual(openaiTools(["ai_route", "explain_tx"]).map((t) => t.function.name), ["ai_route", "explain_tx"]);
});
