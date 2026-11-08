// Runs the leashed agent offline against a mocked Lykia API and a fake wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lykia } from "@lykia/sdk";
import { runLeashedAgent } from "../agent.mjs";
import { rpc } from "../mcp.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LEASH = "lsh_0123456789ab";
const KEY = "lk_leash_live_abcdefabcdef_" + "A".repeat(32);
const SESSION_KEY = "0x7777777777777777777777777777777777777777";
const usage = { day: { remainingUsd: "50.00" }, total: { remainingUsd: "350.00" } };
const step = { intentId: "out_leash0001", stepId: "s1", transaction: { chainId: 5042, from: SESSION_KEY, to: "0x522fAf9A91c41c443c66765030741e4AaCe147D0", data: "0xabcdef", value: "0", label: "Trade bot: Swap 5 USDC to EURC on Uniswap v3" }, calls: [{ kind: "agentTransfer" }, { kind: "agentExecute" }], memo: "lykia:1:out_leash0001:s1:0123456789abcdef", simulated: true };

function api() {
  const calls = [];
  const fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, key: init.headers["Lykia-Key"], body: init.body ? JSON.parse(init.body) : null });
    if (init.method === "GET") return json({ id: LEASH, agentName: "Trade bot", template: "trade-small", expiresAt: "2026-11-15T12:00:00.000Z", usage });
    if (path.endsWith("/plan")) {
      if (/5000/u.test(init.body)) return json({ error: { code: "LEASH_DENIED", message: "Over the cap.", details: { leashId: LEASH, reasons: [{ code: "fence.caps.step", message: "$5,050.00 is above the per-step cap of $25." }, { code: "leash.chain.spendable", message: "The account lets this session spend 25 USDC right now." }], remaining: { stepUsd: "25.00", dayUsd: "44.95", totalUsd: "344.95" }, verdictDigest: null, intentId: null } } }, 422);
      return json({ leashId: LEASH, decision: "allow", intent: { id: "out_leash0001", steps: [{ summary: "Swap 5 USDC to EURC on Uniswap v3" }], verdict: { decision: "allow", digest: `sha256:${"0123456789abcdef".repeat(4)}` } }, prepared: step, remaining: { stepUsd: "25.00", dayUsd: "50.00", totalUsd: "350.00" }, notes: [] });
    }
    if (path.endsWith("/submit")) return json({ leashId: LEASH, status: "settled", chainProven: true, next: null, usage });
    return json({ error: { code: "NOT_FOUND", message: "no route" } }, 404);
  };
  return { lykia: new Lykia({ baseUrl: "https://api.test", apiKey: KEY, retries: 0, fetch }), calls };
}

test("the agent plans a small swap, signs it with its session key, submits it, and gets a clean deny over the cap", async () => {
  const { lykia, calls } = api();
  const sent = [];
  const lines = [];
  const results = await runLeashedAgent({ lykia, leashId: LEASH, tasks: ["swap 5 USDC to EURC", "swap 5000 USDC to EURC"], send: async (tx) => (sent.push(tx), `0x${"c".repeat(64)}`), log: (l) => lines.push(l) });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [`GET /v1/leashes/${LEASH}`, `POST /v1/leashes/${LEASH}/plan`, `POST /v1/leashes/${LEASH}/submit`, `POST /v1/leashes/${LEASH}/plan`]);
  assert.ok(calls.every((c) => c.key === KEY), "every call carries the leash key");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, SESSION_KEY, "the agent's own key signs");
  assert.deepEqual(calls[2].body, { intentId: "out_leash0001", stepId: "s1", hash: `0x${"c".repeat(64)}` });
  assert.equal(results[0].ok, true);
  assert.equal(results[0].settled[0].chainProven, true);
  assert.equal(results[1].ok, false);
  assert.deepEqual(results[1].reasons, ["fence.caps.step", "leash.chain.spendable"]);
  assert.equal(results[1].remaining.dayUsd, "44.95");
  assert.match(lines.at(-1), /^DENIED .*\[fence\.caps\.step\].*Left: \$25\.00 a step, \$44\.95 today/u);
});

test("without a wallet the agent only plans", async () => {
  const { lykia, calls } = api();
  const lines = [];
  await runLeashedAgent({ lykia, leashId: LEASH, tasks: ["swap 5 USDC to EURC"], log: (l) => lines.push(l) });
  assert.ok(!calls.some((c) => c.path.endsWith("/submit")));
  assert.match(lines.at(-1), /not sent/u);
});

test("over MCP the leash key is sent and the leash's tools come back", async () => {
  let seen;
  const result = await rpc("tools/list", {}, { api: "https://api.test", key: KEY, fetch: async (url, init) => {
    seen = init;
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "leash_status" }, { name: "leash_plan" }, { name: "leash_submit" }] } })}\n\n`, { status: 200 });
  } });
  assert.equal(seen.headers["Lykia-Key"], KEY);
  assert.deepEqual(result.tools.map((t) => t.name), ["leash_status", "leash_plan", "leash_submit"]);
});
