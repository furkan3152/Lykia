/**
 * Conditions on the mountain (pure): windsock (funding), weather (realised
 * volatility), avalanche level (portfolio risk) and route grade (risk of a
 * move, SAC T1-T6 with trail blazes).
 */

/* Windsock ------------------------------------------------------------- */

export interface WindsockModel {
  /** 0..5 filled stripes. */
  readonly stripes: number;
  /** The side that gets paid: positive funding means longs pay shorts. */
  readonly pays: "long" | "short" | "none";
  /** 0..1, how hard the sock flutters. */
  readonly strength: number;
  readonly aprPct: number;
}

/** One stripe per 10% annualised funding, capped at five (50%+). */
export const WINDSOCK_STRIPE_APR = 0.1;

export function windsock(fundingApr: number | null | undefined): WindsockModel {
  if (typeof fundingApr !== "number" || !Number.isFinite(fundingApr) || fundingApr === 0) {
    return { stripes: 0, pays: "none", strength: 0, aprPct: 0 };
  }
  const magnitude = Math.abs(fundingApr);
  const stripes = Math.min(5, Math.ceil(magnitude / WINDSOCK_STRIPE_APR - 1e-9));
  return { stripes, pays: fundingApr > 0 ? "short" : "long", strength: stripes / 5, aprPct: fundingApr * 100 };
}

/* Weather --------------------------------------------------------------- */

export type Weather = "clear" | "few" | "overcast" | "storm";

export const WEATHER_LABEL: Readonly<Record<Weather, string>> = {
  clear: "Clear",
  few: "Few clouds",
  overcast: "Overcast",
  storm: "Storm",
};

/** Percentile rank (0..100) of `value` within `sample`. */
export function percentileRank(value: number, sample: readonly number[]): number {
  const finite = sample.filter(Number.isFinite);
  if (finite.length === 0 || !Number.isFinite(value)) return 50;
  let below = 0;
  let equal = 0;
  for (const item of finite) {
    if (item < value) below += 1;
    else if (item === value) equal += 1;
  }
  return ((below + equal / 2) / finite.length) * 100;
}

/** Realised volatility percentile -> sky: under 40 clear, under 65 few clouds, under 88 overcast, else storm. */
export function weatherFromPercentile(percentile: number): Weather {
  if (!Number.isFinite(percentile)) return "few";
  if (percentile < 40) return "clear";
  if (percentile < 65) return "few";
  if (percentile < 88) return "overcast";
  return "storm";
}

export function weatherFromVolatility(vol: number, history: readonly number[]): Weather {
  return weatherFromPercentile(percentileRank(vol, history));
}

/* Avalanche bulletin ------------------------------------------------------ */

export type AvalancheLevel = 1 | 2 | 3 | 4 | 5;

export const AVALANCHE: Readonly<Record<AvalancheLevel, { readonly name: string; readonly advice: string }>> = {
  1: { name: "Low", advice: "Ropes are long. Climb as planned." },
  2: { name: "Moderate", advice: "Watch the shortest rope; set anchors before you sleep." },
  3: { name: "Considerable", advice: "One rope is fraying. Shorten the fall or add margin." },
  4: { name: "High", advice: "A small move snaps a rope. Reduce size now." },
  5: { name: "Very high", advice: "Ropes are snapping. Stop climbing; protect what is left." },
};

export interface AvalancheInput {
  /** Shortest liquidation distance across positions (fraction), null when nothing is roped. */
  readonly minDistance: number | null;
  /** Ropes already snapped (in a shock scenario). */
  readonly snapped?: number;
  /** Largest single exposure as a share of net worth (0..1). */
  readonly concentration?: number;
}

export function avalancheLevel(input: AvalancheInput): AvalancheLevel {
  if ((input.snapped ?? 0) > 0) return 5;
  const d = input.minDistance;
  let level: number = d === null ? 1 : d >= 0.5 ? 1 : d >= 0.3 ? 2 : d >= 0.1 ? 3 : d >= 0.05 ? 4 : 5;
  if ((input.concentration ?? 0) > 0.6 && level < 5 && d !== null) level += 1;
  return Math.max(1, Math.min(5, level)) as AvalancheLevel;
}

/* Route grade -------------------------------------------------------------- */

export type Grade = 1 | 2 | 3 | 4 | 5 | 6;
export type BlazeKind = "yellow" | "red" | "blue";

export interface GradeInput {
  /** What the move does. */
  readonly kind: "swap" | "stake" | "bridge" | "send" | "spot" | "perp" | "twap" | "scale" | "launch" | "pool";
  readonly leverage?: number;
  /** Unverified token or illiquid launch. */
  readonly unverified?: boolean;
}

/** SAC grades: T1-T2 hiking (yellow diamond), T3-T4 mountain (white-red-white), T5-T6 alpine (white-blue-white). */
export function gradeFor(input: GradeInput): Grade {
  const leverage = input.leverage ?? 1;
  if (input.unverified || input.kind === "launch") return leverage > 10 ? 6 : 5;
  if (leverage > 25) return 6;
  if (leverage > 10) return 5;
  if (input.kind === "perp" || input.kind === "twap" || input.kind === "scale") return leverage > 5 ? 4 : 3;
  if (input.kind === "send" || input.kind === "stake") return 1;
  return 2;
}

export function blazeFor(grade: Grade): BlazeKind {
  return grade <= 2 ? "yellow" : grade <= 4 ? "red" : "blue";
}

export const GRADE_NAME: Readonly<Record<BlazeKind, string>> = { yellow: "Trail", red: "Mountain trail", blue: "Alpine route" };

/* Route condition (Shield) ------------------------------------------------- */

export type Condition = "open" | "caution" | "closed";

/** Shield score 0..100 -> trail sign. */
export function conditionFromScore(score: number | null | undefined): Condition {
  if (typeof score !== "number" || !Number.isFinite(score)) return "caution";
  if (score >= 70) return "open";
  if (score >= 40) return "caution";
  return "closed";
}
