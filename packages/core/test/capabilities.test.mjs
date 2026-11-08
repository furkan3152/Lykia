import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCapabilityMap, capabilityVenueIds, genericPositionInsights, readAssist, STATE_MEANINGS, POSITION_KINDS, POSITION_STATES, positionDoing, positionKindInfo } from "../dist/index.js";

const EXEC = new Set(["arc-transfer", "cctp", "gateway", "morpho-vaults", "aave-v4", "uniswap-v3", "relay", "across"]);
const map = buildCapabilityMap({ environment: "mainnet", executable: EXEC, gatewayChains: [{ key: "base", name: "Base" }] });

describe("capability map", () => {
  it("is built from the executable set", () => {
    const ids = capabilityVenueIds(map);
    for (const id of EXEC) if (id !== "arc-transfer") assert.ok(ids.has(id), id);
    assert.ok(!ids.has("morpho-blue"), "not executable here, so not listed");
    const fewer = buildCapabilityMap({ environment: "mainnet", executable: new Set(["cctp"]), gatewayChains: [] });
    assert.deepEqual(fewer.actions.map((a) => a.id), ["bridge"]);
  });

  it("reads capability questions, offers and clarifying questions", () => {
    assert.equal(readAssist("What can you do?", map)?.kind, "capabilities");
    assert.deepEqual(readAssist("Where can I bridge USDC to?", map), { kind: "bridge-destinations", token: "USDC" });
    assert.equal(readAssist("my bot needs money", map)?.feature, "leash");
    assert.equal(readAssist("what if EURC drops 5%?", map)?.feature, "stress-test");
    assert.equal(readAssist("stop everything", map)?.feature, "whistle");
    const ask = readAssist("Bridge 100 USDC", map);
    assert.equal(ask?.kind, "clarify");
    assert.equal(ask?.options[0], "Bridge 100 USDC to Base");
    assert.equal(readAssist("Bridge 100 USDC to Base", map), null);
    assert.equal(readAssist("Give my bot $20 a day for a week to pay invoices", map), null, "a complete request is planned, not offered");
  });
});

describe("generic position kinds", () => {
  it("describes every state and an unknown kind", () => {
    for (const s of POSITION_STATES) assert.ok(STATE_MEANINGS[s]);
    assert.equal(positionKindInfo("options-vault").label, "Options Vault");
  });

  it("finds risk, claims and endings from blocks alone", () => {
    const now = Date.UTC(2026, 10, 8);
    const base = { id: "leashes:l1", venue: "leashes", venueName: "Leash budgets", venueKind: "leash", label: "Invoice bot", assets: [], amount: "12", symbol: "USDC", valueUsd: "12", counts: "overlay", state: "committed", actions: [], source: "history", readAt: new Date(now).toISOString(), block: null, explorer: null };
    const blocks = [{ type: "gauge", label: "Used today", value: 19, min: 0, max: 20, display: "$19 of $20", threshold: { at: 20, label: "today's cap", danger: "above" } }, { type: "countdown", label: "Ends", until: new Date(now + 3_600_000).toISOString(), ends: true }];
    const p = { ...base, blocks, claimable: { amount: "3", symbol: "USDC", valueUsd: "3" } };
    const insights = genericPositionInsights([{ ...p, doing: positionDoing(p) }], now);
    assert.deepEqual(insights.map((i) => i.kind).sort(), ["expiring", "near-threshold", "unclaimed"]);
    assert.match(positionDoing(p), /^Budget for a bot · used today \$19 of \$20/u);
  });

  it("names today's tracked kinds in plain words", () => {
    for (const k of ["leash", "plan", "watch", "bridge", "orders", "payments"]) assert.ok(POSITION_KINDS[k].plain.length > 5, k);
  });
});
