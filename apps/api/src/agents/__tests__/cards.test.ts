import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FENCE, FENCE_SCHEMA, type Fence, type IntentGraph } from "@lykia/core";
import { parseAnswerBlock, parseChatStep } from "@lykia/core/api/answer";

import { fenceCard, infoQuestion, quotedRate, stepsFor, trimDecimal } from "../cards.js";
import { LYKO_SYSTEM, type Emit } from "../orchestrator.js";

const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0x89b50855aa3be2f677cd6303cec089b5f319d72a";

describe("answer cards", () => {
  it("reads plain questions about gas, holdings and the EURC rate, never a plan", () => {
    assert.deepEqual(infoQuestion("is my gas low?"), { kind: "gas" });
    assert.deepEqual(infoQuestion("What do I hold?"), { kind: "balance" });
    assert.deepEqual(infoQuestion("show my balance"), { kind: "balance" });
    assert.deepEqual(infoQuestion("what's the EURC rate"), { kind: "rate", base: "USDC", quote: "EURC" });
    for (const plan of ["convert 200 USDC to EURC", "send 5 USDC for gas to 0x1111111111111111111111111111111111111111", "rebalance my portfolio", "keep 5 USDC for gas"]) assert.equal(infoQuestion(plan), null, plan);
  });

  it("prices a conversion on what the input buys after the protocol fee", () => {
    const step = {
      kind: "swap",
      inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "200000000" }],
      outputs: [{ symbol: "EURC", token: EURC, decimals: 6, amount: "176223682" }],
      fee: { bps: 100, recipient: USDC, symbol: "USDC", token: USDC, decimals: 6, amount: "2000000", usd: "2", basis: "input" },
    };
    assert.deepEqual(quotedRate({ steps: [step] } as unknown as IntentGraph), { base: "USDC", quote: "EURC", rate: "0.890018" });
    assert.equal(quotedRate({ steps: [{ ...step, kind: "transfer" }] } as unknown as IntentGraph), null);
  });

  it("builds the Fence gate from the verdict's own rules, with the room under the caps", () => {
    const fence: Fence = { ...DEFAULT_FENCE, schema: FENCE_SCHEMA, caps: { perStepUsd: "1000", dailyUsd: "5000" }, limits: { maxSlippageBps: 50 } };
    const verdict = { decision: "deny", reasons: [{ rule: "caps.step", decision: "deny", message: "5,000 USD is above the per-step cap of 1,000 USD." }, { rule: "tokens.allow", decision: "allow", message: "ok" }] };
    const card = fenceCard({ verdict } as unknown as IntentGraph, fence);
    assert.ok(card && parseAnswerBlock(card));
    assert.deepEqual(card, { kind: "fence", decision: "deny", rules: [{ rule: "caps.step", message: "5,000 USD is above the per-step cap of 1,000 USD." }], headroom: [{ label: "Per step", value: "$1000" }, { label: "Per day", value: "$5000" }, { label: "Max slippage", value: "0.50%" }] });
    assert.equal(fenceCard({ verdict: { ...verdict, decision: "allow" } } as unknown as IntentGraph, fence), null);
  });

  it("trims decimals for display", () => {
    assert.equal(trimDecimal("0.0526260000001"), "0.052626");
    assert.equal(trimDecimal("12.50", 2), "12.5");
    assert.equal(trimDecimal("7"), "7");
  });
});

describe("Lyko at work", () => {
  it("emits one start and one end per step, same id, with the measured time and clipped text", () => {
    const events: { event: string; data: unknown }[] = [];
    const emit: Emit = (event, data) => events.push({ event, data });
    const steps = stepsFor(emit);
    assert.equal(stepsFor(emit), steps, "one stepper per turn");
    const a = steps.start("route", "Searching routes", "FX hedger");
    const b = steps.start("fence", "Checking your Fence");
    b.end("fail", "Refused by caps.step", "x".repeat(900));
    a.end("ok", "Aerodrome · 1 step");
    a.end("warn", "ignored: a step ends once");
    assert.equal(events.length, 4);
    const parsed = events.map((e) => parseChatStep(e.data));
    assert.ok(parsed.every((p) => p !== null), "every step event validates");
    assert.deepEqual(parsed.map((p) => [p!.id, p!.state]), [["s1", "running"], ["s2", "running"], ["s2", "fail"], ["s1", "ok"]]);
    assert.equal(parsed[2]!.detail!.length, 600);
    assert.equal(typeof parsed[3]!.ms, "number");
  });

  it("tells the model to lead with the verdict, then facts, then one next step", () => {
    assert.match(LYKO_SYSTEM, /verdict in one short, confident line/u);
    assert.match(LYKO_SYSTEM, /\*\*Next:\*\*/u);
    assert.match(LYKO_SYSTEM, /show_card/u);
  });
});
