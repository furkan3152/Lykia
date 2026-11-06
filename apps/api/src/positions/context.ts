/** What every position reader gets, and the small builders they share. */
import { explorerAddress, explorerTx, fromBaseUnits, networkFor, positionDoing, type Address, type ArcEnvironment, type IntentGraph, type Position, type PositionAction, type PositionAsset, type PositionVenueInfo } from "@lykia/core";
import type { AppContext } from "../context.js";
import type { PriceQuote } from "../arc/prices.js";
import { usdValue } from "../arc/prices.js";
import type { RatesSnapshot } from "../engine/venues/yields.js";

export interface ReadContext {
  readonly ctx: AppContext;
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  /** The reader proved control of the address (owner-only venues and derived figures). */
  readonly personal: boolean;
  /** The owner's Fence health floor. */
  readonly healthFloor: number;
  /** The owner's liquidity floor in USD (idle USDC above it can be put to work). */
  readonly liquidityFloorUsd: number;
  readonly readAt: string;
  prices(symbols: readonly string[]): Promise<Record<string, PriceQuote>>;
  /** Live market rates (Morpho and Aave APIs); null when neither answers in time. */
  rates(): Promise<RatesSnapshot | null>;
  /** The owner's Lykia intents (newest first); empty when unreadable. */
  history(): Promise<readonly IntentGraph[]>;
}

export interface ReaderOutput {
  readonly positions: readonly Position[];
  readonly block: string | null;
  readonly method: string;
  readonly source: Position["source"];
  readonly coverage?: string;
}

export type Reader = (r: ReadContext, venue: PositionVenueInfo) => Promise<ReaderOutput>;

/** A venue that cannot answer (a reason the owner can read); turned into status "unavailable", never into zeros. */
export class VenueUnavailable extends Error {}

export function addressLink(environment: ArcEnvironment, address: string): string {
  return explorerAddress(networkFor(environment), address);
}

export function txLink(environment: ArcEnvironment, hash: string): string {
  return explorerTx(networkFor(environment), hash);
}

/** Whole-token amount and USD value of base units at a price (null price = unpriced). */
export function valued(units: bigint, decimals: number, priceUsd: string | null): { amount: string; valueUsd: string | null } {
  const negative = units < 0n;
  const amount = fromBaseUnits(negative ? -units : units, decimals);
  const usd = usdValue(amount, priceUsd);
  return { amount: negative ? `-${amount}` : amount, valueUsd: usd === null ? null : negative && usd !== "0" ? `-${usd}` : usd };
}

export function asset(symbol: string, token: Address | null, amount: string, valueUsd: string | null, role: PositionAsset["role"]): PositionAsset {
  return { symbol, token, amount: amount.replace(/^-/u, ""), valueUsd: valueUsd === null ? null : valueUsd.replace(/^-/u, ""), role };
}

/** Sum of USD strings; null when any is null. */
export function sumUsd(values: readonly (string | null)[]): string | null {
  let micros = 0n;
  for (const v of values) {
    if (v === null) return null;
    const neg = v.startsWith("-");
    const [w = "0", f = ""] = v.replace(/^-/u, "").split(".");
    const m = BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6) || "0");
    micros += neg ? -m : m;
  }
  const neg = micros < 0n;
  return `${neg ? "-" : ""}${fromBaseUnits(neg ? -micros : micros, 6)}`;
}

/** A number for a sentence: whole above 100, two decimals below, no trailing zeros. */
export function sentenceAmount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return n >= 100 ? String(Math.floor(n)) : n.toFixed(2).replace(/\.?0+$/u, "");
}

/** "draft" plans the sentence through the proposal system; "ask" prefills Ask Lyko (moves Lykia cannot draft in one step). */
export function action(kind: PositionAction["kind"], label: string, sentence: string, mode: PositionAction["mode"] = "draft"): PositionAction {
  return { kind, label, sentence, mode };
}

/** Finishes a position: the one-line "what it is doing" comes from core, so every surface says the same thing. */
export function finish(p: Omit<Position, "doing">): Position {
  return { ...p, doing: positionDoing(p) };
}

/** Percent string from a decimal fraction ("0.0412" -> "4.12"); null passes through. */
export function fractionToPercent(fraction: string | null | undefined): string | null {
  if (fraction === null || fraction === undefined) return null;
  const n = Number(fraction);
  return Number.isFinite(n) ? (n * 100).toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "") : null;
}
