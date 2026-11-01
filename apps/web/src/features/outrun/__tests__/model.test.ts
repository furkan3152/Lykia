import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_FENCE, evaluateFence, type Outrun } from "@lykia/core";

import { groupByPlace, sheepSize } from "../../../pages/flock/model";
import { decisionLabel, moodFor, nextActionable, threatCount, verdictLines } from "../model";

const OWNER = "0x1111111111111111111111111111111111111111" as const;

describe("outrun model", () => {
  it("orders verdict lines deny-first and counts wolves", () => {
    const verdict = evaluateFence(DEFAULT_FENCE, {
      environment: "testnet",
      signer: "agent",
      owner: OWNER,
      now: 0,
      spent: { dayUsd: "0", weekUsd: "0" },
      steps: [{ id: "s1", kind: "swap", venue: "dex", usd: "10", tokens: [{ symbol: "USDC", address: "0x9999999999999999999999999999999999999999", listed: false, acquired: true, scent: "danger" }] }],
    });
    const lines = verdictLines(verdict);
    assert.equal(lines[0]!.decision, "deny");
    assert.ok(threatCount(verdict) >= 1);
    assert.equal(decisionLabel("deny", "tr"), "RET");
  });

  it("finds the signer's next step and Lyko's mood", () => {
    const outrun = { intentId: "o", status: "running", current: 0, fold: [], progress: 0, verdictDigest: "sha256:x", waypoints: [{ stepId: "s1", name: "Ölüdeniz", kind: "deposit", venue: "v", summary: "", status: "ready", gives: [], gets: [], explorer: [], turn: "signer", leavesArc: null }] } as unknown as Outrun;
    assert.equal(nextActionable(outrun), "s1");
    assert.equal(nextActionable(null), null);
    assert.equal(moodFor({ whistle: true, graph: null, outrun: null }), "resting");
    assert.equal(moodFor({ whistle: false, graph: null, outrun }), "herding");
  });
});

describe("flock model", () => {
  it("groups by place, never counts unpriced as zero, subtracts debt", () => {
    const groups = groupByPlace([
      { symbol: "USDC", token: "0x3600000000000000000000000000000000000000", amount: "100", usd: "100", where: "wallet", kind: "token" },
      { symbol: "X", token: "0x9999999999999999999999999999999999999999", amount: "5", usd: null, where: "wallet", kind: "token" },
      { symbol: "USDC", token: "0x3600000000000000000000000000000000000000", amount: "30", usd: "30.5", where: "aave", kind: "debt" },
      { symbol: "Y", token: "0x8888888888888888888888888888888888888888", amount: "1", usd: null, where: "vault", kind: "vault" },
    ]);
    assert.equal(groups[0]!.where, "wallet");
    assert.equal(groups[0]!.usd, "100.00");
    assert.equal(groups[0]!.unpriced, 1);
    assert.equal(groups.find((g) => g.where === "aave")!.usd, "-30.50");
    assert.equal(groups.find((g) => g.where === "vault")!.usd, null);
    assert.equal(sheepSize(null), 1);
    assert.equal(sheepSize("5000"), 2);
    assert.equal(sheepSize("50000"), 3);
  });
});
