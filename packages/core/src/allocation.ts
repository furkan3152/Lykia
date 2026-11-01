/**
 * Allocation: target weights -> the fewest swaps that reach them. Values
 * are compared in USD micro-dollars (bigint), never floats. Holdings
 * without a price cannot be rebalanced and are reported, not guessed.
 *
 * Pure: no I/O.
 */
import { fromBaseUnits, toBaseUnitsBig } from "./amounts.js";
import type { AllocationTarget, PlanAction } from "./actions.js";

export interface AllocationHolding {
  readonly symbol: string;
  /** Base units held (wallet, spendable). */
  readonly units: bigint;
  readonly decimals: number;
  /** USD per whole token, decimal string; null = unpriced. */
  readonly usd: string | null;
}

export interface AllocationLeg {
  readonly from: string;
  readonly to: string;
  /** Base units of `from` to sell. */
  readonly units: bigint;
  readonly usdMicros: bigint;
}

export interface AllocationPlan {
  readonly totalUsdMicros: bigint;
  readonly current: readonly { readonly symbol: string; readonly usdMicros: bigint; readonly weightBps: number }[];
  readonly legs: readonly AllocationLeg[];
  readonly unpriced: readonly string[];
  /** True when every token is already within tolerance. */
  readonly balanced: boolean;
}

const PRICE_SCALE = 8;

function priceUnits(usd: string): bigint {
  return toBaseUnitsBig(usd.includes(".") && usd.split(".")[1]!.length > PRICE_SCALE ? usd.slice(0, usd.indexOf(".") + 1 + PRICE_SCALE) : usd, PRICE_SCALE);
}

/** USD micro-dollars of `units` at `usd` per whole token. */
export function usdMicrosOf(units: bigint, decimals: number, usd: string): bigint {
  return (units * priceUnits(usd) * 1_000_000n) / (10n ** BigInt(decimals) * 10n ** BigInt(PRICE_SCALE));
}

/** Base units of a token worth `micros` USD. */
export function unitsForUsdMicros(micros: bigint, decimals: number, usd: string): bigint {
  const price = priceUnits(usd);
  if (price === 0n) return 0n;
  return (micros * 10n ** BigInt(decimals) * 10n ** BigInt(PRICE_SCALE)) / (price * 1_000_000n);
}

/**
 * Greedy pairing: the most overweight token sells into the most
 * underweight one until both meet their targets. With n tokens this needs
 * at most n-1 swaps.
 */
export function planAllocation(holdings: readonly AllocationHolding[], targets: readonly AllocationTarget[], toleranceBps = 100): AllocationPlan {
  const bySymbol = new Map(holdings.map((h) => [h.symbol.toUpperCase(), h]));
  const unpriced: string[] = [];
  const rows = targets.map((t) => {
    const h = bySymbol.get(t.token.toUpperCase());
    const symbol = h?.symbol ?? t.token;
    if (h && h.usd === null) unpriced.push(symbol);
    const usdMicros = h && h.usd !== null ? usdMicrosOf(h.units, h.decimals, h.usd) : 0n;
    return { symbol, target: t.weightBps, usdMicros, holding: h };
  });
  const total = rows.reduce((sum, r) => sum + r.usdMicros, 0n);
  const current = rows.map((r) => ({ symbol: r.symbol, usdMicros: r.usdMicros, weightBps: total === 0n ? 0 : Number((r.usdMicros * 10_000n) / total) }));
  if (total === 0n || unpriced.length > 0) return { totalUsdMicros: total, current, legs: [], unpriced, balanced: total === 0n };

  const delta = rows.map((r) => ({ ...r, diff: r.usdMicros - (total * BigInt(r.target)) / 10_000n }));
  const toleranceMicros = (total * BigInt(toleranceBps)) / 10_000n;
  const legs: AllocationLeg[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const over = delta.filter((d) => d.diff > toleranceMicros).sort((a, b) => (b.diff > a.diff ? 1 : -1))[0];
    const under = delta.filter((d) => d.diff < -toleranceMicros).sort((a, b) => (a.diff > b.diff ? 1 : -1))[0];
    if (!over || !under) break;
    const move = over.diff < -under.diff ? over.diff : -under.diff;
    const h = over.holding as AllocationHolding;
    const units = unitsForUsdMicros(move, h.decimals, h.usd as string);
    if (units <= 0n) break;
    legs.push({ from: over.symbol, to: under.symbol, units: units > h.units ? h.units : units, usdMicros: move });
    over.diff -= move;
    under.diff += move;
  }
  return { totalUsdMicros: total, current, legs, unpriced, balanced: legs.length === 0 };
}

/** The swap actions of an allocation plan (USDC <-> EURC become `fx`). */
export function allocationActions(plan: AllocationPlan, decimalsOf: (symbol: string) => number): PlanAction[] {
  return plan.legs.map((leg) => {
    const amount = { exact: fromBaseUnits(leg.units, decimalsOf(leg.from)) };
    const fx = (leg.from === "USDC" && leg.to === "EURC") || (leg.from === "EURC" && leg.to === "USDC");
    return fx ? { verb: "fx", from: leg.from, to: leg.to, amount } : { verb: "swap", from: leg.from, to: leg.to, amount };
  });
}
