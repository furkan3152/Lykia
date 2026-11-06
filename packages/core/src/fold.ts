/**
 * The Fold: everything an owner holds and everything in motion, in one
 * place. This module holds the pure parts the API and the web share:
 *
 * - `lykia.fold-preferences/v1`, the "Your Lyko" preferences (risk profile,
 *   liquidity floor, target mix, gas floor, which insights to show, how to be
 *   told and the Fold's own layout), with defaults, validation, merging and
 *   the effect each setting has, in words. Lyko always replies in English
 *   (it reads any language), so there is no reply-language setting; a
 *   stored `replyLanguage` from older documents is ignored;
 * - the shock model behind the Flock's what-if slider and the assistant's
 *   "Am I safe if EURC drops 5%?" answer (one model, so they never disagree);
 * - allocation buckets by venue type for the Fold bar's tesserae strip;
 * - the Fold tabs and their order.
 *
 * Pure TypeScript, no I/O.
 */
import type { RiskTier } from "./routes.js";

export const FOLD_PREFERENCES_SCHEMA = "lykia.fold-preferences/v1" as const;

/** The Fold's tabs, in their default order. Keyboard 1 to 5 follows the visible order. */
export const FOLD_TABS = ["flock", "trails", "herding", "pack", "fence"] as const;
export type FoldTab = (typeof FOLD_TABS)[number];

/** Cards on the Fold bar that the owner can show, hide and reorder. */
export const FOLD_CARDS = ["networth", "allocation", "headroom", "counts"] as const;
export type FoldCard = (typeof FOLD_CARDS)[number];

/** Insights Lyko computes for the Fold (deterministic, server-side). */
export const FOLD_INSIGHT_KINDS = [
  "idle-usdc",
  "health-factor",
  "fx-drift",
  "runway",
  "approval-hygiene",
  "scent-warning",
  "gas-floor",
  "beta-headroom",
  "order-near-trigger",
  "agent-budget",
  "unsettled",
  "yield-change",
] as const;
export type FoldInsightKind = (typeof FOLD_INSIGHT_KINDS)[number];

/** A short human name for each insight kind (preferences and filters). */
export const FOLD_INSIGHT_NAMES: Readonly<Record<FoldInsightKind, string>> = {
  "idle-usdc": "Idle USDC",
  "health-factor": "Health factor",
  "fx-drift": "Currency mix drift",
  runway: "Runway for scheduled payments",
  "approval-hygiene": "Old token approvals",
  "scent-warning": "Tokens with red flags",
  "gas-floor": "Gas running low",
  "beta-headroom": "Near the daily cap",
  "order-near-trigger": "Orders close to their trigger",
  "agent-budget": "Agents near their budget",
  unsettled: "Steps still settling",
  "yield-change": "A better low-risk rate",
};

export type FoldRisk = "careful" | "balanced" | "bold";
export const FOLD_RISKS: readonly FoldRisk[] = ["careful", "balanced", "bold"];
export type FoldNotify = "inbox" | "webhook" | "telegram";
export type FoldCadence = "live" | "daily" | "weekly";
/** Fields older preference documents may still carry; read and dropped, never an error. */
const RETIRED_FOLD_FIELDS = ["replyLanguage"] as const;

function withoutRetired(input: Record<string, unknown>): Record<string, unknown> {
  const out = { ...input };
  for (const key of RETIRED_FOLD_FIELDS) delete out[key];
  return out;
}

export interface FoldPreferences {
  readonly schema: typeof FOLD_PREFERENCES_SCHEMA;
  readonly risk: FoldRisk;
  /** USDC kept liquid in the wallet; idle-cash advice starts above it. Decimal USD string. */
  readonly liquidityFloorUsd: string;
  /** Target shares of the Flock, in whole percent, and the band before drift is flagged. */
  readonly targetMix: { readonly usdcPct: number; readonly eurcPct: number; readonly earningPct: number; readonly bandPct: number };
  /** Native USDC kept for gas. Decimal string. */
  readonly gasFloorUsdc: string;
  readonly insights: { readonly hidden: readonly FoldInsightKind[]; readonly notify: FoldNotify; readonly cadence: FoldCadence };
  /** The Fold's layout: visible tabs and bar cards, in order. */
  readonly layout: { readonly tabs: readonly FoldTab[]; readonly cards: readonly FoldCard[] };
  readonly updatedAt: string | null;
}

export const DEFAULT_FOLD_PREFERENCES: FoldPreferences = Object.freeze({
  schema: FOLD_PREFERENCES_SCHEMA,
  risk: "balanced",
  liquidityFloorUsd: "500",
  targetMix: { usdcPct: 50, eurcPct: 10, earningPct: 40, bandPct: 10 },
  gasFloorUsdc: "0.5",
  insights: { hidden: [], notify: "inbox", cadence: "live" },
  layout: { tabs: [...FOLD_TABS], cards: [...FOLD_CARDS] },
  updatedAt: null,
}) as FoldPreferences;

export interface FoldPreferenceIssue {
  readonly path: string;
  readonly message: string;
}

const DECIMAL = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/u;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function uniqueFrom<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return Array.isArray(value) && value.every((v) => (allowed as readonly unknown[]).includes(v)) && new Set(value).size === value.length;
}

/** Deep-merges a partial update (one level of objects; arrays replace). */
export function mergeFoldPreferences(base: FoldPreferences, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const out: Record<string, unknown> = withoutRetired({ ...base });
  for (const [key, value] of Object.entries(withoutRetired(patch))) {
    const current = (base as unknown as Record<string, unknown>)[key];
    out[key] = isRecord(value) && isRecord(current) ? { ...current, ...value } : value;
  }
  return out;
}

export function validateFoldPreferences(raw: unknown): { ok: true; preferences: FoldPreferences } | { ok: false; issues: FoldPreferenceIssue[] } {
  const issues: FoldPreferenceIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(raw)) return { ok: false, issues: [{ path: "", message: "Preferences are an object." }] };
  const input = withoutRetired(raw);
  const known = new Set(Object.keys(DEFAULT_FOLD_PREFERENCES));
  for (const key of Object.keys(input)) if (!known.has(key)) add(key, "Unknown field.");
  if (input.schema !== FOLD_PREFERENCES_SCHEMA) add("schema", `Must be "${FOLD_PREFERENCES_SCHEMA}".`);
  if (!FOLD_RISKS.includes(input.risk as FoldRisk)) add("risk", "careful, balanced or bold.");
  if (typeof input.liquidityFloorUsd !== "string" || !DECIMAL.test(input.liquidityFloorUsd)) add("liquidityFloorUsd", 'A USD amount, e.g. "500".');
  if (typeof input.gasFloorUsdc !== "string" || !DECIMAL.test(input.gasFloorUsdc) || Number(input.gasFloorUsdc) > 1000) add("gasFloorUsdc", 'A USDC amount up to 1000, e.g. "0.5".');
  const mix = input.targetMix;
  if (!isRecord(mix)) add("targetMix", "An object with usdcPct, eurcPct, earningPct and bandPct.");
  else {
    const pct = (k: string, max = 100) => Number.isInteger(mix[k]) && (mix[k] as number) >= 0 && (mix[k] as number) <= max;
    for (const k of ["usdcPct", "eurcPct", "earningPct"]) if (!pct(k)) add(`targetMix.${k}`, "A whole percent, 0 to 100.");
    if (!(pct("bandPct", 50) && (mix.bandPct as number) >= 1)) add("targetMix.bandPct", "A whole percent, 1 to 50.");
    if (pct("usdcPct") && pct("eurcPct") && pct("earningPct") && (mix.usdcPct as number) + (mix.eurcPct as number) + (mix.earningPct as number) !== 100) add("targetMix", "USDC, EURC and earning shares add up to 100.");
  }
  const ins = input.insights;
  if (!isRecord(ins)) add("insights", "An object with hidden, notify and cadence.");
  else {
    if (!uniqueFrom(ins.hidden, FOLD_INSIGHT_KINDS)) add("insights.hidden", "Unique insight kinds.");
    if (!["inbox", "webhook", "telegram"].includes(ins.notify as string)) add("insights.notify", "inbox, webhook or telegram.");
    if (!["live", "daily", "weekly"].includes(ins.cadence as string)) add("insights.cadence", "live, daily or weekly.");
  }
  const layout = input.layout;
  if (!isRecord(layout)) add("layout", "An object with tabs and cards.");
  else {
    if (!uniqueFrom(layout.tabs, FOLD_TABS) || layout.tabs.length === 0) add("layout.tabs", "At least one unique tab.");
    if (!uniqueFrom(layout.cards, FOLD_CARDS)) add("layout.cards", "Unique cards.");
  }
  if (!(input.updatedAt === null || typeof input.updatedAt === "string")) add("updatedAt", "null or a timestamp.");
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, preferences: input as unknown as FoldPreferences };
}

/** The profile risk tier a Fold risk profile maps to (the routing ceiling and the default Fence shape). */
export function riskTierOf(risk: FoldRisk): RiskTier {
  return risk === "careful" ? "low" : risk === "bold" ? "high" : "medium";
}

export function foldRiskOf(tier: RiskTier): FoldRisk {
  return tier === "low" ? "careful" : tier === "high" ? "bold" : "balanced";
}

const money = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface FoldPreferenceEffect {
  readonly key: "risk" | "liquidityFloorUsd" | "targetMix" | "gasFloorUsdc" | "insights" | "layout";
  readonly text: string;
}

/** What each setting does, in words ("Lyko will flag idle USDC above 1,200"). */
export function foldPreferenceEffects(p: FoldPreferences): FoldPreferenceEffect[] {
  const shown = FOLD_INSIGHT_KINDS.length - p.insights.hidden.length;
  return [
    { key: "risk", text: p.risk === "careful" ? "Lyko suggests only the lowest-risk venues, requires verified tokens and keeps slippage at 0.3% or less." : p.risk === "bold" ? "Lyko may suggest higher-yield venues and allows up to 3% slippage; your Fence still has the last word." : "Lyko suggests established venues and keeps slippage at 1% or less." },
    { key: "liquidityFloorUsd", text: `Lyko will flag idle USDC above ${money(p.liquidityFloorUsd)} and never suggests moving the first ${money(p.liquidityFloorUsd)} out of your wallet.` },
    { key: "targetMix", text: `Lyko will flag drift when USDC, EURC or earning moves more than ${p.targetMix.bandPct} points from ${p.targetMix.usdcPct} / ${p.targetMix.eurcPct} / ${p.targetMix.earningPct}.` },
    { key: "gasFloorUsdc", text: `Lyko will warn when gas drops below ${money(p.gasFloorUsdc)} USDC.` },
    { key: "insights", text: `${shown} of ${FOLD_INSIGHT_KINDS.length} insights on; news goes to your ${p.insights.notify}${p.insights.cadence === "live" ? " as it happens" : p.insights.cadence === "daily" ? " once a day" : " once a week"}.` },
    { key: "layout", text: `The Fold shows ${p.layout.tabs.length} tab${p.layout.tabs.length === 1 ? "" : "s"} and ${p.layout.cards.length} bar card${p.layout.cards.length === 1 ? "" : "s"}, in your order.` },
  ];
}

/** A tab id from a path segment, or null. */
export function foldTabOf(value: string | null | undefined): FoldTab | null {
  return (FOLD_TABS as readonly string[]).includes(value ?? "") ? (value as FoldTab) : null;
}

/* ------------------------------------------------------------ shock model */

/** Shocks in percent (EURC -5 means EUR/USD falls 5%), and a change in lending rates in basis points. */
export interface FoldShocks {
  readonly EURC: number;
  readonly cirBTC: number;
  readonly ratesBps: number;
}

export const NO_SHOCK: FoldShocks = Object.freeze({ EURC: 0, cirBTC: 0, ratesBps: 0 });

/** The minimum a holding needs to be shocked: symbol, venue, kind and USD value (null when unpriced). */
export interface ShockHolding {
  readonly symbol: string;
  readonly where: string;
  readonly kind: "token" | "vault" | "supply" | "debt";
  readonly usd: string | number | null;
}

/** The asset whose price moves a holding: cirBTC and EURC (also inside vault names), else none. */
export function shockExposure(h: Pick<ShockHolding, "symbol">): "cirBTC" | "EURC" | null {
  const s = h.symbol.toUpperCase();
  if (s.includes("BTC")) return "cirBTC";
  if (s.includes("EURC") || s === "EUR") return "EURC";
  return null;
}

export interface ShockRow {
  readonly label: string;
  readonly asset: "cirBTC" | "EURC" | null;
  readonly before: number;
  readonly after: number;
  readonly debt: boolean;
}

export interface ShockResult {
  readonly rows: readonly ShockRow[];
  readonly before: number;
  readonly after: number;
  readonly unpriced: number;
  /** Estimated health factor per venue before and after (USDC debt assumed; an estimate, labelled as one). */
  readonly health: readonly { readonly venue: string; readonly before: number | null; readonly after: number | null }[];
  /** Change in yearly yield from the rate shock on earning positions, USD. */
  readonly yearlyYieldDelta: number;
  /** The lowest health factor after the shock, or null when nothing borrows. */
  readonly worstHealth: number | null;
}

/**
 * Applies price shocks (and a rate change) to holdings. Health factors scale
 * with the collateral's value when the debt is USDC; collateral is the
 * venue's non-debt holdings.
 */
export function applyFoldShocks(holdings: readonly ShockHolding[], health: readonly { readonly venue: string; readonly healthFactor: string | null }[], shocks: FoldShocks): ShockResult {
  let unpriced = 0;
  const rows: ShockRow[] = [];
  let earning = 0;
  for (const h of holdings) {
    if (h.usd === null) {
      unpriced += 1;
      continue;
    }
    const v = Math.abs(Number(h.usd));
    if (!Number.isFinite(v)) {
      unpriced += 1;
      continue;
    }
    const asset = shockExposure(h);
    const factor = asset ? 1 + shocks[asset] / 100 : 1;
    const debt = h.kind === "debt";
    const sign = debt ? -1 : 1;
    if (h.kind === "vault" || h.kind === "supply") earning += v * factor;
    rows.push({ label: `${h.symbol} · ${h.where}`, asset, before: sign * v, after: sign * v * factor, debt });
  }
  const hf = health.map((x) => {
    const before = x.healthFactor === null ? null : Number(x.healthFactor);
    const at = holdings.filter((h) => h.where === x.venue && h.kind !== "debt" && h.usd !== null);
    const now = at.reduce((a, h) => a + Math.abs(Number(h.usd)), 0);
    const then = at.reduce((a, h) => {
      const e = shockExposure(h);
      return a + Math.abs(Number(h.usd)) * (e ? 1 + shocks[e] / 100 : 1);
    }, 0);
    return { venue: x.venue, before, after: before === null || now <= 0 ? before : before * (then / now) };
  });
  const afters = hf.map((x) => x.after).filter((x): x is number => x !== null);
  return {
    rows,
    before: rows.reduce((a, r) => a + r.before, 0),
    after: rows.reduce((a, r) => a + r.after, 0),
    unpriced,
    health: hf,
    yearlyYieldDelta: (earning * shocks.ratesBps) / 10_000,
    worstHealth: afters.length > 0 ? Math.min(...afters) : null,
  };
}

/** One sentence for a shock result, the way the assistant says it. */
export function describeShock(result: ShockResult, shocks: FoldShocks, minHealth = 1.2): string {
  const parts: string[] = [];
  const moved = (["EURC", "cirBTC"] as const).filter((k) => shocks[k] !== 0).map((k) => `${k} ${shocks[k] > 0 ? "+" : ""}${shocks[k]}%`);
  if (shocks.ratesBps !== 0) moved.push(`rates ${shocks.ratesBps > 0 ? "+" : ""}${(shocks.ratesBps / 100).toFixed(2)} pts`);
  const delta = result.after - result.before;
  const usd = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  parts.push(`${moved.length > 0 ? `With ${moved.join(", ")}` : "With no shock"}, the Flock goes from ${usd(result.before)} to ${usd(result.after)} (${delta < 0 ? "−" : "+"}${usd(delta)}).`);
  if (result.worstHealth === null) parts.push("Nothing is borrowed, so nothing can be liquidated.");
  else if (result.worstHealth < 1) parts.push(`The lowest health factor would be about ${result.worstHealth.toFixed(2)}: below 1, so a position could be liquidated.`);
  else if (result.worstHealth < minHealth) parts.push(`The lowest health factor would be about ${result.worstHealth.toFixed(2)}, under your Fence floor of ${minHealth}.`);
  else parts.push(`The lowest health factor stays near ${result.worstHealth.toFixed(2)}, above your floor of ${minHealth}.`);
  if (shocks.ratesBps !== 0 && result.yearlyYieldDelta !== 0) parts.push(`Yearly yield would change by about ${result.yearlyYieldDelta < 0 ? "−" : "+"}${usd(result.yearlyYieldDelta)}.`);
  if (result.unpriced > 0) parts.push(`${result.unpriced} unpriced holding(s) are left out.`);
  return parts.join(" ");
}

/* --------------------------------------------------------- allocation */

export type AllocationBucket = "wallet" | "earning" | "borrowing" | "gateway" | "orders" | "other";
export const ALLOCATION_LABELS: Readonly<Record<AllocationBucket, string>> = { wallet: "Wallet", earning: "Earning", borrowing: "Borrowed", gateway: "Gateway", orders: "In orders", other: "Other" };

/** The venue-type bucket of a holding. */
export function allocationBucketOf(h: Pick<ShockHolding, "where" | "kind">): AllocationBucket {
  if (h.kind === "debt") return "borrowing";
  if (h.where === "wallet") return "wallet";
  if (h.where === "gateway") return "gateway";
  if (h.where === "orders" || h.where.includes("orders")) return "orders";
  if (h.kind === "vault" || h.kind === "supply") return "earning";
  return "other";
}

/** USD per bucket (debt as a positive amount in "borrowing"), largest first, empty buckets dropped. */
export function allocationOf(holdings: readonly ShockHolding[]): { readonly bucket: AllocationBucket; readonly label: string; readonly usd: number; readonly share: number }[] {
  const sums = new Map<AllocationBucket, number>();
  for (const h of holdings) {
    if (h.usd === null) continue;
    const v = Math.abs(Number(h.usd));
    if (!Number.isFinite(v) || v === 0) continue;
    const b = allocationBucketOf(h);
    sums.set(b, (sums.get(b) ?? 0) + v);
  }
  const gross = [...sums.values()].reduce((a, v) => a + v, 0);
  return [...sums.entries()].map(([bucket, usd]) => ({ bucket, label: ALLOCATION_LABELS[bucket], usd, share: gross > 0 ? usd / gross : 0 })).sort((a, b) => b.usd - a.usd);
}

/** Current mix shares (percent of gross assets): USDC in the wallet, EURC anywhere liquid, earning positions. */
export function currentMix(holdings: readonly ShockHolding[]): { readonly usdcPct: number; readonly eurcPct: number; readonly earningPct: number; readonly totalUsd: number } {
  let usdc = 0;
  let eurc = 0;
  let earning = 0;
  let total = 0;
  for (const h of holdings) {
    if (h.usd === null || h.kind === "debt") continue;
    const v = Math.abs(Number(h.usd));
    if (!Number.isFinite(v)) continue;
    total += v;
    if (h.kind === "vault" || h.kind === "supply") earning += v;
    else if (h.symbol.toUpperCase().includes("EURC")) eurc += v;
    else if (h.symbol.toUpperCase() === "USDC") usdc += v;
  }
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  return { usdcPct: pct(usdc), eurcPct: pct(eurc), earningPct: pct(earning), totalUsd: total };
}
