import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPosition, fmtPercent, POSITION_VENUES, positionDoing, summarizePositions } from "../dist/index.js";

test("every routable mainnet venue has a position reader listed", () => {
  const ids = POSITION_VENUES.mainnet.map((v) => v.id);
  for (const id of ["wallet", "aave-v4", "morpho-vaults", "morpho-blue", "uniswap-v3", "uniswap-v4", "aerodrome-slipstream", "gateway", "cctp", "arc-transfer", "galaxy-curation", "keyrock", "steakhouse-financial", "gauntlet", "bitwise", "archery", "unitflow-finance-v3", "sushiswap", "relay"]) assert.ok(ids.includes(id), id);
  assert.ok(POSITION_VENUES.mainnet.filter((v) => v.personal).every((v) => ["cctp", "relay", "lykia-orders", "arc-transfer"].includes(v.id)));
});

test("states, lines and an empty summary", () => {
  assert.equal(classifyPosition({ kind: "debt", healthFactor: 1.05, healthFloor: 1 }), "at-risk");
  assert.equal(fmtPercent("0.0003"), "0.0003%");
  assert.equal(positionDoing({ state: "idle", venueKind: "wallet", amount: "1", symbol: "USDC", assets: [] }), "Resting in the wallet, earning nothing");
  const s = summarizePositions([]);
  assert.equal(s.netUsd, "0.00");
  assert.equal(s.weightedApyPercent, null);
  assert.equal(s.lowestHealth, null);
});
