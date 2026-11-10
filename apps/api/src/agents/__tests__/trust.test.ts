/**
 * Trust in Lyko's answers: grounded tool arguments, binding route choice,
 * the number guard on prose, and Lyko on watch's read-only, sourced mode.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FENCE, samplePositions, type Address } from "@lykia/core";
import type { AnswerBlock } from "@lykia/core/api/answer";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "../../__tests__/support.js";
import { services } from "../../services.js";
import { issueToken } from "../../platform/session.js";
import { balanceCard, positionsFacts } from "../cards.js";
import { newGround, recordToolData } from "../grounding.js";
import { setLlmClient } from "../index.js";
import type { LlmClient, LlmRequest, LlmResponse } from "../llm.js";
import { guardNumbers } from "../numberGuard.js";
import { runTurn, type Emit } from "../orchestrator.js";
import { runTool, type ToolContext } from "../tools.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as Address;
const RICH = "0x7000000000000000000000000000000000000007" as Address;
const USDC = "0x3600000000000000000000000000000000000000";
const GALAXY = "0x8E357432CC12ff425c36432F312968aEb16112AF";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

let n = 0;
const toolUse = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `tu_${++n}`, name, input, caller: undefined }) as never;
const say = (text: string) => ({ type: "text" as const, text, citations: null }) as never;
const reply = (content: unknown[], stop: LlmResponse["stop_reason"] = "tool_use"): LlmResponse => ({ content: content as LlmResponse["content"], stop_reason: stop });

function scripted(script: LlmResponse[]): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    model: "test-model",
    calls,
    async turn(request) {
      calls.push(request);
      return script[calls.length - 1] ?? reply([say("done")], "end_turn");
    },
  };
}

const dataOf = (content: string) => JSON.parse(/^<tool_data untrusted="true">([\s\S]*)<\/tool_data>$/u.exec(content)?.[1] ?? "null") as Record<string, unknown>;

describe("grounded arguments and binding routes", () => {
  let ctx: AppContext;
  const arc = new FakeArc();
  before(() => {
    arc.setBalance(USDC, OWNER, 500_000_000n);
    arc.setBalance(USDC, RICH, 1_200_000_000n);
    arc.vaultAssets.set(GALAXY.toLowerCase(), 80_000_000_000_000n);
    ctx = createContext(testConfig({ LYKIA_AGENT_MAX_STEPS: "3" }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
  });
  after(() => closeContext(ctx));

  const turn = (client: LlmClient, message: string, events: { event: string; data: unknown }[], owner: Address = OWNER) => {
    const emit: Emit = (event, data) => events.push({ event, data });
    return runTurn({ ctx, client, environment: "mainnet", owner, fence: DEFAULT_FENCE, pack: [], history: [], message, stateLine: "[lykia-state] test", emit });
  };

  it("an amount the owner never said becomes a question, and nothing is planned", async () => {
    const client = scripted([reply([toolUse("plan_intent", { sentence: "deposit 178.2 USDC into Morpho Galaxy" })]), reply([say("Deposited 178.2 USDC.")], "end_turn")]);
    const events: { event: string; data: unknown }[] = [];
    const result = await turn(client, "Put some of my USDC to work at the best yield", events);
    assert.equal(result.stopReason, "clarify");
    assert.equal(result.proposals.length, 0);
    assert.equal(client.calls.length, 1, "the turn ends with the question; the model gets no second try at a guess");
    const clarify = events.find((e) => e.event === "clarify")?.data as { question: string; options: string[] };
    assert.match(clarify.question, /How much USDC should go to work/u);
    assert.ok(clarify.options.length > 0);
    assert.doesNotMatch(result.text, /178\.2/u);
  });

  it("'my idle USDC' is the documented default: what sits above the floor, computed by code", async () => {
    const client = scripted([reply([toolUse("plan_intent", { sentence: "deposit 1199 USDC into Morpho Galaxy" })]), reply([say("Planned.")], "end_turn")]);
    const events: { event: string; data: unknown }[] = [];
    const result = await turn(client, "Put my idle USDC to work at the best yield", events, RICH);
    assert.equal(result.proposals.length, 1, JSON.stringify(events.filter((e) => e.event === "tool" || e.event === "clarify")));
    const p = result.proposals[0]!;
    assert.match(p.rationale, /Idle USDC: 700 above your floor of 500 USD \(wallet 1200\)/u, "1200 USDC in the wallet minus the 500 USD floor");
    assert.match(p.steps.join(" "), /\b693\b/u, "700 less Lykia's 1% fee goes in");
    assert.doesNotMatch(p.steps.join(" "), /1,?199/u);
  });

  it("a venue the model wrote but the owner did not name is dropped: plan_intent plans the route search's winner", async () => {
    const sentence = "deposit 100 USDC into Morpho Galaxy";
    const client = scripted([reply([toolUse("plan_intent", { sentence })]), reply([say("Planned.")], "end_turn")]);
    const result = await turn(client, "Put 100 USDC to work at the best yield", []);
    assert.equal(result.proposals.length, 1);
    const p = result.proposals[0]!;
    assert.match(p.rationale, /Route search winner:/u);
    // The winner, searched again with the same inputs, is the plan's venue: choosing, labelling and planning agree.
    const search = await services(ctx).search.search({ environment: "mainnet", owner: OWNER, actions: [{ verb: "earn", token: "USDC", amount: { exact: "100" } }], fence: DEFAULT_FENCE, proposedByAgent: true, spent: await services(ctx).intents.spent("mainnet", OWNER) });
    assert.ok(search.best);
    assert.match(p.rationale, new RegExp(search.best.label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.deepEqual(p.steps.filter((s) => !/^Approve/u.test(s)), search.best.steps.filter((s) => s.kind !== "approve").map((s) => s.summary));
    for (const alt of search.alternatives) if (alt.score.totalUsd !== null && search.best.score.totalUsd !== null && !(alt.simulation && !alt.simulation.ok)) assert.ok(Number(search.best.score.totalUsd) >= Number(alt.score.totalUsd), `best ${search.best.label} must out-score ${alt.label}`);
    assert.doesNotMatch(search.best.label, /best venue/u, "no label claims a best it did not score");
  });

  it("a venue the owner named is kept, and stated values pass untouched", async () => {
    const client = scripted([reply([toolUse("plan_intent", { sentence: "deposit 100 USDC into morpho" })]), reply([say("Planned.")], "end_turn")]);
    const result = await turn(client, "Put 100 USDC into Morpho", []);
    assert.equal(result.proposals.length, 1);
    assert.doesNotMatch(result.proposals[0]!.rationale, /Route search winner/u);
    assert.match(result.proposals[0]!.steps.join(" "), /Morpho/u);
  });

  it("orders, alerts, watches and automations take only figures the owner gave", async () => {
    const base = { ctx, environment: "mainnet" as const, owner: OWNER, ownerVerified: true, agent: { name: "Lyko", role: "orchestrator" as const, fence: DEFAULT_FENCE, capabilities: ["read", "propose"] as const }, proposals: [], blocks: [] as AnswerBlock[] } satisfies Omit<ToolContext, "ground">;
    const tc = (message: string): ToolContext => ({ ...base, agent: { ...base.agent, capabilities: [...base.agent.capabilities] }, blocks: [], ground: newGround(message) });
    const order = tc("set a stop-loss on my cirBTC");
    const o = await runTool("draft_order", { kind: "stop-loss", sell: "cirBTC", buy: "USDC", amount: "0.01", triggerPrice: "60000" }, order);
    assert.equal(dataOf(o.content).asked !== undefined, true, "the size was invented");
    assert.ok(order.ground?.question);
    const alert = tc("tell me when EURC gets expensive");
    await runTool("create_alert", { kind: "price-above", token: "EURC", threshold: "1.25" }, alert);
    assert.match(alert.ground?.question?.question ?? "", /price/u);
    const watch = tc("watch my Aave loan");
    const w = await runTool("watch_position", { kind: "health-below", threshold: "1.5" }, watch);
    assert.equal(watch.ground?.question, null, "the Fence floor is the documented default");
    assert.equal(dataOf(w.content).saved, true);
    const auto = tc("every friday sweep my idle USDC");
    await runTool("draft_automation", { name: "Sweep", trigger: { type: "schedule", every: "week", weekday: "fri", at: "17:00", timezone: "UTC" }, action: { type: "plan", sentence: "keep 1 USDC liquid and earn the rest" } }, auto);
    assert.match(auto.ground?.question?.question ?? "", /time/u, "17:00 was never said");
    const stated = tc("every friday at 17:00 keep 1 USDC liquid and earn the rest");
    const ok = await runTool("draft_automation", { name: "Sweep", trigger: { type: "schedule", every: "week", weekday: "fri", at: "17:00", timezone: "UTC" }, action: { type: "plan", sentence: "keep 1 USDC liquid and earn the rest" } }, stated);
    assert.equal(stated.ground?.question, null);
    assert.equal(dataOf(ok.content).saved, true);
  });

  it("compile_goal grounds amounts against the owner's words, not the model's restatement", async () => {
    const t: ToolContext = { ctx, environment: "mainnet", owner: OWNER, ownerVerified: false, agent: { name: "Lyko", role: "orchestrator", fence: DEFAULT_FENCE, capabilities: ["read", "propose"] }, proposals: [], drafts: [], programs: [], ground: newGround("keep some USDC liquid and earn on the rest") };
    const out = await runTool("compile_goal", { goal: "keep 400 USDC liquid and earn on the rest" }, t);
    const data = dataOf(out.content);
    assert.ok(Array.isArray(data.questions) && (data.questions as unknown[]).length > 0, JSON.stringify(data));
    assert.doesNotMatch(JSON.stringify(data.now ?? {}), /400/u);
  });
});

describe("the number guard on prose", () => {
  it("drops the sentences that carry invented totals and blended rates, and keeps the sourced ones whole", () => {
    const ground = newGround("where is my money?");
    recordToolData(ground, { gateway: { unifiedUsdc: "19.4987" }, positions: [{ valueUsd: "4200.00", apy: "6.10" }] });
    const blocks: AnswerBlock[] = [{ kind: "positions", netUsd: "15470.41", weightedApyPercent: "4.05", lowestHealth: "1.38", rows: [], unavailable: [], yearlyYieldUsd: "330.61" }];
    const text = "About 206.76 USDC more sits in Gateway. 19.50 USDC is there now. The vault earns 6.10% on $4,200. The blend is 5.2%. Net worth is $15,470.41 with 4.05% weighted. That is about $412 a year.";
    const out = guardNumbers(text, ground, blocks);
    assert.deepEqual(out.removed, ["About 206.76 USDC", "5.2%", "about $412"]);
    assert.equal(out.text, "19.50 USDC is there now. The vault earns 6.10% on $4,200. Net worth is $15,470.41 with 4.05% weighted.");
    // One sentence that mixes sourced and invented figures goes whole: a figure is never cut out of a sentence.
    assert.equal(guardNumbers("19.50 USDC is there now and the blend is 5.2%.", ground, blocks).text, "");
  });

  it("counts, steps and years pass; a sentence with an unsourced figure is dropped, never patched", () => {
    const out = guardNumbers("Ready to sign: 2 steps in 2026, compared 3 venues. It is worth $9,999.", newGround("hi"), []);
    assert.equal(out.text, "Ready to sign: 2 steps in 2026, compared 3 venues.");
    assert.deepEqual(out.removed, ["$9,999"]);
  });

  it("the blended APY and the yearly estimate come from code on the card, not from prose", () => {
    const map = samplePositions(Date.UTC(2026, 10, 9));
    const facts = positionsFacts(map);
    assert.equal(facts.kind, "facts");
    const rows = facts.kind === "facts" ? facts.rows : [];
    assert.equal(rows.find((r) => r.label === "Blended APY on what earns")?.value, `${map.summary.weightedApyPercent}%`);
    assert.equal(rows.find((r) => r.label === "Yearly estimate, net of borrowing")?.value, `$${Number(map.summary.yearlyYieldUsd).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    assert.ok(rows.every((r) => r.from.readAt && "block" in r.from));
  });

  it("unpriced holdings are flagged on the balance card, never counted as $0", () => {
    const card = balanceCard({ address: OWNER, environment: "mainnet", at: "2026-11-09T10:00:00.000Z", block: "29857405", totalUsd: null, holdings: [{ symbol: "USDC", token: USDC as Address, amount: "10", usd: "10", where: "wallet", kind: "token" }, { symbol: "GBPX", token: "0x0000000000000000000000000000000000000009" as Address, amount: "5", usd: null, where: "wallet", kind: "token" }], gateway: { unifiedUsdc: null }, health: [], native: { usdc18: "0" }, prices: {}, notes: [] });
    assert.equal(card?.kind, "balance");
    if (card?.kind !== "balance") return;
    assert.equal(card.totalUsd, null);
    assert.equal(card.unpriced, 1);
    assert.equal(card.holdings.find((h) => h.symbol === "GBPX")?.usd, null);
    assert.deepEqual(card.from, { source: "Arc chain · Chainlink prices", readAt: "2026-11-09T10:00:00.000Z", block: "29857405" });
  });
});

describe("Lyko on watch: read-only and sourced", () => {
  let ctx: AppContext;
  let served: Served;
  const arc = new FakeArc();
  before(async () => {
    arc.setBalance(USDC, OWNER, 2_400_000_000n);
    ctx = createContext(testConfig({ LYKIA_AGENT_MAX_STEPS: "3" }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  it("origin fold sees no planning tools, and its positions read lands as a facts card with source and block", async () => {
    const client = scripted([reply([toolUse("plan_intent", { sentence: "deposit 100 USDC into morpho" }), toolUse("positions", {})]), reply([say("Your Fold is worth $2,400.00 · Arc chain and venue APIs, blended about 7.7%.")], "end_turn")]);
    const events: { event: string; data: unknown }[] = [];
    const emit: Emit = (event, data) => events.push({ event, data });
    const result = await runTurn({ ctx, client, environment: "mainnet", owner: OWNER, fence: DEFAULT_FENCE, pack: [], history: [], message: "what is my Fold worth?", stateLine: "[lykia-state] test", emit, origin: "fold" });
    const names = client.calls[0]!.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["capabilities", "flock", "get_insights", "positions", "prices", "read_instructions", "show_card"]);
    assert.equal(result.proposals.length, 0);
    const refused = JSON.stringify(client.calls[1]!.messages[client.calls[1]!.messages.length - 1]);
    assert.match(refused, /has no tool named plan_intent/u);
    const facts = events.find((e) => e.event === "block" && (e.data as AnswerBlock).kind === "facts")?.data as Extract<AnswerBlock, { kind: "facts" }>;
    assert.ok(facts, "a sourced facts card");
    assert.ok(facts.rows.every((r) => r.from.source.length > 0 && typeof r.from.readAt === "string"));
    assert.equal(facts.rows[0]!.from.block, "1000");
    assert.doesNotMatch(result.text, /7\.7%/u, "an invented blend is removed");
  });

  it("signed out, Lyko on watch answers from the Fold's sample, with no sample-plan prefix and no fake block", async () => {
    setLlmClient(ctx, null);
    const res = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", Accept: "application/json" }, body: JSON.stringify({ message: "How is my Fold doing?", environment: "mainnet", origin: "fold" }) });
    const body = (await res.json()) as { reply: string; events: { event: string; data: unknown }[] };
    assert.doesNotMatch(body.reply, /Sample plan|dry run/u);
    const net = samplePositions(Date.now()).summary.netUsd!;
    assert.ok(body.reply.includes(`$${Number(net).toLocaleString("en-US", { minimumFractionDigits: 2 })}`), body.reply);
    assert.match(body.reply, /sample, not read from Arc/u);
    assert.doesNotMatch(body.reply, /\babout\b|\broughly\b/u);
    const facts = body.events.find((e) => e.event === "block" && (e.data as AnswerBlock).kind === "facts")?.data as Extract<AnswerBlock, { kind: "facts" }>;
    assert.ok(facts.rows.every((r) => r.from.block === null), "the sample carries no block number");
  });

  it("a move written in the Fold is planned and judged like any other, and the owner is never sent to Ask Lyko", async () => {
    setLlmClient(ctx, null);
    const token = issueToken(ctx, OWNER).token;
    const res = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", Accept: "application/json", "Lykia-Session": token }, body: JSON.stringify({ message: "send 20 USDC to 0x1111111111111111111111111111111111111111", owner: OWNER, environment: "mainnet", origin: "fold" }) });
    const body = (await res.json()) as { reply: string; proposals: unknown[] };
    assert.equal(body.proposals.length, 1, "the plan and the Fence's verdict are in the same thread");
    assert.doesNotMatch(body.reply, /only reads|Ask Lyko/u);
  });

  it("chip answers carry where and when each line was read; the stress test totals equal the position map's net", async () => {
    const owner = "0x000000000000000000000000000000000000dEaD";
    const y = await fetch(`${served.url}/v1/fold/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, environment: "mainnet", question: "yield" }) });
    const yieldBody = (await y.json()) as { artifact: { lines: { label: string; from?: { source: string; readAt: string; block: string | null } }[]; summary: string } };
    assert.ok(yieldBody.artifact.lines.every((l) => l.from && l.from.readAt), "every line has its source and read time");
    assert.doesNotMatch(yieldBody.artifact.summary, /\babout\b/u);
    const w = await fetch(`${served.url}/v1/fold/whatif/${owner}?environment=mainnet&eurc=-5`);
    const whatif = (await w.json()) as { result: { before: number; after: number; rows: { label: string; before: number }[] } };
    const map = samplePositions(Date.now());
    assert.equal(whatif.result.before.toFixed(2), map.summary.netUsd);
    const labels = whatif.result.rows.map((r) => r.label);
    assert.equal(new Set(labels).size, labels.length, "one label per row");
    for (const r of whatif.result.rows) assert.equal(Math.round(r.before * 100) / 100, r.before, "no float noise");
  });
});
