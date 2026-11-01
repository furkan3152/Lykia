import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_FENCE, FENCE_TEMPLATES, fenceHash, validateFence } from "@lykia/core";

import { fenceToForm, formToFence } from "../form";

describe("fence form", () => {
  it("round-trips every template into a valid fence with the same hash", () => {
    for (const [key, fence] of Object.entries(FENCE_TEMPLATES)) {
      const back = formToFence(fenceToForm(fence), fence);
      assert.equal(validateFence(back).ok, true, key);
      assert.equal(fenceHash(back), fenceHash(fence), key);
    }
  });

  it("drops empty inputs instead of inventing limits", () => {
    const form = { ...fenceToForm(DEFAULT_FENCE), perStepUsd: "", dailyUsd: "", minHealthFactor: "", fxBandBps: "" };
    const f = formToFence(form, DEFAULT_FENCE);
    assert.equal(f.caps?.perStepUsd, undefined);
    assert.equal(f.lending, undefined);
    assert.equal(f.fx, undefined);
  });

  it("maps allowlists and schedules", () => {
    const form = { ...fenceToForm(DEFAULT_FENCE), recipients: "allowlist" as const, allowlist: "0x1111111111111111111111111111111111111111\n0x2222222222222222222222222222222222222222", scheduleOn: true };
    const f = formToFence(form, DEFAULT_FENCE);
    assert.equal(f.recipients?.allow?.length, 2);
    assert.equal(f.schedule?.windows[0]?.from, "09:00");
    assert.equal(validateFence(f).ok, true);
  });
});
