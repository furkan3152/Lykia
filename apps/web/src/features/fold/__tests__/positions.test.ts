import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { POSITION_VENUES, POSITION_STATES } from "@lykia/core";

import { healthGauge, orderPens, penOf, positionPasture, rangeBar, rowDomId, samplePositions, shortLabel, STATE_COLOR } from "../positionsModel";

const NOW = Date.UTC(2026, 10, 6, 12);

describe("the position map", () => {
  const sample = samplePositions(NOW);
  const info = (id: string) => POSITION_VENUES.mainnet.find((v) => v.id === id)!;

  it("has a colour for every state and a sample with every state in it, labelled as a sample", () => {
    for (const s of POSITION_STATES) assert.ok(STATE_COLOR[s]);
    const states = new Set(sample.venues.flatMap((v) => v.positions.map((p) => p.state)));
    for (const s of ["earning", "idle", "at-risk", "out-of-range", "pending", "escrowed", "committed"]) assert.ok(states.has(s as never), s);
    assert.equal(sample.address, "0x000000000000000000000000000000000000dEaD");
    assert.equal(sample.summary.lowestHealth?.factor, "1.38");
  });

  it("totals a pen without adding overlays, and stones it with its most urgent state", () => {
    const aave = penOf(info("aave-v4"), sample.venues.find((v) => v.venue === "aave-v4")!);
    assert.equal(aave.stone, "at-risk");
    assert.equal(Math.round(aave.netUsd! * 100), Math.round((1062 - 600 + 2400) * 100));
    assert.equal(aave.positions[0]!.state, "at-risk");
    const orders = penOf(info("lykia-orders"), sample.venues.find((v) => v.venue === "lykia-orders")!);
    assert.equal(orders.netUsd, 0);
    assert.equal(orders.overlayUsd, 500);
  });

  it("puts urgent pens first and unreadable or empty ones last", () => {
    const pens = orderPens(POSITION_VENUES.mainnet.map((v) => penOf(v, sample.venues.find((r) => r.venue === v.id) ?? null)));
    assert.equal(pens[0]!.venue, "aave-v4");
    assert.equal(pens[1]!.venue, "uniswap-v4");
    assert.equal(pens.at(-1)!.positions.length, 0);
  });

  it("lays the pasture by value, leaves overlays out and tiles the whole field", () => {
    const { groups, tiles } = positionPasture(sample.venues.map((r) => ({ name: r.venueName, read: r })));
    assert.ok(!tiles.some((t) => t.id === "s-order" || t.id === "s-rent"));
    assert.ok(Math.abs(groups.reduce((a, g) => a + g.w, 0) - 100) < 1e-6);
    for (const g of groups) {
      const mine = tiles.filter((t) => t.venue === g.venue);
      assert.ok(Math.abs(mine.reduce((a, t) => a + t.h, 0) - 100) < 1e-6, g.venue);
    }
    assert.ok(tiles.find((t) => t.id === "s-aave-usdc-debt")!.debt);
    assert.equal(shortLabel(sample.venues.find((v) => v.venue === "uniswap-v4")!.positions[0]!), "USDC/EURC");
  });

  it("draws the health gauge and the range bar on their scales", () => {
    assert.deepEqual(healthGauge(2, 1.5), { fill: 0.5, floorAt: 0.25, tone: "ok" });
    assert.equal(healthGauge(1.38, 1.5).tone, "bad");
    assert.equal(healthGauge(1.7, 1.5).tone, "warn");
    const r = rangeBar(0.886, 0.8967, 0.8974);
    assert.ok(r.marker > r.left + r.width, "the price sits right of the band");
    assert.match(rowDomId("uniswap-v4:0xabc:12"), /^pos-[A-Za-z0-9_-]+$/u);
  });
});
