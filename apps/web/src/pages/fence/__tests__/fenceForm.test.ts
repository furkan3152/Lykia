import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateFence, FENCE_TEMPLATES, fenceHash, validateFence } from "@lykia/core";

import { fromFence, toFence } from "../fenceForm";
import { SCENARIOS } from "../scenarios";

describe("fence form", () => {
  it("round-trips every template to an equivalent, valid Fence", () => {
    for (const [key, fence] of Object.entries(FENCE_TEMPLATES)) {
      const back = toFence(fromFence(fence));
      assert.equal(validateFence(back).ok, true, key);
      assert.equal(fenceHash(back), fenceHash(fence), key);
    }
  });

  it("drops empty limits and parses lists", () => {
    const form = { ...fromFence(FENCE_TEMPLATES.shepherd), perStepUsd: "", maxSlippageBps: "", recipientsMode: "allowlist" as const, recipientsAllow: "0x2222222222222222222222222222222222222222\n0x2222222222222222222222222222222222222222", venuesAllow: "cctp, gateway" };
    const fence = toFence(form);
    assert.equal(fence.caps?.perStepUsd, undefined);
    assert.equal(fence.limits?.maxSlippageBps, undefined);
    assert.deepEqual(fence.recipients?.allow, ["0x2222222222222222222222222222222222222222"]);
    assert.deepEqual(fence.venues?.allow, ["cctp", "gateway"]);
  });

  it("invalid input is caught by core validation", () => {
    const fence = toFence({ ...fromFence(FENCE_TEMPLATES.shepherd), perStepUsd: "ten" });
    assert.equal(validateFence(fence).ok, false);
  });
});

describe("playground scenarios", () => {
  it("the shepherd allows a small deposit and denies the wolf", () => {
    const now = Date.UTC(2026, 10, 2, 10, 0);
    const pick = (key: string) => SCENARIOS.find((s) => s.key === key)!;
    assert.equal(evaluateFence(FENCE_TEMPLATES.shepherd, pick("deposit").facts("agent", now)).decision, "allow");
    assert.equal(evaluateFence(FENCE_TEMPLATES.shepherd, pick("wolf").facts("agent", now)).decision, "deny");
    assert.equal(evaluateFence(FENCE_TEMPLATES.shepherd, pick("borrow").facts("wallet", now)).decision, "deny");
    assert.equal(evaluateFence({ ...FENCE_TEMPLATES.shepherd, mode: "whistle" }, pick("repay").facts("wallet", now)).decision, "allow");
  });
});
