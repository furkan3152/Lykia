/**
 * The position map's UI model: pens (one per venue), the pasture tiles
 * (positions sized by value, coloured by state, grouped by venue), the
 * state styles and the labelled sample a signed-out visitor sees. Pure:
 * Node tests import it directly.
 */
import { POSITION_STATE_LABELS, POSITION_VENUES, positionDoing, summarizePositions, type ArcEnvironment, type Position, type PositionState, type PositionsResponse, type PositionVenueInfo, type VenueRead } from "@lykia/core";

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
};

/** Worst first: the pen's stone shows the most urgent state inside it. */
export const STATE_PRIORITY: readonly PositionState[] = ["at-risk", "out-of-range", "borrowing", "pending", "escrowed", "committed", "earning", "idle"];

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
  if (Number(p.valueUsd ?? 0) < 0) return `Borrowed ${p.symbol}`;
  if (p.venueKind === "vault") return p.label.replace(/^Morpho\s+/u, "");
  return p.symbol;
}

/** A DOM id for a position row (the pasture scrolls to it). */
export function rowDomId(id: string): string {
  return `pos-${id.replace(/[^A-Za-z0-9_-]+/gu, "-").slice(0, 90)}`;
}

/* ----------------------------------------------------------- formatting */

export function money(n: number | null | undefined, digits?: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "unpriced";
  const d = digits ?? (Math.abs(n) >= 1000 ? 0 : 2);
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function compactMoney(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 10_000) return `${sign}$${(a / 1000).toFixed(0)}k`;
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`;
  if (a >= 1) return `${sign}$${a.toFixed(0)}`;
  return `${sign}$${a.toFixed(2)}`;
}

export function amountText(amount: string, symbol: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${symbol}`;
  const a = Math.abs(n);
  const digits = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: digits })} ${symbol}`;
}

/** "12 s ago", "3 min ago". */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
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

const SAMPLE_OWNER = "0x000000000000000000000000000000000000dEaD" as const;

/** A believable position map for signed-out visitors, always labelled "sample". Same shape as the API's answer. */
export function samplePositions(now: number, environment: ArcEnvironment = "mainnet"): PositionsResponse {
  const at = new Date(now).toISOString();
  const block = "29857405";
  const p = (x: Omit<Position, "doing" | "readAt" | "block" | "source" | "explorer"> & { source?: Position["source"] }): Position => {
    const full = { ...x, source: x.source ?? ("chain" as const), readAt: at, block, explorer: null };
    return { ...full, doing: positionDoing(full) };
  };
  const health = { factor: "1.38", liquidationAtPercent: "78.00", ltvPercent: "56.52", floor: "1.5" };
  const read = (venue: string, positions: Position[]): VenueRead => {
    const info = POSITION_VENUES.mainnet.find((v) => v.id === venue)!;
    return { venue, venueName: info.name, venueKind: info.kind, status: "ok", positions, source: positions[0]?.source ?? "chain", method: "Sample", readAt: at, block, ms: 0 };
  };
  const venues: VenueRead[] = [
    read("wallet", [
      p({ id: "s-wallet-usdc", venue: "wallet", venueName: "Wallet", venueKind: "wallet", label: "USDC", assets: [{ symbol: "USDC", token: null, amount: "3820.40", valueUsd: "3820.40", role: "held" }], amount: "3820.40", symbol: "USDC", valueUsd: "3820.40", counts: "net", state: "idle", facts: [{ label: "Above your liquidity floor", value: "$3,320.40" }], actions: [{ kind: "put-to-work", label: "Put to work", sentence: "Put 3320 USDC to work", mode: "draft" }] }),
      p({ id: "s-wallet-eurc", venue: "wallet", venueName: "Wallet", venueKind: "wallet", label: "EURC", assets: [{ symbol: "EURC", token: null, amount: "1610.00", valueUsd: "1795.80", role: "held" }], amount: "1610.00", symbol: "EURC", valueUsd: "1795.80", counts: "net", state: "idle", actions: [{ kind: "convert", label: "Convert half to USDC", sentence: "Convert 805 EURC to USDC", mode: "draft" }] }),
    ]),
    read("aave-v4", [
      p({ id: "s-aave-cirbtc", venue: "aave-v4", venueName: "Aave V4", venueKind: "lending", label: "Aave V4 Main Spoke · cirBTC supplied", assets: [{ symbol: "cirBTC", token: null, amount: "0.0153", valueUsd: "1062.00", role: "collateral" }], amount: "0.0153", symbol: "cirBTC", valueUsd: "1062.00", counts: "net", state: "at-risk", apy: { percent: "0.0003", kind: "supply", source: "Aave API" }, health, collateral: true, actions: [{ kind: "withdraw", label: "Withdraw", sentence: "Withdraw 0.005 cirBTC from Aave V4 Main Spoke", mode: "draft" }] }),
      p({ id: "s-aave-usdc-debt", venue: "aave-v4", venueName: "Aave V4", venueKind: "lending", label: "Aave V4 Main Spoke · USDC borrowed", assets: [{ symbol: "USDC", token: null, amount: "600.00", valueUsd: "600.00", role: "borrowed" }], amount: "600.00", symbol: "USDC", valueUsd: "-600.00", counts: "net", state: "at-risk", apy: { percent: "3.37", kind: "borrow", source: "Aave API" }, health, actions: [{ kind: "repay", label: "Repay a quarter", sentence: "Repay 150 USDC on aave-v4", mode: "draft" }, { kind: "add-collateral", label: "Add collateral", sentence: "How much cirBTC should I add as collateral on Aave V4 Main Spoke to lift my health factor above 1.5?", mode: "ask" }] }),
      p({ id: "s-aave-usdc", venue: "aave-v4", venueName: "Aave V4", venueKind: "lending", label: "Aave V4 Forex Spoke · USDC supplied", assets: [{ symbol: "USDC", token: null, amount: "2400.00", valueUsd: "2400.00", role: "supplied" }], amount: "2400.00", symbol: "USDC", valueUsd: "2400.00", counts: "net", state: "earning", apy: { percent: "2.40", kind: "supply", source: "Aave API" }, earned: { usd: "18.20", since: new Date(now - 41 * 86_400_000).toISOString(), method: "Sample" }, actions: [{ kind: "withdraw", label: "Withdraw", sentence: "Withdraw 1200 USDC from Aave V4 Forex Spoke", mode: "draft" }, { kind: "move-rate", label: "Move to a better rate", sentence: "Withdraw 2400 USDC from Aave V4 Forex Spoke and put it to work at low risk", mode: "draft" }] }),
    ]),
    read("morpho-vaults", [p({ id: "s-galaxy", venue: "morpho-vaults", venueName: "Morpho Vaults", venueKind: "vault", label: "Galaxy USDC", assets: [{ symbol: "USDC", token: null, amount: "4200.00", valueUsd: "4200.00", role: "supplied" }], amount: "4200.00", symbol: "USDC", valueUsd: "4200.00", counts: "net", state: "earning", apy: { percent: "6.10", kind: "vault", source: "Morpho API (net of fees)" }, facts: [{ label: "Curator", value: "Galaxy" }, { label: "Lykia risk class", value: "Low (by vault size)" }], actions: [{ kind: "withdraw", label: "Withdraw half", sentence: "Withdraw 2100 USDC from Morpho galaxyUsdc", mode: "draft" }] })]),
    read("morpho-blue", []),
    read("uniswap-v3", []),
    read("uniswap-v4", [p({ id: "s-v4", venue: "uniswap-v4", venueName: "Uniswap v4", venueKind: "lp", label: "Uniswap v4 #321603 USDC/EURC 0.05%", assets: [{ symbol: "USDC", token: null, amount: "0", valueUsd: "0", role: "liquidity" }, { symbol: "EURC", token: null, amount: "529.10", valueUsd: "590.14", role: "liquidity" }], amount: "529.10", symbol: "EURC", valueUsd: "590.14", counts: "net", state: "out-of-range", range: { tickLower: -1210, tickUpper: -1090, tick: -1083, lower: "0.8860", upper: "0.8967", price: "0.8974", quote: "EURC per USDC", inRange: false }, fees: { assets: [], valueUsd: "0", method: "Sample" }, actions: [{ kind: "rebalance-range", label: "Rebalance range", sentence: "My Uniswap v4 position #321603 (USDC/EURC) is out of range. What range should I move it to?", mode: "ask" }] })]),
    read("aerodrome-slipstream", [p({ id: "s-aero", venue: "aerodrome-slipstream", venueName: "Aerodrome Slipstream", venueKind: "lp", label: "Aerodrome Slipstream #3529 USDC/EURC tick spacing 1", assets: [{ symbol: "USDC", token: null, amount: "410.20", valueUsd: "410.20", role: "liquidity" }, { symbol: "EURC", token: null, amount: "377.00", valueUsd: "420.50", role: "liquidity" }], amount: "377.00", symbol: "EURC", valueUsd: "834.07", counts: "net", state: "earning", range: { tickLower: -1120, tickUpper: -1060, tick: -1088, lower: "0.8940", upper: "0.8994", price: "0.8968", quote: "EURC per USDC", inRange: true }, fees: { assets: [{ symbol: "USDC", token: null, amount: "1.92", valueUsd: "1.92", role: "fees" }, { symbol: "EURC", token: null, amount: "1.28", valueUsd: "1.43", role: "fees" }], valueUsd: "3.35", method: "Sample" }, actions: [{ kind: "collect-fees", label: "Collect fees", sentence: "Collect the fees on my Aerodrome Slipstream position #3529 (USDC/EURC)", mode: "ask" }] })]),
    read("usyc", [p({ id: "s-usyc", venue: "usyc", venueName: "USYC", venueKind: "treasury", label: "USYC · tokenized US Treasury fund", assets: [{ symbol: "USYC", token: null, amount: "873.30", valueUsd: "998.00", role: "held" }], amount: "873.30", symbol: "USYC", valueUsd: "998.00", counts: "net", state: "earning", apy: { percent: "3.71", kind: "nav", source: "USYC oracle, 42 days of NAV" }, actions: [] })]),
    read("gateway", []),
    read("cctp", [p({ id: "s-cctp", venue: "cctp", venueName: "CCTP transfers", venueKind: "bridge", label: "CCTP · 250 USDC to Base", assets: [{ symbol: "USDC", token: null, amount: "250", valueUsd: "250", role: "in-flight" }], amount: "250", symbol: "USDC", valueUsd: "250", counts: "net", state: "pending", source: "history", facts: [{ label: "Stage", value: "Burned on Arc, awaiting attestation (~2 min)" }], actions: [] })]),
    read("lykia-orders", [p({ id: "s-order", venue: "lykia-orders", venueName: "LykiaOrders", venueKind: "orders", label: "Buy EURC when EUR/USD ≤ 1.09", assets: [{ symbol: "USDC", token: null, amount: "500", valueUsd: "500", role: "escrowed" }], amount: "500", symbol: "USDC", valueUsd: "500", counts: "overlay", state: "escrowed", source: "history", facts: [{ label: "Waiting for", value: "the price condition" }], actions: [] })]),
    read("arc-transfer", [p({ id: "s-rent", venue: "arc-transfer", venueName: "Scheduled payments", venueKind: "payments", label: "Pay 1,200 USDC rent to @landlord on the 1st", assets: [{ symbol: "USDC", token: null, amount: "1200", valueUsd: "1200", role: "committed" }], amount: "1200", symbol: "USDC", valueUsd: "1200", counts: "overlay", state: "committed", source: "history", facts: [{ label: "Next run", value: "in 9 days" }], actions: [] })]),
  ];
  return { address: SAMPLE_OWNER, environment, at, block, venues, summary: summarizePositions(venues), personal: true, healthFloor: "1.5" };
}
