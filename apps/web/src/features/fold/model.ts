/**
 * The Fold's UI model: pure functions and the labelled sample a signed-out
 * visitor sees. Node tests import this file directly, so it imports types
 * and @lykia/core only.
 */
import { ALLOCATION_LABELS, allocationOf, currentMix, FOLD_TABS, LYKIA_TERMS, roomTodayLine, sampleSnapshot as coreSampleSnapshot, type AllocationBucket, type Fence, type FoldPreferences, type FoldTab } from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";
import { sampleAutopilot } from "./autopilot/model";
import { sampleLeashes } from "./leash/model";
import type { FlockHolding, FlockSnapshot } from "@lykia/core/api/flock";
import type { FoldInsight, FoldInstruction, FoldProposal, FoldTrailEntry, RunningControl, RunningKind, RunningSigner, ThreadSummaryView, WhistleItem, WhistleItemKind } from "@lykia/core/api/fold";

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
  flock: { id: "flock", label: LYKIA_TERMS.flock.word, sub: LYKIA_TERMS.flock.plain, line: "Everything you own on Arc: what it is, what it is worth and what it is doing. Tap a row for details." },
  trails: { id: "trails", label: LYKIA_TERMS.trails.word, sub: LYKIA_TERMS.trails.plain, line: "Everything that happened: payments, plans, refusals and fees, each with why." },
  herding: { id: "herding", label: LYKIA_TERMS.herding.word, sub: LYKIA_TERMS.herding.plain, line: "Everything in motion, one row each, with what happens next and one control. Anything you start in Ask Lyko shows up here." },
  pack: { id: "pack", label: LYKIA_TERMS.pack.word, sub: LYKIA_TERMS.pack.plain, line: "One card per agent: the leash it holds, its budget and Revoke. New agents start in Ask Lyko." },
  fence: { id: "fence", label: LYKIA_TERMS.fence.word, sub: LYKIA_TERMS.fence.plain, line: "The limits every move must pass, how much room is left today, and how to change them." },
};

/** The phone-only tab for the docked assistant. */
export const LYKO_TAB = { id: "lyko", label: "Lyko", sub: "your assistant" } as const;
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
  if (n === null || n === undefined || !Number.isFinite(n)) return "unpriced";
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function compactUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 10_000) return `$${(n / 1000).toFixed(0)}k`;
  if (a >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
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
  return { spent, cap, capLabel: cap === null ? "No daily cap" : cap === betaCap && betaCap !== fenceCap ? "Beta daily cap" : "Fence daily cap", left: cap === null ? null : Math.max(0, cap - spent), share, tone: share >= 0.95 ? "bad" : share >= 0.8 ? "warn" : "ok", fenceCap, betaCap };
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
    c.rules > 0 ? plural(c.rules, "instruction runs on its own", "instructions run on their own") : null,
    c.ordersWaiting > 0 ? plural(c.ordersWaiting, "order waits for its price", "orders wait for their price") : null,
    c.agentsWorking > 0 ? plural(c.agentsWorking, "agent on a leash works for you", "agents on a leash work for you") : null,
    c.proposalsWaiting ? plural(c.proposalsWaiting, "draft waits for your signature", "drafts wait for your signature") : null,
  ].filter((x): x is string => x !== null);
  return parts.length === 0 ? "Nothing runs on its own yet." : parts.join(" · ");
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

const VENUE_NAMES: Readonly<Record<string, string>> = { wallet: "Wallet", gateway: "Gateway", "morpho-vaults": "Morpho", "morpho-blue": "Morpho", "aave-v4": "Aave V4", usyc: "USYC", orders: "Orders" };
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
  if (h.kind === "debt") return { label: "Repay", sentence: `Repay ${fmt(Math.abs(amount) / 4)} ${h.symbol} on ${h.where}` };
  if (h.kind === "vault" || h.kind === "supply") return { label: "Withdraw", sentence: `Withdraw ${fmt(Math.abs(value ?? amount) / 2)} USDC from ${venueName(h.where)}` };
  if (h.where === "wallet" && h.symbol === "USDC") {
    const idle = (value ?? amount) - floorUsd;
    return idle >= 1 ? { label: "Put to work", sentence: `Put ${fmt(idle)} USDC to work` } : null;
  }
  if (h.where === "wallet" && h.symbol === "EURC") return { label: "Convert", sentence: `Convert ${fmt(amount / 2)} EURC to USDC` };
  if (h.where === "wallet" && h.kind === "token" && h.symbol !== "USDC") return { label: "Reduce", sentence: `Convert ${fmt(amount / 2)} ${h.symbol} to USDC` };
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
  if (open.length === 0) return sample ? "This is a sample flock. Connect a wallet and I will watch yours." : "All quiet in the valley. I will say something when anything changes.";
  const act = open.filter((i) => i.severity === "act").length;
  const head = act > 0 ? `${act === 1 ? "One thing wants" : `${act} things want`} your attention` : `${open.length === 1 ? "One thing" : `${open.length} things`} worth a look`;
  return `${head}. I can draft each one for you; nothing moves until you sign.`;
}

export const FOLLOW_UPS = [
  { question: "yield", label: "Explain my yield" },
  { question: "whatif", label: "Am I safe if EURC drops 5%?" },
  { question: "week", label: "What runs this week?" },
  { question: "approvals", label: "Tidy my approvals" },
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
  { id: "all", label: "All" },
  { id: "automation", label: "Automations" },
  { id: "order", label: "Orders" },
  { id: "watch", label: "Watches" },
  { id: "leash", label: "Leashes" },
  { id: "autopilot", label: "Autopilot" },
  { id: "plan", label: "Plans" },
  { id: "payment", label: "Payments" },
  { id: "paused", label: "Paused" },
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
export const SIGNER_LINE: Readonly<Record<RunningSigner, string>> = { you: "You sign each time", autopilot: "Autopilot signs", leash: "Its leash signs" };

/** The one control a row offers: the server's, or (older answers) the same one built from the source. */
export function controlOf(i: FoldInstruction): RunningControl | null {
  if (i.control !== undefined) return i.control;
  if (i.stop) return { action: "stop", label: "Stop", method: "post", path: `/v1/intents/${encodeURIComponent(i.stop.intentId)}/stop` };
  if (i.cancel) return { action: "cancel", label: "Cancel", method: "get", path: `/v1/orders/${i.cancel.hash}/cancel-tx`, sign: "order-cancel" };
  if (!i.controllable || (i.status !== "active" && i.status !== "paused")) return null;
  const route = controlRoute(i, i.status === "paused" ? "resume" : "pause");
  return route ? { action: i.status === "paused" ? "resume" : "pause", label: i.status === "paused" ? "Resume" : "Pause", method: route.method, path: route.path } : null;
}

export type TrailFilter = "all" | "settled" | "plans" | "refused" | "orders";
export const TRAIL_FILTERS: readonly { readonly id: TrailFilter; readonly label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "settled", label: "Settled" },
  { id: "plans", label: "Plans" },
  { id: "refused", label: "Refused and failed" },
  { id: "orders", label: "Orders and alerts" },
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
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, items]) => ({ day: k === today ? "Today" : k === yesterday ? "Yesterday" : new Date(`${k}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }), items }));
}

/** A proposal's place in its lifecycle, for the stepper. */
export function proposalStage(p: Pick<FoldProposal, "status">): 0 | 1 | 2 {
  return p.status === "proposed" ? 0 : p.status === "approved" ? 1 : 2;
}

/** Budget meter for an agent: used and left of the tightest cap. */
export function agentMeter(a: Pick<PackAgentView, "budget">): { used: number; cap: number | null; share: number; label: string } {
  const cap = a.budget.caps.dailyUsd ? Number(a.budget.caps.dailyUsd) : a.budget.caps.weeklyUsd ? Number(a.budget.caps.weeklyUsd) : null;
  const used = Number(a.budget.caps.dailyUsd ? a.budget.spent.dayUsd : a.budget.spent.weekUsd) || 0;
  return { used, cap, share: cap ? Math.min(1, used / cap) : 0, label: a.budget.caps.dailyUsd ? "today" : a.budget.caps.weeklyUsd ? "this week" : "no cap" };
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
  const money = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  const health = snap.health[0]?.healthFactor ?? "1.38";
  const debt = Math.abs(Number(snap.holdings.find((h) => h.kind === "debt")?.usd ?? 0));
  const mix = currentMix(snap.holdings);
  return [
    { id: "idle-usdc", kind: "idle-usdc", severity: "act", title: `${money(idle, 0)} of USDC is resting above your floor`, explain: `Your wallet keeps ${money(floor, 0)} liquid for gas and payments. The rest earns nothing while it sits; a medium-risk lending market or vault on Arc can hold it and you can withdraw any time.`, figures: [{ label: "USDC in your wallet", value: money(usdc) }, { label: "Your liquidity floor", value: money(floor, 0) }, { label: "Idle above the floor", value: money(idle) }], draft: { label: "Put it to work", sentence: `Put ${Math.floor(idle)} USDC to work at medium risk` }, handled: false, from: SAMPLE_FROM(now) },
    { id: "health-aave-v4", kind: "health-factor", severity: "watch", title: "Your Aave V4 loan is under your safety floor", explain: `Its health is ${health} and your floor is 1.5. At 1.00 part of your collateral can be sold to repay the loan. Repaying part of the debt raises it.`, figures: [{ label: "Loan health now", value: health }, { label: "Your safety floor", value: "1.5" }, { label: "Repaying a quarter", value: money(debt / 4, 0) }], draft: { label: "Repay a quarter", sentence: `Repay ${Math.round(debt / 4)} USDC on aave-v4` }, handled: false, from: SAMPLE_FROM(now) },
    { id: "fx-drift", kind: "fx-drift", severity: "info", title: `EURC is ${Math.round(mix.eurcPct)}% of the Flock; your target is 10%`, explain: "Inside your band of 10 points, so nothing to do yet. Lyko keeps an eye on it.", figures: [{ label: "EURC share now", value: `${Math.round(mix.eurcPct)}%` }, { label: "Your target", value: "10% ± 10" }], draft: null, handled: false, from: SAMPLE_FROM(now) },
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
  const pause = (id: string): RunningControl => ({ action: "pause", label: "Pause", method: "post", path: `/v1/automations/${id}/pause` });
  const rows: FoldInstruction[] = [
    { ...base, id: "so_sample_rent", source: "recurring", sourceLabel: "Recurring payment", kind: "automation", signs: "you", name: "Pay 1,200 USDC rent to @landlord on the 1st", status: "active", trigger: "monthly on day 1 at 09:00", nextRunAt: at(-60 * 24 * 9, now), nextRunLabel: "in 9 d", nextLine: "Pays the rent in 9 d; you sign it.", lastRunAt: at(60 * 24 * 21, now), lastResult: "Settled · 1 step", nextVerdict: { decision: "allow", reason: "Every rule passed last time." }, editSentence: "Change my rent payment: ", control: pause("so_sample_rent") },
    { ...base, id: "atm_sample_sweep", source: "automation", sourceLabel: "Automation", kind: "automation", signs: "you", name: "Sweep USDC above $5,000 into the Galaxy vault", status: "active", trigger: "USDC balance above 5000", nextRunAt: null, nextRunLabel: "on balance", nextLine: "Plans a deposit when USDC passes $5,000; you sign what it plans.", lastRunAt: at(60 * 30, now), lastResult: "Planned (allow)", nextVerdict: { decision: "unknown", reason: "Planned and checked by the Fence when it fires." }, editSentence: "Change my sweep: ", control: pause("atm_sample_sweep") },
    { ...base, id: "0xsample", source: "order", sourceLabel: "Order", kind: "order", signs: "you", name: "Buy EURC when EUR/USD ≤ 1.09", status: "waiting", trigger: "waiting for condition", nextRunAt: null, nextRunLabel: "on condition", nextLine: "Executes when EUR/USD reaches 1.09; a keeper runs it inside the terms you signed.", lastRunAt: null, lastResult: "Not filled yet", nextVerdict: { decision: "allow", reason: "One execution fits your Fence and the beta cap today; LykiaOrders enforces the price, size and deadline on chain." }, controllable: false, editSentence: "Change my EURC order: ", cancel: { hash: "0x00000000000000000000000000000000000000000000000000000000000000a1", environment: "mainnet" }, control: { action: "cancel", label: "Cancel", method: "get", path: "/v1/orders/0x00000000000000000000000000000000000000000000000000000000000000a1/cancel-tx", sign: "order-cancel" } },
    { ...base, id: "out_sampleplan01", source: "plan", sourceLabel: "Plan", kind: "plan", signs: "you", name: "Swap 500 USDC to EURC, then deposit it into Morpho", status: "active", trigger: "1 of 2 steps settled", nextRunAt: null, nextRunLabel: "your signature", nextLine: "Waits for your signature: deposit the EURC into Morpho Galaxy EURC.", lastRunAt: at(25, now), lastResult: "Next: Deposit the EURC into Morpho Galaxy EURC", nextVerdict: { decision: "allow", reason: "Every rule passed when it was planned; each step is checked again before you sign." }, controllable: false, editSentence: "Change my plan: ", stop: { intentId: "out_sampleplan01" }, control: { action: "stop", label: "Stop", method: "post", path: "/v1/intents/out_sampleplan01/stop" } },
    { ...base, id: "al_sample", source: "alert", sourceLabel: "Watch", kind: "watch", channels: ["in-app", "telegram"], name: "Health factor below 1.3 on Aave V4", status: "active", trigger: "health below", nextRunAt: null, nextRunLabel: "when it happens", nextLine: "Tells you in-app and on Telegram when it happens.", lastRunAt: null, lastResult: "Quiet so far", nextVerdict: { decision: "allow", reason: "A watch only tells you; it moves nothing." }, editSentence: "Change my health watch: ", control: pause("al_sample") },
  ];
  for (const l of sampleLeashes(now)) {
    rows.push({ ...base, id: l.id, source: "leash", sourceLabel: l.spendFrom === "gateway" ? "Leash · Stile" : "Leash", kind: "leash", name: `${l.agentName}: $${Number(l.budget.perDayUsd)} a day, $${Number(l.budget.totalUsd)} in all`, status: "active", trigger: l.spendFrom === "gateway" ? "spends from your Gateway balance through your LykiaStile" : "spends from your LykiaAccount on Arc", nextRunAt: l.expiresAt, nextRunLabel: `key stops in ${Math.round((Date.parse(l.expiresAt) - now) / 86_400_000)} d`, nextLine: `May spend $${l.usage.day.remainingUsd} more today, $${Number(l.budget.perStepUsd)} in one step.`, lastRunAt: l.recent[0]?.at ?? null, lastResult: l.recent[0]?.summary ?? null, nextVerdict: { decision: "allow", reason: "Every step is checked against the leash's Fence, its budget and the session's limits on chain." }, editSentence: `Change ${l.agentName}'s leash: `, control: { action: "stop", label: "Revoke", method: "post", path: `/v1/leashes/${l.id}/revoke`, sign: "revoke-session" } });
  }
  for (const a of samplePack()) {
    rows.push({ ...base, id: a.id, source: "pack-agent", sourceLabel: "Leash", kind: "leash", name: `${a.name}: ${a.role.replace(/-/gu, " ")} agent, $${Number(a.budget.caps.dailyUsd ?? 0)} a day`, status: "active", trigger: "proposes; you sign", nextRunAt: null, nextRunLabel: "when you ask", nextLine: `May propose up to $${Number(a.budget.caps.dailyUsd ?? 0)} a day; you sign each plan.`, lastRunAt: null, lastResult: null, nextVerdict: { decision: "allow", reason: "Its own Fence sits inside yours; its budget is carved from yours." }, editSentence: `Change my agent ${a.name}: `, control: { action: "pause", label: "Pause", method: "post", path: `/v1/pack/${a.id}/pause` } });
  }
  const ap = sampleAutopilot(now).autopilot!;
  rows.push({ ...base, id: "autopilot:mainnet", source: "autopilot", sourceLabel: "Autopilot", kind: "autopilot", signs: "autopilot", name: `Autopilot on Arc mainnet: up to $${ap.limits.perStepUsd} a step, $${ap.limits.perDayUsd} a day`, status: "active", trigger: `${ap.tasks.length} tasks`, nextRunAt: null, nextRunLabel: "runs its tasks", nextLine: `Signs your own automations below, inside $${ap.limits.perDayUsd} a day.`, lastRunAt: ap.updatedAt, lastResult: null, nextVerdict: { decision: "allow", reason: "Each run is checked against your Fence and its leash before Lyko signs." }, editSentence: "Change my Autopilot: ", control: { action: "pause", label: "Pause", method: "post", path: "/v1/autopilot/pause", body: { environment: "mainnet" } } });
  for (const t of ap.tasks) {
    rows.push({ ...base, id: t.id, source: "autopilot-task", sourceLabel: "Automation", kind: "automation", signs: "autopilot", name: t.label, status: "active", trigger: t.when.kind === "schedule" ? `every ${t.when.every}` : "when its condition holds", nextRunAt: null, nextRunLabel: t.when.kind === "schedule" ? `every ${t.when.every}` : "on condition", nextLine: `${t.when.kind === "schedule" ? `Runs every ${t.when.every}` : "Runs when its condition holds"}; Autopilot signs up to $${t.amountUsd}.`, lastRunAt: t.lastRunAt, lastResult: t.lastResult ?? "Not run yet", nextVerdict: { decision: "allow", reason: `Autopilot signs at most $${t.amountUsd} a run, inside your Fence and its leash.` }, editSentence: `Change my automation "${t.label}": `, control: { action: "pause", label: "Pause", method: "post", path: `/v1/autopilot/tasks/${t.id}/pause`, body: { environment: "mainnet" } } });
  }
  rows.push({ ...base, id: "inv_sample_logo", source: "invoice", sourceLabel: "Payment link", kind: "payment", name: "Logo design, November: 120 USDC", status: "active", trigger: "open", nextRunAt: null, nextRunLabel: "when paid", nextLine: "Waits for the payer; Lykia records the payment from the chain.", lastRunAt: null, lastResult: "Not paid yet", nextVerdict: { decision: "allow", reason: "Money comes in; nothing leaves your wallet." }, editSentence: "Change my payment link \"Logo design\": ", control: { action: "cancel", label: "Cancel", method: "post", path: "/v1/invoices/inv_sample_logo/void" } });
  return rows;
}

export function sampleTrails(now: number): FoldTrailEntry[] {
  return [
    { id: "t1", at: at(42, now), kind: "settled", title: "Deposit 4,200 USDC into Galaxy USDC", detail: "Put half my USDC to work · morpho-vaults", environment: "mainnet", memo: "lykia:1:int_sample:s1:7c2f9a01d4e5b6c8", verdict: { decision: "allow", digest: "sha256:7c2f9a01d4e5b6c8" }, transactions: ["0x9f1c…a2d4"], feeUsd: "42.00", link: null },
    { id: "t2", at: at(60 * 20, now), kind: "settled", title: "Send 1,200 USDC to @landlord", detail: "Rent · one transaction with an Arc Memo", environment: "mainnet", memo: "lykia:1:int_rent:s1:1a2b3c4d5e6f7a8b", verdict: { decision: "allow", digest: "sha256:1a2b3c4d5e6f7a8b" }, transactions: ["0x41aa…09be"], feeUsd: "12.00", link: null },
    { id: "t3", at: at(60 * 26, now), kind: "refused", title: "Send 9,000 USDC to a new address", detail: "The daily cap is $5,000 and the recipient is not on your allowlist.", environment: "mainnet", memo: null, verdict: { decision: "deny", digest: "sha256:ffee00112233aabb" }, transactions: [], feeUsd: null, link: null },
    { id: "t4", at: at(60 * 50, now), kind: "order", title: "Buy EURC when EUR/USD ≤ 1.09", detail: "waiting · 0 of 1 executed", environment: "mainnet", memo: null, verdict: null, transactions: [], feeUsd: null, link: null },
  ];
}

export function samplePack(): PackAgentView[] {
  const agent = (id: string, name: string, role: PackAgentView["role"], daily: string, spent: string, tag?: string) =>
    ({ schema: "lykia.pack/v1", id, owner: SAMPLE_OWNER, environment: "mainnet", parentId: null, depth: 1, name, role, capabilities: ["read", "plan"], fence: {} as never, fenceHash: "sha256:00", ...(tag ? { agentId: tag } : {}), status: "active", createdAt: "2026-10-01T00:00:00.000Z", budget: { caps: { dailyUsd: daily }, allocated: {}, free: {}, spent: { dayUsd: spent, weekUsd: spent } }, children: [] }) as unknown as PackAgentView;
  // One agent without an outside leash; the sample leashes (leash/model.ts) are the agents that hold one.
  return [agent("agt_payroll", "Payroll", "payroll", "500", "120", "1842")];
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
  const money = (v: string) => `$${Number(v).toLocaleString("en-US")}`;
  if (f.mode === "whistle") out.push({ rule: "Whistle", text: "The Whistle is blown: nothing new may start. Moves that bring money home still pass." });
  else if (f.mode === "dry-run") out.push({ rule: "Mode", text: "Dry run: Lyko plans and checks, but nothing can be signed." });
  const c = f.caps ?? {};
  if (c.perStepUsd) out.push({ rule: "Per step", text: `No single step moves more than ${money(c.perStepUsd)}.` });
  if (c.perIntentUsd) out.push({ rule: "Per plan", text: `No plan moves more than ${money(c.perIntentUsd)} in total.` });
  if (c.dailyUsd) out.push({ rule: "Per day", text: `At most ${money(c.dailyUsd)} leaves in a day (UTC).` });
  if (c.weeklyUsd) out.push({ rule: "Per week", text: `At most ${money(c.weeklyUsd)} leaves in a week.` });
  const r = f.recipients?.mode ?? "own";
  out.push({ rule: "Recipients", text: r === "own" ? "Money only goes to your own addresses." : r === "allowlist" ? `Money only goes to ${f.recipients?.allow?.length ?? 0} address(es) on your allowlist.` : "Money may go to any address you name." });
  if (f.venues?.allow?.length) out.push({ rule: "Venues", text: `Only these venues: ${f.venues.allow.join(", ")}.` });
  if (f.venues?.deny?.length) out.push({ rule: "Never", text: `Never routed through ${f.venues.deny.join(", ")}.` });
  if (f.limits?.maxSlippageBps !== undefined) out.push({ rule: "Slippage", text: `A swap may lose at most ${(f.limits.maxSlippageBps / 100).toFixed(2)}% to price moves.` });
  if (f.lending?.minHealthFactor) out.push({ rule: "Health", text: `Borrowing never pushes a health factor under ${f.lending.minHealthFactor}.` });
  if (f.fx?.maxDeviationBps !== undefined) out.push({ rule: "FX band", text: `A currency quote may be at most ${(f.fx.maxDeviationBps / 100).toFixed(2)}% off the reference rate.` });
  if (f.scent?.require && f.scent.require !== "off") out.push({ rule: "Tokens", text: f.scent.require === "verified" ? "Only verified registry tokens." : "No token with red flags." });
  if (f.tokens?.unlisted === "deny") out.push({ rule: "Unlisted", text: "Tokens outside the registry are refused." });
  if (f.confirm?.aboveUsd) out.push({ rule: "Confirm", text: `Anything above ${money(f.confirm.aboveUsd)} asks you first.` });
  if (f.schedule) out.push({ rule: "Hours", text: `Only inside your office hours (${f.schedule.timezone}).` });
  return out;
}

/** Ready Fence edits Lyko can propose in one tap. Tightening applies at once; loosening asks for your wallet. */
export function fenceSuggestions(f: Fence): { readonly label: string; readonly patch: Record<string, unknown> }[] {
  const out: { label: string; patch: Record<string, unknown> }[] = [];
  const daily = f.caps?.dailyUsd ? Number(f.caps.dailyUsd) : null;
  if (daily === null || daily > 1000) out.push({ label: "Lower the daily cap to $1,000", patch: { caps: { ...f.caps, dailyUsd: "1000" } } });
  if (f.scent?.require !== "verified") out.push({ label: "Only verified tokens", patch: { scent: { require: "verified" } } });
  if (!f.confirm?.aboveUsd || Number(f.confirm.aboveUsd) > 500) out.push({ label: "Ask me above $500", patch: { confirm: { ...f.confirm, aboveUsd: "500" } } });
  if ((f.limits?.maxSlippageBps ?? 1000) > 50) out.push({ label: "Slippage at most 0.5%", patch: { limits: { ...f.limits, maxSlippageBps: 50 } } });
  if (!f.lending?.minHealthFactor || Number(f.lending.minHealthFactor) < 1.5) out.push({ label: "Health factor floor 1.5", patch: { lending: { minHealthFactor: "1.5" } } });
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
  automation: "Automation",
  standing: "Automation · you sign",
  "agent-automation": "Automation · its leash signs",
  agent: "Agent · leash on Lykia",
  leash: "Leash · key off",
  autopilot: "Autopilot",
  alert: "Watch",
};

/** One line per kind, in the order the sheet lists them. */
export function whistleGroups(items: readonly WhistleItem[]): { kind: WhistleItemKind; label: string; items: WhistleItem[] }[] {
  const order: WhistleItemKind[] = ["autopilot", "agent", "leash", "automation", "standing", "agent-automation", "alert"];
  return order.map((kind) => ({ kind, label: WHISTLE_KIND_LABEL[kind], items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);
}

