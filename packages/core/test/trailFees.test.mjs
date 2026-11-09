import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TRAIL_FEE_WINDOW_DAYS, trailFeesUsd } from "../dist/index.js";

const now = Date.parse("2026-11-09T12:00:00Z");
const ago = (days) => new Date(now - days * 86_400_000).toISOString();

describe("trail fees", () => {
  it("totals settled fees inside the window only", () => {
    const items = [
      { kind: "settled", at: ago(0.1), feeUsd: "42.00" },
      { kind: "settled", at: ago(1), feeUsd: "12.00" },
      { kind: "settled", at: ago(TRAIL_FEE_WINDOW_DAYS + 1), feeUsd: "99.00" },
      { kind: "refused", at: ago(1), feeUsd: "5.00" },
      { kind: "settled", at: ago(2), feeUsd: null },
      { kind: "settled", at: ago(2), feeUsd: "n/a" },
    ];
    assert.equal(trailFeesUsd(items, now), "54.00");
    assert.equal(trailFeesUsd(items, now, 365), "153.00");
    assert.equal(trailFeesUsd([], now), "0.00");
  });
});
