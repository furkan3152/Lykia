import { test } from "node:test";
import assert from "node:assert/strict";
import { LYKIA_TOOLS, aiSdkTools, anthropicTools, createLykiaExecutor, langchainTools, lykiaMcpServer, openaiTools, runAnthropicToolUse, runOpenAiToolCall, validateArgs } from "../dist/index.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeApi(handler) {
  const calls = [];
  const executor = createLykiaExecutor({ baseUrl: "https://api.test/", apiKey: "lk_sk_x", owner: OWNER, environment: "testnet", fetch: async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call);
  } });
  return { executor, calls };
}

test("all nine tools are defined with object JSON schemas", () => {
  assert.deepEqual(LYKIA_TOOLS.map((t) => t.name), ["plan_intent", "check_fence", "scent_token", "quote_route", "flock", "spawn_agent", "standing_order", "place_order", "x402_buy"]);
  for (const t of LYKIA_TOOLS) {
    assert.equal(t.parameters.type, "object", t.name);
    assert.ok(t.description.length > 40, t.name);
    for (const r of t.parameters.required ?? []) assert.ok(r in t.parameters.properties, `${t.name}.${r}`);
  }
});

test("arguments are checked before any request", async () => {
  const { executor, calls } = fakeApi(() => json(200, {}));
  assert.deepEqual(validateArgs(LYKIA_TOOLS[2], { token: "nope" }), ["token has the wrong format."]);
  const r = await executor.execute("scent_token", { token: "0x12", extra: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /wrong format.*extra is not a parameter/su);
  assert.equal((await executor.execute("drain_wallet", {})).error.code, "UNKNOWN_TOOL");
  assert.equal(calls.length, 0);
  const noOwner = createLykiaExecutor({ fetch: async () => json(200, {}) });
  assert.match((await noOwner.execute("plan_intent", { text: "send 5 USDC to me" })).error.message, /owner is required/u);
});

test("plan_intent calls the API with the key and the defaults, and summarises for the model", async () => {
  const { executor, calls } = fakeApi(() => json(201, { intent: { id: "out_abc123", steps: [{ id: "s1", summary: "Send 5 USDC" }], verdict: { decision: "confirm", signable: true, reasons: [{ rule: "confirm", message: "Above $1: confirm." }] } }, outrun: { fees: ["0.05 USDC"], fold: [] }, stored: true }));
  const r = await executor.execute("plan_intent", JSON.stringify({ text: "send 5 USDC to 0x2222222222222222222222222222222222222222" }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { intentId: "out_abc123", decision: "confirm", signable: true, reasons: ["Above $1: confirm."], steps: ["Send 5 USDC"], fees: ["0.05 USDC"], fold: [], next: "Show the plan to the owner; their wallet signs each step." });
  assert.equal(calls[0].url, "https://api.test/v1/intents");
  assert.equal(calls[0].headers["Lykia-Key"], "lk_sk_x");
  assert.deepEqual(calls[0].body, { owner: OWNER, text: "send 5 USDC to 0x2222222222222222222222222222222222222222", environment: "testnet" });
});

test("each tool maps to its route; API errors come back as data", async () => {
  const { executor, calls } = fakeApi((c) => (c.url.includes("/scent/") ? json(503, { error: { code: "UPSTREAM", message: "RPC down" } }) : json(200, { ok: true })));
  await executor.execute("check_fence", { text: "swap 10 USDC to EURC" });
  await executor.execute("quote_route", { kind: "swap", from: "USDC", to: "EURC", amount: "10" });
  await executor.execute("flock", {});
  await executor.execute("spawn_agent", { name: "Payroll", role: "payroll", parentId: "pk_1" });
  await executor.execute("standing_order", { text: "every friday send 50 USDC to 0x2222222222222222222222222222222222222222" });
  await executor.execute("place_order", { kind: "limit", sell: "USDC", buy: "EURC", amount: "100", triggerPrice: "0.9" });
  await executor.execute("x402_buy", { resource: "https://svc.example/data" });
  const scent = await executor.execute("scent_token", { token: OWNER });
  assert.deepEqual(scent, { ok: false, tool: "scent_token", error: { code: "UPSTREAM", message: "RPC down" } });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace("https://api.test", "")}`), [
    "POST /v1/intents", "POST /v1/quote", `GET /v1/flock/${OWNER}?environment=testnet`, "POST /v1/pack/pk_1/spawn", "POST /v1/standing", "POST /v1/orders/draft", "POST /v1/circle/x402/prepare", `GET /v1/scent/${OWNER}?environment=testnet`,
  ]);
  assert.equal(calls[0].body.dryRun, true, "check_fence never stores a plan");
  assert.deepEqual(calls[5].body, { owner: OWNER, kind: "limit", sell: "USDC", buy: "EURC", amount: "100", triggerPrice: "0.9", environment: "testnet" });
});

test("framework adapters wrap the same tools", async () => {
  const { executor } = fakeApi(() => json(200, { level: "verified" }));
  const ai = aiSdkTools(executor, { jsonSchema: (s) => ({ wrapped: s }) });
  assert.equal(Object.keys(ai).length, 9);
  assert.equal(ai.scent_token.parameters.wrapped.type, "object");
  assert.equal((await ai.scent_token.execute({ token: OWNER })).ok, true);
  const lc = langchainTools(executor, { tool: (fn, fields) => ({ fn, ...fields }) }, ["scent_token"]);
  assert.equal(lc[0].name, "scent_token");
  assert.match(await lc[0].fn({ token: OWNER }), /verified/u);
  assert.equal(openaiTools()[0].function.name, "plan_intent");
  const msg = await runOpenAiToolCall(executor, { id: "call_1", function: { name: "scent_token", arguments: JSON.stringify({ token: OWNER }) } });
  assert.equal(msg.role, "tool");
  assert.equal(msg.tool_call_id, "call_1");
  assert.equal(anthropicTools(["flock"])[0].input_schema.type, "object");
  const block = await runAnthropicToolUse(executor, { id: "toolu_1", name: "scent_token", input: { token: "bad" } });
  assert.equal(block.is_error, true);
  assert.deepEqual(lykiaMcpServer({ baseUrl: "https://api.lykia.xyz", apiKey: "lk_sk_x" }), { lykia: { type: "http", url: "https://api.lykia.xyz/v1/mcp", headers: { "Lykia-Key": "lk_sk_x" } } });
});
