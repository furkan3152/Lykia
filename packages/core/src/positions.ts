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
import { coreIntlTag, localized } from "./i18n/index.js";
import type { Address } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";

import { tx, phrase } from "./i18n/index.js";
export const POSITION_STATES = ["earning", "idle", "borrowing", "at-risk", "out-of-range", "pending", "escrowed", "committed", "watching"] as const;
export type PositionState = (typeof POSITION_STATES)[number];

export const POSITION_STATE_LABELS: Readonly<Record<PositionState, string>> = localized({
  earning: phrase("Earning"),
  idle: phrase("Idle"),
  borrowing: phrase("Borrowing"),
  "at-risk": phrase("At risk"),
  "out-of-range": phrase("Out of range"),
  pending: phrase("Pending"),
  escrowed: phrase("Escrowed"),
  committed: phrase("Committed"),
  watching: phrase("Watching"),
});

export type PositionVenueKind = "wallet" | "lending" | "vault" | "market" | "lp" | "gateway" | "bridge" | "treasury" | "orders" | "payments" | "leash" | "watch" | "plan";

/**
 * What each kind is, in plain words: the pen's subtitle in the Fold and the
 * name Lyko uses. A new kind adds one line here and a reader; the Fold draws
 * it from its generic detail blocks with no screen of its own.
 */
export const POSITION_KINDS: Readonly<Record<PositionVenueKind, { readonly label: string; readonly plain: string }>> = localized({
  wallet: { label: phrase("Wallet"), plain: phrase("money resting in your wallet") },
  lending: { label: phrase("Lending"), plain: phrase("money lent out, or borrowed against collateral") },
  vault: { label: phrase("Vault"), plain: phrase("a fund that lends your deposit for you") },
  market: { label: phrase("Lending market"), plain: phrase("a single lending market with its own collateral") },
  lp: { label: phrase("Liquidity"), plain: phrase("money that earns swap fees inside a price band") },
  gateway: { label: "Gateway", plain: phrase("one USDC balance usable on several chains") },
  bridge: { label: phrase("On its way"), plain: phrase("money moving to another chain") },
  treasury: { label: phrase("Treasury fund"), plain: phrase("a tokenized fund of short-term US Treasuries") },
  orders: { label: phrase("Orders"), plain: phrase("money set aside for an order waiting for its price") },
  payments: { label: phrase("Scheduled payments"), plain: phrase("money promised to a payment that runs on its own") },
  leash: { label: phrase("Leash budgets"), plain: phrase("budgets you gave to outside bots") },
  watch: { label: phrase("Watches"), plain: phrase("things Lyko on watch keeps an eye on for you") },
  plan: { label: phrase("Plans in progress"), plain: phrase("step-by-step plans with steps still to sign") },
});

/** The plain description of a kind, with a fallback for a kind this build does not know yet. */
export function positionKindInfo(kind: string): { readonly label: string; readonly plain: string } {
  return (POSITION_KINDS as Readonly<Record<string, { label: string; plain: string }>>)[kind] ?? { label: kind.replace(/-/gu, " ").replace(/\b\w/gu, (c) => c.toUpperCase()), plain: tx("a position Lykia reads for you") };
}

/* ------------------------------------------------------- generic detail blocks */

/**
 * The small set of detail blocks every kind is drawn with. A reader returns
 * the blocks that fit its position; the Fold renders each block the same way
 * for every kind, and Lyko on watch reads them for its generic insights.
 */
export type PositionBlock =
  /** A value on a scale with a danger threshold: health factor, margin, budget used. */
  | { readonly type: "gauge"; readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly display: string; readonly threshold?: { readonly at: number; readonly label: string; readonly danger: "below" | "above" }; readonly meaning?: string }
  /** A value against a band: a price against the band it must stay in. */
  | { readonly type: "range"; readonly label: string; readonly lower: number; readonly upper: number; readonly value: number; readonly lowerLabel: string; readonly upperLabel: string; readonly valueLabel: string; readonly meaning?: string }
  /** Ordered stages: a transfer in flight, a plan's steps, a schedule. */
  | { readonly type: "timeline"; readonly label: string; readonly steps: readonly { readonly label: string; readonly at: string | null; readonly done: boolean }[]; readonly meaning?: string }
  /** Plain label and value pairs, each with an optional one-line meaning. */
  | { readonly type: "facts"; readonly items: readonly { readonly label: string; readonly value: string; readonly meaning?: string }[] }
  /** Time until something happens: an expiry, the next run of a payment. */
  | { readonly type: "countdown"; readonly label: string; readonly until: string; readonly meaning?: string; /** The position or its budget ends then (Lyko on watch flags it when close). */ readonly ends?: boolean }
  /** Profit or loss so far. */
  | { readonly type: "pnl"; readonly label: string; readonly valueUsd: string; readonly percent: string | null; readonly basis: string };

export const POSITION_BLOCK_TYPES = ["gauge", "range", "timeline", "facts", "countdown", "pnl"] as const;
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
  /** Kind-specific detail as generic blocks (any kind; required for kinds without a dedicated reader shape). */
  readonly blocks?: readonly PositionBlock[];
  /** Something the owner can collect now (rewards, fees): Lyko on watch flags it. */
  readonly claimable?: { readonly amount: string; readonly symbol: string; readonly valueUsd: string | null };
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
export const POSITION_VENUES: Readonly<Record<ArcEnvironment, readonly PositionVenueInfo[]>> = localized({
  mainnet: [
    { id: "wallet", name: phrase("Wallet"), kind: "wallet", personal: false },
    { id: "aave-v4", name: "Aave V4", kind: "lending", personal: false },
    { id: "morpho-vaults", name: phrase("Morpho Vaults"), kind: "vault", personal: false },
    { id: "galaxy-curation", name: phrase("Galaxy (Morpho vaults)"), kind: "vault", personal: false },
    { id: "keyrock", name: phrase("Keyrock (Morpho vaults)"), kind: "vault", personal: false },
    { id: "steakhouse-financial", name: phrase("Steakhouse (Morpho vaults)"), kind: "vault", personal: false },
    { id: "gauntlet", name: phrase("Gauntlet (Morpho vaults)"), kind: "vault", personal: false },
    { id: "bitwise", name: phrase("Bitwise (Morpho vaults)"), kind: "vault", personal: false },
    { id: "morpho-blue", name: phrase("Morpho Blue"), kind: "market", personal: false },
    { id: "uniswap-v3", name: "Uniswap v3", kind: "lp", personal: false },
    { id: "uniswap-v4", name: "Uniswap v4", kind: "lp", personal: false },
    { id: "aerodrome-slipstream", name: phrase("Aerodrome Slipstream"), kind: "lp", personal: false },
    { id: "archery", name: phrase("Archery"), kind: "lp", personal: false },
    { id: "unitflow-finance-v3", name: phrase("Unitflow V3"), kind: "lp", personal: false },
    { id: "sushiswap", name: phrase("SushiSwap V3"), kind: "lp", personal: false },
    { id: "usyc", name: "USYC", kind: "treasury", personal: false },
    { id: "gateway", name: "Circle Gateway", kind: "gateway", personal: false },
    { id: "cctp", name: phrase("CCTP transfers"), kind: "bridge", personal: true },
    { id: "relay", name: phrase("Relay transfers"), kind: "bridge", personal: true },
    { id: "across", name: phrase("Across transfers"), kind: "bridge", personal: true },
    { id: "lykia-orders", name: "LykiaOrders", kind: "orders", personal: true },
    { id: "arc-transfer", name: phrase("Scheduled payments"), kind: "payments", personal: true },
    { id: "leashes", name: phrase("Leash budgets"), kind: "leash", personal: true },
    { id: "plans", name: phrase("Plans in progress"), kind: "plan", personal: true },
    { id: "watches", name: phrase("Watches"), kind: "watch", personal: true },
  ],
  testnet: [
    { id: "wallet", name: phrase("Wallet"), kind: "wallet", personal: false },
    { id: "lykia-practice", name: phrase("Lykia practice venues"), kind: "vault", personal: false },
    { id: "usyc", name: "USYC", kind: "treasury", personal: false },
    { id: "gateway", name: "Circle Gateway", kind: "gateway", personal: false },
    { id: "cctp", name: phrase("CCTP transfers"), kind: "bridge", personal: true },
    { id: "lykia-orders", name: "LykiaOrders", kind: "orders", personal: true },
    { id: "arc-transfer", name: phrase("Scheduled payments"), kind: "payments", personal: true },
    { id: "leashes", name: phrase("Leash budgets"), kind: "leash", personal: true },
    { id: "plans", name: phrase("Plans in progress"), kind: "plan", personal: true },
    { id: "watches", name: phrase("Watches"), kind: "watch", personal: true },
  ],
});

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
  return `${sign}$${Math.abs(n).toLocaleString(coreIntlTag(), { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function fmtAmount(value: string | number, symbol?: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return `${value}${symbol ? ` ${symbol}` : ""}`;
  const a = Math.abs(n);
  const digits = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  const s = n.toLocaleString(coreIntlTag(), { maximumFractionDigits: digits, minimumFractionDigits: 0 });
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
  if (a >= 1000) return n.toLocaleString(coreIntlTag(), { maximumFractionDigits: 0 });
  if (a >= 10) return n.toFixed(2);
  if (a >= 0.0001) return n.toPrecision(4);
  return n.toExponential(2);
}

/** What the position is doing, in one plain line. */
/** One line from generic blocks: the PnL, the tightest gauge and the nearest countdown. */
export function blocksDoing(blocks: readonly PositionBlock[], now: number = Date.now()): string | null {
  const parts: string[] = [];
  const pnl = blocks.find((b): b is Extract<PositionBlock, { type: "pnl" }> => b.type === "pnl");
  if (pnl) parts.push(`${Number(pnl.valueUsd) >= 0 ? "up" : "down"} ${fmtUsd(Math.abs(Number(pnl.valueUsd)), 2)}${pnl.percent ? ` (${Number(pnl.percent) >= 0 ? "+" : "−"}${Math.abs(Number(pnl.percent)).toFixed(1)}%)` : ""}`);
  const gauge = blocks.find((b): b is Extract<PositionBlock, { type: "gauge" }> => b.type === "gauge");
  if (gauge) parts.push(`${gauge.label.toLowerCase()} ${gauge.display}`);
  const countdown = blocks.find((b): b is Extract<PositionBlock, { type: "countdown" }> => b.type === "countdown");
  if (countdown) parts.push(`${countdown.label.toLowerCase()} ${untilText(countdown.until, now)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "in 3 d", "in 5 h", "in 12 min", "now". */
export function untilText(iso: string, now: number = Date.now()): string {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (!Number.isFinite(s) || s <= 0) return "now";
  if (s >= 86_400) return tx("in {value} d", { value: Math.round(s / 86_400) });
  if (s >= 3600) return tx("in {value} h", { value: Math.round(s / 3600) });
  return tx("in {value} min", { value: Math.max(1, Math.round(s / 60)) });
}

export function positionDoing(p: Pick<Position, "state" | "venueKind" | "amount" | "symbol" | "apy" | "earned" | "health" | "range" | "fees" | "assets" | "facts"> & { readonly blocks?: readonly PositionBlock[]; readonly claimable?: Position["claimable"] }): string {
  const apy = p.apy ? fmtPercent(p.apy.percent, Number(p.apy.percent) >= 10 ? 1 : 2) : null;
  const earned = p.earned && Number(p.earned.usd) > 0 ? tx(" · +{amount} so far", { amount: fmtUsd(Number(p.earned.usd), 2) }) : "";
  const hf = p.health?.factor ? Number(p.health.factor).toFixed(2) : null;
  const fact = (label: string) => p.facts?.find((f) => f.label === label)?.value ?? null;
  const backing = p.assets.some((a) => a.role === "collateral") && hf ? tx(" · backing a loan, health {hf}", { hf }) : "";
  switch (p.state) {
    case "earning":
      if (p.venueKind === "lp") {
        const feesUsd = p.fees?.valueUsd ? Number(p.fees.valueUsd) : 0;
        const fees = feesUsd > 0 ? tx(" · {value} in fees to collect", { value: feesUsd < 0.01 ? tx("under $0.01") : fmtUsd(feesUsd, 2) }) : "";
        return tx("In range, earning swap fees{fees}", { fees });
      }
      return apy ? tx("Earning {apy} APY{earned}{backing}", { apy, earned, backing }) : tx("Earning{earned}{backing}", { earned, backing });
    case "idle":
      if (p.venueKind === "wallet") return tx("Resting in the wallet, earning nothing");
      if (backing) return tx("Collateral{backing}", { backing });
      return apy ? tx("Supplied at {apy}, earning almost nothing", { apy }) : tx("Deposited, no yield right now");
    case "borrowing":
      return tx("Borrowing {value}{value2}{value3}", { value: fmtAmount(p.amount, p.symbol), value2: apy ? ` at ${apy}` : "", value3: hf ? tx(" · health {hf}", { hf }) : "" });
    case "at-risk":
      return tx("At risk: health {value}, under your {value2} floor · liquidation at 1.00", { value: hf ?? "unknown", value2: p.health?.floor ?? "?" });
    case "out-of-range": {
      const r = p.range;
      if (!r) return tx("Out of range: earning no fees");
      const side = Number(r.price) > Number(r.upper) ? "above" : "below";
      return tx("Out of range: price {price} is {side} your {lower}–{upper} band ({quote})", { price: fmtPrice(r.price), side, lower: fmtPrice(r.lower), upper: fmtPrice(r.upper), quote: r.quote });
    }
    case "pending":
      return fact(tx("Stage")) ?? tx("In flight, waiting to settle");
    case "escrowed":
      return fact(tx("Waiting for")) ? tx("Reserved for an order · {value}", { value: fact(tx("Waiting for")) }) : tx("Reserved for an order");
    case "committed": {
      const generic = p.blocks ? blocksDoing(p.blocks) : null;
      if (p.venueKind === "leash") return tx("Budget for a bot{value}", { value: generic ? ` · ${generic}` : "" });
      if (p.venueKind === "plan") return tx("Plan in progress{value}", { value: generic ? ` · ${generic}` : "" });
      return fact(tx("Next run")) ? tx("Committed to a scheduled payment · next {value}", { value: fact(tx("Next run")) }) : generic ? tx("Committed · {generic}", { generic }) : tx("Committed to a scheduled payment");
    }
    case "watching": {
      const generic = p.blocks ? blocksDoing(p.blocks) : null;
      return generic ? tx("Watching · {generic}", { generic }) : tx("Lyko on watch keeps an eye on it");
    }
  }
}

/* ---------------------------------------------------------------- summary */

const ZERO_STATES = (): Record<PositionState, number> => ({ earning: 0, idle: 0, borrowing: 0, "at-risk": 0, "out-of-range": 0, pending: 0, escrowed: 0, committed: 0, watching: 0 });

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
