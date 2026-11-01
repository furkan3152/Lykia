import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_FENCE, evaluateFence, outrunOf, type IntentGraph } from "@lykia/core";

import { artifactView, pct } from "../model";

const OWNER = "0x1111111111111111111111111111111111111111";
const USDC = "0x3600000000000000000000000000000000000000";

function graph(): IntentGraph {
  const verdict = evaluateFence(DEFAULT_FENCE, { environment: "testnet", signer: "wallet", owner: OWNER, steps: [], spent: { dayUsd: "0", weekUsd: "0" }, now: 0 });
  return {
    spec: "lykia.intent/v1", id: "out_1", environment: "testnet", createdAt: "2026-11-01T00:00:00Z", source: "t", owner: OWNER, verdict, warnings: ["w"],
    steps: [
      { id: "s1", kind: "deposit", venue: "morpho-vaults", summary: "Deposit 100 USDC", signer: "wallet", account: OWNER, dependsOn: [], inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "100000000", usd: "100" }], outputs: [], settlement: { kind: "receipt" }, status: "settled", references: ["0xabc"] },
      { id: "s2", kind: "bridge", venue: "cctp", summary: "Bridge 10 USDC to Base", signer: "wallet", account: OWNER, dependsOn: ["s1"], inputs: [], outputs: [], settlement: { kind: "cctp", destination: "base", expectedSeconds: 20 }, status: "ready" },
    ],
  } as IntentGraph;
}

describe("route artifact model", () => {
  it("derives stops, the next signer step, settled count and the ferry", () => {
    const g = graph();
    const v = artifactView(g, outrunOf(g));
    assert.equal(v.stops.length, 2);
    assert.equal(v.settled, 1);
    assert.equal(v.next, "s2");
    assert.equal(v.ferry, true);
    assert.equal(v.stops[0]!.name, "Telmessos");
    assert.equal(v.decision, "allow");
    assert.deepEqual(v.warnings, ["w"]);
  });

  it("formats APYs honestly", () => {
    assert.equal(pct("0.0612"), "6.12%");
    assert.equal(pct(null), "n/a");
  });
});
