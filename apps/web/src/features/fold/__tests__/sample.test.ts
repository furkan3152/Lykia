import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyFoldShocks, NO_SHOCK, samplePositions as coreSamplePositions, shockInputsFromPositions, stressAnswer, summarizePositions } from "@lykia/core";
import type { AnswerBlock } from "@lykia/core/api/answer";
import type { WhistleItem } from "@lykia/core/api/fold";

import { controlRoute, countsOf, kindOf, countsLine, filterInstructions, sampleInsights, sampleInstructions, sampleSnapshot, sampleWaiting, whistleGroups } from "../model";
import { samplePositions } from "../positionsModel";
import { cancelReviewView, orderReviewView, signableOrder } from "../../route/orderReview";

const NOW = Date.UTC(2026, 10, 9, 10);

describe("the signed-out Fold: one sample everywhere", () => {
  it("the Fold bar, the Flock tab, the Stress test and Lyko on watch show the same net worth", () => {
    const map = samplePositions(NOW);
    const bar = Number(summarizePositions(map.venues).pricedNetUsd); // FoldPage: the bar uses the map's net once every venue answered
    const flockTab = Number(map.summary.netUsd); // PositionMap's headline
    const snapshot = Number(sampleSnapshot(NOW).totalUsd); // the Flock snapshot fallback, and the allocation strip
    const stress = shockInputsFromPositions(map.venues);
    const stressNow = stressAnswer(stress.holdings, stress.health, NO_SHOCK, "Now").before; // the Stress test's "worth now"
    const watch = Number(coreSamplePositions(NOW).summary.netUsd); // the API's Lyko on watch reads core's fixture for the sample address
    for (const [name, v] of [["Flock tab", flockTab], ["snapshot", snapshot], ["Stress test", Math.round(stressNow * 100) / 100], ["Lyko on watch", watch]] as const) assert.equal(v, bar, `${name} agrees with the Fold bar`);
    assert.equal(applyFoldShocks(sampleSnapshot(NOW).holdings, [], NO_SHOCK).before, bar);
  });

  it("nothing in the sample claims a block number", () => {
    const map = samplePositions(NOW);
    assert.equal(map.block, null);
    assert.ok(map.venues.every((v) => v.block === null && v.positions.every((p) => p.block === null)));
    assert.equal(sampleSnapshot(NOW).block, null);
  });

  it("the bar's counts are the lists' counts: 'drafts wait' is exactly what Herding shows", () => {
    const instructions = sampleInstructions(NOW);
    const waiting = sampleWaiting(NOW);
    const counts = countsOf(instructions, waiting);
    assert.equal(counts.proposalsWaiting, waiting.length);
    assert.ok(waiting.length > 0, "the sample's inbox is not empty, so Herding never says 'Nothing waits' beside '1 draft waits'");
    assert.equal(counts.ordersWaiting, filterInstructions(instructions, "order").length);
    assert.equal(counts.agentsWorking, filterInstructions(instructions, "leash").filter((i) => i.status === "active").length);
    assert.equal(counts.rules, instructions.filter((i) => i.status === "active" && !["order", "plan", "leash"].includes(kindOf(i))).length);
    assert.match(countsLine(counts), new RegExp(`${waiting.length} draft`, "u"));
  });

  it("the sample's insights read their figures from the same fixture", () => {
    const usdc = Number(sampleSnapshot(NOW).holdings.find((h) => h.where === "wallet" && h.symbol === "USDC")!.usd);
    const idle = sampleInsights(NOW).find((i) => i.id === "idle-usdc")!;
    assert.equal(idle.figures.find((f) => f.label === "USDC in your wallet")?.value, `$${usdc.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    assert.ok(sampleInsights(NOW).every((i) => i.from?.source === "sample" && i.from.block === null));
  });

  it("Herding offers Stop on the plan in progress and Cancel on the open order", () => {
    const list = sampleInstructions(NOW);
    assert.ok(list.find((i) => i.source === "plan")?.stop);
    assert.ok(list.find((i) => i.source === "order")?.cancel);
    assert.equal(filterInstructions(list, "plan").length, 1);
  });
});

describe("Herding's controls reach real endpoints", () => {
  it("remove is DELETE on the owner's automation route; watches use their own route; orders and plans are not paused", () => {
    assert.deepEqual(controlRoute({ id: "atm_1", source: "automation" }, "remove"), { method: "delete", path: "/v1/automations/atm_1", body: "none", query: "owner" });
    assert.deepEqual(controlRoute({ id: "al_1", source: "alert" }, "pause"), { method: "post", path: "/v1/automations/al_1/pause", body: "none", query: "owner" });
    assert.deepEqual(controlRoute({ id: "0xabc:ins_1", source: "watch" }, "remove"), { method: "post", path: "/v1/agent/instructions/0xabc%3Ains_1/remove", body: "owner", query: "none" });
    assert.equal(controlRoute({ id: "0xhash", source: "order" }, "remove"), null);
    assert.equal(controlRoute({ id: "out_1", source: "plan" }, "pause"), null);
  });
});

describe("orders and the Whistle in the review", () => {
  const block: Extract<AnswerBlock, { kind: "order" }> = { kind: "order", summary: "Stop-loss: sell 0.01 cirBTC when BTC/USD ≤ 60000", environment: "mainnet", decision: "confirm", reasons: ["Anything above $500 asks you first."], perExecution: { fee: "0.0001", swapped: "0.00989", minOut: "583.2", symbolIn: "cirBTC", symbolOut: "USDC" }, approval: "Approve 0.01 cirBTC for LykiaOrders", executions: 1, input: { kind: "stop-loss", sell: "cirBTC", buy: "USDC", amount: "0.01", triggerPrice: "60000" } };

  it("an order is the same review as a plan: the allowance, then one signature, under the Fence's verdict", () => {
    const v = orderReviewView(block, null, { approval: "pending", sign: "pending" });
    assert.deepEqual(v.steps.map((s) => s.id), ["approve", "sign"]);
    assert.equal(v.decision, "confirm");
    assert.equal(v.signable, false, "not signable until the draft is rebuilt and re-checked");
    assert.equal(v.nextStepId, "approve");
    const done = orderReviewView(block, { hash: `0x${"ab".repeat(32)}`, summary: block.summary, order: { executions: 1 }, typedData: { domain: {}, types: {}, primaryType: "Order", message: {} }, approval: null, perExecution: { ...block.perExecution, maxTip: "0" }, notes: [], verdict: { decision: "deny", reasons: [{ decision: "deny", message: "Over the beta cap." }] } }, { approval: "settled", sign: "pending" });
    assert.equal(done.stage, "denied", "the verdict at signing time wins over the draft's");
    assert.deepEqual(done.reasons, ["Over the beta cap."]);
    const cancel = cancelReviewView({ hash: `0x${"cd".repeat(32)}`, name: "Buy EURC", environment: "mainnet" }, "pending");
    assert.equal(cancel.steps.length, 1);
    assert.equal(cancel.nextStepId, "cancel");
  });

  it("the typed order is signed with bigints, without the domain type", () => {
    const td = signableOrder({ domain: { name: "LykiaOrders" }, types: { EIP712Domain: [], Order: [{ name: "amountIn", type: "uint256" }] }, primaryType: "Order", message: { amountIn: "10", minAmountOut: "9", maxTip: "0", triggerPrice: "1", startTime: 0, deadline: 1, nonce: "7" } });
    assert.equal((td.message as { amountIn: bigint }).amountIn, 10n);
    assert.ok(!("EIP712Domain" in (td.types as object)));
  });

  it("the Whistle's sheet groups what it stopped, Autopilot and agents first", () => {
    const items: WhistleItem[] = [
      { kind: "automation", id: "atm_1", label: "Friday sweep", environment: "mainnet", state: "paused" },
      { kind: "autopilot", id: "autopilot:mainnet", label: "Autopilot on Arc mainnet", environment: "mainnet", state: "paused" },
      { kind: "leash", id: "lsh_1", label: "Invoice bot · leash", environment: "mainnet", state: "resumed" },
    ];
    assert.deepEqual(whistleGroups(items).map((g) => g.kind), ["autopilot", "leash", "automation"]);
  });
});
