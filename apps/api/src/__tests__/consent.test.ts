/**
 * Regression tests: a self-serve secret key acts only for its own developer,
 * or for owners who granted the key's project consent from their own session.
 * Covers the owner-scoped modules (agent threads, automations and Pack
 * mutations, the Fold, standing orders, developer-flow automations, chat
 * tools that save state), the consent endpoints, webhook fan-out, and the
 * personal-data guard (profile, memory, contacts).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getToken, tokenAddress, type Address } from "@lykia/core";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../app.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import type { PulseFeed } from "../arc/pulse.js";
import { FakeArc, serve, testConfig, type Served } from "./support.js";
import { setLlmClient, setWebhookResolver, agentServices } from "../agents/index.js";
import { emitEvent } from "../platform/events.js";
import { memoryService } from "../personal/memory.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const developer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const victim = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const DEV = developer.address.toLowerCase() as Address;
const OWNER = victim.address.toLowerCase() as Address;
const FRIEND = "0x1111111111111111111111111111111111111111";
const USDC = tokenAddress(getToken("USDC")!, "testnet")!.toLowerCase();

describe("secret keys act only for their developer or consenting owners", () => {
  let ctx: AppContext;
  let served: Served;
  let devSession = "";
  let ownerSession = "";
  let projectId = "";
  let projectKey = "";
  let plainKey = "";

  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(`${served.url}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
  async function signIn(account: typeof developer): Promise<string> {
    const nonce = await json<{ message: string }>(await call("/v1/auth/nonce", { body: { address: account.address, chainId: 5042002 } }));
    return (await json<{ token: string }>(await call("/v1/auth/verify", { body: { message: nonce.message, signature: await account.signMessage({ message: nonce.message }) } }))).token;
  }
  const asKey = (key: string) => ({ "lykia-key": key });

  before(async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 10_000_000_000n);
    arc.setBalance(USDC, DEV, 10_000_000_000n);
    ctx = createContext(testConfig({ LYKIA_SESSION_SECRET: "c".repeat(40), LYKIA_RATE_LIMIT_AUTH: "500", LYKIA_RATE_LIMIT_HEAVY: "1000", LYKIA_MODE: "testnet" }), { chains: arc.asChains(), pulse: idlePulse, fetch: (async () => new Response("{}", { status: 404 })) as never });
    setWebhookResolver(ctx, async () => [{ address: "93.184.216.34", family: 4 }]);
    setLlmClient(ctx, null);
    served = await serve(createApp(ctx));
    devSession = await signIn(developer);
    assert.equal((await call("/v1/developers/register", { body: { name: "Acme" }, headers: { "lykia-session": devSession } })).status, 201);
    devSession = await signIn(developer);
    ownerSession = await signIn(victim);
    const project = await call("/v1/projects", { headers: { "lykia-session": devSession }, body: { name: "Acme Pay" } });
    assert.equal(project.status, 201, await project.clone().text());
    projectId = (await json<{ id: string }>(project)).id;
    const pk = await call("/v1/developers/keys", { headers: { "lykia-session": devSession }, body: { label: "server", projectId } });
    assert.equal(pk.status, 201, await pk.clone().text());
    projectKey = (await json<{ secret: string }>(pk)).secret;
    plainKey = (await json<{ secret: string }>(await call("/v1/developers/keys", { headers: { "lykia-session": devSession }, body: { label: "plain" } }))).secret;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  // Every owner-scoped call a key might make for OWNER, with the status a refusal gives.
  const ownerCalls = (key: string) => [
    ["agent threads", () => call(`/v1/agent/threads?owner=${OWNER}`, { headers: asKey(key) })],
    ["agent thread create", () => call("/v1/agent/threads", { headers: asKey(key), body: { owner: OWNER, environment: "testnet" } })],
    ["agent automations", () => call(`/v1/agent/automations?owner=${OWNER}`, { headers: asKey(key) })],
    ["agent automation create", () => call("/v1/agent/automations", { headers: asKey(key), body: { owner: OWNER, environment: "testnet", when: { everyMinutes: 60 }, sentence: "send 1 USDC to 0x1111111111111111111111111111111111111111" } })],
    ["pack create", () => call("/v1/pack", { headers: asKey(key), body: { owner: OWNER, environment: "testnet", name: "Rogue", role: "treasurer" } })],
    ["pack whistle", () => call("/v1/pack/whistle", { headers: asKey(key), body: { owner: OWNER, environment: "testnet" } })],
    ["fold seen", () => call("/v1/fold/seen", { headers: asKey(key), body: { owner: OWNER, environment: "testnet" } })],
    ["fold proposals", () => call(`/v1/fold/proposals?owner=${OWNER}`, { headers: asKey(key) })],
    ["fold instructions", () => call(`/v1/fold/instructions?owner=${OWNER}`, { headers: asKey(key) })],
    ["standing list", () => call(`/v1/standing?owner=${OWNER}`, { headers: asKey(key) })],
    ["standing create", () => call("/v1/standing", { headers: asKey(key), body: { owner: OWNER, environment: "testnet", text: `every friday pay ${FRIEND} 5 USDC` } })],
    ["devflow automation create", () => call("/v1/automations", { headers: asKey(key), body: { owner: OWNER, name: "Rogue", environment: "testnet", trigger: { type: "balance", token: "USDC", op: "above", value: "1" }, action: { type: "notify", channel: "webhook" } } })],
  ] as const;

  it("refuses every owner-scoped route for an owner who never consented", async () => {
    for (const key of [plainKey, projectKey]) {
      for (const [name, run] of ownerCalls(key)) {
        const res = await run();
        assert.equal(res.status, 403, `${name}: ${await res.text()}`);
      }
    }
    // The owner's instructions are not listed to the key either.
    const listed = await json<{ entries: { source: string }[] }>(await call(`/v1/automations?owner=${OWNER}`, { headers: asKey(projectKey) }));
    assert.ok(!listed.entries.some((e) => e.source === "standing" || e.source === "alert"));
  });

  it("still acts for the key's own developer", async () => {
    const own = await call(`/v1/agent/threads?owner=${DEV}`, { headers: asKey(plainKey) });
    assert.equal(own.status, 200);
    const pack = await call("/v1/pack", { headers: asKey(plainKey), body: { owner: DEV, environment: "testnet", name: "Treasurer", role: "treasurer" } });
    assert.equal(pack.status, 201, await pack.clone().text());
  });

  it("refuses Pack mutations on another owner's agent (pause, revoke, session-tx)", async () => {
    const created = await call("/v1/pack", { headers: { "lykia-session": ownerSession }, body: { owner: OWNER, environment: "testnet", name: "Keeper", role: "treasurer" } });
    assert.equal(created.status, 201, await created.clone().text());
    const { id } = await json<{ id: string }>(created);
    for (const path of [`/v1/pack/${id}/pause`, `/v1/pack/${id}/revoke`, `/v1/pack/${id}/session-tx`, `/v1/pack/${id}/spawn`]) {
      const res = await call(path, { headers: asKey(projectKey), body: path.endsWith("spawn") ? { name: "pup", role: "treasurer" } : {} });
      assert.equal(res.status, 403, `${path}: ${await res.text()}`);
    }
  });

  it("public Pack and order reads keep chain facts and hide names, missions, Fences and budgets", async () => {
    const created = await call("/v1/pack", { headers: { "lykia-session": ownerSession }, body: { owner: OWNER, environment: "testnet", name: "Secret payroll", role: "treasurer", mission: "Pay Ayse every Friday" } });
    assert.equal(created.status, 201);
    const { id } = await json<{ id: string }>(created);
    const anon = await json<{ agents: Record<string, unknown>[]; redacted: boolean }>(await call(`/v1/pack?owner=${OWNER}&environment=testnet`));
    assert.equal(anon.redacted, true);
    const raw = JSON.stringify(anon);
    assert.ok(!raw.includes("Secret payroll") && !raw.includes("Ayse"), raw);
    assert.ok(anon.agents.every((a) => a.fence === undefined && a.budget === undefined && typeof a.fenceHash === "string"));
    const one = await json<Record<string, unknown>>(await call(`/v1/pack/${id}`, { headers: asKey(projectKey) }));
    assert.equal(one.redacted, true);
    assert.equal(one.name, undefined);
    assert.equal((await call(`/v1/pack/${id}/budget`)).status, 401);
    const own = await json<{ agents: { name: string }[]; redacted: boolean }>(await call(`/v1/pack?owner=${OWNER}&environment=testnet`, { headers: { "lykia-session": ownerSession } }));
    assert.equal(own.redacted, false);
    assert.ok(own.agents.some((a) => a.name === "Secret payroll"));
    const orders = await json<{ redacted: boolean }>(await call(`/v1/orders?owner=${OWNER}&environment=testnet`));
    assert.equal(orders.redacted, true);
  });

  it("chat tools save nothing for an owner the key does not act for", async () => {
    const res = await call("/v1/agent/chat", { headers: { ...asKey(projectKey), accept: "application/json" }, body: { message: `every friday send 5 USDC to ${FRIEND}`, owner: OWNER, environment: "testnet" } });
    assert.equal(res.status, 200, await res.clone().text());
    const thread = await json<{ threadId: string }>(res);
    assert.ok(thread.threadId.startsWith("anon:"), "an unproven chat never writes under the owner's prefix");
    const saved = await json<{ automations: unknown[] }>(await call("/v1/automations", { headers: asKey(projectKey) }));
    assert.equal(saved.automations.length, 0);
  });

  it("consent: only the owner's own session grants, lists and revokes it", async () => {
    assert.equal((await call("/v1/consents", { body: { projectId } })).status, 401);
    assert.equal((await call("/v1/consents", { headers: asKey(projectKey), body: { projectId } })).status, 403);
    assert.equal((await call("/v1/consents", { headers: { ...asKey(projectKey), "lykia-session": ownerSession }, body: { projectId } })).status, 403, "a key riding along never grants");
    assert.equal((await call("/v1/consents", { headers: { "lykia-session": ownerSession }, body: { projectId: "prj_000000000000" } })).status, 404);
    const granted = await call("/v1/consents", { headers: { "lykia-session": ownerSession }, body: { projectId } });
    assert.equal(granted.status, 201, await granted.clone().text());
    const list = await json<{ consents: { projectId: string; developer: string }[] }>(await call("/v1/consents", { headers: { "lykia-session": ownerSession } }));
    assert.deepEqual(list.consents.map((c) => [c.projectId, c.developer]), [[projectId, DEV]]);
  });

  it("with consent, the project's key acts for the owner; a key outside the project still does not", async () => {
    assert.equal((await call(`/v1/agent/threads?owner=${OWNER}`, { headers: asKey(projectKey) })).status, 200);
    const standing = await call("/v1/standing", { headers: asKey(projectKey), body: { owner: OWNER, environment: "testnet", text: `every friday pay ${FRIEND} 5 USDC` } });
    assert.equal(standing.status, 201, await standing.clone().text());
    const auto = await call("/v1/automations", { headers: asKey(projectKey), body: { owner: OWNER, name: "Low cash", environment: "testnet", trigger: { type: "balance", token: "USDC", op: "above", value: "1" }, action: { type: "notify", channel: "webhook" } } });
    assert.equal(auto.status, 201, await auto.clone().text());
    assert.equal((await call("/v1/fold/seen", { headers: asKey(projectKey), body: { owner: OWNER, environment: "testnet" } })).status, 200);
    // The developer's plain key belongs to no project: consent to the project does not extend to it.
    assert.equal((await call(`/v1/agent/threads?owner=${OWNER}`, { headers: asKey(plainKey) })).status, 403);
  });

  it("revoking consent stops the key at once", async () => {
    const revoked = await json<{ revoked: boolean }>(await call(`/v1/consents/${projectId}`, { method: "DELETE", headers: { "lykia-session": ownerSession } }));
    assert.equal(revoked.revoked, true);
    for (const [name, run] of ownerCalls(projectKey)) {
      const res = await run();
      assert.equal(res.status, 403, `${name} after revoke`);
    }
  });

  it("webhooks: no arbitrary owners, only own projects, and another owner's events only with consent", async () => {
    const withOwners = await call("/v1/developers/webhooks", { headers: { "lykia-session": devSession }, body: { url: "https://hooks.example.com/a", owners: [OWNER] } });
    assert.equal(withOwners.status, 400, "the owners list is gone from the schema");
    const foreign = await call("/v1/developers/webhooks", { headers: { "lykia-session": devSession }, body: { url: "https://hooks.example.com/a", projects: ["prj_000000000000"] } });
    assert.equal(foreign.status, 404, "an endpoint follows only the developer's own projects");
    const hook = await call("/v1/developers/webhooks", { headers: { "lykia-session": devSession }, body: { url: "https://hooks.example.com/a", projects: [projectId] } });
    assert.equal(hook.status, 201, await hook.clone().text());
    const hooks = agentServices(ctx).webhooks;
    const before = (await hooks.recentDeliveries(DEV, 200)).length;
    assert.equal((await emitEvent("payout.sent", { payoutId: "po_x" }, { owner: OWNER, ctx })).delivered, 0, "no consent: the owner's events stay private");
    // A plan made through the project's browser path does not subscribe the owner either.
    await call("/v1/intents", { headers: asKey(projectKey), body: { owner: OWNER, environment: "testnet", actions: [{ verb: "send", token: "USDC", amount: { exact: "1" }, to: FRIEND }], dryRun: true } });
    assert.equal((await emitEvent("payout.sent", { payoutId: "po_y" }, { owner: OWNER, ctx })).delivered, 0);
    assert.equal((await hooks.recentDeliveries(DEV, 200)).length, before);
    await call("/v1/consents", { headers: { "lykia-session": ownerSession }, body: { projectId } });
    assert.equal((await emitEvent("payout.sent", { payoutId: "po_z" }, { owner: OWNER, ctx })).delivered, 1, "with consent, the project's endpoint hears the owner");
    await call(`/v1/consents/${projectId}`, { method: "DELETE", headers: { "lykia-session": ownerSession } });
    assert.equal((await emitEvent("payout.sent", { payoutId: "po_w" }, { owner: OWNER, ctx })).delivered, 0);
  });

  it("memory and contacts: a request that only names the owner neither reads nor writes them", async () => {
    const contact = await call("/v1/contacts", { headers: { "lykia-session": ownerSession }, body: { name: "Mehmet", address: FRIEND } });
    assert.equal(contact.status, 201, await contact.clone().text());
    // Unproven: the contact name does not resolve, and nothing is recorded in the owner's history.
    const anon = await call("/v1/intents", { body: { owner: OWNER, environment: "testnet", text: "send 5 USDC to Mehmet" } });
    assert.equal(anon.status, 422, await anon.clone().text());
    const keyed = await call("/v1/intents", { headers: asKey(projectKey), body: { owner: OWNER, environment: "testnet", text: "send 5 USDC to Mehmet" } });
    assert.equal(keyed.status, 422, "a key without consent sees no contacts");
    const planned = await call("/v1/intents", { body: { owner: OWNER, environment: "testnet", text: `send 5 USDC to ${FRIEND}` } });
    assert.equal(planned.status, 201, await planned.clone().text());
    const history = await json<{ intents: unknown[] }>(await call("/v1/memory/intents", { headers: { "lykia-session": ownerSession } }));
    assert.equal(history.intents.length, 0, "an unproven plan is never written to the owner's memory");
    // Proven: the owner's own session resolves the contact and records the plan.
    const own = await call("/v1/intents", { headers: { "lykia-session": ownerSession }, body: { owner: OWNER, environment: "testnet", text: "send 5 USDC to Mehmet" } });
    assert.equal(own.status, 201, await own.clone().text());
    const after = await json<{ intents: unknown[] }>(await call("/v1/memory/intents", { headers: { "lykia-session": ownerSession } }));
    assert.equal(after.intents.length, 1);
    // Outside any request (schedulers), memory works as before.
    assert.equal((await memoryService(ctx).contacts(OWNER)).length, 1);
  });

  it("MCP: the plan tools do not read the owner's memory, and personal tools refuse a full session token", async () => {
    const rpc = (method: string, params: unknown) =>
      call("/v1/mcp", { headers: { accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method, params } }).then(async (r) => {
        const text = await r.text();
        const line = text.split("\n").find((l) => l.startsWith("data: "));
        return JSON.parse(line ? line.slice(6) : text) as { result?: { content?: { text: string }[] } };
      });
    const plan = await rpc("tools/call", { name: "lykia_pack_plan", arguments: { sentence: "send 5 USDC to Mehmet", owner: OWNER, environment: "testnet" } });
    const reply = plan.result?.content?.[0]?.text ?? "";
    assert.ok(!reply.includes(FRIEND.slice(2, 10)), "the contact's address never resolves through MCP");
    const memory = await rpc("tools/call", { name: "lykia_memory", arguments: { sessionToken: ownerSession } });
    assert.match(JSON.stringify(memory), /Do not paste your Lykia-Session/u);
    const minted = await call("/v1/auth/mcp-token", { headers: { "lykia-session": ownerSession }, body: {} });
    assert.equal(minted.status, 201);
    const { token } = await json<{ token: string }>(minted);
    // The read-only token is never a session.
    assert.equal((await call("/v1/auth/session", { headers: { "lykia-session": token } })).status, 401);
    const read = await rpc("tools/call", { name: "lykia_contacts", arguments: { sessionToken: token } });
    assert.match(JSON.stringify(read), /Mehmet/u);
    assert.equal((await call("/v1/auth/mcp-token/revoke", { headers: { "lykia-session": ownerSession }, body: { token } })).status, 200);
    const gone = await rpc("tools/call", { name: "lykia_contacts", arguments: { sessionToken: token } });
    assert.match(JSON.stringify(gone), /revoked/u);
  });
});
