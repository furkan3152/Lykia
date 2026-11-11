/**
 * The Fold's UI model: pure functions and the labelled sample a signed-out
 * visitor sees. Node tests import this file directly, so it imports types
 * and @lykia/core only.
 */
import { ALLOCATION_LABELS, explorerTx, networkFor, type Position, allocationOf, currentMix, FOLD_TABS, LYKIA_TERMS, roomTodayLine, sampleSnapshot as coreSampleSnapshot, type AllocationBucket, type Fence, type FoldPreferences, type FoldTab } from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";
import { sampleAutopilot } from "./autopilot/model";
import { sampleLeashes } from "./leash/model";
import type { FlockHolding, FlockSnapshot } from "@lykia/core/api/flock";
import type { FoldInsight, FoldInstruction, FoldProposal, FoldTrailEntry, RunningControl, RunningKind, RunningSigner, ThreadSummaryView, WhistleItem, WhistleItemKind } from "@lykia/core/api/fold";
import { formatUsd, intlLocale, t as msg } from "../../i18n";

/* ------------------------------------------------------------------ tabs */

export interface FoldTabMeta {
  readonly id: FoldTab;
  /** The metaphor. */
  readonly label: string;
  /** The plain word beside it. */
  readonly sub: string;
  /** One line under the tab's heading. */
  readonly line: string;
}

export const FOLD_TAB_META: Readonly<Record<FoldTab, FoldTabMeta>> = {
  flock: { id: "flock", label: LYKIA_TERMS.flock.word, sub: LYKIA_TERMS.flock.plain, line: msg("fold.model.everythingYouOwnOnArcWhat") },
  trails: { id: "trails", label: LYKIA_TERMS.trails.word, sub: LYKIA_TERMS.trails.plain, line: msg("fold.model.everythingThatHappenedPaymentsPlansRefus") },
  herding: { id: "herding", label: LYKIA_TERMS.herding.word, sub: LYKIA_TERMS.herding.plain, line: msg("fold.model.everythingInMotionOneRowEach") },
  pack: { id: "pack", label: LYKIA_TERMS.pack.word, sub: LYKIA_TERMS.pack.plain, line: msg("fold.model.oneCardPerAgentTheLeash") },
  fence: { id: "fence", label: LYKIA_TERMS.fence.word, sub: LYKIA_TERMS.fence.plain, line: msg("fold.model.theLimitsEveryMoveMustPass") },
};

/** The phone-only tab for the docked assistant. */
export const LYKO_TAB = { id: "lyko", label: "Lyko", sub: msg("fold.model.yourAssistant") } as const;
export type PhoneTab = FoldTab | "lyko";

/** The tab from the URL (/app/fold/:tab), falling back to the first visible tab. */
export function tabFromParam(param: string | undefined, visible: readonly FoldTab[]): PhoneTab {
  if (param === "lyko") return "lyko";
  const tab = (FOLD_TABS as readonly string[]).includes(param ?? "") ? (param as FoldTab) : null;
  return tab && visible.includes(tab) ? tab : (visible[0] ?? "flock");
}

/** The owner's tab order, never empty, hidden tabs left out. */
export function visibleTabs(prefs: Pick<FoldPreferences, "layout"> | null | undefined): FoldTab[] {
  const list = (prefs?.layout.tabs ?? FOLD_TABS).filter((t): t is FoldTab => (FOLD_TABS as readonly string[]).includes(t));
  return list.length > 0 ? [...list] : [...FOLD_TABS];
}

/** Keys 1 to 5 jump to the visible tabs in order; null for any other key. */
export function tabForKey(key: string, visible: readonly FoldTab[]): FoldTab | null {
  if (!/^[1-9]$/u.test(key)) return null;
  return visible[Number(key) - 1] ?? null;
}

/* -------------------------------------------------------------- numbers */

export function usd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return msg("fold.unpriced");
  return `${n < 0 ? "−" : ""}${formatUsd(Math.abs(n), { min: digits, max: digits })}`;
}

export function compactUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000) return formatUsd(n, { compact: true, min: 0, max: a >= 10_000 && a < 1_000_000 ? 0 : 1 });
  return formatUsd(n, { min: 0, max: 0 });
}

export interface RollingChar {
  readonly char: string;
  /** True for a digit that differs from the one in the same place before: only these roll. */
  readonly rolls: boolean;
}

/**
 * Splits the next value into characters and marks which digits changed,
 * aligned from the right so "$1,240.50" -> "$1,241.00" rolls only the last
 * four digits. A change in length rolls the new leading part.
 */
export function rollingChars(previous: string, next: string): RollingChar[] {
  const out: RollingChar[] = [];
  const offset = next.length - previous.length;
  for (let i = 0; i < next.length; i++) {
    const char = next[i]!;
    const before = previous[i - offset];
    out.push({ char, rolls: /\d/u.test(char) && before !== char });
  }
  return out;
}

/* ---------------------------------------------------------- the Fold bar */

export interface Headroom {
  readonly spent: number;
  readonly cap: number | null;
  /** "Fence daily cap" or "Beta daily cap": whichever is tighter. */
  readonly capLabel: string;
  readonly left: number | null;
  /** 0..1 of the tighter cap. */
  readonly share: number;
  readonly tone: "ok" | "warn" | "bad";
  readonly fenceCap: number | null;
  readonly betaCap: number | null;
}

export function headroom(spentDayUsd: string | number | null | undefined, fenceDailyUsd: string | number | null | undefined, betaDailyUsd: string | number | null | undefined): Headroom {
  const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const spent = n(spentDayUsd) ?? 0;
  const fenceCap = n(fenceDailyUsd);
  const betaCap = n(betaDailyUsd);
  const caps = [fenceCap, betaCap].filter((c): c is number => c !== null && c > 0);
  const cap = caps.length > 0 ? Math.min(...caps) : null;
  const share = cap ? Math.min(1, spent / cap) : 0;
  return { spent, cap, capLabel: cap === null ? msg("fold.model.noDailyCap") : cap === betaCap && betaCap !== fenceCap ? msg("fold.model.betaDailyCap") : msg("fold.model.fenceDailyCap"), left: cap === null ? null : Math.max(0, cap - spent), share, tone: share >= 0.95 ? "bad" : share >= 0.8 ? "warn" : "ok", fenceCap, betaCap };
}

/** "Room left today: $3,760 of $5,000 (your daily limit)". */
export function roomLine(h: Headroom): string {
  return roomTodayLine(h.left, h.cap, h.capLabel === "Beta daily cap");
}

export interface FoldCounts {
  readonly rules: number;
  readonly ordersWaiting: number;
  readonly agentsWorking: number;
  readonly proposalsWaiting?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 instructions run on their own · 1 order waits · 2 agents work for you" ("rules" is the Fence's word). */
export function countsLine(c: FoldCounts): string {
  // Calm: only what is there. Zero counts are left out.
  const parts = [
    c.rules > 0 ? plural(c.rules, msg("fold.model.instructionRunsOnItsOwn"), msg("fold.model.instructionsRunOnTheirOwn")) : null,
    c.ordersWaiting > 0 ? plural(c.ordersWaiting, msg("fold.model.orderWaitsForItsPrice"), msg("fold.model.ordersWaitForTheirPrice")) : null,
    c.agentsWorking > 0 ? plural(c.agentsWorking, msg("fold.model.agentOnALeashWorksFor"), msg("fold.model.agentsOnALeashWorkFor")) : null,
    c.proposalsWaiting ? plural(c.proposalsWaiting, msg("fold.model.draftWaitsForYourSignature"), msg("fold.model.draftsWaitForYourSignature")) : null,
  ].filter((x): x is string => x !== null);
  return parts.length === 0 ? msg("fold.model.nothingRunsOnItsOwnYet") : parts.join(" · ");
}

export interface AllocationSlice {
  readonly bucket: AllocationBucket;
  readonly label: string;
  readonly usd: number;
  readonly share: number;
  /** Whole tesserae out of `of`, at least one for any non-empty bucket. */
  readonly stones: number;
}

/** The allocation strip: buckets by venue type as whole tesserae that add up to `of`. */
export function allocationStones(holdings: readonly FlockHolding[], of = 40): AllocationSlice[] {
  const slices = allocationOf(holdings);
  if (slices.length === 0) return [];
  const raw = slices.map((s) => Math.max(1, Math.round(s.share * of)));
  let diff = of - raw.reduce((a, v) => a + v, 0);
  // Settle rounding on the largest buckets first.
  for (let i = 0; diff !== 0 && i < raw.length * 4; i++) {
    const j = i % raw.length;
    if (diff > 0) {
      raw[j]! += 1;
      diff -= 1;
    } else if (raw[j]! > 1) {
      raw[j]! -= 1;
      diff += 1;
    }
  }
  return slices.map((s, i) => ({ ...s, stones: raw[i]! }));
}

export const BUCKET_COLOR: Readonly<Record<AllocationBucket, string>> = { wallet: "var(--sea)", earning: "var(--olive)", borrowing: "var(--terra)", gateway: "var(--navy-2)", orders: "var(--ochre)", other: "var(--ink-3)" };
export { ALLOCATION_LABELS };

/* -------------------------------------------------------------- pasture */

export interface PastureTile {
  readonly key: string;
  readonly label: string;
  readonly where: string;
  readonly usd: number;
  readonly kind: FlockHolding["kind"];
  /** Percent rectangle inside the pasture. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PastureGroup {
  readonly where: string;
  readonly label: string;
  readonly usd: number;
  readonly x: number;
  readonly w: number;
}

const VENUE_NAMES: Readonly<Record<string, string>> = { wallet: msg("fold.model.wallet"), gateway: "Gateway", "morpho-vaults": "Morpho", "morpho-blue": "Morpho", "aave-v4": "Aave V4", usyc: "USYC", orders: msg("fold.model.orders") };
export function venueName(where: string): string {
  return VENUE_NAMES[where] ?? where.replace(/-/gu, " ").replace(/\b\w/gu, (c) => c.toUpperCase());
}

/**
 * The pasture: venues as columns sized by value, holdings stacked inside
 * sized by value (a slice-and-dice treemap). Debt is drawn by its size and
 * marked; unpriced holdings are left out (and counted elsewhere).
 */
export function pastureLayout(holdings: readonly FlockHolding[]): { groups: PastureGroup[]; tiles: PastureTile[] } {
  const priced = holdings.filter((h) => h.usd !== null && Math.abs(Number(h.usd)) > 0);
  const byVenue = new Map<string, FlockHolding[]>();
  for (const h of priced) byVenue.set(h.where, [...(byVenue.get(h.where) ?? []), h]);
  const venues = [...byVenue.entries()].map(([where, list]) => ({ where, list: [...list].sort((a, b) => Math.abs(Number(b.usd)) - Math.abs(Number(a.usd))), usd: list.reduce((a, h) => a + Math.abs(Number(h.usd)), 0) })).sort((a, b) => b.usd - a.usd);
  const total = venues.reduce((a, v) => a + v.usd, 0);
  const groups: PastureGroup[] = [];
  const tiles: PastureTile[] = [];
  let x = 0;
  venues.forEach((v, vi) => {
    const w = vi === venues.length - 1 ? 100 - x : Math.max(8, (v.usd / total) * 100);
    groups.push({ where: v.where, label: venueName(v.where), usd: v.usd, x, w });
    let y = 0;
    v.list.forEach((h, hi) => {
      const value = Math.abs(Number(h.usd));
      const hh = hi === v.list.length - 1 ? 100 - y : Math.max(12, (value / v.usd) * 100);
      tiles.push({ key: `${h.where}-${h.symbol}-${hi}`, label: h.symbol, where: h.where, usd: value, kind: h.kind, x, y, w, h: hh });
      y += hh;
    });
    x += w;
  });
  return { groups, tiles };
}

/** The one assistant action a holding row offers (drafted through the proposal system). */
export function holdingAction(h: FlockHolding, floorUsd: number): { label: string; sentence: string } | null {
  const amount = Number(h.amount);
  const value = h.usd === null ? null : Math.abs(Number(h.usd));
  const fmt = (n: number) => (n >= 100 ? String(Math.floor(n)) : n.toFixed(2).replace(/\.?0+$/u, ""));
  if (h.kind === "debt") return { label: msg("fold.model.repay"), sentence: msg("fold.model.repayOn", { fmt: fmt(Math.abs(amount) / 4), symbol: h.symbol, where: h.where }) };
  if (h.kind === "vault" || h.kind === "supply") return { label: msg("fold.model.withdraw"), sentence: msg("fold.model.withdrawUsdcFrom", { fmt: fmt(Math.abs(value ?? amount) / 2), venueName: venueName(h.where) }) };
  if (h.where === "wallet" && h.symbol === "USDC") {
    const idle = (value ?? amount) - floorUsd;
    return idle >= 1 ? { label: msg("fold.model.putToWork"), sentence: msg("fold.model.putUsdcToWork", { fmt: fmt(idle) }) } : null;
  }
  if (h.where === "wallet" && h.symbol === "EURC") return { label: msg("fold.model.convert"), sentence: msg("fold.model.convertEurcToUsdc", { fmt: fmt(amount / 2) }) };
  if (h.where === "wallet" && h.kind === "token" && h.symbol !== "USDC") return { label: msg("fold.model.reduce"), sentence: msg("fold.model.convertToUsdc", { fmt: fmt(amount / 2), symbol: h.symbol }) };
  return null;
}

/* ------------------------------------------------------ the assistant */

/** Unhandled insights worth a badge (act and watch) plus drafts waiting for a signature. */
export function badgeCount(insights: readonly FoldInsight[], waiting = 0): number {
  return insights.filter((i) => !i.handled && i.severity !== "info").length + waiting;
}

/** Lyko's first message, synthesised from the insights: a calm line, never a wall of alarms. */
export function openingLine(insights: readonly FoldInsight[], sample: boolean): string {
  const open = insights.filter((i) => !i.handled);
  if (open.length === 0) return sample ? msg("fold.model.thisIsASampleFlockConnect") : msg("fold.model.allQuietInTheValleyI");
  const act = open.filter((i) => i.severity === "act").length;
  const head = act > 0 ? msg("fold.model.yourAttention", { value: act === 1 ? msg("fold.model.oneThingWants") : msg("fold.model.thingsWant", { act }) }) : msg("fold.model.worthALook", { n: open.length });
  return msg("fold.model.iCanDraftEachOneFor", { head });
}

export const FOLLOW_UPS = [
  { question: "yield", label: msg("fold.model.explainMyYield") },
  { question: "whatif", label: msg("fold.model.amISafeIfEurcDrops") },
  { question: "week", label: msg("fold.model.whatRunsThisWeek") },
  { question: "approvals", label: msg("fold.model.tidyMyApprovals") },
] as const;

/** Shared threads for the rail: the server's list first (it has the Fold's turns too), then local-only ones. */
export function mergeThreads(local: readonly { readonly id: string; readonly title: string; readonly at: number }[], server: readonly ThreadSummaryView[]): { id: string; title: string; at: number; origin: "ask" | "fold" }[] {
  const seen = new Set<string>();
  const out: { id: string; title: string; at: number; origin: "ask" | "fold" }[] = [];
  for (const t of server) {
    seen.add(t.id);
    out.push({ id: t.id, title: t.title, at: Date.parse(t.updatedAt), origin: t.origin });
  }
  for (const t of local) if (!seen.has(t.id)) out.push({ ...t, origin: "ask" });
  return out.sort((a, b) => b.at - a.at).slice(0, 40);
}

/* ------------------------------------------------------- herding, trails */

export type HerdingFilter = "all" | RunningKind | "paused";

/** The Running list's filters: one per noun, then Paused. */
export const HERDING_FILTERS: readonly { readonly id: HerdingFilter; readonly label: string }[] = [
  { id: "all", label: msg("fold.model.all") },
  { id: "automation", label: msg("fold.model.automations") },
  { id: "order", label: msg("fold.model.orders") },
  { id: "watch", label: msg("fold.model.watches") },
  { id: "leash", label: msg("fold.model.leashes") },
  { id: "autopilot", label: "Autopilot" },
  { id: "plan", label: msg("fold.model.plans") },
  { id: "payment", label: msg("fold.model.payments") },
  { id: "paused", label: msg("fold.model.paused") },
];

/** `?show=` values, old ones included (rounds, alerts, recurring, watch). */
const SHOW_ALIASES: Readonly<Record<string, HerdingFilter>> = { all: "all", automations: "automation", automation: "automation", rounds: "automation", recurring: "automation", orders: "order", order: "order", watches: "watch", watch: "watch", alerts: "watch", leashes: "leash", leash: "leash", autopilot: "autopilot", plans: "plan", plan: "plan", payments: "payment", payment: "payment", paused: "paused" };

export function herdingFilterOf(value: string | null): HerdingFilter {
  return (value && SHOW_ALIASES[value]) || "all";
}

/** The noun a row is: the server says so; older answers are read from the source. */
export function kindOf(i: Pick<FoldInstruction, "source" | "kind">): RunningKind {
  if (i.kind) return i.kind;
  switch (i.source) {
    case "order":
      return "order";
    case "alert":
    case "watch":
      return "watch";
    case "plan":
      return "plan";
    case "leash":
    case "pack-agent":
      return "leash";
    case "autopilot":
      return "autopilot";
    case "invoice":
      return "payment";
    default:
      return "automation";
  }
}

export function filterInstructions(list: readonly FoldInstruction[], filter: HerdingFilter): FoldInstruction[] {
  if (filter === "all") return [...list];
  if (filter === "paused") return list.filter((i) => i.status === "paused");
  return list.filter((i) => kindOf(i) === filter);
}

/** Who signs each run, in the owner's words. */
export const SIGNER_LINE: Readonly<Record<RunningSigner, string>> = { you: msg("fold.model.youSignEachTime"), autopilot: msg("fold.model.autopilotSigns"), leash: msg("fold.model.itsLeashSigns") };

/** The one control a row offers: the server's, or (older answers) the same one built from the source. */
export function controlOf(i: FoldInstruction): RunningControl | null {
  if (i.control !== undefined) return i.control;
  if (i.stop) return { action: "stop", label: msg("fold.model.stop"), method: "post", path: `/v1/intents/${encodeURIComponent(i.stop.intentId)}/stop` };
  if (i.cancel) return { action: "cancel", label: msg("fold.model.cancel"), method: "get", path: `/v1/orders/${i.cancel.hash}/cancel-tx`, sign: "order-cancel" };
  if (!i.controllable || (i.status !== "active" && i.status !== "paused")) return null;
  const route = controlRoute(i, i.status === "paused" ? "resume" : "pause");
  return route ? { action: i.status === "paused" ? "resume" : "pause", label: i.status === "paused" ? msg("fold.model.resume") : msg("fold.model.pause"), method: route.method, path: route.path } : null;
}

export type TrailFilter = "all" | "settled" | "plans" | "refused" | "orders";
export const TRAIL_FILTERS: readonly { readonly id: TrailFilter; readonly label: string }[] = [
  { id: "all", label: msg("fold.model.everything") },
  { id: "settled", label: msg("fold.model.settled") },
  { id: "plans", label: msg("fold.model.plans") },
  { id: "refused", label: msg("fold.model.refusedAndFailed") },
  { id: "orders", label: msg("fold.model.ordersAndWatches") },
];

export function filterTrails(list: readonly FoldTrailEntry[], filter: TrailFilter): FoldTrailEntry[] {
  switch (filter) {
    case "settled":
      return list.filter((t) => t.kind === "settled");
    case "plans":
      return list.filter((t) => t.kind === "planned" || t.kind === "running" || t.kind === "proposal");
    case "refused":
      return list.filter((t) => t.kind === "refused" || t.kind === "failed");
    case "orders":
      return list.filter((t) => t.kind === "order" || t.kind === "alert");
    default:
      return [...list];
  }
}

/** Trails grouped by day, newest first ("Today", "Yesterday", "Mon 2 Nov"). */
export function byDay(list: readonly FoldTrailEntry[], now: number): { day: string; items: FoldTrailEntry[] }[] {
  const key = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const today = key(now);
  const yesterday = key(now - 86_400_000);
  const groups = new Map<string, FoldTrailEntry[]>();
  for (const t of list) {
    const k = key(Date.parse(t.at));
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, items]) => ({ day: k === today ? msg("fold.model.today") : k === yesterday ? msg("fold.model.yesterday") : new Date(`${k}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }), items }));
}

/** A proposal's place in its lifecycle, for the stepper. */
export function proposalStage(p: Pick<FoldProposal, "status">): 0 | 1 | 2 {
  return p.status === "proposed" ? 0 : p.status === "approved" ? 1 : 2;
}

/** Budget meter for an agent: used and left of the tightest cap. */
export function agentMeter(a: Pick<PackAgentView, "budget">): { used: number; cap: number | null; share: number; label: string } {
  const cap = a.budget.caps.dailyUsd ? Number(a.budget.caps.dailyUsd) : a.budget.caps.weeklyUsd ? Number(a.budget.caps.weeklyUsd) : null;
  const used = Number(a.budget.caps.dailyUsd ? a.budget.spent.dayUsd : a.budget.spent.weekUsd) || 0;
  return { used, cap, share: cap ? Math.min(1, used / cap) : 0, label: a.budget.caps.dailyUsd ? "today" : a.budget.caps.weeklyUsd ? msg("fold.model.thisWeek") : msg("fold.model.noCap") };
}

/* --------------------------------------------------------------- sample */

const SAMPLE_OWNER = "0x000000000000000000000000000000000000dEaD" as const;
const at = (minutesAgo: number, now: number) => new Date(now - minutesAgo * 60_000).toISOString();

/**
 * The signed-out flock: core's one sample fixture (sampleFold.ts), the same one Lyko on watch reads on the API, so
 * the Fold bar, the Flock tab, the Stress test and Lyko on watch all show one net worth. No block number: nothing
 * in it was read from Arc.
 */
export function sampleSnapshot(now: number): FlockSnapshot {
  return coreSampleSnapshot(now);
}

export function sampleInsights(now = 0): FoldInsight[] {
  // Every figure comes from the sample fixture, so the insights agree with the Fold bar and the Flock tab.
  const snap = coreSampleSnapshot(now);
  const usdc = Number(snap.holdings.find((h) => h.where === "wallet" && h.symbol === "USDC")?.usd ?? 0);
  const floor = 500;
  const idle = usdc - floor;
  const money = (n: number, d = 2) => formatUsd(n, { min: d, max: d });
  const health = snap.health[0]?.healthFactor ?? "1.38";
  const debt = Math.abs(Number(snap.holdings.find((h) => h.kind === "debt")?.usd ?? 0));
  const mix = currentMix(snap.holdings);
  return [
    { id: "idle-usdc", kind: "idle-usdc", severity: "act", title: msg("fold.model.ofUsdcIsRestingAboveYour", { money: money(idle, 0) }), explain: msg("fold.model.yourWalletKeepsLiquidForGas", { money: money(floor, 0) }), figures: [{ label: msg("fold.model.usdcInYourWallet"), value: money(usdc) }, { label: msg("fold.model.yourLiquidityFloor"), value: money(floor, 0) }, { label: msg("fold.model.idleAboveTheFloor"), value: money(idle) }], draft: { label: msg("fold.model.putItToWork"), sentence: msg("fold.model.putUsdcToWorkAtMedium", { Math: Math.floor(idle) }) }, handled: false, from: SAMPLE_FROM(now) },
    { id: "health-aave-v4", kind: "health-factor", severity: "watch", title: msg("fold.model.yourAaveV4LoanIsUnder"), explain: msg("fold.model.itsHealthIsAndYourFloor", { health }), figures: [{ label: msg("fold.model.loanHealthNow"), value: health }, { label: msg("fold.model.yourSafetyFloor"), value: "1.5" }, { label: msg("fold.model.repayingAQuarter"), value: money(debt / 4, 0) }], draft: { label: msg("fold.model.repayAQuarter"), sentence: msg("fold.model.repayUsdcOnAaveV4", { Math: Math.round(debt / 4) }) }, handled: false, from: SAMPLE_FROM(now) },
    { id: "fx-drift", kind: "fx-drift", severity: "info", title: msg("fold.model.eurcIsOfTheFlockYour", { Math: Math.round(mix.eurcPct) }), explain: msg("fold.model.insideYourBandOf10Points"), figures: [{ label: msg("fold.model.eurcShareNow"), value: `${Math.round(mix.eurcPct)}%` }, { label: msg("fold.model.yourTarget"), value: "10% ± 10" }], draft: null, handled: false, from: SAMPLE_FROM(now) },
  ];
}

const SAMPLE_FROM = (now: number) => ({ source: "sample", readAt: new Date(now).toISOString(), block: null });

/** The sample's one proposal waiting for a signature: the idle-USDC insight drafted, so the inbox and the bar agree. */
export function sampleWaiting(now: number): FoldProposal[] {
  const idle = sampleInsights(now)[0]!;
  return [{ id: "0x000000000000000000000000000000000000dead:prp_000000000001", owner: SAMPLE_OWNER, environment: "mainnet", source: { kind: "insight", ref: idle.id }, title: idle.title, sentence: idle.draft!.sentence, intentId: null, decision: "allow", reasons: [], steps: [`${idle.draft!.sentence} · Morpho Galaxy USDC`], status: "proposed", outcome: null, createdAt: at(12, now), updatedAt: at(12, now), history: [{ status: "proposed", at: at(12, now), note: null }] }];
}

export function sampleInstructions(now: number): FoldInstruction[] {
  const base = { controllable: true, environment: "mainnet" as const };
  const pause = (id: string): RunningControl => ({ action: "pause", label: msg("fold.model.pause"), method: "post", path: `/v1/automations/${id}/pause` });
  const rows: FoldInstruction[] = [
    { ...base, id: "so_sample_rent", source: "recurring", sourceLabel: msg("fold.model.recurringPayment"), kind: "automation", signs: "you", name: msg("fold.model.pay1200UsdcRentTo"), status: "active", trigger: msg("fold.model.monthlyOnDay1At09"), nextRunAt: at(-60 * 24 * 9, now), nextRunLabel: msg("fold.model.in9D"), nextLine: msg("fold.model.paysTheRentIn9D"), lastRunAt: at(60 * 24 * 21, now), lastResult: msg("fold.model.settled1Step"), nextVerdict: { decision: "allow", reason: msg("fold.model.everyRulePassedLastTime") }, editSentence: msg("fold.model.changeMyRentPayment"), control: pause("so_sample_rent") },
    { ...base, id: "atm_sample_sweep", source: "automation", sourceLabel: msg("fold.model.automation"), kind: "automation", signs: "you", name: msg("fold.model.sweepUsdcAbove5000Into"), status: "active", trigger: msg("fold.model.usdcBalanceAbove5000"), nextRunAt: null, nextRunLabel: msg("fold.model.onBalance"), nextLine: msg("fold.model.plansADepositWhenUsdcPasses"), lastRunAt: at(60 * 30, now), lastResult: msg("fold.model.plannedAllow"), nextVerdict: { decision: "unknown", reason: msg("fold.model.plannedAndCheckedByTheFence") }, editSentence: msg("fold.model.changeMySweep"), control: pause("atm_sample_sweep") },
    { ...base, id: "0xsample", source: "order", sourceLabel: msg("fold.model.order"), kind: "order", signs: "you", name: msg("fold.model.buyEurcWhenEurUsd1"), status: "waiting", trigger: msg("fold.model.waitingForCondition"), nextRunAt: null, nextRunLabel: msg("fold.model.onCondition"), nextLine: msg("fold.model.executesWhenEurUsdReaches1"), lastRunAt: null, lastResult: msg("fold.model.notFilledYet"), nextVerdict: { decision: "allow", reason: msg("fold.model.oneExecutionFitsYourFenceAnd") }, controllable: false, editSentence: msg("fold.model.changeMyEurcOrder"), cancel: { hash: "0x00000000000000000000000000000000000000000000000000000000000000a1", environment: "mainnet" }, control: { action: "cancel", label: msg("fold.model.cancel"), method: "get", path: "/v1/orders/0x00000000000000000000000000000000000000000000000000000000000000a1/cancel-tx", sign: "order-cancel" } },
    { ...base, id: "out_sampleplan01", source: "plan", sourceLabel: msg("fold.model.plan"), kind: "plan", signs: "you", name: msg("fold.model.swap500UsdcToEurcThen"), status: "active", trigger: msg("fold.model.n1Of2StepsSettled"), nextRunAt: null, nextRunLabel: msg("fold.model.yourSignature"), nextLine: msg("fold.model.waitsForYourSignatureDepositThe"), lastRunAt: at(25, now), lastResult: msg("fold.model.nextDepositTheEurcIntoMorpho"), nextVerdict: { decision: "allow", reason: msg("fold.model.everyRulePassedWhenItWas") }, controllable: false, editSentence: msg("fold.model.changeMyPlan"), stop: { intentId: "out_sampleplan01" }, control: { action: "stop", label: msg("fold.model.stop"), method: "post", path: "/v1/intents/out_sampleplan01/stop" } },
    { ...base, id: "al_sample", source: "alert", sourceLabel: msg("fold.model.watch"), kind: "watch", channels: ["in-app", "telegram"], name: msg("fold.model.healthFactorBelow13On"), status: "active", trigger: msg("fold.model.healthBelow"), nextRunAt: null, nextRunLabel: msg("fold.model.whenItHappens"), nextLine: msg("fold.model.tellsYouInAppAndOn"), lastRunAt: null, lastResult: msg("fold.model.quietSoFar"), nextVerdict: { decision: "allow", reason: msg("fold.model.aWatchOnlyTellsYouIt") }, editSentence: msg("fold.model.changeMyHealthWatch"), control: pause("al_sample") },
  ];
  for (const l of sampleLeashes(now)) {
    rows.push({ ...base, id: l.id, source: "leash", sourceLabel: l.spendFrom === "gateway" ? "Leash · Stile" : "Leash", kind: "leash", name: msg("fold.model.aDayInAll", { agentName: l.agentName, Number: Number(l.budget.perDayUsd), Number2: Number(l.budget.totalUsd) }), status: "active", trigger: l.spendFrom === "gateway" ? msg("fold.model.spendsFromYourGatewayBalanceThrough") : msg("fold.model.spendsFromYourLykiaaccountOnArc"), nextRunAt: l.expiresAt, nextRunLabel: msg("fold.model.keyStopsInD", { Math: Math.round((Date.parse(l.expiresAt) - now) / 86_400_000) }), nextLine: msg("fold.model.maySpendMoreTodayInOne", { remainingUsd: l.usage.day.remainingUsd, Number: Number(l.budget.perStepUsd) }), lastRunAt: l.recent[0]?.at ?? null, lastResult: l.recent[0]?.summary ?? null, nextVerdict: { decision: "allow", reason: msg("fold.model.everyStepIsCheckedAgainstThe") }, editSentence: msg("fold.model.changeSLeash", { agentName: l.agentName }), control: { action: "stop", label: msg("fold.model.revoke"), method: "post", path: `/v1/leashes/${l.id}/revoke`, sign: "revoke-session" } });
  }
  for (const a of samplePack()) {
    rows.push({ ...base, id: a.id, source: "pack-agent", sourceLabel: "Leash", kind: "leash", name: msg("fold.model.agentADay", { name: a.name, value: a.role.replace(/-/gu, " "), Number: Number(a.budget.caps.dailyUsd ?? 0) }), status: "active", trigger: msg("fold.model.proposesYouSign"), nextRunAt: null, nextRunLabel: msg("fold.model.whenYouAsk"), nextLine: msg("fold.model.mayProposeUpToADay", { Number: Number(a.budget.caps.dailyUsd ?? 0) }), lastRunAt: null, lastResult: null, nextVerdict: { decision: "allow", reason: msg("fold.model.itsOwnFenceSitsInsideYours") }, editSentence: msg("fold.model.changeMyAgent", { name: a.name }), control: { action: "pause", label: msg("fold.model.pause"), method: "post", path: `/v1/pack/${a.id}/pause` } });
  }
  const ap = sampleAutopilot(now).autopilot!;
  rows.push({ ...base, id: "autopilot:mainnet", source: "autopilot", sourceLabel: "Autopilot", kind: "autopilot", signs: "autopilot", name: msg("fold.model.autopilotOnArcMainnetUpTo", { perStepUsd: ap.limits.perStepUsd, perDayUsd: ap.limits.perDayUsd }), status: "active", trigger: `${ap.tasks.length} tasks`, nextRunAt: null, nextRunLabel: msg("fold.model.runsItsTasks"), nextLine: msg("fold.model.signsYourOwnAutomationsBelowInside", { perDayUsd: ap.limits.perDayUsd }), lastRunAt: ap.updatedAt, lastResult: null, nextVerdict: { decision: "allow", reason: msg("fold.model.eachRunIsCheckedAgainstYour") }, editSentence: msg("fold.model.changeMyAutopilot"), control: { action: "pause", label: msg("fold.model.pause"), method: "post", path: "/v1/autopilot/pause", body: { environment: "mainnet" } } });
  for (const t of ap.tasks) {
    rows.push({ ...base, id: t.id, source: "autopilot-task", sourceLabel: msg("fold.model.automation"), kind: "automation", signs: "autopilot", name: t.label, status: "active", trigger: t.when.kind === "schedule" ? msg("common.everyUnit", { unit: t.when.every }) : msg("fold.model.whenItsConditionHolds"), nextRunAt: null, nextRunLabel: t.when.kind === "schedule" ? msg("common.everyUnit", { unit: t.when.every }) : msg("fold.model.onCondition"), nextLine: msg("fold.model.autopilotSignsUpTo", { value: t.when.kind === "schedule" ? msg("fold.model.runsEvery", { every: t.when.every }) : msg("fold.model.runsWhenItsConditionHolds"), amountUsd: t.amountUsd }), lastRunAt: t.lastRunAt, lastResult: t.lastResult ?? msg("fold.model.notRunYet"), nextVerdict: { decision: "allow", reason: msg("fold.model.autopilotSignsAtMostARun", { amountUsd: t.amountUsd }) }, editSentence: msg("fold.model.changeMyAutomation", { label: t.label }), control: { action: "pause", label: msg("fold.model.pause"), method: "post", path: `/v1/autopilot/tasks/${t.id}/pause`, body: { environment: "mainnet" } } });
  }
  rows.push({ ...base, id: "inv_sample_logo", source: "invoice", sourceLabel: msg("fold.model.paymentLink"), kind: "payment", name: msg("fold.model.logoDesignNovember120Usdc"), status: "active", trigger: "open", nextRunAt: null, nextRunLabel: msg("fold.model.whenPaid"), nextLine: msg("fold.model.waitsForThePayerLykiaRecords"), lastRunAt: null, lastResult: msg("fold.model.notPaidYet"), nextVerdict: { decision: "allow", reason: msg("fold.model.moneyComesInNothingLeavesYour") }, editSentence: msg("fold.model.changeMyPaymentLinkLogoDesign"), control: { action: "cancel", label: msg("fold.model.cancel"), method: "post", path: "/v1/invoices/inv_sample_logo/void" } });
  return rows;
}

export function sampleTrails(now: number): FoldTrailEntry[] {
  return [
    { id: "t1", at: at(42, now), kind: "settled", title: msg("fold.model.deposit4200UsdcIntoGalaxy"), detail: msg("fold.model.putHalfMyUsdcToWork"), environment: "mainnet", memo: "lykia:1:int_sample:s1:7c2f9a01d4e5b6c8", verdict: { decision: "allow", digest: "sha256:7c2f9a01d4e5b6c8" }, transactions: ["0x9f1c…a2d4"], feeUsd: "42.00", link: null },
    { id: "t2", at: at(60 * 20, now), kind: "settled", title: msg("fold.model.send1200UsdcToLandlord"), detail: msg("fold.model.rentOneTransactionWithAnArc"), environment: "mainnet", memo: "lykia:1:int_rent:s1:1a2b3c4d5e6f7a8b", verdict: { decision: "allow", digest: "sha256:1a2b3c4d5e6f7a8b" }, transactions: ["0x41aa…09be"], feeUsd: "12.00", link: null },
    { id: "t3", at: at(60 * 26, now), kind: "refused", title: msg("fold.model.send9000UsdcToA"), detail: msg("fold.model.theDailyCapIs5000"), environment: "mainnet", memo: null, verdict: { decision: "deny", digest: "sha256:ffee00112233aabb" }, transactions: [], feeUsd: null, link: null },
    { id: "t4", at: at(60 * 50, now), kind: "order", title: msg("fold.model.buyEurcWhenEurUsd1"), detail: msg("fold.model.waiting0Of1Executed"), environment: "mainnet", memo: null, verdict: null, transactions: [], feeUsd: null, link: null },
  ];
}

export function samplePack(): PackAgentView[] {
  const agent = (id: string, name: string, role: PackAgentView["role"], daily: string, spent: string, tag?: string) =>
    ({ schema: "lykia.pack/v1", id, owner: SAMPLE_OWNER, environment: "mainnet", parentId: null, depth: 1, name, role, capabilities: ["read", "plan"], fence: {} as never, fenceHash: "sha256:00", ...(tag ? { agentId: tag } : {}), status: "active", createdAt: "2026-10-01T00:00:00.000Z", budget: { caps: { dailyUsd: daily }, allocated: {}, free: {}, spent: { dayUsd: spent, weekUsd: spent } }, children: [] }) as unknown as PackAgentView;
  // One agent without an outside leash; the sample leashes (leash/model.ts) are the agents that hold one.
  return [agent("agt_payroll", msg("fold.model.payroll"), "payroll", "500", "120", "1842")];
}

/**
 * The Fold bar's counts from Herding's Running list, the way the API counts them (fold/instructions.ts and the
 * summary route): instructions are the running rows that are not orders, plans or leashes; agents working are the
 * leash rows. The sample uses the same formula on its own list, so the bar and Herding always agree.
 */
export function countsOf(instructions: readonly FoldInstruction[], waiting: readonly FoldProposal[]): FoldCounts {
  const running = instructions.filter((i) => (i.status === "active" || i.status === "waiting") && kindOf(i) !== "plan");
  const orders = running.filter((i) => kindOf(i) === "order").length;
  const agents = running.filter((i) => kindOf(i) === "leash").length;
  return { rules: running.length - orders - agents, ordersWaiting: orders, agentsWorking: agents, proposalsWaiting: waiting.length };
}

export const SAMPLE_COUNTS: FoldCounts = countsOf(sampleInstructions(0), sampleWaiting(0));

/* ---------------------------------------------------------------- fence */

/** The Fence in human words, one rule per line, strongest first. */
export function fenceInWords(f: Fence): { readonly rule: string; readonly text: string }[] {
  const out: { rule: string; text: string }[] = [];
  const money = (v: string) => formatUsd(Number(v), { min: 0 });
  if (f.mode === "whistle") out.push({ rule: "Whistle", text: msg("fold.model.theWhistleIsBlownNothingNew") });
  else if (f.mode === "dry-run") out.push({ rule: "Mode", text: msg("fold.model.dryRunLykoPlansAndChecks") });
  const c = f.caps ?? {};
  if (c.perStepUsd) out.push({ rule: "Per step", text: msg("fold.model.noSingleStepMovesMoreThan", { money: money(c.perStepUsd) }) });
  if (c.perIntentUsd) out.push({ rule: "Per plan", text: msg("fold.model.noPlanMovesMoreThanIn", { money: money(c.perIntentUsd) }) });
  if (c.dailyUsd) out.push({ rule: "Per day", text: msg("fold.model.atMostLeavesInADay", { money: money(c.dailyUsd) }) });
  if (c.weeklyUsd) out.push({ rule: "Per week", text: msg("fold.model.atMostLeavesInAWeek", { money: money(c.weeklyUsd) }) });
  const r = f.recipients?.mode ?? "own";
  out.push({ rule: "Recipients", text: r === "own" ? msg("fold.model.moneyOnlyGoesToYourOwn") : r === "allowlist" ? msg("fold.model.moneyOnlyGoesToAddressEs", { value: f.recipients?.allow?.length ?? 0 }) : msg("fold.model.moneyMayGoToAnyAddress") });
  if (f.venues?.allow?.length) out.push({ rule: "Venues", text: msg("fold.model.onlyTheseVenues", { value: f.venues.allow.join(", ") }) });
  if (f.venues?.deny?.length) out.push({ rule: "Never", text: msg("fold.model.neverRoutedThrough", { value: f.venues.deny.join(", ") }) });
  if (f.limits?.maxSlippageBps !== undefined) out.push({ rule: "Slippage", text: msg("fold.model.aSwapMayLoseAtMost", { value: (f.limits.maxSlippageBps / 100).toFixed(2) }) });
  if (f.lending?.minHealthFactor) out.push({ rule: "Health", text: msg("fold.model.borrowingNeverPushesAHealthFactor", { minHealthFactor: f.lending.minHealthFactor }) });
  if (f.fx?.maxDeviationBps !== undefined) out.push({ rule: "FX band", text: msg("fold.model.aCurrencyQuoteMayBeAt", { value: (f.fx.maxDeviationBps / 100).toFixed(2) }) });
  if (f.scent?.require && f.scent.require !== "off") out.push({ rule: "Tokens", text: f.scent.require === "verified" ? msg("fold.model.onlyVerifiedRegistryTokens") : msg("fold.model.noTokenWithRedFlags") });
  if (f.tokens?.unlisted === "deny") out.push({ rule: "Unlisted", text: msg("fold.model.tokensOutsideTheRegistryAreRefused") });
  if (f.confirm?.aboveUsd) out.push({ rule: "Confirm", text: msg("fold.model.anythingAboveAsksYouFirst", { money: money(f.confirm.aboveUsd) }) });
  if (f.schedule) out.push({ rule: "Hours", text: msg("fold.model.onlyInsideYourOfficeHours", { timezone: f.schedule.timezone }) });
  return out;
}

/** Ready Fence edits Lyko can propose in one tap. Tightening applies at once; loosening asks for your wallet. */
export function fenceSuggestions(f: Fence): { readonly label: string; readonly patch: Record<string, unknown> }[] {
  const out: { label: string; patch: Record<string, unknown> }[] = [];
  const daily = f.caps?.dailyUsd ? Number(f.caps.dailyUsd) : null;
  if (daily === null || daily > 1000) out.push({ label: msg("fold.model.lowerTheDailyCapTo1"), patch: { caps: { ...f.caps, dailyUsd: "1000" } } });
  if (f.scent?.require !== "verified") out.push({ label: msg("fold.model.onlyVerifiedTokens"), patch: { scent: { require: "verified" } } });
  if (!f.confirm?.aboveUsd || Number(f.confirm.aboveUsd) > 500) out.push({ label: msg("fold.model.askMeAbove500"), patch: { confirm: { ...f.confirm, aboveUsd: "500" } } });
  if ((f.limits?.maxSlippageBps ?? 1000) > 50) out.push({ label: msg("fold.model.slippageAtMost05"), patch: { limits: { ...f.limits, maxSlippageBps: 50 } } });
  if (!f.lending?.minHealthFactor || Number(f.lending.minHealthFactor) < 1.5) out.push({ label: msg("fold.model.healthFactorFloor15"), patch: { lending: { minHealthFactor: "1.5" } } });
  return out.slice(0, 4);
}

/** A Fence with a patch applied (one level deep, like the server merges). */
export function applyFencePatch(f: Fence, patch: Readonly<Record<string, unknown>>): Fence {
  const out: Record<string, unknown> = { ...f };
  for (const [k, v] of Object.entries(patch)) {
    const cur = (f as unknown as Record<string, unknown>)[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur) ? { ...(cur as object), ...(v as object) } : v;
  }
  return out as unknown as Fence;
}

/** Where a Herding row is paused, resumed or removed: the endpoint that owns it. Orders are cancelled with a signed transaction instead. */
export function controlRoute(i: Pick<FoldInstruction, "id" | "source">, action: "pause" | "resume" | "remove"): { method: "post" | "delete"; path: string; body: "owner" | "none"; query: "owner" | "none" } | null {
  if (i.source === "order" || i.source === "plan") return null;
  if (i.source === "watch" || i.id.includes(":ins_")) return { method: "post", path: `/v1/agent/instructions/${encodeURIComponent(i.id)}/${action}`, body: "owner", query: "none" };
  // Automations, standing orders, recurring payments, alerts and agent automations all live behind /v1/automations/:id.
  if (action === "remove") return { method: "delete", path: `/v1/automations/${encodeURIComponent(i.id)}`, body: "none", query: "owner" };
  return { method: "post", path: `/v1/automations/${encodeURIComponent(i.id)}/${action}`, body: "none", query: "owner" };
}


/* ---------------------------------------------------------------- whistle */

export const WHISTLE_KIND_LABEL: Readonly<Record<WhistleItemKind, string>> = {
  automation: msg("fold.model.automation"),
  standing: msg("fold.model.automationYouSign"),
  "agent-automation": msg("fold.model.automationItsLeashSigns"),
  agent: msg("fold.model.agentLeashOnLykia"),
  leash: msg("fold.model.leashKeyOff"),
  autopilot: "Autopilot",
  alert: msg("fold.model.watch"),
};

/** One line per kind, in the order the sheet lists them. */
export function whistleGroups(items: readonly WhistleItem[]): { kind: WhistleItemKind; label: string; items: WhistleItem[] }[] {
  const order: WhistleItemKind[] = ["autopilot", "agent", "leash", "automation", "standing", "agent-automation", "alert"];
  return order.map((kind) => ({ kind, label: WHISTLE_KIND_LABEL[kind], items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);
}


/* ------------------------------------------------------- acting from a row */

/**
 * "Ask about this" on a position: one scoped question for Lyko on watch and
 * the position as context (what it is, what it is doing, its value and the
 * block it was read at), so the answer is about this row and nothing else.
 */
export function askAboutPosition(p: Position): { readonly question: string; readonly context: string } {
  const next = p.actions[0] ? msg("fold.model.itsNextAction", { value: p.actions[0].label.toLowerCase(), sentence: p.actions[0].sentence }) : "";
  return {
    question: msg("fold.model.aboutMyWhatIsItDoing", { label: p.label, venueName: p.venueName }),
    // i18n-ignore: context handed to Lyko with the question; tool data stays English.
    context: `Position ${p.label} at ${p.venueName}: ${p.doing}. State ${p.state}. Value ${p.valueUsd ?? "unpriced"} USD, read at block ${p.block ?? "n/a"}.${next}`.slice(0, 1000),
  };
}

export interface TrailLink {
  readonly label: string;
  readonly href: string;
  readonly external: boolean;
}

/**
 * Where a trail row leads: its Herding row while it still runs or waits,
 * else its transaction on the explorer (full hashes only), else its plan.
 */
export function trailLink(t: FoldTrailEntry): TrailLink | null {
  if (t.kind === "running" || t.kind === "planned" || t.kind === "order" || t.kind === "alert" || t.kind === "proposal") return { label: msg("fold.model.inHerding"), href: "/app/fold/herding", external: false };
  const tx = t.transactions.find((h) => /^0x[0-9a-fA-F]{64}$/.test(h));
  if (tx) return { label: msg("fold.model.transaction"), href: explorerTx(networkFor(t.environment), tx), external: true };
  if (t.link && t.link.startsWith("/app/")) return { label: msg("fold.model.thePlan"), href: t.link, external: false };
  return null;
}

/** "Ask why" on a trail row: a question Lyko on watch answers from the trail, with the row as context. */
export function askWhyTrail(t: FoldTrailEntry): { readonly question: string; readonly context: string } {
  const what = t.kind === "refused" ? msg("fold.model.wasThisRefused") : t.kind === "failed" ? msg("fold.model.didThisFail") : t.kind === "settled" ? msg("fold.model.didThisHappenAndWhatDid") : msg("fold.model.isThisHere");
  return {
    question: msg("fold.model.why", { what, title: t.title }),
    // i18n-ignore: context handed to Lyko with the question; tool data stays English.
    context: `Trail entry (${t.kind}, ${t.at}, Arc ${t.environment}): ${t.title}. ${t.detail}${t.verdict ? msg("fold.model.fenceVerdict", { decision: t.verdict.decision, value: t.verdict.digest.slice(0, 18) }) : ""}${t.feeUsd ? msg("fold.model.fee", { feeUsd: t.feeUsd }) : ""}`.slice(0, 1000),
  };
}

/** The yield explanation with its fee line set to the Trails total, so the page shows one fee figure. */
export function withTrailFees<T extends { readonly lines: readonly { readonly label: string; readonly value: string }[] }>(artifact: T, feesUsd: string | null): T {
  if (feesUsd === null) return artifact;
  return { ...artifact, lines: artifact.lines.map((l) => (l.label.startsWith("Lykia fees") ? { ...l, value: `$${feesUsd}` } : l)) };
}

/**
 * The insight's one primary action, decided from what it carries:
 * - sent to Ask already: open that exact thread;
 * - drafted already: open Herding, where the draft waits to be signed;
 * - a draft Lyko can write here (owner signed in): write it now and open the sign sheet in place;
 * - otherwise (the sample, or reading another address): Ask Lyko with the sentence written out.
 */
export type InsightAction = { readonly kind: "thread"; readonly label: string } | { readonly kind: "herding"; readonly label: string } | { readonly kind: "draft"; readonly label: string } | { readonly kind: "ask"; readonly label: string } | { readonly kind: "receive"; readonly label: string; readonly address: string } | { readonly kind: "link"; readonly label: string; readonly href: string };

export function insightAction(insight: FoldInsight, canDraft: boolean): InsightAction {
  if (insight.sent) return { kind: "thread", label: msg("fold.model.openThePlan") };
  // A fix that needs no transaction from this wallet (adding USDC to it, opening a page) is never a draft to sign.
  if (insight.draft?.receive) return { kind: "receive", label: insight.draft.label, address: insight.draft.receive };
  if (insight.draft?.href && !insight.draft.sentence) return { kind: "link", label: insight.draft.label, href: insight.draft.href };
  if (insight.handled) return { kind: "herding", label: msg("fold.model.signItInHerding") };
  if (insight.draft && canDraft) return { kind: "draft", label: insight.draft.label };
  if (insight.draft) return { kind: "ask", label: msg("fold.model.inAsk", { label: insight.draft.label }) };
  return { kind: "ask", label: msg("fold.model.askLyko") };
}
