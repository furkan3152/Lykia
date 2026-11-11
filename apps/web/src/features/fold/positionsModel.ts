/**
 * The position map's UI model: pens (one per venue), the pasture tiles
 * (positions sized by value, coloured by state, grouped by venue), the
 * state styles and the labelled sample a signed-out visitor sees. Pure:
 * Node tests import it directly.
 */
import { POSITION_STATE_LABELS, type Position, type PositionState, type PositionVenueInfo, type VenueRead } from "@lykia/core";
import { formatUsd, intlLocale, t } from "../../i18n";

/* --------------------------------------------------------------- states */

export const STATE_COLOR: Readonly<Record<PositionState, string>> = {
  earning: "var(--olive)",
  idle: "#8c97a6",
  borrowing: "var(--terra)",
  "at-risk": "#c0392b",
  "out-of-range": "var(--ochre)",
  pending: "var(--sea)",
  escrowed: "#6d5a8c",
  committed: "var(--navy-2)",
  watching: "#2f6f8f",
};

/** Worst first: the pen's stone shows the most urgent state inside it. */
export const STATE_PRIORITY: readonly PositionState[] = ["at-risk", "out-of-range", "borrowing", "pending", "escrowed", "committed", "watching", "earning", "idle"];

export function stateLabel(s: PositionState): string {
  return POSITION_STATE_LABELS[s];
}

/** The summary strip's states, in reading order. */
export const SUMMARY_STATES: readonly PositionState[] = ["earning", "idle", "borrowing", "at-risk", "pending"];

/* ------------------------------------------------------------------ pens */

export interface Pen {
  readonly venue: string;
  readonly name: string;
  readonly kind: PositionVenueInfo["kind"];
  readonly read: VenueRead | null;
  /** Net USD (debt subtracted, overlays left out); null when any net position is unpriced. */
  readonly netUsd: number | null;
  /** The same over priced positions only, and how many are unpriced (left out, never zero). */
  readonly pricedUsd: number;
  readonly unpriced: number;
  /** USD in overlays (orders, scheduled payments). */
  readonly overlayUsd: number;
  readonly stone: PositionState | null;
  readonly positions: readonly Position[];
}

export function penOf(info: PositionVenueInfo, read: VenueRead | null): Pen {
  const positions = read?.positions ?? [];
  let net: number | null = 0;
  let priced = 0;
  let unpriced = 0;
  let overlay = 0;
  for (const p of positions) {
    const v = p.valueUsd === null ? null : Number(p.valueUsd);
    if (p.counts === "overlay") overlay += Math.abs(v ?? 0);
    else if (v === null) {
      net = null;
      unpriced += 1;
    } else {
      priced += v;
      if (net !== null) net += v;
    }
  }
  const stone = STATE_PRIORITY.find((s) => positions.some((p) => p.state === s)) ?? null;
  const sorted = [...positions].sort((a, b) => STATE_PRIORITY.indexOf(a.state) - STATE_PRIORITY.indexOf(b.state) || Math.abs(Number(b.valueUsd ?? 0)) - Math.abs(Number(a.valueUsd ?? 0)));
  return { venue: info.id, name: info.name, kind: info.kind, read, netUsd: net, pricedUsd: priced, unpriced, overlayUsd: overlay, stone, positions: sorted };
}

/** Pens with something in them first (largest first), then the empty and unreadable ones. */
export function orderPens(pens: readonly Pen[]): Pen[] {
  const weight = (p: Pen) => (p.read?.status === "unavailable" ? -1 : p.positions.length === 0 ? -2 : Math.abs(p.pricedUsd) + p.overlayUsd);
  return [...pens].sort((a, b) => {
    const urgent = (p: Pen) => (p.stone === "at-risk" ? 2 : p.stone === "out-of-range" ? 1 : 0);
    return urgent(b) - urgent(a) || weight(b) - weight(a);
  });
}

/* --------------------------------------------------------------- pasture */

export interface PositionTile {
  readonly id: string;
  readonly venue: string;
  readonly label: string;
  readonly short: string;
  readonly usd: number;
  readonly state: PositionState;
  readonly debt: boolean;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PositionGroup {
  readonly venue: string;
  readonly name: string;
  readonly usd: number;
  readonly x: number;
  readonly w: number;
}

/**
 * The pasture: venues as columns sized by value, positions stacked inside
 * sized by value (slice and dice). Overlays (orders, payments) are left out
 * because their money already sits in the wallet; unpriced positions too.
 */
export function positionPasture(venues: readonly { readonly name: string; readonly read: VenueRead | null }[]): { groups: PositionGroup[]; tiles: PositionTile[] } {
  const cols = venues
    .map((v) => {
      const list = (v.read?.positions ?? []).filter((p) => p.counts === "net" && p.valueUsd !== null && Math.abs(Number(p.valueUsd)) >= 0.005).sort((a, b) => Math.abs(Number(b.valueUsd)) - Math.abs(Number(a.valueUsd)));
      return { venue: v.read?.venue ?? v.name, name: v.name, list, usd: list.reduce((s, p) => s + Math.abs(Number(p.valueUsd)), 0) };
    })
    .filter((c) => c.list.length > 0)
    .sort((a, b) => b.usd - a.usd);
  const total = cols.reduce((s, c) => s + c.usd, 0);
  const groups: PositionGroup[] = [];
  const tiles: PositionTile[] = [];
  if (total <= 0) return { groups, tiles };
  // Columns get at least 9% so a small venue stays visible; the rest shares by value.
  const minW = Math.min(9, 100 / cols.length);
  const spare = 100 - minW * cols.length;
  let x = 0;
  cols.forEach((c, ci) => {
    const w = ci === cols.length - 1 ? 100 - x : minW + (spare * c.usd) / total;
    groups.push({ venue: c.venue, name: c.name, usd: c.usd, x, w });
    const minH = Math.min(14, 100 / c.list.length);
    const spareH = 100 - minH * c.list.length;
    let y = 0;
    c.list.forEach((p, pi) => {
      const v = Math.abs(Number(p.valueUsd));
      const h = pi === c.list.length - 1 ? 100 - y : minH + (spareH * v) / c.usd;
      tiles.push({ id: p.id, venue: c.venue, label: p.label, short: shortLabel(p), usd: v, state: p.state, debt: Number(p.valueUsd) < 0, x, y, w, h });
      y += h;
    });
    x += w;
  });
  return { groups, tiles };
}

/** A tile's short name: "USDC", "USDC/EURC", "Borrowed USDC". */
export function shortLabel(p: Position): string {
  if (p.venueKind === "lp") return p.assets.map((a) => a.symbol).join("/");
  if (Number(p.valueUsd ?? 0) < 0) return t("fold.positionsModel.borrowed", { symbol: p.symbol });
  if (p.venueKind === "vault") return p.label.replace(/^Morpho\s+/u, "");
  return p.symbol;
}

/** A DOM id for a position row (the pasture scrolls to it). */
export function rowDomId(id: string): string {
  return `pos-${id.replace(/[^A-Za-z0-9_-]+/gu, "-").slice(0, 90)}`;
}

/* ----------------------------------------------------------- formatting */

export function money(n: number | null | undefined, digits?: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return t("fold.unpriced");
  const d = digits ?? (Math.abs(n) >= 1000 ? 0 : 2);
  return `${n < 0 ? "−" : ""}${formatUsd(Math.abs(n), { min: d, max: d })}`;
}

export function compactMoney(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1000) return `${sign}${formatUsd(a, { compact: true, min: 0, max: a >= 10_000 && a < 1_000_000 ? 0 : 1 })}`;
  return `${sign}${formatUsd(a, { min: a >= 1 ? 0 : 2, max: a >= 1 ? 0 : 2 })}`;
}

export function amountText(amount: string, symbol: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${symbol}`;
  const a = Math.abs(n);
  const digits = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return `${n.toLocaleString(intlLocale(), { maximumFractionDigits: digits })} ${symbol}`;
}

/** "12 s ago", "3 min ago". */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return t("fold.positionsModel.sAgo", { s });
  if (s < 3600) return t("fold.positionsModel.minAgo", { Math: Math.round(s / 60) });
  return t("fold.positionsModel.hAgo", { Math: Math.round(s / 3600) });
}

/** Health gauge: where the factor sits between liquidation (1.0) and comfortable (3.0), with the floor marked. */
export function healthGauge(factor: number, floor: number): { fill: number; floorAt: number; tone: "ok" | "warn" | "bad" } {
  const span = (v: number) => Math.max(0, Math.min(1, (v - 1) / 2));
  return { fill: span(factor), floorAt: span(floor), tone: factor < Math.max(1.1, floor) ? "bad" : factor < floor * 1.25 ? "warn" : "ok" };
}

/** Range bar: the band and the price on one axis padded around both. */
export function rangeBar(lower: number, upper: number, price: number): { left: number; width: number; marker: number } {
  const lo = Math.min(lower, price);
  const hi = Math.max(upper, price);
  const pad = (hi - lo) * 0.25 || Math.abs(price) * 0.01 || 1;
  const a = lo - pad;
  const b = hi + pad;
  const at = (v: number) => ((v - a) / (b - a)) * 100;
  return { left: at(lower), width: at(upper) - at(lower), marker: at(price) };
}

/* ---------------------------------------------------------------- sample */

/** The signed-out sample: one fixture in core, read by every widget of the Fold and by Lyko on watch. */
export { samplePositions } from "@lykia/core";
