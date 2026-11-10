/**
 * Ask Lyko is right, acts, and never talks nonsense:
 *
 *   - the Fold's sample fixture never reaches an Ask turn;
 *   - with no wallet, an answer about money says it is a sample, first line and card;
 *   - a request to fix loan health is computed in code and ends in a plan or a choice;
 *   - the number guard drops sentences, never patches them: no placeholder can appear;
 *   - tool names, internal terms and remarks about earlier answers never reach the owner;
 *   - short follow-ups are resolved against the thread by code;
 *   - the capability map knows every action, feature, flag, limit and check the code has.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AUTOPILOT_BETA, buildSelfKnowledge, canTargets, DEFAULT_FEE_BPS, DEFAULT_FENCE, FENCE_PRESET_IDS, FLAG_PLAIN, isSampleOwner, knowledgeEntries, LYKIA_TERMS, PREFLIGHT_CHECKS, readKnowledge, SAMPLE_OWNER, samplePositions, STILE_BETA, type Address } from "@lykia/core";
import type { AnswerBlock } from "@lykia/core/api/answer";
import { FEATURE_FLAGS } from "@lykia/core/api/platform";
import { createApp } from "../../app.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { capabilityMap, liveCapabilityMap } from "../../capabilities/map.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { EXECUTABLE_VENUES } from "../../engine/adapters.js";
import { foldPositions, usesFixture } from "../../fold/sample.js";
import { turkishIntent } from "../../language/turkish.js";
import { issueToken } from "../../platform/session.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "../../__tests__/support.js";
import { isActionRequest, readDesk } from "../desk.js";
import { resolveFollowUp, scaleSentence, type ThreadTurn } from "../followUp.js";
import { newGround, recordToolData } from "../grounding.js";
import { healthReport } from "../health.js";
import { setLlmClient } from "../index.js";
import type { LlmClient, LlmRequest, LlmResponse } from "../llm.js";
import { guardNumbers, visibleGround } from "../numberGuard.js";
import { cleanProse, PLACEHOLDER, roundPrices, sampleWording, summaryFromBlocks } from "../prose.js";
import { missingRecipient } from "../chat.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as Address;
const USDC = "0x3600000000000000000000000000000000000000";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

let n = 0;
const toolUse = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `t_${++n}`, name, input, caller: undefined }) as never;
const say = (text: string) => ({ type: "text" as const, text, citations: null }) as never;
const reply = (content: unknown[], stop: LlmResponse["stop_reason"] = "tool_use"): LlmResponse => ({ content: content as LlmResponse["content"], stop_reason: stop });
function scripted(script: LlmResponse[]): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return { model: "test-model", calls, turn: async (request) => (calls.push(request), script[calls.length - 1] ?? reply([say("Nothing more to add.")], "end_turn")) };
}

interface Answer {
  readonly reply: string;
  readonly stopReason: string;
  readonly threadId: string;
  readonly proposals: readonly { readonly steps: readonly string[]; readonly decision: string }[];
  readonly events: readonly { readonly event: string; readonly data: unknown }[];
}
const blocksOf = (a: Answer) => a.events.filter((e) => e.event === "block").map((e) => e.data as AnswerBlock);
const optionsOf = (a: Answer) => ((a.events.filter((e) => e.event === "clarify").pop()?.data as { options?: string[] } | undefined)?.options ?? []);

describe("Ask Lyko: right, acting, never nonsense", () => {
  let ctx: AppContext;
  let served: Served;
  let arc: FakeArc;
  const chat = async (body: Record<string, unknown>, session = false): Promise<Answer> => {
    const res = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...(session ? { "lykia-session": issueToken(ctx, OWNER).token } : {}) }, body: JSON.stringify({ environment: "mainnet", ...body }) });
    return (await res.json()) as Answer;
  };

  before(async () => {
    arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 900_000_000n);
    ctx = createContext(testConfig({ LYKIA_RATE_LIMIT_HEAVY: "100000", LYKIA_RATE_LIMIT_SHARED: "100000" }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  /* --------------------------------------------------- 1. the fixture */

  it("the sample fixture answers only a Fold read for the sample address", async () => {
    assert.equal(usesFixture(SAMPLE_OWNER, "fold"), true);
    assert.equal(usesFixture(SAMPLE_OWNER, "chain"), false);
    assert.equal(usesFixture(OWNER, "fold"), false);
    const fixture = samplePositions(ctx.clock.now(), "mainnet");
    const fold = await foldPositions(ctx, "mainnet", SAMPLE_OWNER, { personal: false, fixture: "fold" });
    const ask = await foldPositions(ctx, "mainnet", SAMPLE_OWNER, { personal: false, fixture: "chain" });
    assert.equal(fold.summary.netUsd, fixture.summary.netUsd);
    assert.notEqual(ask.summary.netUsd, fixture.summary.netUsd, "an Ask read of the sample address goes to the chain");
  });

  it("an Ask turn never shows a fixture card, with a model or without one", async () => {
    setLlmClient(ctx, null);
    const reader = await chat({ message: "Fix the health of my at-risk loans" });
    assert.ok(!JSON.stringify(blocksOf(reader)).includes('"source":"sample"'), "reader path");
    assert.doesNotMatch(reader.reply, /15,470|1\.38/u);
    // The model asks for the positions twice (a tool and a card): still the chain, never the fixture.
    const client = scripted([reply([toolUse("positions", {}), toolUse("show_card", { card: "positions" })]), reply([say("The sample address holds little here.\n\n**Next:** connect a wallet.")], "end_turn")]);
    setLlmClient(ctx, client);
    const model = await chat({ message: "Tell me a story about what this address has been up to lately" });
    setLlmClient(ctx, null);
    assert.ok(client.calls.length >= 1, "the model answered this one");
    assert.ok(!JSON.stringify(blocksOf(model)).includes('"source":"sample"'), "model path");
    assert.doesNotMatch(JSON.stringify(model.events), /15470\.41/u);
  });

  it("what Lyko on watch says about the sample flock never enters a thread Ask reads", async () => {
    setLlmClient(ctx, null);
    const fold = await chat({ message: "What is my Fold worth?", origin: "fold" });
    assert.match(fold.reply, /^\*\*Sample flock, not your wallet\.\*\*/u);
    assert.ok(JSON.stringify(blocksOf(fold)).includes('"source":"sample"'), "the Fold shows its fixture");
    const seen: LlmRequest[] = [];
    setLlmClient(ctx, { model: "test-model", turn: async (request) => (seen.push(request), reply([say("Nothing to add.")], "end_turn")) });
    await chat({ message: "Tell me a story about this thread", threadId: fold.threadId });
    setLlmClient(ctx, null);
    assert.ok(seen.length > 0);
    assert.doesNotMatch(JSON.stringify(seen[0]!.messages), /15,470|sample flock is worth/iu, "the fixture answer is not in the model's history");
  });

  /* ------------------------------------------------ 2. whose wallet */

  it("with no wallet, an answer about money says so in its first line and on a card, and never says your wallet", async () => {
    setLlmClient(ctx, null);
    const a = await chat({ message: "What is my balance?" });
    assert.match(a.reply, /^\*\*Sample address, not your wallet\.\*\*/u);
    const card = blocksOf(a).find((b) => b.kind === "sample");
    assert.ok(card && card.kind === "sample" && /Connect/u.test(card.cta) && isSampleOwner(card.address));
    assert.doesNotMatch(a.reply.replace(/^\*\*[^*]+\*\*/u, ""), /\byour wallet\b|\bYou hold\b|\byour money\b/iu);
    // A model that says "your wallet" anyway is corrected in code.
    setLlmClient(ctx, scripted([reply([say("187.28 USDC sits in your wallet and your floor is 500.\n\n**Next:** tell me what to do with your money.")], "end_turn")]));
    const m = await chat({ message: "Tell me a story about my 187.28 USDC and my 500 floor" });
    setLlmClient(ctx, null);
    assert.match(m.reply, /^\*\*Sample address, not your wallet\.\*\*/u);
    // Claims of ownership go; "your floor" (the rules) and "tell me what to do with your money" (a request) stay.
    assert.doesNotMatch(m.reply.replace(/^\*\*[^*]+\*\*/u, ""), /\bin your wallet\b|\byour wallet (?:holds|has)\b|\byour money is\b|\bYou hold\b/u, m.reply);
    assert.match(m.reply, /the sample wallet/u);
  });

  it("a connected wallet's address reaches the chat: its own balance, no sample label", async () => {
    setLlmClient(ctx, null);
    const a = await chat({ message: "What is my balance?", owner: OWNER });
    assert.doesNotMatch(a.reply, /Sample/u);
    assert.match(a.reply, /\$900\.00/u);
    assert.ok(!blocksOf(a).some((b) => b.kind === "sample"));
  });

  it("sampleWording rewrites claims of ownership about balances and positions, and nothing else", () => {
    assert.equal(sampleWording("You hold $5 in your wallet."), "The sample wallet holds $5 in the sample wallet.");
    assert.equal(sampleWording("Your wallet holds 187.28 USDC and your money is idle."), "The sample wallet holds 187.28 USDC and the sample wallet's money is idle.");
    assert.equal(sampleWording("You have no loans."), "The sample wallet has no loans.");
    // The sentences the live model wrote, which the first rewrite turned into nonsense: left exactly as written.
    for (const kept of [
      "Ready as a proposal: this is a dry run on the sample address, not your money.",
      "Connecting your wallet lets me save it to your account.",
      "Your EURC watch below $1.05 is not saved, because no wallet is connected.",
      "Connect your wallet to sign it.",
      "It stays inside your Fence and your 1.5 floor.",
      "You have to connect a wallet first.",
      "Once your wallet is connected, I plan it.",
    ]) assert.equal(sampleWording(kept), kept, kept);
  });

  it("prices are rounded in prose, and a price only a tool saw is not evidence", () => {
    assert.equal(roundPrices("EURC is $1.11923186 now and $12.123456 later; 49.487503 USDC stays."), "EURC is $1.1192 now and $12.12 later; 49.487503 USDC stays.");
    const ground = newGround("tell me if EURC falls below 1.05");
    recordToolData(ground, { EURC: { usd: "1.11923186" }, fees: [{ fee: "0.2 USDC" }] });
    // The old evidence (anything a tool returned) let both through; what the owner can see does not.
    assert.deepEqual(guardNumbers("EURC is $1.1192 now. The fee is 0.2 USDC.", ground, []).removed, []);
    const seen = visibleGround(ground, { proposals: [{ title: "send", steps: ["Send 20 USDC to 0x11…11"], warnings: [], reasons: [] }], options: [] });
    assert.deepEqual(guardNumbers("EURC is $1.1192 now. The fee is 0.2 USDC. You send 20 USDC. Below 1.05 I tell you.", seen, []).removed, ["$1.1192", "0.2 USDC"]);
  });

  it("the cards that carry a plan's cost and the Fence's limits are valid cards with the code's figures", async () => {
    const { planFactsCard, fenceFactsCard } = await import("../cards.js");
    const { parseAnswerBlock } = await import("@lykia/core/api/answer");
    const usdc = { symbol: "USDC", token: USDC as Address, decimals: 6, usd: null };
    const intent = { createdAt: new Date().toISOString(), steps: [{ kind: "deposit", summary: "Deposit 99 USDC into Aave V4 Main Spoke (supply)", inputs: [{ ...usdc, amount: "99000000" }], outputs: [{ ...usdc, symbol: "USDC@aave", amount: "99000000" }], fee: { bps: 100, recipient: OWNER, symbol: "USDC", token: USDC as Address, decimals: 6, amount: "1000000", usd: "1", basis: "input" }, route: { chosen: { venue: "aave-v4", label: "Aave V4 Main Spoke", apy: "0.0287", tvlUsd: "124600000", risk: "low", executable: true, notes: [] }, alternatives: [{ venue: "morpho-vaults", label: "Morpho Galaxy USDC", apy: "0.0253", tvlUsd: "80000000", risk: "low", executable: true, notes: [] }], reason: "Compared 2 venues." } }] } as never;
    const card = parseAnswerBlock(planFactsCard(intent));
    assert.ok(card && card.kind === "facts", "valid");
    const text = JSON.stringify(card);
    for (const want of ["1 USDC", "1% taken from the amount", "2.87% APY", "$124.6M TVL", "2.53% APY"]) assert.ok(text.includes(want), want);
    // "$124.6M" on the card is evidence for "$124.6M" in prose.
    assert.deepEqual(guardNumbers("Aave pays 2.87% on $124.6M; the fee is 1 USDC.", newGround("x"), [card]).removed, []);
    const fence = parseAnswerBlock(fenceFactsCard(DEFAULT_FENCE, { perStepUsd: "1000", perDayUsd: "5000" }, new Date().toISOString()));
    assert.ok(fence && fence.kind === "facts");
    for (const want of ["$1,000", "$2,500", "$5,000", "$500", "1.00%", "1.5"]) assert.ok(JSON.stringify(fence).includes(want), want);
  });

  it("a send with no recipient is asked by code, never sent to a model", () => {
    assert.deepEqual(missingRecipient("Send 50 USDC"), { amount: "50", token: "USDC" });
    assert.deepEqual(missingRecipient("pay 1,000 dollars"), { amount: "1000", token: "USDC" });
    for (const text of ["Send 50 USDC to 0x1111111111111111111111111111111111111111", "Send 50 USDC to Ayla", "Give my bot $20 a day", "Pay 5 USDC every Friday"]) assert.equal(missingRecipient(text), null, text);
  });

  /* --------------------------------------------------- 3. it acts */

  it("loan health is fixed by arithmetic: enough to pass the floor with a buffer, never more than the wallet holds", () => {
    const res = samplePositions(Date.now(), "mainnet");
    const report = healthReport(res, "1.5");
    assert.equal(report.atRisk.length, 1);
    const fix = report.atRisk[0]!;
    assert.equal(fix.health, "1.38");
    assert.equal(fix.target, "1.55");
    // 600 owed at 1.38: repaying 600 x (1 - 1.38 / 1.55) = 65.81 lifts it to 1.55.
    assert.equal(fix.repay?.amount, "65.81");
    assert.equal(fix.repay?.capped, false);
    assert.ok(Number(fix.repay?.reaches) >= 1.55);
    assert.ok((1.38 * 600) / (600 - 65.81) >= 1.55);
    // No cirBTC in the sample wallet: no collateral move is invented.
    assert.equal(fix.collateral, null);
    // A wallet with 20 USDC can only repay 20, and the answer says what that reaches.
    const poor = { ...res, venues: res.venues.map((v) => (v.venueKind === "wallet" ? { ...v, positions: v.positions.filter((p) => p.symbol === "USDC").map((p) => ({ ...p, amount: "20", valueUsd: "20" })) } : v)) };
    const capped = healthReport(poor, "1.5").atRisk[0]!;
    assert.equal(capped.repay?.amount, "20");
    assert.equal(capped.repay?.capped, true);
    assert.ok(Number(capped.repay?.reaches) < 1.5);
    // A lower floor: nothing is at risk, and the lowest health is reported.
    const calm = healthReport(res, "1.2");
    assert.equal(calm.atRisk.length, 0);
    assert.equal(calm.lowest?.health, "1.38");
  });

  it("verbs that ask Lyko to act are read as requests to act, in English and Turkish", () => {
    for (const text of ["fix my loan health", "improve my health factor", "protect my loan", "rebalance to 60/40", "close my position", "exit everything", "top up my collateral", "reduce my risk", "put my idle money to work", "can you repay my loan?", "riskte olan pozisyonlar\u0131m\u0131 d\u00fczelt"]) assert.equal(isActionRequest(text), true, text);
    for (const text of ["what is a health factor?", "how much does repaying cost?", "where is my money?", "is bridging safe?"]) assert.equal(isActionRequest(text), false, text);
    assert.equal(readDesk("riskte olan lending ve borrowing pozisyonlar\u0131m\u0131n sa\u011fl\u0131\u011f\u0131n\u0131 d\u00fczelt")?.kind, "fix-health");
    assert.equal(readDesk("Fix the health of my at-risk loans")?.kind, "fix-health");
    assert.equal(readDesk("Is my loan safe?")?.kind, "fix-health");
    assert.equal(readDesk("Repay everything")?.kind, "repay-all");
    assert.equal(readDesk("Exit everything to USDC")?.kind, "exit-all");
    assert.equal(readDesk("Move all my idle money to the best vault")?.kind, "idle-to-work");
    assert.equal(readDesk("Undo my last swap")?.kind, "undo-swap");
    assert.equal(readDesk("What did I pay in fees?")?.kind, "fees-paid");
    assert.equal(readDesk("Why did my last plan fail?")?.kind, "why-failed");
    assert.deepEqual(readDesk("Stop the Friday payment"), { kind: "running", action: "stop", words: ["friday", "payment"] });
    assert.equal(readDesk("cuma \u00f6demesini durdur")?.kind, "running");
    assert.equal(readDesk("Buy EURC with 50 USDC every week for 4 weeks")?.kind, "order");
    // A new watch, a new stop-loss and the Whistle keep their own readers.
    for (const text of ["Tell me if my health factor drops below 1.5", "Stop everything", "Sell my cirBTC if it drops 10%", "What is a health factor?", "Convert 100 USDC to EURC"]) assert.equal(readDesk(text), null, text);
  });

  it("a move written in the Fold is planned in the same thread; nothing is planned on the sample flock", async () => {
    setLlmClient(ctx, null);
    const owner = await chat({ message: "Convert 100 USDC to EURC", owner: OWNER, origin: "fold" }, true);
    assert.equal(owner.proposals.length, 1);
    assert.doesNotMatch(owner.reply, /Ask Lyko/u);
    const sample = await chat({ message: "Convert 100 USDC to EURC", origin: "fold" });
    assert.equal(sample.proposals.length, 0);
    assert.match(sample.reply, /sample flock/u);
    assert.doesNotMatch(sample.reply, /Ask Lyko/u);
  });

  it("a running thing is found by name and offered with the control Herding has for it; nothing changes in the chat", async () => {
    setLlmClient(ctx, null);
    const { services } = await import("../../services.js");
    const order = await services(ctx).standing.create({ owner: OWNER, environment: "mainnet", draft: { trigger: { kind: "schedule", every: "week", weekday: "fri", at: "09:00", timezone: "UTC" }, actions: [{ verb: "send", token: "USDC", amount: { exact: "5" }, to: "0x1111111111111111111111111111111111111111" }], text: "Pay 5 USDC rent every Friday" } });
    const a = await chat({ message: "Stop the Friday payment", owner: OWNER }, true);
    const card = blocksOf(a).find((b) => b.kind === "running");
    assert.ok(card && card.kind === "running" && card.items.length === 1);
    assert.equal(card.items[0]!.id, order.id);
    assert.equal(card.items[0]!.control?.action, "pause");
    assert.match(card.items[0]!.control?.path ?? "", /^\/v1\/automations\//u);
    assert.equal((await services(ctx).standing.list(OWNER)).find((o) => o.id === order.id)?.status, "active", "the chat itself changes nothing");
    // Not signed in: private, and said so.
    const anon = await chat({ message: "Stop the Friday payment", owner: OWNER });
    assert.match(anon.reply, /private until you sign in/u);
    assert.equal(blocksOf(anon).length, 0);
    await services(ctx).standing.setStatus(order.id, "cancelled");
  });

  /* ------------------------------------------- 4. the number guard */

  it("the number guard drops the sentence that carries an unsourced figure and keeps the rest whole", () => {
    const ground = newGround("where is my money?");
    recordToolData(ground, { gateway: { unifiedUsdc: "19.4987" }, positions: [{ valueUsd: "4200.00", apy: "6.10" }] });
    const blocks: AnswerBlock[] = [{ kind: "positions", netUsd: "15470.41", weightedApyPercent: "4.05", lowestHealth: "1.38", rows: [], unavailable: [], yearlyYieldUsd: "330.61" }];
    const out = guardNumbers("About 206.76 USDC more sits in Gateway. 19.50 USDC is there now. The vault earns 6.10% on $4,200.\n\n- **Blend:** 5.2%\n- **Net worth:** $15,470.41 with 4.05% weighted\n\n**Next:** expect about $412 a year.", ground, blocks);
    assert.deepEqual(out.removed, ["About 206.76 USDC", "5.2%", "about $412"]);
    assert.equal(out.text, "19.50 USDC is there now. The vault earns 6.10% on $4,200.\n\n- **Net worth:** $15,470.41 with 4.05% weighted");
  });

  it("placeholder phrases can never appear, whatever a model writes", () => {
    const blocks: AnswerBlock[] = [{ kind: "positions", netUsd: "15470.41", weightedApyPercent: null, lowestHealth: null, rows: [], unavailable: [] }];
    const ground = newGround("what can you do");
    const nasty = [
      "My earlier reply (77 positions, 212.88 net, 10.44 in Morpho) did not match this read, which shows 16 positions and 15,470.41 net.",
      "Tell me what to do with the 187.28 USDC in your wallet.",
      "Net is $1 and $2 and $3. Rates are 4.4%, 5.5% and 6.6%.",
      "- **A:** $9,999\n- **B:** 12.5%\n\n**Next:** move 77.7 USDC.",
      "Worth $9,999.",
      "The wallet shows an amount (see the card) and a rate that is unavailable right now.",
      "$5",
    ];
    for (const text of nasty) {
      for (const cards of [blocks, []]) {
        const guarded = guardNumbers(text, ground, cards);
        const final = cleanProse(guarded.text) || summaryFromBlocks(cards);
        if (!PLACEHOLDER.test(text)) assert.doesNotMatch(guarded.text, PLACEHOLDER, `the guard never writes one: ${text}`);
        assert.doesNotMatch(final, PLACEHOLDER, text);
        assert.ok(final.trim().length > 0, "there is always an answer");
        assert.doesNotMatch(final, /\(\s*\)|,\s*,|\s{2,}\.|\bthe an?\b/u, `grammatical: ${final}`);
      }
    }
  });

  it("a model that invents figures gets one retry with the allowed figures; the answer has no placeholder and no invented figure", async () => {
    const client = scripted([
      reply([say("The wallet holds 4,321.09 USDC and earns 7.7%.\n\n**Next:** move 1,234 USDC.")], "end_turn"),
      reply([say("The wallet holds 900 USDC.\n\n**Next:** say what it should do.")], "end_turn"),
    ]);
    setLlmClient(ctx, client);
    const a = await chat({ message: "Tell me a story about my 900 USDC", owner: OWNER });
    setLlmClient(ctx, null);
    assert.equal(client.calls.length, 2, "one retry");
    assert.match(String(client.calls[1]!.messages.at(-1)?.content), /only figures you may state/u);
    assert.equal(client.calls[1]!.tools.length, 0, "the retry reads nothing new");
    assert.equal(a.reply, "The wallet holds 900 USDC.\n\n**Next:** say what it should do.");
    // A retry that invents again: the first answer stands without its offending sentences, or code writes the summary.
    const stubborn = scripted([reply([say("It holds 4,321.09 USDC.")], "end_turn"), reply([say("It holds 8,888 USDC.")], "end_turn")]);
    setLlmClient(ctx, stubborn);
    const b = await chat({ message: "Tell me a story about this wallet", owner: OWNER });
    setLlmClient(ctx, null);
    assert.doesNotMatch(b.reply, PLACEHOLDER);
    assert.doesNotMatch(b.reply, /4,321|8,888/u);
    assert.ok(b.reply.trim().length > 0);
  });

  /* --------------------------------- 5 and 6. internals and self-comments */

  it("tool names, internal terms, self-references and corrections never reach the owner", () => {
    const cleaned = cleanProse(
      "The loan is under the floor.\n\nCorrection: My earlier reply did not match this read, so one of the two is stale.\n\n- **Rates:** I'll rank the options with `yields` before planning anything.\n- **Health:** read on Arc.\n- **Mode:** Your mode is dry-run, so nothing executes.\n\n**Next:** Ask Lyko to plan the repay on Aave V4.",
    );
    assert.equal(cleaned, "The loan is under the floor.\n\n- **Health:** read on Arc.\n\n**Next:** Say “plan the repay on Aave V4”.");
    for (const leak of ["I called plan_intent for you.", "The positions tool returned it.", "See the tool result.", "Per the [lykia-state] block."]) assert.equal(cleanProse(`Fine. ${leak}`), "Fine.", leak);
    // Ordinary words that are also tool names stay.
    assert.equal(cleanProse("Your positions and your Fence look fine, and yields are steady."), "Your positions and your Fence look fine, and yields are steady.");
  });

  it("capability answers are a card built by code, on the model path too, with protocols never counted as actions", async () => {
    const client = scripted([reply([say("I can do 95 mapped actions with 14 routable.")], "end_turn")]);
    setLlmClient(ctx, client);
    const a = await chat({ message: "What can you do?" });
    setLlmClient(ctx, null);
    assert.equal(client.calls.length, 0, "no model round for a capability question");
    const card = blocksOf(a).find((b) => b.kind === "capabilities");
    assert.ok(card && card.kind === "capabilities" && card.sections.length >= 2);
    assert.doesNotMatch(a.reply, /mapped actions|dry-run|Your mode/u);
    const map = capabilityMap("mainnet", ctx);
    assert.ok(a.reply.includes(map.actions.map((x) => x.label.toLowerCase()).join(", ")));
  });

  /* ------------------------------------------------------ 7. latency */

  it("common questions take no model round and one read of each venue", async () => {
    const client = scripted([]);
    setLlmClient(ctx, client);
    for (const message of ["Where is my money?", "What is my balance?", "How is my gas?", "What is the EURC rate?", "What are the fees?", "Fix my loan health", "Put my idle USDC to work"]) await chat({ message, owner: OWNER }, true);
    setLlmClient(ctx, null);
    assert.equal(client.calls.length, 0);
  });

  /* ------------------------------------------------------- follow-ups */

  it("short follow-ups are resolved against the thread by code", () => {
    const thread: ThreadTurn[] = [{ role: "user", text: "Bridge 50 USDC to Arbitrum" }, { role: "assistant", text: "Ready to sign.", proposals: [{ intentId: "out_abcdef", title: "bridge", steps: ["Bridge 49.5 USDC to Arbitrum over CCTP"], decision: "confirm", reasons: [], warnings: [], attribution: [], rationale: "" }] }];
    assert.deepEqual(resolveFollowUp("same but to Base", thread), { kind: "resolved", sentence: "Bridge 50 USDC to Base", how: "your last request, with that one change" });
    assert.equal((resolveFollowUp("half of that", thread) as { sentence: string }).sentence, "Bridge 25 USDC to Arbitrum");
    assert.equal((resolveFollowUp("yar\u0131s\u0131", thread) as { sentence: string }).sentence, "Bridge 25 USDC to Arbitrum");
    assert.equal((resolveFollowUp("double it", thread) as { sentence: string }).sentence, "Bridge 100 USDC to Arbitrum");
    assert.equal((resolveFollowUp("make it 75", thread) as { sentence: string }).sentence, "Bridge 75 USDC to Arbitrum");
    assert.equal(resolveFollowUp("do it", thread).kind, "ready");
    const asked: ThreadTurn[] = [{ role: "user", text: "Bridge 50 USDC" }, { role: "assistant", text: "Bridge to which chain?", options: ["Bridge 50 USDC to Base", "Bridge 50 USDC to Arbitrum"] }];
    assert.equal((resolveFollowUp("the second one", asked) as { sentence: string }).sentence, "Bridge 50 USDC to Arbitrum");
    assert.equal((resolveFollowUp("the last one", asked) as { sentence: string }).sentence, "Bridge 50 USDC to Arbitrum");
    assert.equal(resolveFollowUp("yes", asked).kind, "ask", "two choices: it asks which");
    assert.equal(resolveFollowUp("the fourth one", asked).kind, "ask");
    assert.equal(resolveFollowUp("do it", []).kind, "ask", "nothing before it: it asks what");
    assert.equal(resolveFollowUp("convert 100 USDC to EURC", []).kind, "none");
    assert.equal(resolveFollowUp("do it", [{ role: "user", text: "hello" }, { role: "assistant", text: "Hi." }]).kind, "ask");
    assert.equal(resolveFollowUp("Convert 100 USDC to EURC", thread).kind, "none", "a full request stands on its own");
    // Amounts are scaled by arithmetic; addresses and invoice numbers are left alone.
    assert.equal(scaleSentence("Send 20 USDC to 0x1111111111111111111111111111111111111111 for invoice 12", 0.5), "Send 10 USDC to 0x1111111111111111111111111111111111111111 for invoice 12");
  });

  it("follow-ups work through the chat route and are stored as what they meant", async () => {
    setLlmClient(ctx, null);
    const first = await chat({ message: "Bridge 50 USDC", owner: OWNER }, true);
    assert.equal(first.stopReason, "clarify");
    assert.ok(optionsOf(first).length >= 2);
    const second = await chat({ message: "the second one", owner: OWNER, threadId: first.threadId }, true);
    assert.equal(second.proposals.length, 1);
    assert.match(second.proposals[0]!.steps.join(" "), /Arbitrum/u);
    const third = await chat({ message: "same but to Base", owner: OWNER, threadId: first.threadId }, true);
    assert.match(third.proposals[0]!.steps.join(" "), /Base/u);
  });

  /* --------------------------------------------------- self-knowledge */

  it("the map knows every action, feature, flag, limit and check the code has", async () => {
    const map = await liveCapabilityMap(ctx, "mainnet");
    const k = map.knowledge;
    const all = knowledgeEntries(k);
    // Every executable venue is reachable through an action or a bridge route.
    const venues = new Set([...map.actions.flatMap((a) => a.venues.map((v) => v.id)), ...map.bridges.map((b) => b.id)]);
    for (const id of ["cctp", "gateway"]) if (EXECUTABLE_VENUES.mainnet.has(id)) assert.ok(venues.has(id), id);
    // Every action and feature can be the answer to "can you ...".
    const targets = canTargets(map);
    for (const a of map.actions) assert.ok(targets.some((t) => t.name === a.label && t.words.length > 0), a.id);
    for (const f of map.features) assert.ok(targets.some((t) => t.name === f.name && t.words.length > 0), f.id);
    // Every feature flag has a plain line, and a flag that is off shows in the map.
    for (const flag of FEATURE_FLAGS) assert.ok(FLAG_PLAIN[flag] && (FLAG_PLAIN[flag]!.off.length > 0 || FLAG_PLAIN[flag]!.on), flag);
    assert.ok(k.off.some((e) => e.id === "flag-agents.keeper"), "agents.keeper is off by default and the map says so");
    const halted = buildSelfKnowledge({ environment: "mainnet", flags: { "routing.halt": true } });
    assert.ok(halted.off.some((e) => e.id === "flag-routing.halt"));
    // Every preflight check is in the map.
    assert.deepEqual(map.checks.map((c) => c.id), PREFLIGHT_CHECKS.map((c) => c.id));
    // Every limit the code enforces is in the map, with the code's own figure.
    for (const id of FENCE_PRESET_IDS) assert.ok(k.limits.some((e) => e.id === `fence-${id}`), id);
    const value = (id: string) => k.limits.find((e) => e.id === id)?.value ?? "";
    assert.ok(value("autopilot-ceiling").includes(`$${AUTOPILOT_BETA.perStepUsd}`) && value("autopilot-ceiling").includes(`$${AUTOPILOT_BETA.perDayUsd}`));
    assert.ok(value("stile-ceiling").includes(`$${STILE_BETA.perStepUsd}`) && value("stile-ceiling").includes(`$${STILE_BETA.perDayUsd}`));
    assert.ok(value("beta-cap").includes(Number(ctx.config.beta!.perStepUsd).toLocaleString("en-US")) && value("beta-cap").includes(Number(ctx.config.beta!.perDayUsd).toLocaleString("en-US")));
    for (const id of ["fence-edges", "leash-limits", "order-limits", "watch-limits"]) assert.ok(value(id).length > 0, id);
    // The fee is the deployment's, and what is free is what the fee code exempts.
    assert.equal(k.fees.find((e) => e.id === "lykia-fee")?.value, `${ctx.config.fee.bps / 100}%`);
    assert.equal(ctx.config.fee.bps, DEFAULT_FEE_BPS);
    assert.match(k.fees.find((e) => e.id === "free-moves")?.value ?? "", /repaying, withdrawing/u);
    // Lykia's own words are all in the glossary.
    for (const term of Object.keys(LYKIA_TERMS)) assert.ok(k.glossary.some((e) => e.id === term), term);
    // What is not a route is said to be not a route.
    for (const id of ["perps", "launchpad", "stablefx", "usyc", "x402"]) assert.ok(k.notBuilt.some((e) => e.id === id), id);
    for (const id of ["stablefx", "usyc", "x402"]) assert.match(k.notBuilt.find((e) => e.id === id)!.plain, /not a route/u);
    // Every entry has a source and something to match on; a testnet map has no mainnet beta cap.
    for (const e of all) assert.ok(e.source.length > 0 && e.plain.length > 0 && (e.words.length > 0 || e.topic === "off"), e.id);
    assert.ok(!capabilityMap("testnet", ctx).knowledge.limits.some((e) => e.id === "beta-cap"));
    // A deployment with another fee quotes its own figure.
    assert.equal(buildSelfKnowledge({ environment: "mainnet", feeBps: 30 }).fees[0]!.value, "0.3%");
  });

  it("questions about Lykia itself are read against the map, in English and Turkish", () => {
    const map = capabilityMap("mainnet", ctx);
    const read = (text: string) => readKnowledge(turkishIntent(text), map.knowledge, canTargets(map));
    assert.deepEqual([read("What are the fees?")?.intent, read("What are the fees?")?.entries[0]?.id], ["cost", "lykia-fee"]);
    assert.equal(read("Is repaying free?")?.entries[0]?.id, "free-moves");
    assert.equal(read("What is the most Autopilot can spend?")?.entries[0]?.id, "autopilot-ceiling");
    assert.equal(read("How many watches can I have?")?.entries[0]?.id, "watch-limits");
    assert.equal(read("What is a health factor?")?.entries[0]?.id, "health-factor");
    assert.deepEqual([read("Can you trade perps?")?.verdict, read("Can you trade perps?")?.entries[0]?.id], ["no", "perps"]);
    assert.equal(read("Can you route through StableFX?")?.entries[0]?.id, "stablefx");
    assert.equal(read("Why can't you undo a transaction?")?.entries[0]?.id, "undo");
    assert.equal(read("Can you swap tokens?")?.verdict, "yes");
    assert.equal(read("Is Morpho safe?")?.intent, "safe");
    assert.equal(read("What happens if I get liquidated?")?.entries[0]?.id, "if-liquidated");
    assert.deepEqual([read("Will EURC go up next week?")?.verdict, read("Will EURC go up next week?")?.entries[0]?.id], ["no", "future-prices"]);
    assert.equal(read("Do you hold my money?")?.entries[0]?.id, "non-custodial");
    assert.equal(read("\u00dccretler ne kadar?")?.entries[0]?.id, "lykia-fee");
    assert.equal(read("Sa\u011fl\u0131k fakt\u00f6r\u00fc nedir?")?.entries[0]?.id, "health-factor");
    assert.equal(read("Perp i\u015flemi yapabilir misin?")?.entries[0]?.id, "perps");
    assert.equal(read("EURC y\u00fckselecek mi?")?.entries[0]?.id, "future-prices");
    // A request is not a question about Lykia.
    for (const text of ["Convert 100 USDC to EURC", "Put my idle USDC to work", "hello"]) assert.equal(read(text), null, text);
  });
});
