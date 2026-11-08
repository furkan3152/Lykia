/**
 * Nothing unexplained: the beta limit never appears without its reason, every
 * area has a "How this works", Lykia's words carry a plain subtitle, every
 * position kind and state has a meaning, and the Fold's sample rows say what
 * they are doing.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { betaCapExplain, DEFAULT_FENCE, fencePresetPreview, fenceSentences, LYKIA_TERMS, POSITION_KINDS, POSITION_STATES, STATE_MEANINGS, STRESS_SCENARIO_IDS, STRESS_SCENARIOS, stressAnswer } from "@lykia/core";

import { FOLD_TAB_META, countsLine, roomLine, headroom } from "../../fold/model";
import { leashSentence, emptyForm } from "../../fold/leash/model";
import { samplePositions } from "../../fold/positionsModel";
import { HELP, HELP_AREAS } from "../help";

const SRC = fileURLToPath(new URL("../../../", import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : tsxFiles(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

describe("the beta limit is always explained", () => {
  it("says what it is, why, who it applies to and that money coming home is never capped", () => {
    const b = betaCapExplain({ perStepUsd: "1000", perDayUsd: "5000" });
    assert.match(b.sentence, /won't move more than \$1,000 in one step or \$5,000 in one day/u);
    assert.match(b.why, /audited/u);
    assert.match(b.scope, /everyone/u);
    assert.match(b.home, /never capped/u);
  });

  it("is explained in every file that shows the beta limit's number", () => {
    const shows = /useBetaCap\(|betaCap\b|BetaCap\b|"Lykia's beta limit"|perDayUsd: "5000"/u;
    const explains = /betaCapExplain|BetaCapNote|BetaRibbon/u;
    // Files that only read the limit and hand it on, with the components that draw (and explain) it.
    const passThrough: Readonly<Record<string, readonly string[]>> = { "pages/fold/FoldPage.tsx": ["features/fold/tabs/FenceTab.tsx", "features/fold/FoldBar.tsx"] };
    for (const targets of Object.values(passThrough)) for (const t of targets) assert.match(readFileSync(join(SRC, t), "utf8"), explains, t);
    const offenders = tsxFiles(SRC).filter((f) => {
      const text = readFileSync(f, "utf8");
      return shows.test(text) && !explains.test(text) && !(f.slice(SRC.length) in passThrough);
    });
    assert.deepEqual(offenders.map((f) => f.slice(SRC.length)), []);
  });

  it("sets the beta limit apart from the owner's own rules", () => {
    const rows = fenceSentences(DEFAULT_FENCE, { perStepUsd: "1000", perDayUsd: "5000" });
    assert.ok(rows.some((r) => r.source === "yours" && /won't move more than \$1,000 in one step/u.test(r.text)));
    const beta = rows.filter((r) => r.source === "beta");
    assert.equal(beta.length, 1);
    assert.match(beta[0]!.text, /audited/u);
  });
});

describe("the Fence changes by presets, with a preview", () => {
  it("lists what changes and whether the wallet signs it", () => {
    const careful = fencePresetPreview(DEFAULT_FENCE, "careful", { perStepUsd: "1000", perDayUsd: "5000" });
    assert.ok(careful.changes.length > 0 && careful.changes.every((c) => c.direction === "tighter"));
    assert.equal(careful.needsWallet, false);
    const bold = fencePresetPreview(DEFAULT_FENCE, "bold", { perStepUsd: "1000", perDayUsd: "5000" });
    assert.equal(bold.needsWallet, true);
    assert.match(bold.betaNote ?? "", /beta/u, "a preset above the beta limit says the limit still applies");
    assert.equal(fencePresetPreview(DEFAULT_FENCE, "balanced").changes.length, 0, "the default Fence is Balanced");
  });
});

describe("every area explains itself", () => {
  it("has a How this works with three bullets at most and a question for Lyko", () => {
    for (const area of HELP_AREAS) {
      const h = HELP[area];
      assert.ok(h.bullets.length >= 1 && h.bullets.length <= 3, area);
      assert.ok(h.ask.length > 3, area);
    }
  });

  it("gives Lykia's words a plain subtitle in the Fold's tabs", () => {
    for (const meta of Object.values(FOLD_TAB_META)) {
      const term = Object.values(LYKIA_TERMS).find((t) => t.word === meta.label);
      assert.ok(term, meta.label);
      assert.equal(meta.sub, term.plain);
    }
  });

  it("says the room left today with whose limit it is", () => {
    assert.equal(roomLine(headroom(1240, 5000, null)), "Room left today: $3,760 of $5,000 (your daily limit).");
    assert.match(roomLine(headroom(0, 10000, 5000)), /Lykia's beta limit/u);
    assert.equal(countsLine({ rules: 0, ordersWaiting: 0, agentsWorking: 0 }), "Nothing runs on its own yet.");
  });
});

describe("positions say what they are", () => {
  it("has a plain meaning for every state and kind", () => {
    for (const s of POSITION_STATES) assert.ok(STATE_MEANINGS[s].length > 10, s);
    for (const [k, v] of Object.entries(POSITION_KINDS)) assert.ok(v.plain.length > 5, k);
  });

  it("answers every stress scenario in one sentence with before, after and the closest loan", () => {
    const s = samplePositions(Date.UTC(2026, 10, 8));
    const holdings = s.venues.flatMap((v) => v.positions).filter((p) => p.counts === "net").flatMap((p) => p.assets.map((a) => ({ symbol: a.symbol, where: p.venue, kind: a.role === "borrowed" ? ("debt" as const) : ("supply" as const), usd: a.valueUsd })));
    for (const id of STRESS_SCENARIO_IDS) {
      const a = stressAnswer(holdings, [{ venue: "aave-v4", healthFactor: "1.38" }], STRESS_SCENARIOS[id].shocks, STRESS_SCENARIOS[id].lead, 1.5, { "aave-v4": "Aave V4" });
      assert.match(a.sentence, /^If .+ your holdings would be worth \$[\d,]+ \([−+]\$[\d,]+\)/u, id);
      assert.match(a.sentence, /Aave V4/u, id);
    }
  });

  it("tracks today's kinds from the generic blocks: leashes, bridges in flight, plans and watches", () => {
    const s = samplePositions(Date.UTC(2026, 10, 8));
    for (const venue of ["leashes", "across", "plans", "watches"]) {
      const p = s.venues.find((v) => v.venue === venue)?.positions[0];
      assert.ok(p && (p.blocks ?? []).length > 0, venue);
      assert.ok(p.doing.length > 5, venue);
    }
    assert.equal(s.venues.find((v) => v.venue === "watches")?.positions[0]?.state, "watching");
  });

  it("answers every sample venue (none is left reading)", () => {
    const s = samplePositions(Date.UTC(2026, 10, 8));
    assert.ok(s.venues.every((v) => v.status === "ok"));
    assert.ok(s.venues.some((v) => v.venue === "leashes" && v.positions[0]?.blocks?.some((b) => b.type === "gauge")));
  });
});

describe("the Leash review is one sentence", () => {
  it("says how much, for how long, to whom, and that it can be stopped", () => {
    const form = { ...emptyForm("pay-invoices"), name: "Invoice bot", perDayUsd: "20", perStepUsd: "20", days: "7" };
    assert.equal(leashSentence(form, 2), "Invoice bot can spend up to $20 a day for 7 days, only to these 2 payees. You can stop it anytime.");
  });
});
