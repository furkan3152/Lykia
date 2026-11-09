import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FOLD_PREFERENCES, type FoldPreferences } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { FoldAnswerResponse, FoldInsightsResponse, FoldInstructionsResponse, FoldProposal, PreferencesResponse, ThreadSummaryView } from "@lykia/core/api/fold";
import { createApp } from "../../app.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { setLlmClient } from "../../agents/index.js";
import { issueToken } from "../../platform/session.js";
import { services } from "../../services.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "../../__tests__/support.js";
import { computeInsights, type InsightInputs } from "../insights.js";
import { inWords } from "../instructions.js";
import { canMove } from "../proposals.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as const;
const STRANGER = "0x3333333333333333333333333333333333333333" as const;
const USDC = "0x3600000000000000000000000000000000000000";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

function snapshot(partial: Partial<FlockSnapshot> = {}): FlockSnapshot {
  return {
    address: OWNER,
    environment: "testnet",
    at: "2026-11-04T09:00:00.000Z",
    block: "1000",
    totalUsd: "3000",
    holdings: [
      { symbol: "USDC", token: USDC, amount: "2400", usd: "2400", where: "wallet", kind: "token" },
      { symbol: "EURC", token: "0x89b50855aa3be2f677cd6303cec089b5f319d72a", amount: "540", usd: "600", where: "wallet", kind: "token" },
    ],
    gateway: { unifiedUsdc: null },
    health: [],
    native: { usdc18: "2400000000000000000000" },
    prices: { EURC: { usd: "1.11", source: "chainlink:EUR/USD" } },
    notes: [],
    ...partial,
  };
}

function inputs(partial: Partial<InsightInputs> = {}): InsightInputs {
  return { snapshot: snapshot(), preferences: DEFAULT_FOLD_PREFERENCES, minHealthFactor: 1.2, instructions: [], standing: [], pack: [], spentDayUsd: 0, dailyCapUsd: 5000, betaDayUsd: null, intents: [], approvals: [], orders: [], bestLowRiskApy: null, heldApy: null, ...partial };
}

describe("fold insights (pure)", () => {
  it("flags idle USDC above the liquidity floor with a plannable draft and human-labelled figures", () => {
    const list = computeInsights(inputs());
    const idle = list.find((i) => i.kind === "idle-usdc");
    assert.ok(idle);
    assert.equal(idle.severity, "act");
    assert.match(idle.title, /\$1,900/u);
    assert.equal(idle.draft?.sentence, "Put 1900 USDC to work at medium risk");
    assert.ok(idle.figures.every((f) => !/[a-z][A-Z]/u.test(f.label)), "labels are words, not keys");
    const careful = computeInsights(inputs({ preferences: { ...DEFAULT_FOLD_PREFERENCES, risk: "careful", liquidityFloorUsd: "2390" } }));
    assert.equal(careful.find((i) => i.kind === "idle-usdc"), undefined, "under 50 above the floor: quiet");
  });

  it("flags EURC drift from the target mix, the daily cap, agents near budget, unsettled steps and the runway", () => {
    const prefs: FoldPreferences = { ...DEFAULT_FOLD_PREFERENCES, targetMix: { usdcPct: 50, eurcPct: 0, earningPct: 50, bandPct: 5 } };
    const list = computeInsights(
      inputs({
        preferences: prefs,
        spentDayUsd: 4800,
        pack: [{ id: "agt_1", name: "Payroll", role: "payroll", status: "active", budget: { caps: { dailyUsd: "100" }, allocated: {}, free: {}, spent: { dayUsd: "95", weekUsd: "95" } } } as never],
        standing: [{ id: "so_1", text: "Pay rent", every: "week", sendUsd: 1000, active: true }],
        intents: [{ id: "int_1", environment: "testnet", steps: [{ id: "s1", status: "settling", summary: "Bridge 10 USDC to Base", settlement: { kind: "cctp", destination: "base", expectedSeconds: 60 } }] } as never],
      }),
    );
    const kinds = list.map((i) => i.kind);
    for (const k of ["fx-drift", "beta-headroom", "agent-budget", "unsettled", "runway"]) assert.ok(kinds.includes(k as never), k);
    assert.match(list.find((i) => i.kind === "fx-drift")!.draft!.sentence!, /^Convert \d+(\.\d+)? EURC to USDC$/u);
    assert.equal(list[0]!.severity, "act", "act first");
  });

  it("flags health factors near the Fence floor and drafts a quarter repay", () => {
    const snap = snapshot({ health: [{ venue: "aave-v4", healthFactor: "1.25" }], holdings: [...snapshot().holdings, { symbol: "USDC", token: USDC, amount: "400", usd: "-400", where: "aave-v4", kind: "debt" }] });
    const hf = computeInsights(inputs({ snapshot: snap })).find((i) => i.kind === "health-factor");
    assert.equal(hf?.severity, "act");
    assert.equal(hf?.draft?.sentence, "Repay 100 USDC on aave-v4");
  });

  it("describes next runs in words", () => {
    const now = Date.UTC(2026, 10, 4, 9);
    assert.equal(inWords(new Date(now + 3 * 3_600_000).toISOString(), now), "in 3 h");
    assert.equal(inWords(new Date(now + 5 * 86_400_000).toISOString(), now), "in 5 d");
    assert.equal(inWords(null, now), "—");
  });

  it("only allows forward moves in the proposal lifecycle", () => {
    assert.ok(canMove("proposed", "approved") && canMove("approved", "done") && canMove("proposed", "stopped"));
    assert.ok(!canMove("done", "approved") && !canMove("stopped", "proposed") && !canMove("proposed", "done"));
  });
});

describe("fold API", () => {
  let ctx: AppContext;
  let served: Served;
  let token: string;
  const arc = new FakeArc();

  before(async () => {
    arc.setBalance(USDC, OWNER, 2_400_000_000n);
    arc.setBalance("0x3600000000000000000000000000000000000000", OWNER, 2_400_000_000n);
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    setLlmClient(ctx, null);
    // The fake chain answers single reads; the Flock's batched balance read is stubbed with a fixed snapshot.
    services(ctx).flock.snapshot = async (environment, address) => ({ ...snapshot(), environment, address });
    served = await serve(createApp(ctx));
    token = issueToken(ctx, OWNER).token;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, auth = true, headers: Record<string, string> = {}) => {
    const response = await fetch(`${served.url}${path}`, { method, headers: { "content-type": "application/json", ...(auth ? { "Lykia-Session": token } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, body: (await response.json()) as T };
  };

  it("reads insights publicly, and personally for the signed-in owner", async () => {
    const pub = await call<FoldInsightsResponse>("GET", `/v1/fold/insights/${OWNER}?environment=testnet`, undefined, false);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.personal, false);
    assert.ok(pub.body.insights.some((i) => i.kind === "idle-usdc"));
    const mine = await call<FoldInsightsResponse>("GET", `/v1/fold/insights/${OWNER}?environment=testnet`);
    assert.equal(mine.body.personal, true);
    assert.deepEqual(mine.body.brief, { since: null, lines: [] }, "no brief on a first visit");
  });

  it("keeps preferences with effects, validates them and writes the risk through to the profile", async () => {
    assert.equal((await call("GET", "/v1/me/preferences", undefined, false)).status, 401);
    const fresh = await call<PreferencesResponse>("GET", "/v1/me/preferences");
    assert.equal(fresh.body.preferences.liquidityFloorUsd, "500");
    const bad = await call("PUT", "/v1/me/preferences", { targetMix: { usdcPct: 90, eurcPct: 20, earningPct: 0, bandPct: 5 } });
    assert.equal(bad.status, 400);
    const ok = await call<PreferencesResponse>("PUT", "/v1/me/preferences", { risk: "careful", liquidityFloorUsd: "1200", insights: { hidden: ["gas-floor"] } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.preferences.insights.notify, "inbox", "partial objects merge");
    assert.ok(ok.body.effects.some((e) => e.text.includes("idle USDC above 1,200")));
    const profile = await call<{ profile: { risk: string } }>("GET", "/v1/profile");
    assert.equal(profile.body.profile.risk, "low");
    const insights = await call<FoldInsightsResponse>("GET", `/v1/fold/insights/${OWNER}?environment=testnet`);
    assert.match(insights.body.insights.find((i) => i.kind === "idle-usdc")!.title, /\$1,200/u, "the floor applies");
  });

  it("drafts a proposal from an insight on the server, runs its lifecycle, keeps a feed and marks the insight handled", async () => {
    const forged = await call("POST", "/v1/fold/proposals", { owner: OWNER, environment: "testnet", source: { kind: "insight", ref: "nope" } });
    assert.equal(forged.status, 409);
    assert.equal((await call("POST", "/v1/fold/proposals", { owner: STRANGER, environment: "testnet", source: { kind: "insight", ref: "idle-usdc" } })).status, 403);
    const created = await call<FoldProposal>("POST", "/v1/fold/proposals", { owner: OWNER, environment: "testnet", source: { kind: "insight", ref: "idle-usdc" } });
    assert.equal(created.status, 201);
    assert.match(created.body.sentence ?? "", /^Put 1200 USDC to work at low risk$/u);
    assert.ok(["proposed", "stopped"].includes(created.body.status));
    const after = await call<FoldInsightsResponse>("GET", `/v1/fold/insights/${OWNER}?environment=testnet`);
    assert.equal(after.body.insights.find((i) => i.id === "idle-usdc")?.handled, true);

    const chat = await call<FoldProposal>("POST", "/v1/fold/proposals", { owner: OWNER, environment: "testnet", source: { kind: "holding", ref: "USDC" }, sentence: "Convert 10 USDC to EURC" });
    assert.equal(chat.status, 201);
    const id = encodeURIComponent(chat.body.id);
    if (chat.body.status === "proposed") {
      const approved = await call<FoldProposal>("POST", `/v1/fold/proposals/${id}/approve`, { owner: OWNER });
      assert.equal(approved.body.status, "approved");
      const done = await call<FoldProposal>("POST", `/v1/fold/proposals/${id}/done`, { owner: OWNER, note: "Signed in the deck." });
      assert.equal(done.body.status, "done");
      assert.deepEqual(done.body.history.map((h) => h.status), ["proposed", "approved", "done"]);
      assert.equal((await call("POST", `/v1/fold/proposals/${id}/approve`, { owner: OWNER })).status, 409, "done is final");
    }
    const fence = await call<FoldProposal>("POST", "/v1/fold/proposals", { owner: OWNER, environment: "testnet", source: { kind: "fence", ref: null }, title: "Lower the daily cap to $1,000", fencePatch: { caps: { dailyUsd: "1000" } } });
    assert.equal(fence.body.status, "proposed");
    const stopped = await call<FoldProposal>("POST", `/v1/fold/proposals/${encodeURIComponent(fence.body.id)}/stop`, { owner: OWNER });
    assert.equal(stopped.body.status, "stopped");
    const feed = await call<{ entries: { status: string }[] }>("GET", `/v1/fold/feed?owner=${OWNER}`);
    assert.ok(feed.body.entries.length >= 4);
    assert.ok(feed.body.entries.some((e) => e.status === "stopped"));
    const trails = await call<{ items: { kind: string }[]; totals: { feesUsd: string } }>("GET", `/v1/fold/trails?owner=${OWNER}`);
    assert.ok(trails.body.items.some((i) => i.kind === "proposal"));
    // One fee figure: the yield explanation reads the same total the Trails card shows.
    const yieldCard = await call<{ lines: { label: string; value: string }[] }>("GET", `/v1/fold/explain?owner=${OWNER}&question=yield`);
    assert.equal(yieldCard.status, 200);
    const feeLine = yieldCard.body.lines.find((l) => l.label.startsWith("Lykia fees"));
    assert.equal(feeLine?.value, `$${trails.body.totals.feesUsd}`);
  });

  it("lists every instruction in one read model with the proposals waiting for a signature", async () => {
    const alert = await call("POST", "/v1/alerts", { kind: "price-above", token: "EURC", threshold: "1.5", environment: "testnet", channels: ["inbox"] });
    assert.equal(alert.status, 201);
    const view = await call<FoldInstructionsResponse>("GET", `/v1/fold/instructions?owner=${OWNER}`);
    assert.equal(view.status, 200);
    const watch = view.body.instructions.find((i) => i.source === "alert");
    assert.ok(watch);
    assert.equal(watch.sourceLabel, "Watch");
    assert.equal(watch.kind, "watch");
    assert.equal(watch.nextVerdict?.decision, "allow");
    assert.match(watch.editSentence, /^Change my watch/u);
    assert.equal(view.body.counts.waitingSignature, view.body.waiting.length);
    assert.ok(view.body.waiting.every((p) => p.status === "proposed" || p.status === "approved"));
    assert.equal((await call("GET", `/v1/fold/instructions?owner=${OWNER}`, undefined, false)).status, 401);
    const summary = await call<{ counts: { rules: number } }>("GET", `/v1/fold/summary/${OWNER}?environment=testnet`);
    assert.ok(summary.body.counts.rules >= 1);
  });

  it("answers a chip into the shared thread that Ask Lyko continues, and lists threads with their origin", async () => {
    const answered = await call<FoldAnswerResponse>("POST", "/v1/fold/answer", { owner: OWNER, environment: "testnet", question: "whatif", shocks: { EURC: -5 } });
    assert.equal(answered.status, 200);
    assert.match(answered.body.reply, /Nothing is borrowed/u);
    assert.equal(answered.body.artifact.kind, "whatif");
    const chat = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", Accept: "application/json", "Lykia-Session": token }, body: JSON.stringify({ message: "what do I hold?", owner: OWNER, environment: "testnet", threadId: answered.body.threadId, origin: "ask" }) });
    assert.equal(chat.status, 200);
    const threads = await call<{ threads: ThreadSummaryView[] }>("GET", "/v1/me/threads");
    const shared = threads.body.threads.find((t) => t.id === answered.body.threadId);
    assert.ok(shared);
    assert.equal(shared.messages, 4, "both surfaces wrote to the same thread");
    assert.equal(shared.origin, "ask");
    const whatif = await call<{ result: { before: number } }>("GET", `/v1/fold/whatif/${OWNER}?environment=testnet&eurc=-5`, undefined, false);
    assert.ok(whatif.body.result.before > 0);
  });

  it("lets any site read /v1/health, like /v1/stats", async () => {
    const health = await fetch(`${served.url}/v1/health`, { headers: { Origin: "https://status.example" } });
    assert.equal(health.headers.get("access-control-allow-origin"), "*");
  });
});
