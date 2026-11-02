import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { FakeArc, serve, testConfig, type Served } from "../../__tests__/support.js";
import { setWebhookResolver } from "../../agents/index.js";
import { emitEvent } from "../events.js";
import { ipAllowed, parseKey, validIpEntry } from "../keys.js";
import { monthKey } from "../billing.js";
import { mountedRoutes } from "../openapi/mounted.js";
import { allDocumentedRoutes, buildOpenApi } from "../openapi/document.js";
import { UNDOCUMENTED_ROUTES } from "../openapi/catalog.js";
import { zodToJsonSchema } from "../openapi/zodSchema.js";
import { verifyWebhookSignature, RETRY_DELAYS_MS } from "../webhooks.js";
import { requirementsFor, TRANSFER_WITH_AUTHORIZATION_TYPES } from "../../x402/x402.js";
import { z } from "zod";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const wallet = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const PAY_TO = "0x2222222222222222222222222222222222222222";

describe("API platform core", () => {
  let ctx: AppContext;
  let served: Served;
  let token = "";
  let now = Date.UTC(2026, 10, 3, 9);
  const hooks: { url: string; headers: Record<string, string>; body: string }[] = [];
  let hookStatus = 200;

  before(async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/settle")) return new Response(JSON.stringify({ success: true, transaction: `0x${"ef".repeat(32)}` }), { status: 200, headers: { "content-type": "application/json" } });
      hooks.push({ url, headers: init?.headers as Record<string, string>, body: String(init?.body ?? "") });
      return new Response("ok", { status: hookStatus });
    };
    ctx = createContext(testConfig({ LYKIA_SESSION_SECRET: "y".repeat(40), LYKIA_X402_PAY_TO: PAY_TO, LYKIA_MODE: "mainnet" }), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: fetchImpl as never, clock: { now: () => now } });
    setWebhookResolver(ctx, async () => [{ address: "93.184.216.34", family: 4 }]);
    served = await serve(createApp(ctx));
    token = await signIn();
    assert.equal((await call("/v1/developers/register", { body: { name: "Ant Labs" }, headers: { "lykia-session": token } })).status, 201);
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(`${served.url}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  const session = () => ({ "lykia-session": token });
  async function signIn(): Promise<string> {
    const nonce = (await (await call("/v1/auth/nonce", { body: { address: wallet.address, chainId: 5042002 } })).json()) as { message: string };
    const signature = await wallet.signMessage({ message: nonce.message });
    return ((await (await call("/v1/auth/verify", { body: { message: nonce.message, signature } })).json()) as { token: string }).token;
  }
  async function newKey(body: Record<string, unknown>): Promise<{ id: string; secret: string; scopes: string[]; mode?: string; prefix: string }> {
    const res = await call("/v1/developers/keys", { body, headers: session() });
    assert.equal(res.status, 201, await res.clone().text());
    return (await res.json()) as { id: string; secret: string; scopes: string[]; prefix: string };
  }

  it("documents every mounted /v1 route in the OpenAPI document", async () => {
    const documented = new Set(allDocumentedRoutes().map((r) => `${r.method.toUpperCase()} ${r.path}`));
    const missing = mountedRoutes(createApp(ctx))
      .filter((r) => r.includes(" /v1/"))
      .filter((r) => !documented.has(r) && !UNDOCUMENTED_ROUTES.includes(r));
    assert.deepEqual(missing, [], `undocumented routes: ${missing.join(", ")}`);
    const spec = (await (await call("/v1/openapi.json")).json()) as { openapi: string; paths: Record<string, Record<string, { operationId: string }>>; components: Record<string, unknown> };
    assert.equal(spec.openapi, "3.1.0");
    const ids = Object.values(spec.paths).flatMap((ops) => Object.values(ops).map((o) => o.operationId));
    assert.equal(new Set(ids).size, ids.length, "operationIds are unique");
    assert.ok(spec.paths["/v1/intents/{id}/steps/{sid}/prepare"]?.post);
    assert.ok(spec.paths["/v1/x402/quote"]?.post);
    // Every $ref resolves.
    const json = JSON.stringify(spec);
    for (const ref of new Set([...json.matchAll(/"\$ref":"#\/components\/([^/]+)\/([^"]+)"/gu)].map((m) => `${m[1]}/${m[2]}`))) {
      const [group, name] = ref.split("/") as [string, string];
      assert.ok((spec.components[group] as Record<string, unknown>)?.[name], `missing component ${ref}`);
    }
    const html = await (await call("/v1/reference")).text();
    assert.match(html, /Lykia API/u);
    assert.ok(buildOpenApi(ctx, "https://api.example") !== null);
  });

  it("converts zod schemas to JSON Schema", () => {
    const schema = zodToJsonSchema(z.object({ a: z.string().min(2).regex(/^x/u), b: z.number().int().max(5).optional(), c: z.enum(["x", "y"]).nullable(), d: z.array(z.literal(1)).max(3) }).strict());
    assert.deepEqual(schema, {
      type: "object",
      properties: { a: { type: "string", minLength: 2, pattern: "^x" }, b: { type: "integer", maximum: 5 }, c: { anyOf: [{ type: "string", enum: ["x", "y"] }, { type: "null" }] }, d: { type: "array", items: { const: 1 }, maxItems: 3 } },
      required: ["a", "c", "d"],
      additionalProperties: false,
    });
  });

  it("issues live and test keys with fine-grained scopes; test keys never reach mainnet", async () => {
    const live = await newKey({ label: "live", mode: "live" });
    const test = await newKey({ label: "sandbox", mode: "test" });
    assert.match(live.secret, /^lk_live_[a-z0-9]{12}_/u);
    assert.match(test.secret, /^lk_test_[a-z0-9]{12}_/u);
    assert.deepEqual(parseKey(test.secret), { id: test.id, kind: "secret", mode: "test" });
    assert.ok(live.scopes.includes("build") && !live.scopes.includes("admin"));
    const legacy = await newKey({ label: "legacy" });
    assert.match(legacy.secret, /^lk_sk_/u, "no mode keeps the legacy format");
    assert.equal((await call("/v1/developers/keys", { body: { label: "x", scopes: ["payouts"] }, headers: session() })).status, 400, "fine scopes need a mode");

    const testHeaders = { "lykia-key": test.secret };
    const denied = await call("/v1/venues?environment=mainnet", { headers: testHeaders });
    assert.equal(denied.status, 403);
    assert.equal(((await denied.json()) as { error: { code: string } }).error.code, "LIVE_MODE_REQUIRED");
    assert.equal((await call("/v1/quote", { body: { kind: "swap", environment: "mainnet", from: "USDC", to: "EURC", amount: "1" }, headers: testHeaders })).status, 403);
    assert.equal((await call("/v1/venues?environment=testnet", { headers: testHeaders })).status, 200);
    // Without an environment a test key is served testnet even on a mainnet server.
    const fence = (await (await call("/v1/fence/default", { headers: testHeaders })).json()) as unknown;
    assert.ok(fence);
    // The aggregator too: a quote that names no environment is a testnet quote, never mainnet.
    const quoted = await call("/v1/aggregator/quote", { body: { kind: "transfer", token: "USDC", amount: "1", taker: wallet.address, to: wallet.address }, headers: testHeaders });
    const quoteBody = (await quoted.json()) as { environment?: string; error?: { code: string } };
    assert.notEqual(quoteBody.environment, "mainnet", JSON.stringify(quoteBody).slice(0, 300));

    // Fine scopes: a read-only live key cannot quote; admin is needed to list keys with a key.
    const reader = await newKey({ label: "reader", mode: "live", scopes: ["read"] });
    const refused = await call("/v1/fence/validate", { body: { fence: {} }, headers: { "lykia-key": reader.secret } });
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { error: { details: { required: string } } }).error.details.required, "quote");
    assert.equal((await call("/v1/developers/keys", { headers: { "lykia-key": live.secret } })).status, 403);
    const admin = await newKey({ label: "cli", mode: "live", scopes: ["read", "admin"] });
    const listed = (await (await call("/v1/developers/keys", { headers: { "lykia-key": admin.secret } })).json()) as { keys: { id: string }[] };
    assert.ok(listed.keys.some((k) => k.id === live.id));
    assert.equal((await call("/v1/developers/keys", { headers: { "lykia-key": legacy.secret } })).status, 403, "legacy keys stay session-only for account routes");
  });

  it("rotates with an overlap window, enforces IP allowlists and sends rate-limit headers", async () => {
    const key = await newKey({ label: "rotating", mode: "live", perMinute: 50 });
    const rotated = (await (await call(`/v1/developers/keys/${key.id}/rotate`, { body: { overlapSeconds: 60 }, headers: session() })).json()) as { secret: string; previousSecretExpiresAt: string };
    assert.notEqual(rotated.secret, key.secret);
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": key.secret } })).status, 200, "old secret works during the overlap");
    const fresh = await call("/v1/networks", { headers: { "lykia-key": rotated.secret } });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.get("x-ratelimit-limit"), "50");
    assert.ok(Number(fresh.headers.get("x-ratelimit-remaining")) < 50);
    assert.ok(fresh.headers.get("x-request-id"));
    assert.match(fresh.headers.get("ratelimit-policy") ?? "", /"key";q=50;w=60/u);
    now += 61_000;
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": key.secret } })).status, 401, "old secret expires after the overlap");

    assert.ok(validIpEntry("10.0.0.0/8") && validIpEntry("2001:db8::/32") && !validIpEntry("10.0.0.0/33") && !validIpEntry("nope"));
    assert.ok(ipAllowed(["10.0.0.0/8"], "10.2.3.4") && !ipAllowed(["10.0.0.0/8"], "11.0.0.1") && ipAllowed(["127.0.0.1"], "::ffff:127.0.0.1"));
    const patched = await call(`/v1/developers/keys/${key.id}`, { method: "PATCH", body: { allowedIps: ["203.0.113.0/24"] }, headers: session() });
    assert.equal(patched.status, 200);
    const blocked = await call("/v1/networks", { headers: { "lykia-key": rotated.secret } });
    assert.equal(blocked.status, 403);
    assert.equal(((await blocked.json()) as { error: { code: string } }).error.code, "IP_NOT_ALLOWED");
    await call(`/v1/developers/keys/${key.id}`, { method: "PATCH", body: { allowedIps: ["127.0.0.1", "::1"] }, headers: session() });
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": rotated.secret } })).status, 200);
  });

  it("pins versions, refuses unknown ones and echoes Lykia-Version", async () => {
    const bad = await call("/v1/networks", { headers: { "lykia-version": "1999-01-01" } });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "INVALID_API_VERSION");
    assert.equal((await call("/v1/networks")).headers.get("lykia-version"), "2026-11-01");
    const pinned = await newKey({ label: "pinned", mode: "live", apiVersion: "2026-06-01" });
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": pinned.secret } })).headers.get("lykia-version"), "2026-06-01");
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": pinned.secret, "lykia-version": "2026-11-01" } })).headers.get("lykia-version"), "2026-11-01");
    const versions = (await (await call("/v1/versions")).json()) as { latest: string };
    assert.equal(versions.latest, "2026-11-01");
  });

  it("replays POSTs by Idempotency-Key and refuses a different body", async () => {
    const headers = { ...session(), "idempotency-key": "create-key-0001" };
    const a = await call("/v1/developers/keys", { body: { label: "idem", mode: "test" }, headers });
    const b = await call("/v1/developers/keys", { body: { label: "idem", mode: "test" }, headers });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers.get("idempotent-replayed"), "true");
    assert.equal(((await a.json()) as { id: string }).id, ((await b.json()) as { id: string }).id);
    const c = await call("/v1/developers/keys", { body: { label: "other", mode: "test" }, headers });
    assert.equal(c.status, 409);
    assert.equal(((await c.json()) as { error: { code: string } }).error.code, "IDEMPOTENCY_CONFLICT");
  });

  it("logs keyed requests and answers them by request id with filters", async () => {
    const key = await newKey({ label: "logged", mode: "test", scopes: ["read", "quote"] });
    const ok = await call("/v1/networks", { headers: { "lykia-key": key.secret, "x-request-id": "req-log-000001" } });
    assert.equal(ok.headers.get("x-request-id"), "req-log-000001");
    await call("/v1/fence/validate", { body: { fence: { nope: true } }, headers: { "lykia-key": key.secret } });
    await call("/v1/intents", { body: { owner: wallet.address, text: "send 1 usdc" }, headers: { "lykia-key": key.secret } });
    await new Promise((r) => setTimeout(r, 30));
    const page = (await (await call(`/v1/logs?keyId=${key.id}`, { headers: session() })).json()) as { data: { requestId: string; status: number; route: string | null; errorCode: string | null; mode: string }[] };
    assert.ok(page.data.length >= 3);
    const intents = page.data.find((e) => e.route === null && e.status === 403);
    assert.equal(intents?.errorCode, "FORBIDDEN", "the intents call lacked the build scope");
    const one = (await (await call("/v1/logs/req-log-000001", { headers: session() })).json()) as { route: string; status: number; mode: string };
    assert.equal(one.route, "/v1/networks");
    assert.equal(one.status, 200);
    assert.equal(one.mode, "test");
    const errors = (await (await call(`/v1/logs?keyId=${key.id}&statusClass=error`, { headers: session() })).json()) as { data: { status: number }[] };
    assert.ok(errors.data.every((e) => e.status >= 400));
    const usage = (await (await call("/v1/billing/usage?days=2", { headers: session() })).json()) as { endpoints: { endpoint: string; requests: number }[]; days: { requests: number }[] };
    assert.ok(usage.endpoints.some((e) => e.endpoint === "GET /v1/networks" && e.requests >= 1));
  });

  it("delivers catalogue events signed, logs attempts, replays, sends test events and feeds /v1/events", async () => {
    const created = (await (await call("/v1/developers/webhooks", { body: { url: "https://hooks.ant.dev/lykia", events: ["payout.sent", "step.settled"] }, headers: session() })).json()) as { id: string; secret: string };
    hooks.length = 0;
    const result = await emitEvent("payout.sent", { payoutId: "po_1", amount: "25" }, { owner: wallet.address, ctx });
    assert.equal(result.delivered, 1);
    const hit = hooks.at(-1)!;
    assert.ok(verifyWebhookSignature(created.secret, hit.body, hit.headers["Lykia-Signature"] as string, Math.floor(now / 1000)));
    const body = JSON.parse(hit.body) as { type: string; event: string; owner: string; livemode: boolean; apiVersion: string };
    assert.equal(body.type, "payout.sent");
    assert.equal(body.owner, wallet.address.toLowerCase());
    assert.equal(hit.headers["Lykia-Event-Id"], (body as unknown as { id: string }).id);
    // The legacy alias reaches catalogue subscribers.
    await emitEvent("intent.step.settled", { intentId: "out_x" }, { owner: wallet.address, ctx });
    assert.equal((JSON.parse(hooks.at(-1)!.body) as { type: string }).type, "step.settled");
    assert.equal((await emitEvent("not.a.thing", {}, { owner: wallet.address, ctx })).delivered, 0);

    hookStatus = 503;
    await emitEvent("payout.sent", { payoutId: "po_2" }, { owner: wallet.address, ctx });
    const list = (await (await call(`/v1/developers/webhooks/deliveries?endpointId=${created.id}&status=pending`, { headers: session() })).json()) as { deliveries: { id: string; attempts: number }[] };
    const pending = list.deliveries[0]!;
    assert.equal(pending.attempts, 1);
    const detail = (await (await call(`/v1/developers/webhooks/deliveries/${pending.id}`, { headers: session() })).json()) as { attemptLog: { statusCode: number; error: string }[]; payload: { data: { payoutId: string } } };
    assert.equal(detail.attemptLog[0]?.statusCode, 503);
    assert.equal(detail.payload.data.payoutId, "po_2");
    hookStatus = 200;
    now += RETRY_DELAYS_MS[0];
    const replay = (await (await call(`/v1/developers/webhooks/deliveries/${pending.id}/replay`, { body: {}, headers: session() })).json()) as { status: string; replayOf: string };
    assert.equal(replay.status, "delivered");
    assert.equal(replay.replayOf, pending.id);
    const test = (await (await call("/v1/developers/webhooks/test", { body: { endpointId: created.id, type: "invoice.paid" }, headers: session() })).json()) as { sent: number; deliveries: { status: string }[] };
    assert.equal(test.sent, 1);
    assert.equal(test.deliveries[0]?.status, "delivered");
    assert.equal((JSON.parse(hooks.at(-1)!.body) as { data: { test: boolean } }).data.test, true);
    const feed = (await (await call("/v1/events?type=payout.sent", { headers: session() })).json()) as { data: { id: string; type: string }[] };
    assert.ok(feed.data.length >= 2 && feed.data.every((e) => e.type === "payout.sent"));
    const catalogue = (await (await call("/v1/webhooks/events")).json()) as { events: { type: string; aliases: string[] }[] };
    assert.ok(catalogue.events.find((e) => e.type === "agent.whistle")?.aliases.includes("whistle.blown"));
  });

  it("applies plans: free stops at the quota, pay as you go takes credits or x402", async () => {
    const plan = (await (await call("/v1/billing/plan", { headers: session() })).json()) as { plan: { id: string; includedRequests: number } };
    assert.equal(plan.plan.id, "free");
    const key = await newKey({ label: "billing", mode: "live", scopes: ["read"] });
    const owner = wallet.address.toLowerCase();
    await ctx.store.counters("bill_month").increment(`${owner}:${monthKey(now)}`, plan.plan.includedRequests);
    const quota = await call("/v1/networks", { headers: { "lykia-key": key.secret } });
    assert.equal(quota.status, 429);
    assert.equal(((await quota.json()) as { error: { code: string } }).error.code, "QUOTA_EXCEEDED");
    const sandbox = await newKey({ label: "billing-test", mode: "test", scopes: ["read"] });
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": sandbox.secret } })).status, 200, "test keys are never billed");

    assert.equal((await call("/v1/billing/plan", { method: "PUT", body: { plan: "enterprise" }, headers: session() })).status, 403);
    assert.equal((await call("/v1/billing/plan", { method: "PUT", body: { plan: "payg" }, headers: session() })).status, 200);
    const pay = await call("/v1/networks", { headers: { "lykia-key": key.secret } });
    assert.equal(pay.status, 402);
    const required = (await pay.json()) as { error: { code: string; details: { accepts: { amount: string; payTo: string }[] } } };
    assert.equal(required.error.code, "PAYMENT_REQUIRED");
    assert.equal(required.error.details.accepts[0]?.payTo.toLowerCase(), PAY_TO);

    // Pay one call over x402.
    const price = required.error.details.accepts[0]!.amount;
    const payer = privateKeyToAccount(generatePrivateKey());
    const reqs = requirementsFor("mainnet", PAY_TO, price, "/v1/networks", "x");
    const authorization = { from: payer.address, to: PAY_TO as `0x${string}`, value: price, validAfter: "0", validBefore: String(Math.floor(now / 1000) + 60), nonce: `0x${"cd".repeat(32)}` as `0x${string}` };
    const signature = await payer.signTypedData({ domain: { name: "USDC", version: "2", chainId: 5042, verifyingContract: reqs.asset }, types: TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization", message: { ...authorization, value: BigInt(price), validAfter: 0n, validBefore: BigInt(authorization.validBefore) } });
    const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted: { scheme: "exact", network: "eip155:5042" }, payload: { signature, authorization } })).toString("base64");
    const paidCall = await call("/v1/networks", { headers: { "lykia-key": key.secret, "x-payment": header } });
    assert.equal(paidCall.status, 200, await paidCall.clone().text());
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": key.secret, "x-payment": header } })).status, 402, "an authorization pays once");

    // Prepaid credits cover overage.
    await ctx.store.counters("billing_credits").increment(`bought:${owner}`, 1_000_000);
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": key.secret } })).status, 200);
    const usage = (await (await call("/v1/billing/usage", { headers: session() })).json()) as { overageRequests: number; creditsUnits: string };
    assert.ok(usage.overageRequests >= 2);
    assert.ok(Number(usage.creditsUnits) < 1_000_000);
    const credits = await call("/v1/billing/credits", { body: { amountUsdc: "5" }, headers: session() });
    assert.equal(credits.status, 402, "credits are bought over x402");
    await call("/v1/billing/plan", { method: "PUT", body: { plan: "free" }, headers: session() });
    await ctx.store.counters("bill_month").reset(`${owner}:${monthKey(now)}`);
  });
});
