/**
 * Paid x402 routes, end to end over HTTP: every unpaid request gets the 402
 * offer before any validation, a valid payment with an invalid request is
 * refused without settling, the answer leaves only after settlement, the
 * payment is on the network the work runs on, and the offers, the discovery
 * document and the OpenAPI document agree.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../app.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { errorHandler } from "../http/request.js";
import { monthKey, setPlan } from "../platform/billing.js";
import { createKey } from "../platform/keys.js";
import { paidService } from "../x402/manifest.js";
import { paidRoute, requirementsFor, TRANSFER_WITH_AUTHORIZATION_TYPES } from "../x402/x402.js";
import type { PulseFeed } from "../arc/pulse.js";
import { FakeArc, serve, testConfig, type Served } from "./support.js";

const PAY_TO = "0x2222222222222222222222222222222222222222" as const;
const FACILITATOR = "https://facilitator.example";
const USDC_TOKEN = "0x3600000000000000000000000000000000000000";
const OWNER = "0x1111111111111111111111111111111111111111";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

interface Offer {
  x402Version: number;
  error: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: { scheme: string; network: string; amount: string; payTo: string; resource: string; description: string }[];
  extensions?: { bazaar?: { info: { input: Record<string, unknown> }; schema: { properties: { input: { properties: Record<string, unknown> } } }; routeTemplate?: string } };
}

/** A facilitator that settles (or refuses) and counts the calls, with the amount and network of each. */
function facilitator() {
  const state = { settles: 0, succeed: true, settled: [] as { amount: string; network: string }[] };
  const fetch = async (input: string, init?: RequestInit) => {
    if (input === `${FACILITATOR}/settle`) {
      state.settles += 1;
      const body = JSON.parse(String(init?.body)) as { paymentRequirements: { resource: string; amount: string; network: string } };
      state.settled.push({ amount: body.paymentRequirements.amount, network: body.paymentRequirements.network });
      assert.match(body.paymentRequirements.resource, /^http/u, "settlement carries the absolute resource");
      return new Response(JSON.stringify(state.succeed ? { success: true, transaction: `0x${"ab".repeat(32)}` } : { success: false, errorReason: "insufficient_funds" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new TypeError(`fetch failed: ${input}`);
  };
  return { state, fetch };
}

/** A signed EIP-3009 authorization for `amount` USDC units on an Arc network (testnet unless named), as an x402 v2 payment header. */
async function payment(amount: string, nonceByte = "cd", environment: "mainnet" | "testnet" = "testnet") {
  const payer = privateKeyToAccount(generatePrivateKey());
  const offer = requirementsFor(environment, PAY_TO, amount, "https://x", "x");
  const chainId = Number(offer.network.split(":")[1]);
  const authorization = { from: payer.address, to: PAY_TO, value: amount, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 120), nonce: `0x${nonceByte.repeat(32)}` as `0x${string}` };
  const signature = await payer.signTypedData({ domain: { name: "USDC", version: "2", chainId, verifyingContract: offer.asset }, types: TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization", message: { ...authorization, value: BigInt(amount), validAfter: 0n, validBefore: BigInt(authorization.validBefore) } });
  return Buffer.from(JSON.stringify({ x402Version: 2, accepted: { scheme: "exact", network: offer.network }, payload: { signature, authorization } })).toString("base64");
}

function decodeHeader(value: string | null): unknown {
  assert.ok(value, "PAYMENT-REQUIRED is set");
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

/** Every property of a JSON Schema object (nested objects, array items, variants) has a description. */
function undescribed(schema: Record<string, unknown>, path = "body"): string[] {
  const missing: string[] = [];
  for (const variant of [...((schema.anyOf as Record<string, unknown>[] | undefined) ?? []), ...((schema.oneOf as Record<string, unknown>[] | undefined) ?? [])]) missing.push(...undescribed(variant, path));
  for (const [name, property] of Object.entries((schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {})) {
    if (typeof property.description !== "string" || property.description.length === 0) missing.push(`${path}.${name}`);
    missing.push(...undescribed(property, `${path}.${name}`));
  }
  if (schema.items && typeof schema.items === "object") missing.push(...undescribed(schema.items as Record<string, unknown>, `${path}[]`));
  return missing;
}

describe("x402 paid routes", () => {
  let ctx: AppContext;
  let served: Served;
  const settle = facilitator();

  before(async () => {
    ctx = createContext(testConfig({ LYKIA_X402_PAY_TO: PAY_TO, LYKIA_X402_FACILITATOR_URL: FACILITATOR, LYKIA_CONTACT_EMAIL: "team@example.com" }), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: settle.fetch });
    served = await serve(createApp(ctx));
  });

  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  beforeEach(() => {
    settle.state.settles = 0;
    settle.state.succeed = true;
    settle.state.settled = [];
  });

  const post = (path: string, body: string | undefined, headers: Record<string, string> = {}) => fetch(`${served.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body }) });
  const validFacts = JSON.stringify({ facts: { environment: "testnet", owner: OWNER, signer: "wallet", steps: [] } });
  const oversized = JSON.stringify({ facts: { environment: "testnet", owner: OWNER, signer: "wallet", steps: [] }, pad: "x".repeat(300 * 1024) });
  const latin1 = (path: string, headers: Record<string, string> = {}) => fetch(`${served.url}${path}`, { method: "POST", headers: { "content-type": "application/json; charset=latin1", ...headers }, body: validFacts });

  it("answers every unpaid request with the 402 offer before looking at the body", async () => {
    const unpaid = [
      await post("/v1/x402/fence/evaluate", "{}"),
      await post("/v1/x402/fence/evaluate", JSON.stringify({ facts: {} })),
      await post("/v1/x402/fence/evaluate", undefined),
      await post("/v1/x402/fence/evaluate", "{not json"),
      await fetch(`${served.url}/v1/x402/fence/evaluate`, { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" }),
      await latin1("/v1/x402/fence/evaluate"),
      await post("/v1/x402/fence/evaluate", oversized),
      // Express routes paths case-insensitively and with a trailing slash: so do the paid-route checks.
      await post("/v1/X402/fence/evaluate", "{not json"),
      await fetch(`${served.url}/v1/X402/Fence/Evaluate/`, { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" }),
      await post("/v1/x402/quote", "{}"),
      await post("/v1/x402/quote", JSON.stringify({ kind: "deposit", amount: "1" })),
      await fetch(`${served.url}/v1/x402/scent/not-an-address`),
    ];
    for (const response of unpaid) {
      assert.equal(response.status, 402, `${response.url} answered ${response.status}`);
      const body = (await response.json()) as Offer;
      assert.equal(body.x402Version, 2);
      assert.equal(body.accepts[0]?.network, "eip155:5042002");
      assert.deepEqual(decodeHeader(response.headers.get("payment-required")), body);
    }
    assert.equal(settle.state.settles, 0);
  });

  it("puts the absolute resource URL from discovery in every offer", async () => {
    const manifest = (await (await fetch(`${served.url}/.well-known/x402`)).json()) as { services: { id: string; resource: string }[]; items: { resource: string; accepts: { amount: string; payTo: string; network: string }[] }[] };
    const listed = Object.fromEntries(manifest.services.map((s) => [s.id, s.resource]));
    assert.deepEqual(manifest.items.map((i) => i.resource), manifest.services.map((s) => s.resource), "items[] and services[] list the same resources");
    const fence = (await (await post("/v1/x402/fence/evaluate", "{}")).json()) as Offer;
    assert.equal(fence.resource.url, listed["fence-check"]);
    assert.equal(fence.accepts[0]?.resource, listed["fence-check"]);
    assert.equal(fence.resource.url, `${served.url}/v1/x402/fence/evaluate`);
    const quote = (await (await post("/v1/x402/quote", "{}")).json()) as Offer;
    assert.equal(quote.resource.url, listed["route-quote"]);
    // The discovery offer is the live one.
    const listedQuote = manifest.items.find((i) => i.resource === listed["route-quote"])?.accepts[0];
    assert.deepEqual([listedQuote?.amount, listedQuote?.payTo, listedQuote?.network], [quote.accepts[0]?.amount, quote.accepts[0]?.payTo, quote.accepts[0]?.network]);
    // A templated resource: the listed URL itself answers with the listed URL; a real token with its own URL.
    const probe = (await (await fetch(`${served.url}/v1/x402/scent/%7Btoken%7D`)).json()) as Offer;
    assert.equal(probe.resource.url, listed["scent-report"]);
    assert.equal(probe.resource.url, `${served.url}/v1/x402/scent/{token}`);
    const scent = (await (await fetch(`${served.url}/v1/x402/scent/${USDC_TOKEN}?environment=testnet`)).json()) as Offer;
    assert.equal(scent.resource.url, `${served.url}/v1/x402/scent/${USDC_TOKEN}`);
    assert.equal(scent.extensions?.bazaar?.routeTemplate, "/v1/x402/scent/:token");
    assert.deepEqual(scent.extensions?.bazaar?.info.input.pathParams, { token: USDC_TOKEN });
  });

  it("carries the request schema in the 402 (bazaar), the same one discovery lists", async () => {
    const offer = (await (await post("/v1/x402/quote", "{}")).json()) as Offer;
    const body = offer.extensions?.bazaar?.schema.properties.input.properties.body as { anyOf: { properties: { kind: { const: string } }; required: string[] }[] };
    assert.deepEqual(body.anyOf.map((v) => v.properties.kind.const), ["swap", "earn", "borrow"]);
    assert.deepEqual(offer.extensions?.bazaar?.info.input, { type: "http", method: "POST", bodyType: "json", body: { kind: "swap", environment: "mainnet", from: "USDC", to: "EURC", amount: "100" } });
  });

  it("with a valid payment, refuses an invalid request with 400 and settles nothing; the authorization stays usable", async () => {
    const header = await payment("10000", "a1");
    const invalid = await post("/v1/x402/fence/evaluate", JSON.stringify({ facts: {} }), { "x-payment": header });
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as { error: { code: string } }).error.code, "INVALID_REQUEST");
    const malformed = await post("/v1/x402/fence/evaluate", "{not json", { "x-payment": header });
    assert.equal(malformed.status, 400);
    assert.equal(((await malformed.json()) as { error: { code: string } }).error.code, "INVALID_JSON");
    const tooLarge = await post("/v1/x402/fence/evaluate", oversized, { "x-payment": header });
    assert.equal(tooLarge.status, 413);
    assert.equal(((await tooLarge.json()) as { error: { code: string } }).error.code, "PAYLOAD_TOO_LARGE");
    const charset = await latin1("/v1/x402/fence/evaluate", { "x-payment": header });
    assert.equal(charset.status, 415);
    assert.equal(((await charset.json()) as { error: { code: string } }).error.code, "UNSUPPORTED_MEDIA_TYPE");
    assert.equal(settle.state.settles, 0, "nothing settles for a bad request");

    const paid = await post("/v1/x402/fence/evaluate", validFacts, { "payment-signature": header });
    assert.equal(paid.status, 200, await paid.clone().text());
    assert.equal(((await paid.json()) as { schema: string }).schema, "lykia.verdict/v1");
    assert.equal(settle.state.settles, 1);
    const receipt = decodeHeader(paid.headers.get("payment-response")) as { success: boolean; mode: string; network: string; transaction: string };
    assert.deepEqual([receipt.success, receipt.mode, receipt.network], [true, "settled", "eip155:5042002"]);

    const replay = await post("/v1/x402/fence/evaluate", validFacts, { "x-payment": header });
    assert.equal(replay.status, 402);
    assert.match(((await replay.json()) as Offer).error, /already used/u);
    assert.equal(settle.state.settles, 1, "a replay never settles again");
  });

  it("never sends the answer when settlement fails", async () => {
    settle.state.succeed = false;
    const response = await post("/v1/x402/fence/evaluate", validFacts, { "x-payment": await payment("10000", "b2") });
    assert.equal(response.status, 402);
    const body = (await response.json()) as Offer & { decision?: string };
    assert.match(body.error, /Settlement failed: insufficient_funds/u);
    assert.equal(body.decision, undefined, "no verdict leaves without a settled payment");
    assert.equal(response.headers.get("payment-response"), null);
  });

  it("refuses a payment that is too small or malformed with the 402 offer", async () => {
    assert.equal((await post("/v1/x402/fence/evaluate", validFacts, { "x-payment": await payment("9999", "c3") })).status, 402);
    const odd = Buffer.from(JSON.stringify({ x402Version: 2, payload: { signature: "0x00", authorization: { from: OWNER, to: PAY_TO, value: {}, validAfter: "0", validBefore: "1", nonce: "0x00" } } })).toString("base64");
    assert.equal((await post("/v1/x402/fence/evaluate", validFacts, { "x-payment": odd })).status, 402);
    assert.equal(settle.state.settles, 0);
  });

  it("ignores Idempotency-Key on paid routes, so a stored 402 never shadows the paid call", async () => {
    for (const [path, nonce] of [["/v1/x402/fence/evaluate", "d4"], ["/v1/X402/fence/evaluate", "d5"]] as const) {
      const key = { "idempotency-key": `paid-route-key-${nonce}` };
      assert.equal((await post(path, validFacts, key)).status, 402);
      const paid = await post(path, validFacts, { ...key, "x-payment": await payment("10000", nonce) });
      assert.equal(paid.status, 200, path);
      assert.equal(paid.headers.get("idempotent-replayed"), null);
      const replay = await post(path, validFacts, key);
      assert.equal(replay.status, 402, `${path}: the paid answer is not replayed for free`);
      assert.equal(replay.headers.get("idempotent-replayed"), null);
    }
    assert.equal(settle.state.settles, 2);
  });

  it("never charges a HEAD request: it gets the offer, whatever payment it carries", async () => {
    const head = await fetch(`${served.url}/v1/x402/scent/${USDC_TOKEN}?environment=testnet`, { method: "HEAD", headers: { "x-payment": await payment("10000", "f6") } });
    assert.equal(head.status, 402);
    assert.ok(head.headers.get("payment-required"), "the offer is in PAYMENT-REQUIRED");
    assert.equal(head.headers.get("payment-response"), null);
    assert.equal(settle.state.settles, 0);
  });

  it("offers and takes the payment on the network the request runs on", async () => {
    const offerOf = async (response: Response) => ((await response.json()) as Offer).accepts[0]?.network;
    const mainnetFacts = JSON.stringify({ facts: { environment: "mainnet", owner: OWNER, signer: "wallet", steps: [] } });
    // The Fence check runs on facts.environment; a query parameter names nothing on a POST.
    assert.equal(await offerOf(await post("/v1/x402/fence/evaluate", mainnetFacts)), "eip155:5042");
    assert.equal(await offerOf(await post("/v1/x402/fence/evaluate?environment=testnet", mainnetFacts)), "eip155:5042");
    assert.equal(await offerOf(await post("/v1/x402/fence/evaluate?environment=mainnet", validFacts)), "eip155:5042002");
    // A quote runs on the body's environment, else the server's network.
    const mainnetQuote = JSON.stringify({ kind: "swap", environment: "mainnet", from: "USDC", to: "EURC", amount: "1" });
    assert.equal(await offerOf(await post("/v1/x402/quote?environment=testnet", mainnetQuote)), "eip155:5042");
    assert.equal(await offerOf(await post("/v1/x402/quote?environment=mainnet", JSON.stringify({ kind: "swap", from: "USDC", to: "EURC", amount: "1" }))), "eip155:5042002");
    // Scent runs on its query parameter.
    assert.equal(await offerOf(await fetch(`${served.url}/v1/x402/scent/${USDC_TOKEN}?environment=mainnet`)), "eip155:5042");
    // Testnet USDC never buys a mainnet check.
    const refused = await post("/v1/x402/fence/evaluate?environment=testnet", mainnetFacts, { "x-payment": await payment("10000", "f7") });
    assert.equal(refused.status, 402);
    assert.match(((await refused.json()) as Offer).error, /eip155:5042\b/u);
    assert.equal(settle.state.settles, 0);
  });

  it("leaves a keyed call to the route's own payment: no overage on top, no X-PAYMENT spent by billing", async () => {
    const created = await createKey(ctx, { owner: OWNER, label: "paid routes", kind: "secret", mode: "live", scopes: ["quote"] });
    await setPlan(ctx, OWNER, "payg");
    const month = ctx.store.counters("bill_month");
    const counted = `${OWNER}:${monthKey(ctx.clock.now())}`;
    await month.increment(counted, 1_000_000, { ttlMs: 86_400_000 });
    const before = await month.get(counted);
    const keyed = { "lykia-key": created.secret };

    const unpaid = await post("/v1/x402/fence/evaluate", "{}", keyed);
    assert.equal(unpaid.status, 402);
    const offer = (await unpaid.json()) as Offer & { error: unknown };
    assert.equal(typeof offer.error, "string", "the route's own offer, not a billing error envelope");
    assert.deepEqual([offer.accepts[0]?.amount, offer.accepts[0]?.description], ["10000", paidService("fence-check").description]);

    const header = await payment("10000", "f8");
    const invalid = await post("/v1/x402/fence/evaluate", JSON.stringify({ facts: {} }), { ...keyed, "x-payment": header });
    assert.equal(invalid.status, 400);
    assert.equal(settle.state.settles, 0, "an invalid keyed request settles nothing");

    const paid = await post("/v1/x402/fence/evaluate", validFacts, { ...keyed, "x-payment": header });
    assert.equal(paid.status, 200, await paid.clone().text());
    assert.deepEqual(settle.state.settled, [{ amount: "10000", network: "eip155:5042002" }], "one settlement, at the route's price");
    assert.equal(await month.get(counted), before, "a paid route is not counted against the monthly plan");
    assert.equal(paid.headers.get("x-monthly-quota-used"), String(before));
  });

  it("describes the paid routes for agents: discovery input matches the API, links load, x-payment-info on each paid operation", async () => {
    const manifest = (await (await fetch(`${served.url}/.well-known/x402`)).json()) as { services: { id: string; description: string; metadata: { description: string; input: { anyOf: { properties: { kind: { const: string } }; required: string[] }[] }; provider: { docsUrl: string; website: string } } }[] };
    const quote = manifest.services.find((s) => s.id === "route-quote")!;
    assert.deepEqual(quote.metadata.input.anyOf.map((v) => [v.properties.kind.const, [...v.required].sort()]), [
      ["swap", ["amount", "from", "kind", "to"]],
      ["earn", ["kind", "token"]],
      ["borrow", ["account", "amount", "kind", "token"]],
    ]);
    assert.doesNotMatch(JSON.stringify(manifest), /deposit or borrow|"deposit"/u);
    assert.match(quote.description, /swap, earn or borrow/u);
    for (const s of manifest.services) {
      assert.equal(s.metadata.provider.docsUrl, `${served.url}/v1/reference`);
      assert.doesNotMatch(s.metadata.provider.website, /\/build/u);
    }
    assert.equal((await fetch(manifest.services[0]!.metadata.provider.docsUrl)).status, 200, "docsUrl loads");

    const spec = (await (await fetch(`${served.url}/openapi.json`)).json()) as { openapi: string; info: { "x-guidance": string; contact: { email?: string } }; externalDocs: { url: string }; paths: Record<string, Record<string, { "x-payment-info"?: { price: { currency: string; amount: string }; protocols: Record<string, unknown>[] }; requestBody?: { content: { "application/json": { schema: Record<string, unknown> } } }; responses: Record<string, { content: { "application/json": { schema: unknown } } }>; parameters: { name: string; in: string; description?: string; $ref?: string }[]; "x-lykia-idempotent"?: boolean }>> };
    assert.equal(spec.openapi, "3.1.0");
    assert.deepEqual(spec, await (await fetch(`${served.url}/v1/openapi.json`)).json(), "the root copy is the same document");
    assert.ok(spec.info["x-guidance"].length > 200 && spec.info["x-guidance"].length < 4000, "guidance is present and concise");
    assert.equal(spec.info.contact.email, "team@example.com");
    assert.equal(spec.externalDocs.url, `${served.url}/v1/reference`);
    const paidOps = [spec.paths["/v1/x402/fence/evaluate"]?.post, spec.paths["/v1/x402/quote"]?.post, spec.paths["/v1/x402/scent/{token}"]?.get];
    for (const op of paidOps) {
      assert.ok(op?.["x-payment-info"], "x-payment-info on each paid operation");
      assert.deepEqual(op["x-payment-info"].price, { mode: "fixed", currency: "USDC", amount: "0.01" });
      assert.ok(op["x-payment-info"].protocols[0]?.x402);
      assert.equal(op["x-lykia-idempotent"], undefined);
      const body = op.requestBody?.content["application/json"].schema;
      if (body) assert.deepEqual(undescribed(body), [], "every request field is described");
      for (const p of op.parameters.filter((p) => !p.$ref)) assert.ok(p.description, `parameter ${p.name} is described`);
      assert.deepEqual(op.parameters.filter((p) => p.in === "header" && !p.$ref).map((p) => p.name), ["PAYMENT-SIGNATURE", "X-PAYMENT"], "both x402 payment headers");
    }
    // The answer schema of each paid operation is the one discovery lists.
    const answers = paidOps.map((op) => op?.responses["200"]?.content["application/json"].schema);
    assert.deepEqual(answers, [paidService("fence-check").output, paidService("route-quote").output, paidService("scent-report").output]);
    // Addresses carry their pattern in every published schema.
    const tokenParam = spec.paths["/v1/x402/scent/{token}"]?.get?.parameters.find((p) => p.name === "token") as { schema: { pattern?: string } } | undefined;
    assert.equal(tokenParam?.schema.pattern, "^0x[0-9a-fA-F]{40}$");
    const scentInput = manifest.services.find((s) => s.id === "scent-report")!.metadata.input as unknown as { properties: { token: { pattern?: string } } };
    assert.equal(scentInput.properties.token.pattern, "^0x[0-9a-fA-F]{40}$");
    const borrow = quote.metadata.input.anyOf[2] as unknown as { properties: { account: { pattern?: string } } };
    assert.equal(borrow.properties.account.pattern, "^0x[0-9a-fA-F]{40}$");
    assert.match(spec.info["x-guidance"], /facts\.environment for the Fence check/u);
    // No other operation claims to be paid.
    const claimed = Object.values(spec.paths).flatMap((ops) => Object.values(ops)).filter((op) => op["x-payment-info"]);
    assert.equal(claimed.length, 3);
  });
});

describe("x402 paid routes on a mainnet server", () => {
  let ctx: AppContext;
  let served: Served;
  const settle = facilitator();
  const facts = (environment: string) => JSON.stringify({ facts: { environment, owner: OWNER, signer: "wallet", steps: [] } });
  const post = (path: string, body: string, headers: Record<string, string> = {}) => fetch(`${served.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

  before(async () => {
    ctx = createContext(testConfig({ LYKIA_MODE: "mainnet", LYKIA_X402_PAY_TO: PAY_TO, LYKIA_X402_FACILITATOR_URL: FACILITATOR }), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: settle.fetch });
    served = await serve(createApp(ctx));
  });

  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  it("never sells mainnet work for testnet USDC", async () => {
    for (const path of ["/v1/x402/fence/evaluate", "/v1/x402/fence/evaluate?environment=testnet"]) {
      const response = await post(path, facts("mainnet"), { "x-payment": await payment("10000", path.includes("?") ? "a7" : "a8") });
      assert.equal(response.status, 402, path);
      assert.equal(((await response.json()) as Offer).accepts[0]?.network, "eip155:5042");
    }
    const quote = (await (await post("/v1/x402/quote?environment=testnet", JSON.stringify({ kind: "earn", token: "USDC" }))).json()) as Offer;
    assert.equal(quote.accepts[0]?.network, "eip155:5042", "a quote without environment runs, and is paid, on the server's network");
    assert.equal(settle.state.settles, 0);
  });

  it("takes a testnet payment for testnet work", async () => {
    const response = await post("/v1/x402/fence/evaluate", facts("testnet"), { "x-payment": await payment("10000", "a9") });
    assert.equal(response.status, 200, await response.clone().text());
    const receipt = decodeHeader(response.headers.get("payment-response")) as { network: string };
    assert.equal(receipt.network, "eip155:5042002");
    assert.deepEqual(settle.state.settled, [{ amount: "10000", network: "eip155:5042002" }]);
  });
});

describe("paidRoute", () => {
  it("frees the authorization and settles nothing when the paid work fails", async () => {
    const settle = facilitator();
    const ctx = createContext(testConfig({ LYKIA_X402_PAY_TO: PAY_TO, LYKIA_X402_FACILITATOR_URL: FACILITATOR }), { fetch: settle.fetch });
    let fail = true;
    const app = express();
    app.use(express.json());
    app.post(
      "/work",
      paidRoute(ctx, {
        description: "work",
        resource: () => "https://api.example/work",
        environment: () => "testnet",
        parse: () => ({ environment: "testnet" as const }),
        run: () => {
          if (fail) throw new Error("the work broke");
          return { done: true };
        },
      }),
    );
    app.use(errorHandler(ctx.log));
    const served = await serve(app);
    try {
      const header = await payment("10000", "e5");
      const broken = await fetch(`${served.url}/work`, { method: "POST", headers: { "x-payment": header } });
      assert.equal(broken.status, 500);
      assert.equal(settle.state.settles, 0);
      fail = false;
      const retried = await fetch(`${served.url}/work`, { method: "POST", headers: { "x-payment": header } });
      assert.equal(retried.status, 200, "the same authorization pays the retry");
      assert.deepEqual(await retried.json(), { done: true });
      assert.equal(settle.state.settles, 1);
    } finally {
      await served.close();
      await closeContext(ctx);
    }
  });
});
