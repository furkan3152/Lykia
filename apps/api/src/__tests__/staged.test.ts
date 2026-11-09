/**
 * Staged plans and the hand-offs between Lyko on watch and Ask Lyko:
 * stages from the planner, a step rebuilt from what the step before
 * actually delivered (its receipt), pausing on a refusal or a revert,
 * retrying, resuming from the store, batching a stage into one
 * transaction, the Fence checked again at build time; then agent
 * instructions: the authorization rules, routing, watch transitions, the
 * insight -> plan link and a watch firing an insight.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { canMoveInstruction, checkWatch, DEFAULT_FENCE, moveInstruction, planStages, planStatusOf, readWatchRequest, routingIssue, watchForPlan, type AgentInstruction, type Fence, type IntentGraph } from "@lykia/core";
import { decodeFunctionData, pad } from "viem";
import { createApp } from "../app.js";
import type { PulseFeed } from "../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { MULTICALL3_FROM_ABI } from "../engine/abis.js";
import { receivedOf } from "../engine/service.js";
import { issueToken } from "../platform/session.js";
import { services } from "../services.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "./support.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as const;
const PAYEE = "0x1111111111111111111111111111111111111111" as const;
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const POOL = "0x00000000000000000000000000000000000000f0";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const FENCE: Fence = { ...DEFAULT_FENCE, recipients: { mode: "allowlist", allow: [PAYEE] } };

const transferLog = (token: string, from: string, to: string, value: bigint) => ({ address: token, topics: [TRANSFER, pad(from as `0x${string}`), pad(to as `0x${string}`)], data: `0x${value.toString(16).padStart(64, "0")}` });

let hashSeq = 0;
/** Puts the prepared transaction on the fake chain with a receipt, and returns its hash. */
function land(arc: FakeArc, tx: { to: string; data: string }, receipt: { status: "success" | "reverted"; logs?: unknown[] }): string {
  const hash = `0x${(++hashSeq).toString(16).padStart(64, "0")}`;
  arc.transactions.set(hash, { from: OWNER, to: tx.to, input: tx.data, value: 0n, chainId: 5042 });
  arc.receipts.set(hash, receipt);
  return hash;
}

describe("staged plans", () => {
  let ctx: AppContext;
  let arc: FakeArc;
  let now = Date.UTC(2026, 10, 9, 10, 0); // a Monday, 10:00 UTC
  const s = () => services(ctx).intents;
  const fxThenSend = () => s().create({ environment: "mainnet", owner: OWNER, actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "500" } }, { verb: "send", token: "EURC", amount: { previous: true }, to: PAYEE }], source: "swap then pay it", fence: FENCE });

  before(() => {
    arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 2_000_000_000n);
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch(), clock: { now: () => now } as never });
  });
  after(async () => {
    await closeContext(ctx);
  });

  it("stages a step that spends what the step before delivered apart, and keeps independent steps together", async () => {
    const { intent } = await fxThenSend();
    assert.deepEqual(intent.steps.map((st) => [st.id, st.stage, st.status]), [["s1", 1, "ready"], ["s2", 2, "blocked"]]);
    const plan = planStages(intent);
    assert.equal(plan.total, 2);
    assert.equal(plan.current?.n, 1);
    assert.equal(plan.stages[1]?.state, "next");
    assert.match(plan.headline, /^Step 1 of 2: Convert/u);
    const together = await s().create({ environment: "mainnet", owner: OWNER, actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }, { verb: "send", token: "USDC", amount: { exact: "10" }, to: PAYEE }], source: "two at once", fence: FENCE });
    assert.deepEqual(together.intent.steps.map((st) => st.stage), [1, 1]);
    assert.equal(planStages(together.intent).total, 1);
  });

  it("reads what a step delivered from its receipt, net of what left", () => {
    const step = { outputs: [{ symbol: "EURC", token: EURC as `0x${string}`, decimals: 6, amount: "1", usd: null }] };
    const got = receivedOf([{ status: "success", logs: [transferLog(EURC, POOL, OWNER, 442_610_000n), transferLog(USDC, OWNER, POOL, 1n), transferLog(EURC, OWNER, PAYEE, 10_000n)] }], step, OWNER);
    assert.equal(got?.amount, "442600000");
    assert.equal(receivedOf([{ status: "success", logs: [] }], step, OWNER), undefined);
  });

  it("rebuilds the next step with the amount actually received, not the quote, and charges the fee on it", async () => {
    const { intent } = await fxThenSend();
    const planned = BigInt(intent.steps[1]!.inputs[0]!.amount);
    const p1 = await s().prepare(intent.id, "s1", { confirm: true, stage: true });
    assert.equal(p1.stepIds, undefined, "a dependent step is never batched with the one it depends on");
    arc.setBalance(EURC, OWNER, 442_610_000n);
    const hash = land(arc, p1.transactions[0]!, { status: "success", logs: [transferLog(EURC, POOL, OWNER, 442_610_000n)] });
    const r1 = await s().submit(intent.id, "s1", [hash]);
    assert.equal(r1.step.status, "settled");
    assert.equal(r1.step.received?.amount, "442610000");
    const p2 = await s().prepare(intent.id, "s2", { confirm: true });
    assert.deepEqual(p2.replanned, { symbol: "EURC", planned: planned.toString(), actual: "442610000" });
    const after = (await s().get(intent.id)).intent;
    const s2 = after.steps[1]!;
    assert.equal(s2.inputs[0]!.amount, "442610000");
    assert.equal(s2.fee?.amount, "4426100", "1% of what arrived, taken from it as planned");
    assert.match(s2.summary, /438\.1839 EURC/u);
    assert.equal(planStages(after).current?.replanned?.startsWith("Re-planned with the 442.61 EURC step 1 delivered"), true);
    // A later build reuses the rebuilt step (it is not planned a third time).
    const again = await s().prepare(intent.id, "s2", { confirm: true });
    assert.equal(again.replanned, undefined);
  });

  it("pauses on a refusal at build time, says why, and resumes the same step after a retry and a reload", async () => {
    const { intent } = await fxThenSend();
    const p1 = await s().prepare(intent.id, "s1", { confirm: true });
    arc.setBalance(EURC, OWNER, 0n);
    await s().submit(intent.id, "s1", [land(arc, p1.transactions[0]!, { status: "success", logs: [transferLog(EURC, POOL, OWNER, 442_610_000n)] })]);
    await assert.rejects(() => s().prepare(intent.id, "s2", { confirm: true }), (e: { code?: string }) => e.code === "INSUFFICIENT_BALANCE");
    const paused = (await s().get(intent.id)).intent;
    const plan = planStages(paused);
    assert.equal(plan.paused, true);
    assert.equal(plan.current?.n, 2);
    assert.match(plan.current?.reason ?? "", /needs .* EURC/u);
    assert.equal(plan.stages[0]?.state, "done", "steps already done stay done");
    assert.equal(paused.steps[1]!.transactions, undefined, "nothing later is prepared blindly");
    await s().retry(intent.id, "s2");
    // A reload reads the same plan from the store: the next stage, active again.
    const reloaded = planStages((await services(ctx).intents.get(intent.id)).intent);
    assert.equal(reloaded.paused, false);
    assert.equal(reloaded.current?.n, 2);
    assert.equal(reloaded.current?.state, "active");
    arc.setBalance(EURC, OWNER, 442_610_000n);
    const p2 = await s().prepare(intent.id, "s2", { confirm: true });
    assert.equal(p2.replanned?.actual, "442610000");
  });

  it("pauses a stage whose transaction reverted (nothing moved), and a retry makes it signable again", async () => {
    const { intent } = await fxThenSend();
    const p1 = await s().prepare(intent.id, "s1", { confirm: true });
    const r = await s().submit(intent.id, "s1", [land(arc, p1.transactions[0]!, { status: "reverted" })]);
    assert.equal(r.step.status, "failed");
    assert.equal(planStages((await s().get(intent.id)).intent).paused, true);
    await s().retry(intent.id, "s1");
    assert.equal((await s().get(intent.id)).intent.steps[0]!.status, "ready");
    await assert.rejects(() => s().retry(intent.id, "s1"), (e: { code?: string }) => e.code === "STEP_NOT_READY");
  });

  it("signs a stage of independent steps as one Multicall3From transaction and settles them together", async () => {
    const { intent } = await s().create({ environment: "mainnet", owner: OWNER, actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }, { verb: "send", token: "USDC", amount: { exact: "10" }, to: PAYEE }], source: "two at once", fence: FENCE });
    const p = await s().prepare(intent.id, "s1", { confirm: true, stage: true });
    assert.deepEqual(p.stepIds, ["s1", "s2"]);
    assert.equal(p.transactions.length, 1);
    const inner = decodeFunctionData({ abi: MULTICALL3_FROM_ABI, data: p.transactions[0]!.data }).args[0] as readonly unknown[];
    assert.ok(inner.length >= 4, "approval, fees and both value-moving calls in one batch");
    const r = await s().submit(intent.id, "s1", [land(arc, p.transactions[0]!, { status: "success" })]);
    assert.equal(r.outrun.status, "settled");
    assert.ok((await s().get(intent.id)).intent.steps.every((st) => st.status === "settled"));
  });

  it("checks the Fence again when a stage is built: a schedule that closed refuses it", async () => {
    const weekdays: Fence = { ...FENCE, schedule: { timezone: "UTC", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], from: "09:00", to: "17:00" }] } };
    now = Date.UTC(2026, 10, 9, 10, 0);
    const { intent } = await s().create({ environment: "mainnet", owner: OWNER, actions: [{ verb: "send", token: "USDC", amount: { exact: "10" }, to: PAYEE }], source: "pay", fence: weekdays });
    assert.notEqual(intent.verdict.decision, "deny");
    now = Date.UTC(2026, 10, 9, 20, 0);
    await assert.rejects(() => s().prepare(intent.id, "s1", { confirm: true }), (e: { code?: string }) => e.code === "FENCE_DENIED");
    assert.equal(planStages((await s().get(intent.id)).intent).paused, true);
    now = Date.UTC(2026, 10, 9, 10, 0);
  });
});

describe("agent instructions (core)", () => {
  const base: AgentInstruction = { id: "0xa:ins_0000000000000001", owner: OWNER, environment: "mainnet", from: "ask", to: "watch", kind: "watch", payload: { kind: "watch", condition: { kind: "health-below", threshold: "1.5" }, label: "Health factor below 1.5", fired: 0, lastFiredAt: null, observation: null }, status: "active", threadId: null, createdAt: "x", updatedAt: "x" };

  it("routes plans from Lyko on watch to Ask Lyko and watches the other way", () => {
    assert.equal(routingIssue({ from: "watch", to: "ask", kind: "plan" }), null);
    assert.equal(routingIssue({ from: "ask", to: "watch", kind: "watch" }), null);
    assert.ok(routingIssue({ from: "ask", to: "watch", kind: "plan" }));
    assert.ok(routingIssue({ from: "watch", to: "watch", kind: "watch" }));
  });

  it("allows only the documented moves", () => {
    assert.equal(moveInstruction(base, "paused", "t").status, "paused");
    assert.equal(canMoveInstruction("watch", "removed", "active"), false);
    assert.equal(canMoveInstruction("watch", "active", "planned"), false);
    assert.equal(canMoveInstruction("plan", "planned", "signed"), true);
    assert.equal(canMoveInstruction("plan", "done", "planned"), false);
    assert.throws(() => moveInstruction({ ...base, status: "removed" }, "active", "t"));
  });

  it("reads the common watch phrasings, and leaves moves and price alerts alone", () => {
    assert.deepEqual(readWatchRequest("watch my Aave position and tell me if health drops below 1.5")?.condition, { kind: "health-below", threshold: "1.5", venue: "aave-v4" });
    assert.deepEqual(readWatchRequest("keep an eye on this LP")?.condition, { kind: "lp-out-of-range" });
    const floor = readWatchRequest("alert me if my loan gets risky", "1.8");
    assert.equal(floor?.defaulted, true);
    assert.deepEqual(floor?.condition, { kind: "health-below", threshold: "1.8" });
    assert.equal(readWatchRequest("tell me when EURC is above 1.2"), null);
    assert.equal(readWatchRequest("watch cirBTC and sell half if it drops below 90000"), null);
    assert.equal(readWatchRequest("send 20 USDC to 0x1111111111111111111111111111111111111111"), null);
  });

  it("checks a watch against what the Fold read", () => {
    const facts = { health: [{ venue: "aave-v4", label: "Aave V4 Main Spoke", factor: "1.31" }], ranges: [{ venue: "uniswap-v3", label: "USDC/EURC 0.05%", inRange: false }], wallet: { USDC: 900 }, rates: [] };
    assert.deepEqual(checkWatch({ kind: "health-below", threshold: "1.5" }, facts), { met: true, observation: "Health factor 1.31 on Aave V4 Main Spoke, below 1.5" });
    assert.equal(checkWatch({ kind: "health-below", threshold: "1.2" }, facts).met, false);
    assert.equal(checkWatch({ kind: "lp-out-of-range" }, facts).met, true);
    assert.equal(checkWatch({ kind: "idle-above", token: "USDC", amount: "1000" }, facts).met, false);
    assert.equal(checkWatch({ kind: "apy-below", percent: "4" }, facts).met, false);
  });

  it("follows a plan's status and offers a watch once it settles", () => {
    const graph = (statuses: string[], kind = "borrow", venue = "aave-v4") => ({ steps: statuses.map((status, i) => ({ id: `s${i + 1}`, kind, venue, status })) }) as unknown as IntentGraph;
    assert.equal(planStatusOf(graph(["ready", "blocked"])), "planned");
    assert.equal(planStatusOf(graph(["settled", "ready"])), "signed");
    assert.equal(planStatusOf(graph(["settled", "settled"])), "done");
    assert.deepEqual(watchForPlan(graph(["settled"]), "1.6"), { kind: "health-below", threshold: "1.6", venue: "aave-v4" });
    assert.equal(watchForPlan(graph(["settled"], "transfer", "arc-transfer")), null);
  });
});

/** A fake Arc that also answers the Flock's balance reads (the Fold's insights start there). */
class FoldArc extends FakeArc {
  override asChains() {
    const chains = super.asChains();
    return { ...chains, getBalances: async (_e: string, owner: string, tokens: readonly string[]) => ({ balances: tokens.map((t) => ({ token: t, balance: t === "native" ? 10n ** 18n : (this.balances.get(`${t.toLowerCase()}:${owner.toLowerCase()}`) ?? 0n) })), block: 1000n }) } as unknown as ReturnType<FakeArc["asChains"]>;
  }
}

describe("agent instructions (API)", () => {
  let ctx: AppContext;
  let served: Served;
  let token: string;
  const arc = new FoldArc();

  before(async () => {
    arc.setBalance(USDC, OWNER, 1_000_000_000n);
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
    token = issueToken(ctx, OWNER).token;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = async (method: string, path: string, body?: unknown, auth = true) => {
    const response = await fetch(`${served.url}${path}`, { method, headers: { "content-type": "application/json", ...(auth ? { "Lykia-Session": token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const watchBody = (condition: unknown) => ({ owner: OWNER, environment: "mainnet", kind: "watch", from: "ask", to: "watch", condition });

  it("needs the owner's proof, and refuses a hand-off in the wrong direction", async () => {
    assert.equal((await call("POST", "/v1/agent/instructions", watchBody({ kind: "idle-above", token: "USDC", amount: "100" }), false)).status, 401);
    assert.equal((await call("GET", `/v1/agent/instructions?owner=${OWNER}`, undefined, false)).status, 401);
    assert.equal((await call("POST", "/v1/agent/instructions", { owner: OWNER, kind: "plan", from: "ask", to: "watch", insightId: "idle-usdc" })).status, 400);
    assert.equal((await call("POST", "/v1/agent/instructions", watchBody({ kind: "health-below", threshold: "0.5" }))).status, 400);
  });

  it("creates a watch task once, lists it in Herding, pauses, resumes and removes it", async () => {
    const made = await call("POST", "/v1/agent/instructions", watchBody({ kind: "idle-above", token: "USDC", amount: "100" }));
    assert.equal(made.status, 201);
    const instruction = made.body.instruction as AgentInstruction;
    assert.equal(instruction.status, "active");
    assert.equal(instruction.from, "ask");
    const twice = await call("POST", "/v1/agent/instructions", watchBody({ kind: "idle-above", token: "USDC", amount: "100" }));
    assert.equal((twice.body.instruction as AgentInstruction).id, instruction.id, "the same condition is not set twice");
    const herding = await call("GET", `/v1/fold/instructions?owner=${OWNER}`);
    const row = (herding.body.instructions as { id: string; source: string; sourceLabel: string; kind?: string }[]).find((i) => i.id === instruction.id);
    assert.equal(row?.source, "watch");
    assert.equal(row?.sourceLabel, "Watch");
    assert.equal(row?.kind, "watch");
    const id = encodeURIComponent(instruction.id);
    assert.equal(((await call("POST", `/v1/agent/instructions/${id}/pause`, { owner: OWNER })).body.instruction as AgentInstruction).status, "paused");
    assert.equal(((await call("POST", `/v1/agent/instructions/${id}/resume`, { owner: OWNER })).body.instruction as AgentInstruction).status, "active");
    assert.equal(((await call("POST", `/v1/agent/instructions/${id}/remove`, { owner: OWNER })).body.instruction as AgentInstruction).status, "removed");
    assert.equal((await call("POST", `/v1/agent/instructions/${id}/resume`, { owner: OWNER })).status, 404);
  });

  it("fires an insight marked From Ask Lyko when a watch is met", async () => {
    const made = await call("POST", "/v1/agent/instructions", watchBody({ kind: "idle-above", token: "USDC", amount: "500" }));
    const id = (made.body.instruction as AgentInstruction).id;
    const insights = await call("GET", `/v1/fold/insights/${OWNER}?environment=mainnet`);
    const fired = (insights.body.insights as { kind: string; title: string; origin?: { agent: string; instructionId: string } }[]).find((i) => i.kind === "watch-task");
    assert.equal(fired?.origin?.agent, "ask");
    assert.equal(fired?.origin?.instructionId, id);
    assert.match(fired?.title ?? "", /1000\.00 USDC in the wallet, above 500/u);
    const list = await call("GET", `/v1/agent/instructions?owner=${OWNER}&kind=watch`);
    const saw = (list.body.instructions as AgentInstruction[]).find((i) => i.id === id)!;
    assert.equal((saw.payload as { fired: number }).fired, 1);
    // Still met on the next read: it does not fire twice in a row.
    await call("GET", `/v1/fold/insights/${OWNER}?environment=mainnet`);
    const again = (await call("GET", `/v1/agent/instructions?owner=${OWNER}&kind=watch`)).body.instructions as AgentInstruction[];
    assert.equal((again.find((i) => i.id === id)!.payload as { fired: number }).fired, 1);
  });

  it("hands an insight to Ask Lyko as a staged plan on the shared thread, and the insight shows it", async () => {
    // Aim for 40% EURC: the Fold's currency-mix insight drafts a conversion.
    assert.equal((await call("PUT", "/v1/me/preferences", { targetMix: { usdcPct: 30, eurcPct: 40, earningPct: 30, bandPct: 5 } })).status, 200);
    const insights = await call("GET", `/v1/fold/insights/${OWNER}?environment=mainnet`);
    const drift = (insights.body.insights as { id: string; kind: string; draft: { sentence: string | null } | null }[]).find((i) => i.kind === "fx-drift");
    assert.ok(drift?.draft?.sentence);
    const sent = await call("POST", "/v1/agent/instructions", { owner: OWNER, environment: "mainnet", kind: "plan", from: "watch", to: "ask", insightId: drift.id });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const instruction = sent.body.instruction as AgentInstruction;
    const proposal = sent.body.proposal as { intentId: string; from: { agent: string; instructionId: string } };
    assert.equal(instruction.status, "planned");
    assert.equal(proposal.from.agent, "watch");
    assert.equal(proposal.from.instructionId, instruction.id);
    assert.ok(proposal.intentId.startsWith("out_"));
    const thread = await call("GET", `/v1/agent/threads/${encodeURIComponent(sent.body.threadId as string)}?owner=${OWNER}`);
    const last = (thread.body.messages as { origin?: string; instruction?: { from: string; to: string }; proposals?: unknown[] }[]).at(-1)!;
    assert.deepEqual([last.origin, last.instruction?.from, last.instruction?.to, last.proposals?.length], ["fold", "watch", "ask", 1]);
    const after = await call("GET", `/v1/fold/insights/${OWNER}?environment=mainnet`);
    const marked = (after.body.insights as { id: string; sent?: { status: string; intentId: string } }[]).find((i) => i.id === drift.id);
    assert.equal(marked?.sent?.status, "planned");
    assert.equal(marked?.sent?.intentId, proposal.intentId);
    // Once a step of its plan settles, the instruction reads as signed.
    const svc = services(ctx).intents;
    const p = await svc.prepare(proposal.intentId, "s1", { confirm: true });
    const hash = `0x${"77".repeat(32)}`;
    arc.transactions.set(hash, { from: OWNER, to: p.transactions[0]!.to, input: p.transactions[0]!.data, value: 0n, chainId: 5042 });
    arc.receipts.set(hash, { status: "success" });
    await svc.submit(proposal.intentId, "s1", [hash]);
    const listed = (await call("GET", `/v1/agent/instructions?owner=${OWNER}&kind=plan`)).body.instructions as AgentInstruction[];
    assert.ok(["signed", "done"].includes(listed.find((i) => i.id === instruction.id)!.status));
  });

  it("takes a watch request in chat and hands it to Lyko on watch", async () => {
    const response = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "Lykia-Session": token }, body: JSON.stringify({ message: "Keep an eye on my Uniswap LP", owner: OWNER, environment: "mainnet" }) });
    const body = (await response.json()) as { reply: string; events: { event: string; data: { kind?: string; items?: { kind: string }[] } }[] };
    assert.match(body.reply, /Lyko on watch has it/u);
    assert.ok(body.events.some((e) => e.event === "block" && e.data.kind === "herded" && e.data.items?.[0]?.kind === "watch"));
    const list = await call("GET", `/v1/agent/instructions?owner=${OWNER}&kind=watch`);
    assert.ok((list.body.instructions as AgentInstruction[]).some((i) => (i.payload as { label: string }).label === "Liquidity out of range on Uniswap"));
  });
});
