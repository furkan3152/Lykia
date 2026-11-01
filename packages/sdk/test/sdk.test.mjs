import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Lykia, LykiaError, parseFrame, readSse, signWebhook, verifyWebhook } from "../dist/index.js";

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("sends keys, sessions and idempotency keys; parses the error envelope", async () => {
  const seen = [];
  const lykia = new Lykia({ baseUrl: "https://api.test/", apiKey: "lk_sk_x", session: "lk1.a.b", environment: "testnet", fetch: async (url, init) => {
    seen.push({ url, init });
    return url.includes("/flock/") ? json(200, { totalUsd: "1" }) : json(403, { error: { code: "FENCE_DENIED", message: "No.", requestId: "req_1" } });
  } });
  assert.equal((await lykia.arc.flock("0x1111111111111111111111111111111111111111")).totalUsd, "1");
  assert.equal(seen[0].url, "https://api.test/v1/flock/0x1111111111111111111111111111111111111111?environment=testnet");
  assert.equal(seen[0].init.headers["Lykia-Key"], "lk_sk_x");
  assert.equal(seen[0].init.headers["Lykia-Session"], "lk1.a.b");
  await assert.rejects(lykia.intents.create({ owner: "0x1111111111111111111111111111111111111111", text: "x" }), (e) => e instanceof LykiaError && e.code === "FENCE_DENIED" && e.status === 403 && e.requestId === "req_1" && !e.retryable);
  assert.match(seen[1].init.headers["Idempotency-Key"], /^[0-9a-f]{32}$/u);
});

test("retries 429 and 503 with the same idempotency key, then gives up", async () => {
  let calls = 0;
  const keys = new Set();
  const lykia = new Lykia({ retries: 2, fetch: async (_url, init) => {
    calls++;
    keys.add(init.headers["Idempotency-Key"]);
    return calls < 3 ? json(calls === 1 ? 429 : 503, { error: { code: "RATE_LIMITED", message: "slow" } }, { "retry-after": "0" }) : json(201, { stored: true });
  } });
  assert.deepEqual(await lykia.intents.create({ owner: "0x1111111111111111111111111111111111111111", text: "x" }), { stored: true });
  assert.equal(calls, 3);
  assert.equal(keys.size, 1);
  let n = 0;
  const failing = new Lykia({ retries: 1, fetch: async () => { n++; return json(503, { error: { code: "UPSTREAM_UNAVAILABLE", message: "down" } }); } });
  await assert.rejects(failing.arc.venues(), (e) => e.retryable && e.status === 503);
  assert.equal(n, 2);
});

test("streams Lyko's chat as SSE messages", async () => {
  const frames = 'event: thread\ndata: {"threadId":"t1","mode":"reader"}\n\n: heartbeat\n\nevent: task\ndata: {"agent":"FX hedger","role":"fx-hedger","task":"fx"}\n\nevent: done\ndata: {"threadId":"t1","stopReason":"end_turn"}\n\n';
  const body = new ReadableStream({ start(c) { const enc = new TextEncoder(); for (const part of [frames.slice(0, 30), frames.slice(30, 90), frames.slice(90)]) c.enqueue(enc.encode(part)); c.close(); } });
  const lykia = new Lykia({ fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }) });
  const names = [];
  for await (const m of lykia.agent.chat({ message: "hi" })) names.push(m.event);
  assert.deepEqual(names, ["thread", "task", "done"]);
  assert.deepEqual(parseFrame("event: text\ndata: line one\ndata: line two"), { event: "text", data: "line one\nline two" });
  assert.equal(parseFrame(": only a comment"), null);
  void readSse;
});

test("verifies webhook signatures the server makes", async () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "intent.settled", data: { intentId: "out_abc123" } });
  const t = 1_800_000_000;
  const server = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  assert.equal(await verifyWebhook(secret, body, server, { now: t + 10 }), true);
  assert.equal(await verifyWebhook(secret, `${body} `, server, { now: t }), false);
  assert.equal(await verifyWebhook("whsec_other", body, server, { now: t }), false);
  assert.equal(await verifyWebhook(secret, body, server, { now: t + 301 }), false);
  assert.equal(await verifyWebhook(secret, body, null), false);
  assert.equal(await signWebhook(secret, body, t), server);
});

test("modular subpaths share one transport and emit typed events", async () => {
  const { createTransport } = await import("../dist/transport.js");
  const { intentsApi } = await import("../dist/intents.js");
  const { projectsApi } = await import("../dist/projects.js");
  const seen = [];
  const t = createTransport({ baseUrl: "https://api.test", apiKey: "lk_pk_x", project: "prj_aaaaaaaaaaaa", environment: "testnet", fetch: async (url, init) => {
    seen.push({ url, method: init.method });
    if (url.endsWith("/public")) return json(200, { id: "prj_aaaaaaaaaaaa", assistantName: "Penny" });
    if (url.endsWith("/submit")) return json(200, { step: { id: "s1", status: "settled" }, outrun: {} });
    return json(201, { intent: { id: "out_abc123", steps: [{}], verdict: { decision: "allow" } }, outrun: {}, stored: true });
  } });
  const events = [];
  const off = t.on("plan-created", (e) => events.push(["plan", e.intentId, e.decision]));
  t.on("settled", (e) => events.push(["settled", e.stepId, e.status]));
  t.on("step-signed", (e) => events.push(["signed", e.hashes.length]));
  assert.equal((await projectsApi(t).public()).assistantName, "Penny");
  assert.equal(seen[0].url, "https://api.test/v1/projects/prj_aaaaaaaaaaaa/public");
  await intentsApi(t).create({ owner: "0x1111111111111111111111111111111111111111", text: "send 5 USDC to me" });
  await intentsApi(t).submit("out_abc123", "s1", ["0x" + "a".repeat(64)]);
  off();
  await intentsApi(t).create({ owner: "0x1111111111111111111111111111111111111111", text: "again" });
  assert.deepEqual(events, [["plan", "out_abc123", "allow"], ["signed", 1], ["settled", "s1", "settled"]]);
  const lykia = new Lykia({ fetch: async () => json(200, { projects: [] }) });
  assert.deepEqual(await lykia.projects.list(), { projects: [] });
  assert.equal(typeof lykia.ecosystem.map, "function");
});

test("platform: keys, logs pagination, Lykia-Version and typed operations", async () => {
  const { operations, operationPath, paginate, LYKIA_OPERATIONS } = await import("../dist/index.js");
  const seen = [];
  const lykia = new Lykia({ baseUrl: "https://api.test", apiKey: "lk_test_abcdefabcdef_" + "A".repeat(32), apiVersion: "2026-11-01", fetch: async (url, init) => {
    seen.push({ url, init });
    if (url.includes("/v1/logs")) return json(200, url.includes("cursor=c2") ? { data: [{ requestId: "r3" }], nextCursor: null } : { data: [{ requestId: "r1" }, { requestId: "r2" }], nextCursor: "c2" });
    return json(200, { ok: true });
  } });
  await lykia.platform.keys.rotate("abcdefabcdef", 60);
  assert.equal(seen[0].url, "https://api.test/v1/developers/keys/abcdefabcdef/rotate");
  assert.equal(JSON.parse(seen[0].init.body).overlapSeconds, 60);
  assert.equal(seen[0].init.headers["Lykia-Version"], "2026-11-01");
  const ids = [];
  for await (const entry of lykia.platform.logs.all({ statusClass: "error" })) ids.push(entry.requestId);
  assert.deepEqual(ids, ["r1", "r2", "r3"]);
  assert.match(seen[1].url, /statusClass=error/u);
  assert.equal(operationPath("/v1/intents/{id}/steps/{sid}/prepare", { id: "out_abc123", sid: "s1" }, { x: undefined }), "/v1/intents/out_abc123/steps/s1/prepare");
  assert.ok(LYKIA_OPERATIONS.postIntents && LYKIA_OPERATIONS.postIntents.idempotent);
  await operations(lykia).call("getVenues", { query: { environment: "testnet" } });
  assert.equal(seen.at(-1).url, "https://api.test/v1/venues?environment=testnet");
  let n = 0;
  for await (const x of paginate(async () => ({ data: [n++], nextCursor: null }))) assert.equal(x, 0);
});

test("constructEvent verifies and parses a delivery, accepting rotated secrets", async () => {
  const { constructEvent, WebhookSignatureError } = await import("../dist/index.js");
  const body = JSON.stringify({ id: "evt_1", type: "payout.sent", event: "payout.sent", data: { amount: "5" } });
  const t = 1_800_000_000;
  const good = createHmac("sha256", "whsec_new").update(`${t}.${body}`).digest("hex");
  const old = createHmac("sha256", "whsec_old").update(`${t}.${body}`).digest("hex");
  const event = await constructEvent("whsec_new", body, `t=${t},v1=${old},v1=${good}`, { now: t + 10 });
  assert.equal(event.type, "payout.sent");
  await assert.rejects(constructEvent("whsec_new", `${body} `, `t=${t},v1=${good}`, { now: t }), (e) => e instanceof WebhookSignatureError);
  await assert.rejects(constructEvent("whsec_new", body, `t=${t},v1=${good}`, { now: t + 301 }), WebhookSignatureError);
});
