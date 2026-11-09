import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_FOLD_PREFERENCES, FOLD_INSIGHT_KINDS } from "@lykia/core";

import { applyPreset, groupState, MIX_PRESETS, mixStones, presetOf, toggleGroup, WATCH_GROUPS } from "../prefsModel";

describe("target mix presets", () => {
  it("each adds up to 100 and the default is one of them", () => {
    for (const p of MIX_PRESETS) assert.equal(p.mix.usdcPct + p.mix.eurcPct + p.mix.earningPct, 100, p.id);
    assert.equal(presetOf(DEFAULT_FOLD_PREFERENCES.targetMix), "balanced");
  });

  it("keeps the band and reads a fine-tuned mix as no preset", () => {
    const mix = applyPreset({ ...DEFAULT_FOLD_PREFERENCES.targetMix, bandPct: 7 }, "earn");
    assert.equal(mix.bandPct, 7);
    assert.equal(presetOf(mix), "earn");
    assert.equal(presetOf({ ...mix, usdcPct: 26, earningPct: 69 }), null);
  });

  it("draws ten stones for any mix", () => {
    for (const p of MIX_PRESETS) assert.equal(mixStones(p.mix).length, 10);
    assert.equal(mixStones({ usdcPct: 33, eurcPct: 33, earningPct: 34 }).length, 10);
    assert.deepEqual(mixStones({ usdcPct: 70, eurcPct: 10, earningPct: 20 }).filter((s) => s === "usdc").length, 7);
  });
});

describe("what Lyko watches for, in themes", () => {
  it("puts every insight kind in exactly one group", () => {
    const all = WATCH_GROUPS.flatMap((g) => g.kinds);
    assert.equal(all.length, FOLD_INSIGHT_KINDS.length);
    assert.deepEqual([...all].sort(), [...FOLD_INSIGHT_KINDS].sort());
    assert.ok(WATCH_GROUPS.length >= 4 && WATCH_GROUPS.length <= 5);
  });

  it("switches a whole group with one toggle and leaves the others alone", () => {
    const risk = WATCH_GROUPS.find((g) => g.id === "risk")!;
    const hidden = toggleGroup(risk, ["gas-floor"]);
    assert.deepEqual(groupState(risk, hidden), { on: 0, of: risk.kinds.length });
    assert.ok(hidden.includes("gas-floor"));
    const partly = hidden.filter((k) => k !== "health-factor");
    assert.equal(groupState(risk, toggleGroup(risk, partly)).on, risk.kinds.length, "a partly-on group turns fully on");
  });
});
