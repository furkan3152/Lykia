import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { balanceLines, decisionLabel, reportFromError, units, visibleFindings } from "../model";

describe("security view model", () => {
  it("formats balances and orders findings", () => {
    assert.equal(units("20200000", 6), "20.2");
    assert.equal(units("1", 6), "0.000001");
    assert.deepEqual(balanceLines({ summary: { balanceChanges: [{ token: "0x3600000000000000000000000000000000000000", symbol: "USDC", out: "20200000", in: null }], lines: [], calls: [], approvals: [], contractsTouched: [] } }), ["-20.2 USDC"]);
    const f = (severity: "block" | "warn" | "info") => ({ layer: "simulation" as const, rule: severity, severity, message: severity });
    assert.deepEqual(visibleFindings([f("info"), f("warn"), f("block")]).map((x) => x.severity), ["block", "warn"]);
    assert.equal(decisionLabel("block"), "BLOCKED");
  });

  it("reads the report a blocked prepare carries", () => {
    assert.equal(reportFromError(new Error("x")), null);
    const security = { decision: "block" };
    assert.equal(reportFromError({ code: "SECURITY_BLOCKED", details: { security } }), security);
  });
});
