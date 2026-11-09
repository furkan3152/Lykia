import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFoldShocks, isSampleOwner, NO_SHOCK, sampleSnapshot, samplePositions, SAMPLE_OWNER } from "../dist/index.js";

const NOW = Date.UTC(2026, 10, 9, 10);

test("the signed-out sample is one fixture: the snapshot total equals the position map's net, and nothing claims a block", () => {
  const map = samplePositions(NOW);
  const snap = sampleSnapshot(NOW);
  assert.equal(snap.totalUsd, map.summary.netUsd);
  assert.equal(map.block, null);
  assert.equal(snap.block, null);
  assert.ok(map.venues.every((v) => v.block === null && v.positions.every((p) => p.block === null)), "no fake block number anywhere");
  assert.equal(isSampleOwner(SAMPLE_OWNER.toLowerCase()), true);
  // The Stress test on the sample starts from the same net worth.
  const shock = applyFoldShocks(snap.holdings, snap.health, NO_SHOCK);
  assert.equal(shock.before.toFixed(2), map.summary.netUsd);
});

test("the shock model rounds to the cent, keeps one label per row and its total equals the sum it shows", () => {
  const holdings = [
    { symbol: "USDC", where: "morpho-vaults", kind: "vault", usd: "0.1", label: "Galaxy USDC" },
    { symbol: "USDC", where: "morpho-vaults", kind: "vault", usd: "0.2", label: "Steakhouse USDC" },
    { symbol: "EURC", where: "wallet", kind: "token", usd: "1795.8" },
  ];
  const r = applyFoldShocks(holdings, [], { ...NO_SHOCK, EURC: -7 });
  assert.deepEqual(r.rows.map((x) => x.label), ["Galaxy USDC", "Steakhouse USDC", "EURC · wallet"]);
  assert.equal(r.before, 1796.1);
  assert.equal(r.after, 1670.39);
  for (const row of r.rows) assert.equal(Math.round(row.after * 100) / 100, row.after, "no float noise");
});
