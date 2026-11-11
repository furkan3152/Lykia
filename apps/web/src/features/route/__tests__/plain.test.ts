import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bridgePlan } from "../../../pages/kit/preflightFixtures";
import { feeLine, leadSentence, plainRationale, plainReason, plainRouteWhy, plainStep, planGist } from "../plain";
import { nextStep, followUps } from "../../ask/starters";
import type { ChatMessage } from "../../ask/model";

describe("a plan in plain words", () => {
  it("says why the owner confirms, without rule codes", () => {
    assert.equal(plainReason("Value leaves Arc for base.", "confirm.cross-chain"), "You confirm because the money leaves Arc for Base.");
    assert.equal(plainReason("An agent proposed this plan: the owner confirms it.", "confirm.agent"), "You confirm because Lyko wrote this plan, not you.");
    assert.equal(plainReason("Above $500: the owner confirms."), "You confirm because the plan moves more than $500.");
    for (const r of bridgePlan().graph.verdict.reasons) assert.doesNotMatch(plainReason(r.message, r.rule), /confirm\.|cross-chain|counted in the caps|the owner confirms/u);
  });

  it("shows the fee as one short line", () => {
    assert.equal(feeLine("Lykia fee 1% · 0.189955 USDC ($0.189955), counted in the caps."), "Lykia fee: 0.19 USDC (1%)");
    assert.equal(plainReason("Lykia fee 1% · 0.189955 USDC ($0.189955), counted in the caps.", "fee"), "Lykia fee: 0.19 USDC (1%)");
  });

  it("keeps route-search bookkeeping off the screen", () => {
    assert.equal(plainRationale("Route search winner: As asked: cctp (net -0.21 USD over 90 days; beat 0 other options)."), "");
    assert.equal(plainRationale("Keeps 50 USDC liquid. Route search winner: Morpho (net 1.2 USD over 90 days; beat 3 other options)."), "Keeps 50 USDC liquid.");
    assert.equal(plainRouteWhy("As asked: cctp.", "CCTP"), "You asked for CCTP.");
    assert.equal(plainStep("Bridge 0.99 USDC to Base over CCTP (Circle forwards the mint)"), "Bridge 0.99 USDC to Base over CCTP");
  });

  it("sums up what you get, what it costs and how long, from the plan itself", () => {
    const { graph } = bridgePlan();
    const g = planGist(graph);
    assert.equal(g.get, "about 0.99 USDC on Base");
    assert.equal(g.cost, "Lykia fee 0.01 USDC (1%) · network fee a few cents");
    assert.equal(g.time, "about 20 seconds");
    assert.equal(leadSentence(graph), "You send 1 USDC from Arc and receive about 0.99 USDC on Base in about 20 seconds. Lykia fee 0.01 USDC.");
  });
});

describe("one thing to do at a time", () => {
  const plan = bridgePlan();
  const answer = (over: Partial<ChatMessage>): ChatMessage => ({ id: "a", role: "assistant", text: "", proposals: [plan.proposal], streaming: false, ...over }) as ChatMessage;
  it("asks the question before offering to sign", () => {
    const m = answer({ clarify: plan.clarify });
    assert.equal(nextStep(m).kind, "choose");
    assert.deepEqual(followUps(m), []);
  });
  it("offers review once the question is answered", () => {
    assert.equal(nextStep(answer({})).kind, "review");
  });
});
