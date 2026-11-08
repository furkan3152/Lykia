/**
 * Positions: where the owner's money is in every venue Lykia supports, how
 * much, what it is worth, what state it is in and what it is doing. The
 * server reads each venue on chain (or from a real API, or from the owner's
 * own Lykia history) and returns one typed row per position; the Fold, Lyko
 * and the SDK all read the same shape.
 *
 * Pure: no I/O. The state classification, the one-line "what it is doing"
 * and the summary live here so the server, the web sample and the tests
 * agree on them.
 */
import type { Address } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";

export const POSITION_STATES = ["earning", "idle", "borrowing", "at-risk", "out-of-range", "pending", "escrowed", "committed"] as const;
export type PositionState = (typeof POSITION_STATES)[number];

export const POSITION_STATE_LABELS: Readonly<Record<PositionState, string>> = {
  earning: "Earning",
  idle: "Idle",
  borrowing: "Borrowing",
  "at-risk": "At risk",
  "out-of-range": "Out of range",
  pending: "Pending",
  escrowed: "Escrowed",
  committed: "Committed",
};

export type PositionVenueKind = "wallet" | "lending" | "vault" | "market" | "lp" | "gateway" | "bridge" | "treasury" | "orders" | "payments";
export type PositionSource = "chain" | "api" | "history";

export type PositionAssetRole = "held" | "supplied" | "borrowed" | "collateral" | "liquidity" | "fees" | "escrowed" | "committed" | "in-flight";

export interface PositionAsset {
  readonly symbol: string;
  readonly token: Address | null;
  /** Whole-token decimal string. */
  readonly amount: string;
  /** USD value, decimal string; null when no price source (never zero). */
  readonly valueUsd: string | null;
  readonly role: PositionAssetRole;
}

export const POSITION_ACTION_KINDS = ["withdraw", "repay", "add-collateral", "rebalance-range", "collect-fees", "move-rate", "put-to-work", "convert", "cancel", "top-up"] as const;
export type PositionActionKind = (typeof POSITION_ACTION_KINDS)[number];

/** A one-tap Lyko action: the sentence is planned through the proposal system under the owner's Fence; nothing signs here. */
export interface PositionAction {
  readonly kind: PositionActionKind;
  readonly label: string;
  readonly sentence: string;
  /** "draft": plan the sentence through the proposal system. "ask": prefill Ask Lyko with it (moves Lykia cannot draft in one step). */
  readonly mode: "draft" | "ask";
}

export interface PositionApy {
  /** Percent a year, decimal string ("4.12" = 4.12%). */
  readonly percent: string;
  readonly kind: "supply" | "borrow" | "vault" | "nav" | "fees";
  readonly source: string;
}

export interface PositionHealth {
  /** Health factor (1.00 = liquidation); null when unbounded (no debt) or unreadable. */
  readonly factor: string | null;
  /** The level where liquidation starts, percent of collateral value (Aave collateral factor, Morpho LLTV). */
  readonly liquidationAtPercent: string | null;
  /** Debt over collateral value, percent; null when there is no debt. */
  readonly ltvPercent: string | null;
  /** The owner's Fence floor the state was judged against. */
  readonly floor: string;
}

export interface PositionRange {
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly tick: number;
  /** Prices of token1 in token0 (or as `quote` says), decimal strings. */
  readonly lower: string;
  readonly upper: string;
  readonly price: string;
  /** What the prices mean, e.g. "EURC per USDC". */
  readonly quote: string;
  readonly inRange: boolean;
}

export interface Position {
  /** Stable id: venue, contract and the position key (reserve, market, token id). */
  readonly id: string;
  readonly venue: string;
  readonly venueName: string;
  readonly venueKind: PositionVenueKind;
  /** "Aave V4 Main Spoke · USDC", "Uniswap v3 #4821 USDC/EURC 0.05%". */
  readonly label: string;
  readonly assets: readonly PositionAsset[];
  /** The headline amount and its symbol (the supplied, borrowed, held or deposited asset). */
  readonly amount: string;
  readonly symbol: string;
  /** Signed USD value: debt is negative. Null when any part is unpriced. */
  readonly valueUsd: string | null;
  /** "net" adds to what the owner is worth; "overlay" marks money already counted elsewhere (orders, scheduled payments). */
  readonly counts: "net" | "overlay";
  readonly state: PositionState;
  /** What it is doing, in one plain line. */
  readonly doing: string;
  readonly apy?: PositionApy;
  /** Interest or yield earned, only when it can be derived from the chain and the owner's history; never estimated. */
  readonly earned?: { readonly usd: string; readonly since: string; readonly method: string };
  readonly health?: PositionHealth;
  readonly range?: PositionRange;
  readonly fees?: { readonly assets: readonly PositionAsset[]; readonly valueUsd: string | null; readonly method: string };
  /** Collateral flag on lending supplies. */
  readonly collateral?: boolean;
  /** When the position started, if known (the owner's Lykia history or an on-chain timestamp). */
  readonly since?: string | null;
  /** Free facts for the detail view: label and value. */
  readonly facts?: readonly { readonly label: string; readonly value: string }[];
  readonly actions: readonly PositionAction[];
  readonly source: PositionSource;
  readonly readAt: string;
  readonly block: string | null;
  /** Explorer link for the contract or the transaction behind it. */
  readonly explorer: string | null;
}

export type VenueReadStatus = "ok" | "unavailable" | "private";

export interface VenueRead {
  readonly venue: string;
  readonly venueName: string;
  readonly venueKind: PositionVenueKind;
  readonly status: VenueReadStatus;
  /** Why it could not be read (unavailable) or why it is withheld (private). */
  readonly reason?: string;
  readonly positions: readonly Position[];
  readonly source: PositionSource;
  /** How positions are found at this venue (enumeration, registry, events, history). */
  readonly method: string;
  /** Discovery that is still catching up (e.g. an event backfill): what is covered so far. */
  readonly coverage?: string;
  readonly readAt: string;
  readonly block: string | null;
  readonly ms: number;
}

export interface PositionsSummary {
  /** Sum of net positions (debt subtracted); null when anything material is unpriced. */
  readonly netUsd: string | null;
  /** The same sum over priced positions only (unpriced ones are counted in `unpriced`, never as zero). */
  readonly pricedNetUsd: string;
  /** Absolute USD per state, two decimals. */
  readonly byState: Readonly<Record<PositionState, string>>;
  /** Value-weighted APY of earning positions, percent; null when none has a rate. */
  readonly weightedApyPercent: string | null;
  /** Earning positions times their APY minus debt times its borrow APY, USD a year; null without rates. */
  readonly yearlyYieldUsd: string | null;
  readonly lowestHealth: { readonly venue: string; readonly label: string; readonly factor: string } | null;
  readonly positions: number;
  readonly unpriced: number;
  /** Venues that could not be read (named, never zeroed). */
  readonly unavailable: readonly string[];
}

export interface PositionsResponse {
  readonly address: Address;
  readonly environment: ArcEnvironment;
  readonly at: string;
  readonly block: string | null;
  readonly venues: readonly VenueRead[];
  readonly summary: PositionsSummary;
  /** Personal venues (orders, scheduled payments, transfers in flight) are included only for the proven owner. */
  readonly personal: boolean;
  /** The owner's Fence health floor used for the at-risk state. */
  readonly healthFloor: string;
}

/* ------------------------------------------------------------- the venues */

export interface PositionVenueInfo {
  readonly id: string;
  readonly name: string;
  readonly kind: PositionVenueKind;
  /** Needs the owner's proof (it reads Lykia's own records rather than the chain). */
  readonly personal: boolean;
}

/** The venues with a position reader, in reading order. */
export const POSITION_VENUES: Readonly<Record<ArcEnvironment, readonly PositionVenueInfo[]>> = {
  mainnet: [
    { id: "wallet", name: "Wallet", kind: "wallet", personal: false },
    { id: "aave-v4", name: "Aave V4", kind: "lending", personal: false },
    { id: "morpho-vaults", name: "Morpho Vaults", kind: "vault", personal: false },
    { id: "galaxy-curation", name: "Galaxy (Morpho vaults)", kind: "vault", personal: false },
    { id: "keyrock", name: "Keyrock (Morpho vaults)", kind: "vault", personal: false },
    { id: "steakhouse-financial", name: "Steakhouse (Morpho vaults)", kind: "vault", personal: false },
    { id: "gauntlet", name: "Gauntlet (Morpho vaults)", kind: "vault", personal: false },
    { id: "bitwise", name: "Bitwise (Morpho vaults)", kind: "vault", personal: false },
    { id: "morpho-blue", name: "Morpho Blue", kind: "market", personal: false },
    { id: "uniswap-v3", name: "Uniswap v3", kind: "lp", personal: false },
    { id: "uniswap-v4", name: "Uniswap v4", kind: "lp", personal: false },
    { id: "aerodrome-slipstream", name: "Aerodrome Slipstream", kind: "lp", personal: false },
    { id: "archery", name: "Archery", kind: "lp", personal: false },
    { id: "unitflow-finance-v3", name: "Unitflow V3", kind: "lp", personal: false },
    { id: "sushiswap", name: "SushiSwap V3", kind: "lp", personal: false },
    { id: "usyc", name: "USYC", kind: "treasury", personal: false },
    { id: "gateway", name: "Circle Gateway", kind: "gateway", personal: false },
    { id: "cctp", name: "CCTP transfers", kind: "bridge", personal: true },
    { id: "relay", name: "Relay transfers", kind: "bridge", personal: true },
    { id: "lykia-orders", name: "LykiaOrders", kind: "orders", personal: true },
    { id: "arc-transfer", name: "Scheduled payments", kind: "payments", personal: true },
  ],
  testnet: [
    { id: "wallet", name: "Wallet", kind: "wallet", personal: false },
    { id: "lykia-practice", name: "Lykia practice venues", kind: "vault", personal: false },
    { id: "usyc", name: "USYC", kind: "treasury", personal: false },
    { id: "gateway", name: "Circle Gateway", kind: "gateway", personal: false },
    { id: "cctp", name: "CCTP transfers", kind: "bridge", personal: true },
    { id: "lykia-orders", name: "LykiaOrders", kind: "orders", personal: true },
    { id: "arc-transfer", name: "Scheduled payments", kind: "payments", personal: true },
  ],
};

export function positionVenue(environment: ArcEnvironment, id: string): PositionVenueInfo | null {
  return POSITION_VENUES[environment].find((v) => v.id === id) ?? null;
}

/* ---------------------------------------------------------- classification */

/** Below this health factor a position is near liquidation, whatever the Fence floor says. */
export const NEAR_LIQUIDATION_HEALTH = 1.1;

export interface StateFacts {
  readonly kind: "held" | "supply" | "vault" | "debt" | "collateral" | "lp" | "in-flight" | "escrow" | "commitment";
  /** Percent a year, when known. */
  readonly apyPercent?: number | null;
  readonly healthFactor?: number | null;
  readonly healthFloor?: number;
  readonly inRange?: boolean;
}

/**
 * The state of one position:
 * - at-risk beats everything for anything inside an account with debt whose health is under the floor or near liquidation;
 * - debt is borrowing; LP outside its band is out-of-range;
 * - supplies and vaults earn when their APY is above zero, otherwise they are idle;
 * - CCTP legs are pending, orders escrowed, scheduled payments committed; wallet money is idle.
 */
export function classifyPosition(f: StateFacts): PositionState {
  const hf = f.healthFactor ?? null;
  if (hf !== null && Number.isFinite(hf) && (f.kind === "debt" || f.kind === "collateral" || f.kind === "supply")) {
    if (hf < Math.max(NEAR_LIQUIDATION_HEALTH, f.healthFloor ?? 0)) return "at-risk";
  }
  switch (f.kind) {
    case "debt":
      return "borrowing";
    case "lp":
      return f.inRange === false ? "out-of-range" : "earning";
    case "supply":
    case "vault":
      return (f.apyPercent ?? 0) > 0 ? "earning" : "idle";
    case "collateral":
      return (f.apyPercent ?? 0) > 0 ? "earning" : "idle";
    case "in-flight":
      return "pending";
    case "escrow":
      return "escrowed";
    case "commitment":
      return "committed";
    default:
      return (f.apyPercent ?? 0) > 0 ? "earning" : "idle";
  }
}

/* ------------------------------------------------------------- formatting */

export function fmtUsd(n: number, digits?: number): string {
  const d = digits ?? (Math.abs(n) >= 1000 ? 0 : 2);
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function fmtAmount(value: string | number, symbol?: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return `${value}${symbol ? ` ${symbol}` : ""}`;
  const a = Math.abs(n);
  const digits = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  const s = n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return symbol ? `${s} ${symbol}` : s;
}

export function fmtPercent(p: string | number, digits = 2): string {
  const n = typeof p === "number" ? p : Number(p);
  if (!Number.isFinite(n)) return `${p}%`;
  // Tiny rates keep their first significant digits ("0.0003%"), never a misleading "0.00%".
  if (n !== 0 && Math.abs(n) < 10 ** -digits) return `${Number(n.toPrecision(1))}%`;
  return `${n.toFixed(digits)}%`;
}

/** A price for display: four significant decimals below 10, two above. */
export function fmtPrice(p: string | number): string {
  const n = typeof p === "number" ? p : Number(p);
  if (!Number.isFinite(n)) return String(p);
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 10) return n.toFixed(2);
  if (a >= 0.0001) return n.toPrecision(4);
  return n.toExponential(2);
}

/** What the position is doing, in one plain line. */
export function positionDoing(p: Pick<Position, "state" | "venueKind" | "amount" | "symbol" | "apy" | "earned" | "health" | "range" | "fees" | "assets" | "facts">): string {
  const apy = p.apy ? fmtPercent(p.apy.percent, Number(p.apy.percent) >= 10 ? 1 : 2) : null;
  const earned = p.earned && Number(p.earned.usd) > 0 ? ` · +${fmtUsd(Number(p.earned.usd), 2)} so far` : "";
  const hf = p.health?.factor ? Number(p.health.factor).toFixed(2) : null;
  const fact = (label: string) => p.facts?.find((f) => f.label === label)?.value ?? null;
  const backing = p.assets.some((a) => a.role === "collateral") && hf ? ` · backing a loan, health ${hf}` : "";
  switch (p.state) {
    case "earning":
      if (p.venueKind === "lp") {
        const feesUsd = p.fees?.valueUsd ? Number(p.fees.valueUsd) : 0;
        const fees = feesUsd > 0 ? ` · ${feesUsd < 0.01 ? "under $0.01" : fmtUsd(feesUsd, 2)} in fees to collect` : "";
        return `In range, earning swap fees${fees}`;
      }
      return apy ? `Earning ${apy} APY${earned}${backing}` : `Earning${earned}${backing}`;
    case "idle":
      if (p.venueKind === "wallet") return `Resting in the wallet, earning nothing`;
      if (backing) return `Collateral${backing}`;
      return apy ? `Supplied at ${apy}, earning almost nothing` : "Deposited, no yield right now";
    case "borrowing":
      return `Borrowing ${fmtAmount(p.amount, p.symbol)}${apy ? ` at ${apy}` : ""}${hf ? ` · health ${hf}` : ""}`;
    case "at-risk":
      return `At risk: health ${hf ?? "unknown"}, under your ${p.health?.floor ?? "?"} floor · liquidation at 1.00`;
    case "out-of-range": {
      const r = p.range;
      if (!r) return "Out of range: earning no fees";
      const side = Number(r.price) > Number(r.upper) ? "above" : "below";
      return `Out of range: price ${fmtPrice(r.price)} is ${side} your ${fmtPrice(r.lower)}–${fmtPrice(r.upper)} band (${r.quote})`;
    }
    case "pending":
      return fact("Stage") ?? "In flight, waiting to settle";
    case "escrowed":
      return fact("Waiting for") ? `Reserved for an order · ${fact("Waiting for")}` : "Reserved for an order";
    case "committed":
      return fact("Next run") ? `Committed to a scheduled payment · next ${fact("Next run")}` : "Committed to a scheduled payment";
  }
}

/* ---------------------------------------------------------------- summary */

const ZERO_STATES = (): Record<PositionState, number> => ({ earning: 0, idle: 0, borrowing: 0, "at-risk": 0, "out-of-range": 0, pending: 0, escrowed: 0, committed: 0 });

/** Totals by state, weighted APY, yearly yield and the lowest health factor over the venues that were read. */
export function summarizePositions(venues: readonly VenueRead[]): PositionsSummary {
  const byState = ZERO_STATES();
  let net = 0;
  let netKnown = true;
  let unpriced = 0;
  let earnValue = 0;
  let earnWeighted = 0;
  let yearly = 0;
  let rated = false;
  let lowest: PositionsSummary["lowestHealth"] = null;
  let count = 0;
  for (const v of venues) {
    for (const p of v.positions) {
      count += 1;
      const value = p.valueUsd === null ? null : Number(p.valueUsd);
      if (value === null || !Number.isFinite(value)) {
        unpriced += 1;
        if (p.counts === "net") netKnown = false;
      } else {
        // "At risk" is the value that can be liquidated (the collateral); the debt itself is not added on top.
        if (!(p.state === "at-risk" && value < 0)) byState[p.state] += Math.abs(value);
        if (p.counts === "net") net += value;
      }
      const apy = p.apy ? Number(p.apy.percent) : null;
      if (value !== null && apy !== null && Number.isFinite(apy) && p.counts === "net") {
        if (value < 0 && p.apy?.kind === "borrow") {
          yearly -= (Math.abs(value) * apy) / 100;
          rated = true;
        } else if (value > 0 && (p.state === "earning" || p.state === "at-risk")) {
          earnValue += value;
          earnWeighted += value * apy;
          yearly += (value * apy) / 100;
          rated = true;
        }
      }
      const hf = p.health?.factor ? Number(p.health.factor) : null;
      if (hf !== null && Number.isFinite(hf) && (lowest === null || hf < Number(lowest.factor))) lowest = { venue: p.venue, label: p.label, factor: p.health!.factor! };
    }
  }
  const two = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  const states = Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, two(v)])) as Record<PositionState, string>;
  return {
    netUsd: netKnown ? two(net) : null,
    pricedNetUsd: two(net),
    byState: states,
    weightedApyPercent: earnValue > 0 ? (earnWeighted / earnValue).toFixed(2) : null,
    yearlyYieldUsd: rated ? two(yearly) : null,
    lowestHealth: lowest,
    positions: count,
    unpriced,
    unavailable: venues.filter((v) => v.status === "unavailable").map((v) => v.venueName),
  };
}
