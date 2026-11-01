import { test } from "node:test";
import assert from "node:assert/strict";
import { Lykia } from "../dist/index.js";
import { payoutsApi } from "../dist/payouts.js";
import { invoicesApi } from "../dist/invoices.js";
import { automationsApi } from "../dist/automations.js";
import { agentsApi } from "../dist/agents.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const A = "0x1111111111111111111111111111111111111111";

test("business modules call the documented routes with the client's environment", async () => {
  const seen = [];
  const lykia = new Lykia({ baseUrl: "https://api.test", apiKey: "lk_sk_x", environment: "testnet", fetch: async (url, init) => {
    seen.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    return json(200, { ok: true });
  } });
  await lykia.payouts.create({ payer: A, rows: [{ to: A, token: "USDC", amount: "1" }] });
  await lykia.payouts.importCsv("to,token,amount\n", { payer: A });
  await lykia.payouts.submit("po_x", 0, `0x${"a".repeat(64)}`);
  await lykia.invoices.create({ token: "USDC", payee: A, amount: "5" });
  await lykia.invoices.pay("inv_x", { payer: A });
  await lykia.agents.run("agt_x", { message: "pay Ada 10 USDC" });
  await lykia.agents.verifyVerdict("sha256:00");
  await lykia.automations.pause("so_x", A);
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url.replace("https://api.test", "")}`), [
    "POST /v1/payouts",
    "POST /v1/payouts/import",
    "POST /v1/payouts/po_x/batches/0/submit",
    "POST /v1/invoices",
    "POST /v1/invoices/inv_x/pay",
    "POST /v1/agents/agt_x/run",
    "GET /v1/verdicts/sha256%3A00",
    `POST /v1/automations/so_x/pause?owner=${A}`,
  ]);
  assert.equal(seen[0].body.environment, "testnet");
  assert.equal(seen[1].body.csv, "to,token,amount\n");
});

test("subpath modules work on their own", () => {
  for (const make of [payoutsApi, invoicesApi, automationsApi, agentsApi]) assert.equal(typeof make({ env: () => undefined, request: async () => ({}) }), "object");
});
