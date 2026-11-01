import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { ArcChains } from "../../chains/arc.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { FakeArc, serve, testConfig, type Served } from "../../__tests__/support.js";
import { agentServices, setWebhookResolver } from "../../agents/index.js";
import { recordDeployment } from "../admin.js";
import { hashSecret } from "../keys.js";
import { RETRY_DELAYS_MS, signWebhook, verifyWebhookSignature } from "../webhooks.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const admin = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

describe("platform", () => {
  let ctx: AppContext;
  let served: Served;
  const deliveries: { url: string; headers: Record<string, string>; body: string }[] = [];
  let hookStatus = 200;
  let now = Date.UTC(2026, 10, 2, 10);

  before(async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      deliveries.push({ url, headers: init?.headers as Record<string, string>, body: String(init?.body ?? "") });
      return new Response("ok", { status: hookStatus });
    };
    ctx = createContext(testConfig({ LYKIA_SESSION_SECRET: "x".repeat(40), LYKIA_ADMIN_ADDRESSES: admin.address }), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: fetchImpl as never, clock: { now: () => now } });
    setWebhookResolver(ctx, async () => [{ address: "93.184.216.34", family: 4 }]);
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(`${served.url}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });

  async function signIn(account: typeof wallet): Promise<string> {
    const nonce = (await (await call("/v1/auth/nonce", { body: { address: account.address, chainId: 5042002 } })).json()) as { message: string };
    const signature = await account.signMessage({ message: nonce.message });
    const res = await call("/v1/auth/verify", { body: { message: nonce.message, signature } });
    assert.equal(res.status, 200);
    return ((await res.json()) as { token: string }).token;
  }

  it("signs in with SIWE on Arc and refuses replays and wrong signers", async () => {
    const nonce = (await (await call("/v1/auth/nonce", { body: { address: wallet.address, chainId: 5042002 } })).json()) as { message: string; domain: string; chainIds: number[] };
    assert.ok(nonce.chainIds.includes(5042) && nonce.chainIds.includes(5042002));
    const forged = await admin.signMessage({ message: nonce.message });
    assert.equal((await call("/v1/auth/verify", { body: { message: nonce.message, signature: forged } })).status, 401);
    // The forged attempt consumed the nonce: even the right signature now fails (single use).
    const signature = await wallet.signMessage({ message: nonce.message });
    assert.equal((await call("/v1/auth/verify", { body: { message: nonce.message, signature } })).status, 401);
    const token = await signIn(wallet);
    const session = (await (await call("/v1/auth/session", { headers: { "lykia-session": token } })).json()) as { address: string; roles: string[] };
    assert.equal(session.address, wallet.address.toLowerCase());
    assert.deepEqual(session.roles, ["user"]);
    await call("/v1/auth/logout", { body: {}, headers: { "lykia-session": token } });
    assert.equal((await call("/v1/auth/session", { headers: { "lykia-session": token } })).status, 401);
  });

  it("issues hashed API keys with scopes, per-key quotas, origins and revocation", async () => {
    const token = await signIn(wallet);
    assert.equal((await call("/v1/developers/keys", { headers: { "lykia-session": token } })).status, 403);
    assert.equal((await call("/v1/developers/register", { body: { name: "Acme Pay" }, headers: { "lykia-session": token } })).status, 201);
    const created = (await (await call("/v1/developers/keys", { body: { label: "server", perMinute: 2, scopes: ["read"] }, headers: { "lykia-session": token } })).json()) as { id: string; secret: string; prefix: string };
    assert.match(created.secret, /^lk_sk_[a-z0-9]{12}_/u);
    const stored = (await ctx.store.collection("api_keys").get(created.id))?.value as { hash: string };
    assert.equal(stored.hash, hashSecret(ctx, created.secret));
    assert.ok(!JSON.stringify(stored).includes(created.secret.split("_").pop() as string));
    const withKey = { "lykia-key": created.secret };
    assert.equal((await call("/v1/networks", { headers: withKey })).status, 200);
    assert.equal((await call("/v1/fence/validate", { body: { fence: {} }, headers: withKey })).status, 403, "read-only key cannot plan");
    assert.equal((await call("/v1/networks", { headers: withKey })).status, 429, "per-minute quota (the 403 above still counted)");
    now += 61_000;
    assert.equal((await call("/v1/networks", { headers: withKey })).status, 200);
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": `${created.secret.slice(0, -1)}x` } })).status, 401);
    await call(`/v1/developers/keys/${created.id}/revoke`, { body: {}, headers: { "lykia-session": token } });
    assert.equal((await call("/v1/networks", { headers: withKey })).status, 401);
    const pub = (await (await call("/v1/developers/keys", { body: { label: "site", kind: "publishable", allowedOrigins: ["https://app.acme.dev"] }, headers: { "lykia-session": token } })).json()) as { secret: string; scopes: string[] };
    assert.deepEqual(pub.scopes, ["read", "plan"]);
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": pub.secret, origin: "https://evil.example" } })).status, 403);
    assert.equal((await call("/v1/networks", { headers: { "lykia-key": pub.secret, origin: "https://app.acme.dev" } })).status, 200);
    const usage = (await (await call("/v1/developers/usage", { headers: { "lykia-session": token } })).json()) as { today: number };
    assert.ok(usage.today >= 3);
    assert.equal((await call("/v1/developers/settings", { method: "PUT", body: { integratorFeeBps: 51, feeRecipient: wallet.address }, headers: { "lykia-session": token } })).status, 400);
    assert.equal((await call("/v1/developers/settings", { method: "PUT", body: { integratorFeeBps: 25, feeRecipient: wallet.address }, headers: { "lykia-session": token } })).status, 200);
  });

  it("delivers signed webhooks and retries with backoff", async () => {
    const token = await signIn(wallet);
    const endpoint = (await (await call("/v1/developers/webhooks", { body: { url: "https://hooks.acme.dev/lykia", events: ["pack.agent.spawned"] }, headers: { "lykia-session": token } })).json()) as { id: string; secret: string };
    assert.match(endpoint.secret, /^whsec_/u);
    deliveries.length = 0;
    await agentServices(ctx).pack.create({ owner: wallet.address, environment: "testnet", name: "Sentinel", role: "sentinel" });
    for (let i = 0; i < 20 && deliveries.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const hit = deliveries[0]!;
    assert.equal(hit.url, "https://hooks.acme.dev/lykia");
    assert.ok(verifyWebhookSignature(endpoint.secret, hit.body, hit.headers["Lykia-Signature"] as string, Math.floor(now / 1000)));
    assert.ok(!verifyWebhookSignature(endpoint.secret, `${hit.body} `, hit.headers["Lykia-Signature"] as string, Math.floor(now / 1000)));
    assert.ok(!verifyWebhookSignature(endpoint.secret, hit.body, hit.headers["Lykia-Signature"] as string, Math.floor(now / 1000) + 600), "stale timestamps are refused");
    assert.equal(JSON.parse(hit.body).event, "pack.agent.spawned");

    hookStatus = 500;
    await agentServices(ctx).webhooks.emit("pack.agent.spawned", wallet.address, { retry: true });
    const failed = (await (await call("/v1/developers/webhooks/deliveries", { headers: { "lykia-session": token } })).json()) as { deliveries: { status: string; attempts: number; nextAttemptAt: string }[] };
    const pending = failed.deliveries.find((d) => d.status === "pending")!;
    assert.equal(pending.attempts, 1);
    assert.equal(Date.parse(pending.nextAttemptAt) - now, RETRY_DELAYS_MS[0]);
    hookStatus = 200;
    now += RETRY_DELAYS_MS[0];
    assert.equal(await agentServices(ctx).webhooks.retryDue(), 1);
    const after = (await (await call("/v1/developers/webhooks/deliveries", { headers: { "lykia-session": token } })).json()) as { deliveries: { status: string }[] };
    assert.equal(after.deliveries.filter((d) => d.status === "pending").length, 0);
    assert.equal(signWebhook("s", "b", 1), signWebhook("s", "b", 1));
  });

  it("records direct CREATE deployments from an admin wallet after checking the receipt and the bytecode", async () => {
    const code = "0x6080604052600080fd" as Hex;
    const address = "0x7777777777777777777777777777777777777777";
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const viaFactory = `0x${"cd".repeat(32)}` as Hex;
    const byStranger = `0x${"ef".repeat(32)}` as Hex;
    const chains = {
      client: () => ({
        getTransactionReceipt: async ({ hash: h }: { hash: string }) => ([hash, viaFactory, byStranger].includes(h as Hex) ? { status: "success", contractAddress: h === viaFactory ? null : address, blockNumber: 99n, logs: [] } : null),
        getTransaction: async ({ hash: h }: { hash: string }) => ({ from: h === byStranger ? wallet.address : admin.address, to: h === viaFactory ? "0x4e59b44847b379578588920ca78fbf26c0b4956c" : null }),
        getCode: async () => code,
      }),
    } as unknown as ArcChains;
    const local = createContext(testConfig({ LYKIA_ADMIN_ADDRESSES: admin.address }), { chains, pulse: idlePulse });
    const ok = await recordDeployment(local, { environment: "testnet", contract: "PracticeVault", name: "PracticeVaultUSDC", address, txHash: hash, recordedBy: admin.address }, () => true);
    assert.equal(ok.verified, true);
    assert.equal(ok.id, "testnet:PracticeVaultUSDC");
    assert.equal(ok.creator.toLowerCase(), admin.address.toLowerCase());
    await assert.rejects(recordDeployment(local, { environment: "testnet", contract: "LykiaAccountFactory", address, txHash: hash, recordedBy: admin.address }, () => false), (e: Error & { code?: string }) => e.code === "DEPLOYMENT_MISMATCH");
    await assert.rejects(recordDeployment(local, { environment: "testnet", contract: "LykiaRouter", address, txHash: viaFactory, recordedBy: admin.address }, () => true), (e: Error & { code?: string }) => e.code === "DEPLOYMENT_UNVERIFIED" && /not a contract creation/u.test(e.message));
    await assert.rejects(recordDeployment(local, { environment: "testnet", contract: "LykiaRouter", address, txHash: byStranger, recordedBy: admin.address }, () => true), (e: Error & { code?: string }) => e.code === "DEPLOYMENT_UNVERIFIED" && /not an admin/u.test(e.message));
    await assert.rejects(recordDeployment(local, { environment: "testnet", contract: "X", address: "0x8888888888888888888888888888888888888888", txHash: hash, recordedBy: admin.address }, () => null), (e: Error & { code?: string }) => e.code === "DEPLOYMENT_UNVERIFIED");
    const unknown = await recordDeployment(local, { environment: "testnet", contract: "Other", address, txHash: hash, recordedBy: admin.address }, () => null);
    assert.equal(unknown.verified, false);
    // The default check compares with the core artifact: random code is refused for a known contract.
    await assert.rejects(recordDeployment(local, { environment: "testnet", contract: "LykiaRouter", address, txHash: hash, recordedBy: admin.address }), (e: Error & { code?: string }) => e.code === "DEPLOYMENT_MISMATCH");
    await closeContext(local);

    const adminToken = await signIn(admin);
    const userToken = await signIn(wallet);
    assert.equal((await call("/v1/admin/flags", { headers: { "lykia-session": userToken } })).status, 403);
    const flags = (await (await call("/v1/admin/flags", { method: "PUT", body: { "agents.keeper": true }, headers: { "lykia-session": adminToken } })).json()) as Record<string, boolean>;
    assert.equal(flags["agents.keeper"], true);
  });
});
