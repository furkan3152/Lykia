/**
 * The Whistle is server truth: one call pauses every automation, standing
 * order, agent automation, Pack agent and leash the owner has (Autopilot is
 * covered in autopilot.test.ts), lists exactly what it stopped, and each item
 * resumes on its own. Agent automations plan under the owner's Fence. Plans
 * started in Ask show in Herding with Stop, open orders with Cancel and their
 * real Fence verdict.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FENCE, LEASH_SCHEMA, type Address, type Leash } from "@lykia/core";
import type { FoldInstructionsResponse, WhistleResponse } from "@lykia/core/api/fold";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "../../__tests__/support.js";
import { agentServices, setLlmClient } from "../../agents/index.js";
import { createAutomation as createAgentAutomation, listAutomations as listAgentAutomations, runAutomations } from "../../agents/automations.js";
import { runTool, type ToolContext } from "../../agents/tools.js";
import { automations } from "../../devflows/stores.js";
import { leashService } from "../../leash/service.js";
import { assertLeashKeyAllowed } from "../../leash/store.js";
import { issueToken } from "../../platform/session.js";
import { services } from "../../services.js";
import { updateProfile } from "../../personal/profile.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as Address;
const USDC = "0x3600000000000000000000000000000000000000";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

describe("the Whistle", () => {
  let ctx: AppContext;
  let served: Served;
  let token: string;
  const arc = new FakeArc();

  before(async () => {
    arc.setBalance(USDC, OWNER, 900_000_000n);
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    setLlmClient(ctx, null);
    served = await serve(createApp(ctx));
    token = issueToken(ctx, OWNER).token;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${served.url}${path}`, { method, headers: { "content-type": "application/json", "Lykia-Session": token }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: (await res.json()) as T };
  };

  async function seed(): Promise<{ leashId: string; agentId: string }> {
    const tc: ToolContext = { ctx, environment: "mainnet", owner: OWNER, ownerVerified: true, agent: { name: "Lyko", role: "orchestrator", fence: DEFAULT_FENCE, capabilities: ["read", "propose"] }, proposals: [], drafts: [] };
    const made = await runTool("draft_automation", { name: "Friday sweep", trigger: { type: "schedule", every: "week", weekday: "fri", at: "17:00", timezone: "UTC" }, action: { type: "plan", sentence: "keep 1 USDC liquid and earn the rest" } }, tc);
    assert.equal(made.ok, true, made.summary);
    await services(ctx).standing.create({ owner: OWNER, environment: "mainnet", draft: { trigger: { kind: "schedule", every: "day", at: "09:00", timezone: "UTC" }, actions: [{ verb: "send", token: "USDC", amount: { exact: "5" }, to: "0x1111111111111111111111111111111111111111" }], text: "Pay 5 USDC every day" } });
    const agent = await agentServices(ctx).pack.create({ owner: OWNER, environment: "mainnet", name: "Treasury desk", role: "treasurer" });
    await createAgentAutomation(ctx, agentServices(ctx).pack, { owner: OWNER, environment: "mainnet", agentId: null, when: { everyMinutes: 60 }, sentence: "deposit 10 USDC into morpho", mode: "propose" });
    const leash = { schema: LEASH_SCHEMA, id: "lsh_0123456789ab", owner: OWNER.toLowerCase(), environment: "mainnet", agentId: agent.id, agentName: "Invoice bot", parentAgentId: null, template: "custom", fence: DEFAULT_FENCE, fenceHash: "sha256:00", budget: { perStepUsd: "10", perDayUsd: "20", totalUsd: "100" }, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), tools: ["plan", "submit", "status"], venues: null, recipients: [], status: "active", session: null, tag: null, key: { id: "key_x", prefix: "lk_x" }, createdBy: { via: "session", developer: OWNER.toLowerCase() }, createdAt: new Date().toISOString() } as unknown as Leash;
    await leashService(ctx).put(leash);
    return { leashId: leash.id, agentId: agent.id };
  }

  it("stops every automation, standing order, agent automation, Pack agent and leash on the server, and says what it stopped", async () => {
    const { leashId, agentId } = await seed();
    const blown = await call<WhistleResponse>("POST", "/v1/whistle", { owner: OWNER, environment: "mainnet", reason: "test" });
    assert.equal(blown.status, 200);
    const kinds = new Set(blown.body.items.filter((i) => i.state === "paused").map((i) => i.kind));
    for (const k of ["automation", "standing", "agent-automation", "agent", "leash"] as const) assert.ok(kinds.has(k), `${k} is listed`);
    assert.ok(blown.body.blownAt);
    // Server truth: every one of them is stopped where it lives.
    const unified = (await automations(ctx).list({ limit: 100 })).map((d) => d.value).filter((a) => a.owner.toLowerCase() === OWNER.toLowerCase());
    assert.ok(unified.length > 0 && unified.every((a) => a.status === "paused"));
    assert.ok((await services(ctx).standing.list(OWNER)).every((o) => o.status !== "active"));
    assert.ok((await listAgentAutomations(ctx, OWNER)).every((a) => !a.enabled));
    assert.equal((await agentServices(ctx).pack.get(agentId)).status, "paused");
    assert.equal((await leashService(ctx).get(leashId)).paused?.by, "whistle");
    await assert.rejects(assertLeashKeyAllowed(ctx, leashId, "POST", `/leashes/${leashId}/plan`), (e: Error & { code?: string }) => e.code === "LEASH_PAUSED", "the leash key is disabled");
    const state = await call<WhistleResponse>("GET", `/v1/whistle?owner=${OWNER}&environment=mainnet`);
    assert.deepEqual(state.body.items.map((i) => i.id).sort(), blown.body.items.map((i) => i.id).sort());
  });

  it("each item resumes on its own, then everything else at once", async () => {
    const state = (await call<WhistleResponse>("GET", `/v1/whistle?owner=${OWNER}&environment=mainnet`)).body;
    const leash = state.items.find((i) => i.kind === "leash")!;
    const one = await call<WhistleResponse>("POST", "/v1/whistle/resume", { owner: OWNER, environment: "mainnet", kind: "leash", id: leash.id });
    assert.equal(one.body.items.find((i) => i.id === leash.id)?.state, "resumed");
    assert.equal((await leashService(ctx).get(leash.id)).paused ?? null, null);
    await assertLeashKeyAllowed(ctx, leash.id, "POST", `/leashes/${leash.id}/plan`);
    assert.ok(one.body.items.some((i) => i.state === "paused"), "the rest stays stopped");
    const all = await call<WhistleResponse>("POST", "/v1/whistle/resume", { owner: OWNER, environment: "mainnet" });
    assert.ok(all.body.items.every((i) => i.state === "resumed"));
    assert.equal(all.body.blownAt, null);
    assert.ok((await listAgentAutomations(ctx, OWNER)).every((a) => a.enabled));
    assert.ok((await services(ctx).standing.list(OWNER)).some((o) => o.status === "active"));
    assert.equal((await call<{ status: number }>("POST", "/v1/whistle/resume", { owner: OWNER, kind: "leash", id: "lsh_nothere" })).status, 404);
  });

  it("the Pack's whistle route is the same server-side stop", async () => {
    const res = await call<{ whistle: WhistleResponse }>("POST", "/v1/pack/whistle", { owner: OWNER, environment: "mainnet" });
    assert.ok(res.body.whistle.items.some((i) => i.kind === "agent" && i.state === "paused"));
    await call("POST", "/v1/whistle/resume", { owner: OWNER, environment: "mainnet" });
  });

  it("agent automations plan under the owner's Fence, never a default one", async () => {
    const owner = "0x5100000000000000000000000000000000000051" as Address;
    arc.setBalance(USDC, owner, 900_000_000n);
    arc.vaultAssets.set("0x8E357432CC12ff425c36432F312968aEb16112AF".toLowerCase(), 80_000_000_000_000n);
    // The owner's own rules refuse Morpho vaults; the default Fence would let the deposit through.
    await updateProfile(ctx, owner, { venues: { favorites: [], blocked: ["morpho-vaults"] } });
    await createAgentAutomation(ctx, agentServices(ctx).pack, { owner, environment: "mainnet", agentId: null, when: { everyMinutes: 15 }, sentence: "deposit 300 USDC into morpho", mode: "propose" });
    const fence = await import("../../agents/automations.js").then((m) => m.ownerFenceOf(ctx, owner));
    assert.ok(fence.venues?.deny?.includes("morpho-vaults"));
    const runs = await runAutomations(ctx, agentServices(ctx).pack, owner, "mainnet");
    assert.equal(runs.length, 1);
    const run = runs[0]!;
    // The owner's Fence decides: never a Morpho vault (DEFAULT_FENCE would route there), refused or routed elsewhere.
    assert.doesNotMatch((run.proposal?.steps ?? []).join(" "), /Morpho/u, JSON.stringify(run));
  });
});

describe("Herding: plans with Stop, orders with Cancel", () => {
  let ctx: AppContext;
  let served: Served;
  let token: string;
  const arc = new FakeArc();
  before(async () => {
    arc.setBalance(USDC, OWNER, 900_000_000n);
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    setLlmClient(ctx, null);
    served = await serve(createApp(ctx));
    token = issueToken(ctx, OWNER).token;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  it("a plan started in Ask is one Herding row with Stop; stop_plan and the Stop endpoint end it", async () => {
    const res = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", Accept: "application/json", "Lykia-Session": token }, body: JSON.stringify({ message: "convert 50 USDC to EURC", owner: OWNER, environment: "mainnet" }) });
    const chat = (await res.json()) as { proposals: { intentId: string | null }[] };
    const intentId = chat.proposals[0]?.intentId;
    assert.ok(intentId, "a stored plan");
    const view = (await (await fetch(`${served.url}/v1/fold/instructions?owner=${OWNER}`, { headers: { "Lykia-Session": token } })).json()) as FoldInstructionsResponse;
    const row = view.instructions.find((i) => i.source === "plan" && i.id === intentId);
    assert.ok(row, "the plan is in Herding");
    assert.deepEqual(row.stop, { intentId });
    // Ask's stop_plan tool and the Fold's Stop button reach the same endpoint logic.
    const tc: ToolContext = { ctx, environment: "mainnet", owner: OWNER, ownerVerified: true, agent: { name: "Lyko", role: "orchestrator", fence: DEFAULT_FENCE, capabilities: ["read", "propose"] }, proposals: [] };
    const stopped = await runTool("stop_plan", { intentId }, tc);
    assert.equal(stopped.ok, true, stopped.summary);
    const after = (await (await fetch(`${served.url}/v1/fold/instructions?owner=${OWNER}`, { headers: { "Lykia-Session": token } })).json()) as FoldInstructionsResponse;
    assert.equal(after.instructions.some((i) => i.id === intentId), false, "a stopped plan leaves Herding");
    const unverified = await runTool("stop_plan", { intentId }, { ...tc, ownerVerified: false });
    assert.match(unverified.summary, /not signed in/u);
    const stopNoProof = await fetch(`${served.url}/v1/intents/${intentId}/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(stopNoProof.status, 401, "Stop needs the owner's proof");
  });

  it("draft_order shows a signable order card with the Fence and beta verdict from draft time", async () => {
    const tc: ToolContext = { ctx, environment: "mainnet", owner: OWNER, ownerVerified: true, agent: { name: "Lyko", role: "orchestrator", fence: DEFAULT_FENCE, capabilities: ["read", "propose"] }, proposals: [], blocks: [] };
    const out = await runTool("draft_order", { kind: "stop-loss", sell: "cirBTC", buy: "USDC", amount: "0.01", triggerPrice: "60000" }, tc);
    assert.equal(out.ok, true, out.summary);
    const card = tc.blocks!.find((b) => b.kind === "order");
    assert.ok(card && card.kind === "order");
    assert.notEqual(card.decision, "deny");
    if (card.decision === "confirm") assert.ok(card.reasons.length > 0, "a confirmation says which rule asks");
    assert.deepEqual(card.input, { kind: "stop-loss", sell: "cirBTC", buy: "USDC", amount: "0.01", triggerPrice: "60000" });
    assert.doesNotMatch(JSON.stringify(tc.blocks), /\/app\/orders/u, "no dead link to the old Orders page");
    // Over the owner's per-step cap: the verdict is a refusal, shown on the card, not a fake allow.
    const big = await runTool("draft_order", { kind: "stop-loss", sell: "cirBTC", buy: "USDC", amount: "5", triggerPrice: "60000" }, { ...tc, blocks: [] });
    assert.match(big.summary, /\(deny\)/u);
  });
});
