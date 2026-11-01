/**
 * Pure helpers for the Flock: group holdings by place, size sheep by value,
 * and sum what can be summed. Unpriced stays unpriced: it is never counted
 * as zero and the total says so.
 */
import type { FlockHolding, FlockSnapshot } from "../../lib/types";

export interface PlaceGroup {
  readonly where: string;
  readonly holdings: readonly FlockHolding[];
  /** Sum of priced holdings (debt subtracted); null when nothing here is priced. */
  readonly usd: string | null;
  readonly unpriced: number;
}

function toCents(usd: string): bigint {
  const [whole = "0", frac = ""] = usd.replace(/^-/u, "").split(".");
  const cents = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return usd.startsWith("-") ? -cents : cents;
}

function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export function groupByPlace(holdings: readonly FlockHolding[]): PlaceGroup[] {
  const order = ["wallet", "gateway"];
  const places = new Map<string, FlockHolding[]>();
  for (const h of holdings) places.set(h.where, [...(places.get(h.where) ?? []), h]);
  return [...places.entries()]
    .sort(([a], [b]) => (order.indexOf(a) === -1 ? 9 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 9 : order.indexOf(b)) || a.localeCompare(b))
    .map(([where, list]) => {
      const priced = list.filter((h) => h.usd !== null);
      const sum = priced.reduce((acc, h) => acc + (h.kind === "debt" ? -toCents(h.usd as string) : toCents(h.usd as string)), 0n);
      return { where, holdings: list, usd: priced.length > 0 ? fromCents(sum) : null, unpriced: list.length - priced.length };
    });
}

/** Sheep size 1..3 by USD value on a log scale; unpriced holdings are lambs. */
export function sheepSize(usd: string | null): 1 | 2 | 3 {
  if (usd === null) return 1;
  const value = Number(usd);
  if (!Number.isFinite(value) || value < 100) return 1;
  if (value < 10_000) return 2;
  return 3;
}

const WOOL: Readonly<Record<string, string>> = { USDC: "#F4EFE4", EURC: "#DCE8F2", USYC: "#EFE4CF", cirBTC: "#F2D9B0" };

export function sheepFor(snapshot: FlockSnapshot): { size: 1 | 2 | 3; wool: string; label: string }[] {
  return snapshot.holdings
    .filter((h) => h.kind !== "debt" && Number(h.amount) > 0)
    .slice(0, 12)
    .map((h) => ({ size: sheepSize(h.usd), wool: WOOL[h.symbol] ?? "#F4EFE4", label: `${h.amount} ${h.symbol}` }));
}

export function placeLabel(where: string, lang: "en" | "tr"): string {
  if (where === "wallet") return lang === "tr" ? "Cüzdan" : "Wallet";
  if (where === "gateway") return lang === "tr" ? "Gateway birleşik bakiye" : "Gateway unified balance";
  return where;
}
