import assert from "node:assert/strict";
import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { memoryLogger } from "../../log.js";
import { FakeArc, serve, testConfig, type Served } from "../../__tests__/support.js";
import { issueToken } from "../session.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const ADMIN = "0x00000000000000000000000000000000000ad111";
const USER = "0x0000000000000000000000000000000000000222";

describe("POST /v1/admin/circle/entity-secret", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const calls: { url: string; body: string; auth: string }[] = [];
  const recovery = "CIRCLE-RECOVERY-FILE-CONTENT";
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url, body: String(init?.body ?? ""), auth: headers.get("authorization") ?? "" });
    if (url.endsWith("/v1/w3s/config/entity/publicKey")) return Response.json({ data: { publicKey: pem } });
    if (url.endsWith("/v1/w3s/config/entity/entitySecret")) return Response.json({ data: { recoveryFile: recovery } });
    return new Response("no", { status: 404 });
  };
  const log = memoryLogger("debug");
  let ctx: AppContext;
  let served: Served;
  let configured: AppContext;
  let servedConfigured: Served;

  before(async () => {
    const env = { LYKIA_SESSION_SECRET: "s".repeat(40), LYKIA_ADMIN_ADDRESSES: ADMIN, CIRCLE_API_KEY: "TEST_API_KEY:abc:def" };
    ctx = createContext(testConfig(env), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: fetchImpl as never, log });
    served = await serve(createApp(ctx));
    configured = createContext(testConfig({ ...env, CIRCLE_ENTITY_SECRET: "a".repeat(64) }), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: fetchImpl as never, log });
    servedConfigured = await serve(createApp(configured));
  });
  after(async () => {
    await served.close();
    await servedConfigured.close();
    await closeContext(ctx);
    await closeContext(configured);
  });

  const post = (base: string, token: string | null, body: unknown = {}) =>
    fetch(`${base}/v1/admin/circle/entity-secret`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "lykia-session": token } : {}) }, body: JSON.stringify(body) });

  it("refuses without a session and for non-admins", async () => {
    assert.equal((await post(served.url, null)).status, 401);
    assert.equal((await post(served.url, issueToken(ctx, USER).token)).status, 403);
    assert.equal(calls.length, 0);
  });

  it("refuses when CIRCLE_ENTITY_SECRET is already set", async () => {
    const res = await post(servedConfigured.url, issueToken(configured, ADMIN).token);
    assert.equal(res.status, 409);
    assert.equal(calls.length, 0);
  });

  it("generates, encrypts with RSA-OAEP SHA-256, registers and returns the secret once", async () => {
    const res = await post(served.url, issueToken(ctx, ADMIN).token);
    assert.equal(res.status, 201);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/u);
    const body = (await res.json()) as { entitySecret: string; recoveryFile: string; recoveryFileName: string };
    assert.match(body.entitySecret, /^[0-9a-f]{64}$/u);
    assert.equal(Buffer.from(body.recoveryFile, "base64").toString("utf8"), recovery);
    assert.match(body.recoveryFileName, /^recovery_file_.*\.dat$/u);
    const register = calls.find((c) => c.url.endsWith("/entitySecret"))!;
    assert.equal(register.auth, "Bearer TEST_API_KEY:abc:def");
    const { entitySecretCiphertext } = JSON.parse(register.body) as { entitySecretCiphertext: string };
    const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(entitySecretCiphertext, "base64"));
    assert.equal(plain.toString("hex"), body.entitySecret);
    // Never logged, never stored.
    const logged = JSON.stringify(log.lines);
    assert.ok(!logged.includes(body.entitySecret));
    assert.ok(!logged.includes(recovery) && !logged.includes(body.recoveryFile));
    for (const name of ["circle", "settings", "admin", "secrets", "entity_secret"]) {
      const rows = await ctx.store.collection(name).list({ limit: 100 }).catch(() => []);
      assert.ok(!JSON.stringify(rows).includes(body.entitySecret));
    }
  });
});
