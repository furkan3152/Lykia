import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_FENCE, DEFAULT_FOLD_PREFERENCES, loosenedRules } from "@lykia/core";
import type { FoldInsight } from "@lykia/core/api/fold";

import { agentMeter, allocationStones, applyFencePatch, badgeCount, byDay, countsLine, fenceInWords, fenceSuggestions, filterInstructions, filterTrails, headroom, herdingFilterOf, holdingAction, mergeThreads, openingLine, pastureLayout, rollingChars, sampleInsights, sampleInstructions, samplePack, sampleSnapshot, sampleTrails, tabForKey, tabFromParam, visibleTabs } from "../model";

const NOW = Date.UTC(2026, 10, 4, 12);

describe("the Fold's tabs", () => {
  it("follows the owner's layout, never empty, and maps keys 1 to 5 onto the visible tabs", () => {
    assert.deepEqual(visibleTabs(null), ["flock", "trails", "herding", "pack", "fence"]);
    const mine = visibleTabs({ layout: { tabs: ["herding", "flock"], cards: [] } });
    assert.deepEqual(mine, ["herding", "flock"]);
    assert.deepEqual(visibleTabs({ layout: { tabs: [], cards: [] } }), ["flock", "trails", "herding", "pack", "fence"]);
    assert.equal(tabForKey("1", mine), "herding");
    assert.equal(tabForKey("3", mine), null);
    assert.equal(tabForKey("a", mine), null);
    assert.equal(tabFromParam("pack", mine), "herding", "a hidden tab falls back to the first visible one");
    assert.equal(tabFromParam("lyko", mine), "lyko");
    assert.equal(tabFromParam(undefined, visibleTabs(DEFAULT_FOLD_PREFERENCES)), "flock");
  });
});

describe("the Fold bar", () => {
  it("rolls only the digits that changed, aligned from the right", () => {
    const rolled = rollingChars("$1,240.50", "$1,241.00").filter((c) => c.rolls).map((c) => c.char).join("");
    assert.equal(rolled, "10", "only the units and the tenths roll");
    assert.equal(rollingChars("$999.00", "$1,000.00").filter((c) => c.rolls).length, 4, "a longer number rolls its new digits");
    assert.ok(rollingChars("$5.00", "$5.00").every((c) => !c.rolls));
  });

  it("measures headroom against the tighter of the Fence and beta daily caps", () => {
    const h = headroom("4200", "5000", "4500");
    assert.equal(h.cap, 4500);
    assert.equal(h.capLabel, "Beta daily cap");
    assert.equal(h.left, 300);
    assert.equal(h.tone, "warn");
    assert.equal(headroom(null, null, null).capLabel, "No daily cap");
    assert.equal(headroom("100", "5000", null).tone, "ok");
  });

  it("writes the counts line in words", () => {
    assert.equal(countsLine({ rules: 3, ordersWaiting: 1, agentsWorking: 2 }), "3 rules run on their own · 1 order waits for its price · 2 agents work for you");
    assert.equal(countsLine({ rules: 1, ordersWaiting: 0, agentsWorking: 1, proposalsWaiting: 2 }), "1 rule runs on its own · 1 agent works for you · 2 drafts wait for your signature", "zero counts are left out");
    assert.equal(countsLine({ rules: 0, ordersWaiting: 0, agentsWorking: 0 }), "Nothing runs on its own yet.");
  });

  it("splits the allocation into whole tesserae that add up", () => {
    const stones = allocationStones(sampleSnapshot(NOW).holdings, 40);
    assert.equal(stones.reduce((a, s) => a + s.stones, 0), 40);
    assert.ok(stones.every((s) => s.stones >= 1));
    assert.deepEqual(new Set(stones.map((s) => s.bucket)), new Set(["wallet", "earning", "borrowing", "other"]));
  });
});

describe("the Flock", () => {
  it("lays the pasture out as venue pens that fill the width, holdings stacked inside", () => {
    const { groups, tiles } = pastureLayout(sampleSnapshot(NOW).holdings);
    assert.ok(Math.abs(groups.reduce((a, g) => a + g.w, 0) - 100) < 1e-9);
    assert.equal(groups[0]!.label, "Wallet", "the biggest pen first");
    for (const g of groups) {
      const inside = tiles.filter((t) => t.where === g.where);
      assert.ok(Math.abs(inside.reduce((a, t) => a + t.h, 0) - 100) < 1e-9, g.where);
    }
  });

  it("offers one assistant action per holding, phrased so the reader can plan it", () => {
    const h = sampleSnapshot(NOW).holdings;
    const usdc = h.find((x) => x.where === "wallet" && x.symbol === "USDC");
    const eurc = h.find((x) => x.where === "wallet" && x.symbol === "EURC");
    const vault = h.find((x) => x.kind === "vault");
    const debt = h.find((x) => x.kind === "debt");
    assert.deepEqual(holdingAction(usdc!, 500), { label: "Put to work", sentence: "Put 3320 USDC to work" });
    assert.equal(holdingAction(usdc!, 5000), null, "under the floor: nothing to suggest");
    assert.equal(holdingAction(eurc!, 500)?.label, "Convert");
    assert.equal(holdingAction(vault!, 500)?.label, "Withdraw");
    assert.equal(holdingAction(debt!, 500)?.sentence, "Repay 150 USDC on aave-v4");
  });
});

describe("Lyko on watch", () => {
  it("badges unhandled act and watch insights plus drafts to sign, and opens calmly", () => {
    const insights = sampleInsights();
    assert.equal(badgeCount(insights, 1), 3);
    const handled: FoldInsight[] = insights.map((i) => ({ ...i, handled: true }));
    assert.equal(badgeCount(handled), 0);
    assert.match(openingLine(handled, false), /All quiet in the valley/u);
    assert.match(openingLine(insights, false), /^One thing wants your attention/u);
    assert.match(openingLine([], true), /sample flock/u);
  });

  it("lists the shared threads from the server first, then local-only ones", () => {
    const merged = mergeThreads([{ id: "a", title: "local", at: NOW - 1000 }, { id: "b", title: "both", at: NOW - 5000 }], [{ id: "b", title: "both", environment: "mainnet", createdAt: "", updatedAt: new Date(NOW).toISOString(), messages: 4, last: "x", origin: "fold" }]);
    assert.deepEqual(merged.map((t) => [t.id, t.origin]), [["b", "fold"], ["a", "ask"]]);
  });
});

describe("Herding, Trails, Pack and Fence", () => {
  it("filters instructions by kind and reads the filter from the URL", () => {
    const list = sampleInstructions(NOW);
    assert.equal(filterInstructions(list, "orders").length, 1);
    assert.equal(filterInstructions(list, "recurring")[0]!.sourceLabel, "Recurring");
    assert.equal(filterInstructions(list, "all").length, list.length);
    assert.equal(herdingFilterOf("alerts"), "alerts");
    assert.equal(herdingFilterOf("<script>"), "all");
  });

  it("filters the trail and groups it by day", () => {
    const trail = sampleTrails(NOW);
    assert.equal(filterTrails(trail, "refused").length, 1);
    assert.equal(filterTrails(trail, "settled").length, 2);
    const days = byDay(trail, NOW);
    assert.equal(days[0]!.day, "Today");
    assert.ok(days.some((d) => d.day === "Yesterday"));
  });

  it("meters an agent's budget against its tightest cap", () => {
    const [payroll, keeper] = samplePack();
    assert.deepEqual(agentMeter(payroll!), { used: 120, cap: 500, share: 0.24, label: "today" });
    assert.ok(agentMeter(keeper!).share > 0.8);
  });

  it("says the Fence in words and proposes edits that only tighten it", () => {
    const words = fenceInWords(DEFAULT_FENCE).map((w) => w.rule);
    assert.ok(words.includes("Per day") && words.includes("Recipients"));
    assert.match(fenceInWords({ ...DEFAULT_FENCE, mode: "whistle" })[0]!.text, /Whistle is blown/u);
    for (const s of fenceSuggestions(DEFAULT_FENCE)) assert.deepEqual(loosenedRules(DEFAULT_FENCE, applyFencePatch(DEFAULT_FENCE, s.patch)), [], s.label);
    const looser = applyFencePatch(DEFAULT_FENCE, { caps: { ...DEFAULT_FENCE.caps, dailyUsd: "999999" } });
    assert.ok(loosenedRules(DEFAULT_FENCE, looser).length > 0, "a looser cap is caught, so the wallet must sign it");
  });
});
