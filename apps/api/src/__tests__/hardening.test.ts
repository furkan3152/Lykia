/**
 * Regression tests for the low-severity hardening: constant-time secret
 * checks, SIWE only for listed city hosts, x402 never verify-only in
 * production, and who may stop an intent.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { getToken, tokenAddress } from "@lykia/core";
import { createApp } from "../app.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import type { PulseFeed } from "../arc/pulse.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "./support.js";
import { cronAuthorized, secretMatches } from "../platform/crypto.js";
import { acceptPayment, settlementMode } from "../x402/x402.js";
import { issueToken } from "../platform/session.js";
import { upstreamReason } from "../circle/http.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const OWNER = owner.address.toLowerCase();
const USDC_ARC = "0x3600000000000000000000000000000000000000";

describe("hardening", () => {
  let ctx: AppContext;
  let served: Served;
  before(async () => {
    const arc = new FakeArc();
    arc.setBalance(tokenAddress(getToken("USDC")!, "testnet")!, OWNER, 10_000_000_000n);
    ctx = createContext(testConfig({ LYKIA_ROOT_DOMAIN: "lykia.example", LYKIA_SESSION_SECRET: "h".repeat(40), LYKIA_MODE: "testnet" }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${served.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("compares secrets in constant time and refuses an unset CRON_SECRET", () => {
    assert.equal(secretMatches("abc", "abc"), true);
    assert.equal(secretMatches("abc", "abd"), false);
    assert.equal(secretMatches("abc", "abcd"), false);
    assert.equal(secretMatches(undefined, "abc"), false);
    const before = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    assert.equal(cronAuthorized("Bearer "), false);
    process.env.CRON_SECRET = "s3cret";
    assert.equal(cronAuthorized("Bearer s3cret"), true);
    assert.equal(cronAuthorized("Bearer s3cre"), false);
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  });

  it("SIWE: an unlisted subdomain of the root domain is neither offered nor accepted", async () => {
    const nonce = (await (await post("/v1/auth/nonce", { address: owner.address, chainId: 5042002 }, { origin: "https://evil.lykia.example" })).json()) as { domain: string };
    assert.notEqual(nonce.domain, "evil.lykia.example");
    const n = generateSiweNonce();
    await ctx.store.collection("siwe_nonces").put(n, { issuedAt: Date.now() }, { ttlMs: 60_000 });
    const message = createSiweMessage({ address: owner.address, chainId: 5042002, domain: "evil.lykia.example", nonce: n, uri: "https://evil.lykia.example", version: "1", issuedAt: new Date() });
    const res = await post("/v1/auth/verify", { message, signature: await owner.signMessage({ message }) });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "SIWE_DOMAIN");
  });

  it("x402: production without a facilitator is off, and no payment is accepted unsettled", async () => {
    const prod = { ...ctx, config: { ...ctx.config, env: "production" as const, x402: { ...ctx.config.x402, payTo: OWNER as `0x${string}`, facilitatorUrl: null } } } as AppContext;
    assert.equal(settlementMode(prod).mode, "off");
    const result = await acceptPayment(prod, "e30=", { scheme: "exact", network: "eip155:5042002", amount: "1", asset: USDC_ARC, payTo: OWNER, maxTimeoutSeconds: 60 } as never, "testnet");
    assert.equal(result.ok, false);
    const dev = { ...prod, config: { ...prod.config, env: "development" as const } } as AppContext;
    assert.equal(settlementMode(dev).mode, "verify-only");
  });

  it("intents: only the owner or whoever planned it may stop a plan", async () => {
    const planned = await post("/v1/intents", { owner: OWNER, environment: "testnet", actions: [{ verb: "send", token: "USDC", amount: { exact: "1" }, to: "0x1111111111111111111111111111111111111111" }] });
    assert.equal(planned.status, 201, await planned.clone().text());
    const { intent } = (await planned.json()) as { intent: { id: string } };
    assert.equal((await post(`/v1/intents/${intent.id}/stop`, {})).status, 401);
    const stranger = issueToken(ctx, "0x2222222222222222222222222222222222222222").token;
    assert.equal((await post(`/v1/intents/${intent.id}/stop`, {}, { "lykia-session": stranger })).status, 403);
    assert.equal((await post(`/v1/intents/${intent.id}/stop`, {}, { "lykia-session": issueToken(ctx, OWNER).token })).status, 200);
  });

  it("upstream errors carry only Circle's code and message, never the raw body", () => {
    assert.deepEqual(upstreamReason(JSON.stringify({ code: 155101, message: "Invalid entity secret", request: { entitySecretCiphertext: "AAAA" } })), { code: 155101, message: "Invalid entity secret" });
    assert.deepEqual(upstreamReason("<html>gateway timeout</html>"), {});
  });
});
