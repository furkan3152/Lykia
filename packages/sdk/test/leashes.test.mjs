import { test } from "node:test";
import assert from "node:assert/strict";
import { Lykia } from "../dist/index.js";
import { leashesApi } from "../dist/leashes.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const A = "0x1111111111111111111111111111111111111111";
const ID = "lsh_0123456789ab";

test("leashes call the documented routes", async () => {
  const seen = [];
  const lykia = new Lykia({ baseUrl: "https://api.test", apiKey: "lk_live_x", environment: "mainnet", fetch: async (url, init) => {
    seen.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    return json(200, { ok: true });
  } });
  await lykia.leashes.templates();
  await lykia.leashes.create({ agent: { name: "Invoice bot", signer: A }, template: "pay-invoices", budget: { perStepUsd: "20", perDayUsd: "20", totalUsd: "140" }, expiresAt: "2026-11-15T00:00:00Z", recipients: [A] });
  await lykia.leashes.list(A);
  await lykia.leashes.get(ID);
  await lykia.leashes.trail(ID);
  await lykia.leashes.revoke(ID);
  await lykia.leashes.renew(ID, { expiresAt: "2026-11-22T00:00:00Z" });
  await lykia.leashes.bindSession(ID, `0x${"a".repeat(64)}`);
  await lykia.leashes.plan(ID, { text: "pay 12 USDC to 0x1111111111111111111111111111111111111111" });
  await lykia.leashes.submit(ID, { intentId: "out_abcdefgh", stepId: "s1", hash: `0x${"b".repeat(64)}` });
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url.replace("https://api.test", "")}`), [
    "GET /v1/leashes/templates",
    "POST /v1/leashes",
    `GET /v1/leashes?owner=${A}&environment=mainnet`,
    `GET /v1/leashes/${ID}`,
    `GET /v1/leashes/${ID}/trail`,
    `POST /v1/leashes/${ID}/revoke`,
    `POST /v1/leashes/${ID}/renew`,
    `POST /v1/leashes/${ID}/session`,
    `POST /v1/leashes/${ID}/plan`,
    `POST /v1/leashes/${ID}/submit`,
  ]);
  assert.equal(seen[1].body.environment, "mainnet");
  assert.equal(seen[1].body.template, "pay-invoices");
});

test("a leash denial surfaces as a LykiaError with its reasons", async () => {
  const lykia = new Lykia({ baseUrl: "https://api.test", apiKey: "lk_leash_live_x", retries: 0, fetch: async () => json(422, { error: { code: "LEASH_DENIED", message: "Over the cap.", details: { reasons: [{ code: "fence.caps.step", message: "Over the cap." }], remaining: { stepUsd: "20.00", dayUsd: "20.00", totalUsd: "140.00" } } } }) });
  await assert.rejects(lykia.leashes.plan(ID, { text: "pay 30 USDC to 0x1111111111111111111111111111111111111111" }), (e) => e.code === "LEASH_DENIED" && e.status === 422 && e.details.reasons[0].code === "fence.caps.step" && e.details.remaining.dayUsd === "20.00");
});

test("the leashes subpath works on its own", () => {
  assert.equal(typeof leashesApi({ env: () => undefined, request: async () => ({}) }).plan, "function");
});
