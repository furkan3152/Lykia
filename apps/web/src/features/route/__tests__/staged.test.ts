import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planStages, type IntentGraph, type IntentStep } from "@lykia/core";

import { handoffLine } from "../../ask/model";
import { reviewView } from "../reviewModel";
import { STAGE_START, stageHeadline, stageReduce, type StageState } from "../stagedFlow";

const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const USDC = "0x3600000000000000000000000000000000000000";

function step(id: string, stage: number, status: IntentStep["status"], over: Partial<IntentStep> = {}): IntentStep {
  return {
    id,
    kind: id === "s1" ? "fx" : "deposit",
    venue: id === "s1" ? "uniswap-v4" : "morpho-vaults",
    summary: id === "s1" ? "Swap 500 USDC → EURC on Uniswap v4" : "Deposit into Morpho",
    signer: "wallet",
    account: "0x1111111111111111111111111111111111111111",
    dependsOn: id === "s1" ? [] : ["s1"],
    inputs: [id === "s1" ? { symbol: "USDC", token: USDC, decimals: 6, amount: "500000000", usd: "500" } : { symbol: "EURC", token: EURC, decimals: 6, amount: "440400000", usd: null }],
    outputs: [id === "s1" ? { symbol: "EURC", token: EURC, decimals: 6, amount: "443000000", minimum: "440400000", usd: null } : { symbol: "EURC@morpho-vaults", token: EURC, decimals: 6, amount: "440400000", usd: null }],
    settlement: { kind: "receipt" },
    status,
    stage,
    ...over,
  } as IntentStep;
}

function graph(steps: IntentStep[]): IntentGraph {
  return { spec: "lykia.intent/v1", id: "out_staged01", environment: "mainnet", createdAt: "2026-11-08T10:00:00Z", source: "swap then deposit", owner: "0x1111111111111111111111111111111111111111", steps, verdict: { decision: "allow", signable: true, reasons: [], waived: [], digest: `sha256:${"0".repeat(64)}`, fenceHash: `sha256:${"1".repeat(64)}` }, warnings: [] } as unknown as IntentGraph;
}

const received = { symbol: "EURC", token: EURC, decimals: 6, amount: "442610000", usd: null } as const;
const start = graph([step("s1", 1, "ready"), step("s2", 2, "blocked")]);
const afterOne = graph([step("s1", 1, "settled", { received }), step("s2", 2, "ready")]);
const rebuilt = graph([step("s1", 1, "settled", { received }), step("s2", 2, "awaiting-signature", { inputs: [{ ...received }], replanned: { symbol: "EURC", planned: "440400000", actual: "442610000", at: "t" } })]);
const fold = (state: StageState, g: IntentGraph) => stageReduce(state, { type: "graph", plan: planStages(g), decision: "allow", signable: true });

describe("staged plans: the view", () => {
  it("shows step 1 active and step 2 next, and the modal scopes the figures to the current stage", () => {
    const plan = planStages(start);
    assert.equal(plan.headline, "Step 1 of 2: Swap 500 USDC → EURC on Uniswap v4");
    assert.deepEqual(plan.stages.map((s) => s.state), ["active", "next"]);
    const view = reviewView(start, null);
    assert.deepEqual(view.send.map((f) => `${f.amount} ${f.symbol}`), ["500 USDC"]);
    assert.deepEqual(view.get.map((f) => f.symbol), ["EURC"]);
  });

  it("after step 1 settles, step 2 is current with what actually arrived", () => {
    const plan = planStages(rebuilt);
    assert.equal(plan.current?.n, 2);
    assert.equal(plan.stages[0]?.received, "442.61 EURC");
    assert.match(plan.current?.replanned ?? "", /^Re-planned with the 442\.61 EURC step 1 delivered \(planned 440\.4\)/u);
    assert.deepEqual(reviewView(rebuilt, null).send.map((f) => `${f.amount} ${f.symbol}`), ["442.61 EURC"]);
  });

  it("names a paused step and its reason", () => {
    const paused = planStages(graph([step("s1", 1, "settled", { received }), step("s2", 2, "ready", { failure: { code: "FENCE_DENIED", message: "Your Fence refuses this step now: the daily cap is spent.", retryable: true } })]));
    assert.equal(paused.paused, true);
    assert.equal(paused.headline, "Paused at step 2 of 2");
    assert.equal(paused.stages[0]?.state, "done");
    assert.match(paused.current?.reason ?? "", /daily cap/u);
  });
});

describe("staged plans: the modal's stage machine", () => {
  it("walks review → signing → settling → advancing → review of the next stage", () => {
    let s = fold(STAGE_START, start);
    assert.deepEqual([s.mode, s.stage, s.total], ["review", 1, 2]);
    s = stageReduce(s, { type: "phase", phase: "signing" });
    assert.equal(s.mode, "signing");
    s = stageReduce(s, { type: "phase", phase: "submitting" });
    assert.equal(s.mode, "settling");
    s = fold(s, afterOne);
    assert.equal(s.mode, "advancing");
    assert.deepEqual(s.settled, { n: 1, received: "442.61 EURC" });
    s = fold(s, rebuilt);
    s = stageReduce(s, { type: "phase", phase: "quoted" });
    assert.deepEqual([s.mode, s.stage], ["review", 2]);
    assert.match(s.replanned ?? "", /442\.61 EURC/u);
    assert.equal(stageHeadline(s, "Deposit into Morpho"), "Step 2 of 2: Deposit into Morpho");
  });

  it("pauses when the wallet refuses, holds the pause until a retry, and can stop", () => {
    let s = fold(STAGE_START, start);
    s = stageReduce(s, { type: "failed", reason: "You cancelled in the wallet." });
    assert.equal(s.mode, "paused");
    s = fold(s, start);
    assert.equal(s.mode, "paused", "a fresh read of the plan does not unpause a refusal");
    s = stageReduce(s, { type: "retry" });
    assert.equal(s.mode, "review");
    assert.equal(stageReduce(s, { type: "stop" }).mode, "stopped");
  });

  it("resumes at the right stage after a reload, paused or not", () => {
    assert.deepEqual([fold(STAGE_START, rebuilt).mode, fold(STAGE_START, rebuilt).stage], ["review", 2]);
    const serverPaused = graph([step("s1", 1, "failed", { failure: { code: "RECEIPT_REVERTED", message: "The transaction reverted on Arc, so nothing moved.", retryable: true } }), step("s2", 2, "blocked")]);
    const s = fold(STAGE_START, serverPaused);
    assert.deepEqual([s.mode, s.stage], ["paused", 1]);
    assert.match(s.pause?.reason ?? "", /nothing moved/u);
    assert.equal(fold(STAGE_START, graph([step("s1", 1, "settled"), step("s2", 2, "settled")])).mode, "done");
  });

  it("reads a hand-off compactly", () => {
    assert.equal(handoffLine({ id: "x", from: "watch", to: "ask", kind: "plan", label: "Repay" }), "Lyko on watch → Ask Lyko · plan");
    assert.equal(handoffLine({ id: "x", from: "ask", to: "watch", kind: "watch", label: "Health" }), "Ask Lyko → Lyko on watch · watch task");
  });
});
