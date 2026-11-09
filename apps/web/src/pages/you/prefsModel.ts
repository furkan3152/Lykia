/**
 * Your Lyko, made simple (pure): three target-mix presets in plain words,
 * and the insight kinds grouped into a few themes with one switch each.
 */
import { FOLD_INSIGHT_KINDS, type FoldInsightKind, type FoldPreferences } from "@lykia/core";

type Mix = FoldPreferences["targetMix"];

export interface MixPreset {
  readonly id: "dollars" | "balanced" | "earn";
  readonly title: string;
  readonly line: string;
  readonly mix: Pick<Mix, "usdcPct" | "eurcPct" | "earningPct">;
}

export const MIX_PRESETS: readonly MixPreset[] = [
  { id: "dollars", title: "Mostly dollars", line: "Most of it ready to spend in USDC.", mix: { usdcPct: 70, eurcPct: 10, earningPct: 20 } },
  { id: "balanced", title: "Balanced", line: "Half ready to spend, a share earning.", mix: { usdcPct: 50, eurcPct: 10, earningPct: 40 } },
  { id: "earn", title: "Earn more", line: "Most of it earning; enough kept to spend.", mix: { usdcPct: 25, eurcPct: 5, earningPct: 70 } },
];

/** The preset a mix matches, or null when it was fine-tuned. */
export function presetOf(mix: Mix): MixPreset["id"] | null {
  return MIX_PRESETS.find((p) => p.mix.usdcPct === mix.usdcPct && p.mix.eurcPct === mix.eurcPct && p.mix.earningPct === mix.earningPct)?.id ?? null;
}

/** A preset applied to a mix: the band is kept. */
export function applyPreset(mix: Mix, id: MixPreset["id"]): Mix {
  const p = MIX_PRESETS.find((x) => x.id === id);
  return p ? { ...mix, ...p.mix } : mix;
}

/** Ten tesserae for a mini allocation strip: how many stones each share gets (largest remainder, always 10). */
export function mixStones(mix: Pick<Mix, "usdcPct" | "eurcPct" | "earningPct">): readonly ("usdc" | "eurc" | "earning")[] {
  const parts = [["usdc", mix.usdcPct], ["eurc", mix.eurcPct], ["earning", mix.earningPct]] as const;
  const raw = parts.map(([k, v]) => ({ k, whole: Math.floor(v / 10), rest: v % 10 }));
  let left = 10 - raw.reduce((a, r) => a + r.whole, 0);
  for (const r of [...raw].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    r.whole += 1;
    left -= 1;
  }
  return raw.flatMap((r) => Array.from({ length: r.whole }, () => r.k));
}

export interface WatchGroup {
  readonly id: "risk" | "idle" | "running" | "safety";
  readonly title: string;
  readonly line: string;
  readonly kinds: readonly FoldInsightKind[];
}

/** Every insight kind sits in exactly one group (tested). */
export const WATCH_GROUPS: readonly WatchGroup[] = [
  { id: "risk", title: "Money at risk", line: "Loans near liquidation, ranges that stopped earning, a mix that drifted.", kinds: ["health-factor", "lp-out-of-range", "fx-drift", "scent-warning", "near-threshold"] },
  { id: "idle", title: "Money sitting idle", line: "Cash above your floor, a better low-risk rate, something to claim.", kinds: ["idle-usdc", "idle-position", "yield-change", "unclaimed"] },
  { id: "running", title: "Things running", line: "Orders near their price, agents near their budget, payments coming up.", kinds: ["order-near-trigger", "order-expiring", "agent-budget", "watch-task", "runway", "obligations", "unsettled", "bridge-stuck", "expiring"] },
  { id: "safety", title: "Safety", line: "Old token approvals, gas running low, tokens stuck without gas, the daily cap close.", kinds: ["approval-hygiene", "gas-floor", "stranded", "dust", "beta-headroom"] },
];

/** How many of a group's kinds are shown. */
export function groupState(group: WatchGroup, hidden: readonly FoldInsightKind[]): { readonly on: number; readonly of: number } {
  const off = new Set(hidden);
  return { on: group.kinds.filter((k) => !off.has(k)).length, of: group.kinds.length };
}

/** One switch for a group: all on, unless all are on already, then all off. */
export function toggleGroup(group: WatchGroup, hidden: readonly FoldInsightKind[]): FoldInsightKind[] {
  const { on, of } = groupState(group, hidden);
  const rest = hidden.filter((k) => !group.kinds.includes(k));
  return on === of ? [...rest, ...group.kinds] : rest;
}

export const ALL_KINDS: readonly FoldInsightKind[] = FOLD_INSIGHT_KINDS;
