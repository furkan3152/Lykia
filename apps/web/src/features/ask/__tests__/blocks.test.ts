import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gasShortfall, MAX_BLOCKS, parseAnswerBlock, parseAnswerBlocks, parseChatStep } from "@lykia/core/api/answer";
import type { AnswerBlock, ChatStep } from "@lykia/core/api/agents";

import { assistantDraft, EMPTY, reduce, userMessage, type Conversation } from "../model";
import { avatarState, formatMs, trailSteps, trailSummary } from "../workTrail";

const ADDR = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f";
const TX = "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const VALID: readonly AnswerBlock[] = [
  { kind: "gas", balance: "0.0412", floor: "0.5", address: ADDR, gasPriceGwei: "20" },
  { kind: "gas", balance: "3", floor: "0.5", address: null, gasPriceGwei: null },
  { kind: "fence", decision: "deny", rules: [{ rule: "caps.step", message: "Above the per-step cap." }], headroom: [{ label: "Per step", value: "$1,000" }] },
  { kind: "balance", totalUsd: "12480.2", holdings: [{ symbol: "USDC", amount: "8210.5", usd: "8210.5", where: "wallet" }, { symbol: "USYC", amount: "1", usd: null, where: "wallet" }] },
  { kind: "rate", base: "USDC", quote: "EURC", rate: "0.889", reference: "0.8889", bandBps: 50, source: "Chainlink EURC/USD" },
  { kind: "herded", items: [{ kind: "automation", label: "Friday sweep", saved: true, href: "/app/fold/herding?show=rounds", next: "every Friday at 17:00" }] },
  { kind: "settled", summary: "250 USDC to Ayla", tx: TX },
];

describe("answer block schemas", () => {
  it("accepts every well-formed card unchanged", () => {
    for (const b of VALID) assert.deepEqual(parseAnswerBlock(b), b, b.kind);
  });

  it("drops extra fields", () => {
    const parsed = parseAnswerBlock({ ...VALID[0], html: "<script>", onclick: "x" });
    assert.deepEqual(parsed, VALID[0]);
  });

  it("refuses off-shape cards", () => {
    const bad: unknown[] = [
      null,
      "gas",
      { kind: "weather" },
      { kind: "gas", balance: "lots", floor: "0.5", address: null, gasPriceGwei: null },
      { kind: "gas", balance: "1", floor: "0.5", address: "0x123", gasPriceGwei: null },
      { kind: "fence", decision: "allow", rules: [{ rule: "x", message: "y" }] },
      { kind: "fence", decision: "deny", rules: [] },
      { kind: "fence", decision: "deny", rules: Array.from({ length: 7 }, () => ({ rule: "x", message: "y" })) },
      { kind: "balance", totalUsd: "NaN", holdings: [] },
      { kind: "balance", totalUsd: null, holdings: [{ symbol: "<b>", amount: "1", usd: null, where: "wallet" }] },
      { kind: "rate", base: "USDC", quote: "EURC", rate: "0.9", reference: null, bandBps: -1, source: null },
      { kind: "herded", items: [{ kind: "alert", label: "x", saved: false, href: "https://evil.example", next: null }] },
      { kind: "herded", items: [{ kind: "alert", label: "x", saved: false, href: "javascript:alert(1)", next: null }] },
      { kind: "herded", items: [{ kind: "alert", label: "x", saved: false, href: "//evil.example/app", next: null }] },
      { kind: "settled", summary: "ok", tx: ADDR },
    ];
    for (const b of bad) assert.equal(parseAnswerBlock(b), null, JSON.stringify(b));
  });

  it("keeps at most MAX_BLOCKS valid cards from a list", () => {
    const list = [...VALID, ...VALID, { kind: "nope" }];
    const parsed = parseAnswerBlocks(list);
    assert.equal(parsed.length, MAX_BLOCKS);
    assert.deepEqual(parseAnswerBlocks("not a list"), []);
  });

  it("measures the gas shortfall", () => {
    assert.equal(gasShortfall({ balance: "0.0412", floor: "0.5" }), "0.4588");
    assert.equal(gasShortfall({ balance: "3", floor: "0.5" }), "0");
  });

  it("validates steps", () => {
    const ok: ChatStep = { id: "s1", kind: "route", label: "Searching routes", state: "ok", result: "Aerodrome · 1 step", ms: 2140, agent: "FX hedger" };
    assert.deepEqual(parseChatStep(ok), ok);
    assert.equal(parseChatStep({ ...ok, kind: "teleport" }), null);
    assert.equal(parseChatStep({ ...ok, state: "maybe" }), null);
    assert.equal(parseChatStep({ ...ok, label: "" }), null);
    assert.equal(parseChatStep({ ...ok, ms: -4 }), null);
    assert.equal(parseChatStep({ ...ok, label: "x".repeat(81) }), null);
  });
});

describe("Lyko at work", () => {
  const start = (): Conversation => ({ ...EMPTY, messages: [userMessage("convert 200 USDC to EURC"), assistantDraft(1000)] });

  it("upserts a step by id as it starts and ends, and collects valid cards", () => {
    let c = start();
    c = reduce(c, { event: "step", data: { id: "s1", kind: "intent", label: "Reading your request", state: "running" } });
    c = reduce(c, { event: "step", data: { id: "s1", kind: "intent", label: "Reading your request", state: "ok", result: "1 action: fx", ms: 40 } });
    c = reduce(c, { event: "step", data: { id: "s2", kind: "route", label: "Searching routes", state: "running" } });
    c = reduce(c, { event: "block", data: VALID[4]! });
    c = reduce(c, { event: "block", data: VALID[4]! });
    c = reduce(c, { event: "block", data: { kind: "rate", rate: "lots" } as never });
    const m = c.messages[1]!;
    assert.deepEqual(m.steps!.map((s) => [s.id, s.state]), [["s1", "ok"], ["s2", "running"]]);
    assert.equal(m.blocks!.length, 1, "a duplicate and an invalid card are dropped");
    assert.equal(avatarState(m), "sniffing");
    c = reduce(c, { event: "done", data: { threadId: "t", stopReason: "stopped" } });
    const done = c.messages[1]!;
    assert.equal(done.steps![1]!.state, "warn", "a step still running when the stream ends is marked, not faked as done");
    assert.equal(done.streaming, false);
  });

  it("keeps the model's interim words out of the trail", () => {
    let c = start();
    c = reduce(c, { event: "thinking-summary", data: { agent: "Lyko", text: "Your gas is low. Why it matters: …" } });
    const m = c.messages[1]!;
    assert.equal(m.trail.length, 0);
    assert.deepEqual(m.notes, ["Your gas is low. Why it matters: …"]);
  });

  it("reads legacy events as steps when the server sends no step events", () => {
    let c = start();
    c = reduce(c, { event: "reading", data: { what: "flock", ok: true } });
    c = reduce(c, { event: "tool", data: { agent: "FX hedger", name: "plan_intent", ok: false, summary: "No route" } });
    const steps = trailSteps(c.messages[1]!);
    assert.deepEqual(steps.map((s) => [s.kind, s.state]), [["wallet", "ok"], ["route", "fail"]]);
  });

  it("summarises the trail and picks the avatar's state", () => {
    const steps: ChatStep[] = [
      { id: "a", kind: "intent", label: "x", state: "ok" },
      { id: "b", kind: "wallet", label: "x", state: "warn" },
      { id: "c", kind: "route", label: "x", state: "ok" },
      { id: "d", kind: "fence", label: "x", state: "ok" },
    ];
    assert.equal(trailSummary(steps, 1800), "Checked 4 things · 1 flag · 1.8s");
    assert.equal(trailSummary(steps.slice(0, 1)), "Checked 1 thing");
    assert.equal(formatMs(640), "640ms");
    assert.equal(formatMs(12_400), "12s");
    const base = { streaming: false, trail: [], proposals: [], blocks: [] as AnswerBlock[] };
    assert.equal(avatarState({ ...base, steps: steps.filter((s) => s.state === "ok") }), "done");
    assert.equal(avatarState({ ...base, steps }), "warning");
    assert.equal(avatarState({ ...base, steps: [], error: "offline" }), "warning");
    assert.equal(avatarState({ ...base, streaming: true, steps: steps.slice(0, 1) }), "found");
  });
});
