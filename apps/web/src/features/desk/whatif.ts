/** What-if math: price shocks on a flock snapshot, health-factor estimates and the move per holding. */
import type { FlockHolding, FlockSnapshot } from "@lykia/core/api/flock";

export const SHOCKED = ["cirBTC", "EURC"] as const;
export type Shocks = Record<(typeof SHOCKED)[number], number>;

/** The asset whose price moves a holding: cirBTC and EURC (also inside vault or venue names), else none. */
export function exposure(h: FlockHolding): (typeof SHOCKED)[number] | null {
  const s = h.symbol.toUpperCase();
  if (s.includes("BTC")) return "cirBTC";
  if (s.includes("EURC") || s === "EUR") return "EURC";
  return null;
}

export interface WhatIfRow { readonly label: string; readonly asset: string | null; readonly before: number; readonly after: number; readonly debt: boolean }

export function applyShocks(holdings: readonly FlockHolding[], shocks: Shocks): { rows: WhatIfRow[]; before: number; after: number; unpriced: number } {
  let unpriced = 0;
  const rows: WhatIfRow[] = [];
  for (const h of holdings) {
    if (h.usd === null) {
      unpriced += 1;
      continue;
    }
    const v = Number(h.usd);
    const asset = exposure(h);
    const factor = asset ? 1 + shocks[asset] / 100 : 1;
    const debt = h.kind === "debt";
    const sign = debt ? -1 : 1;
    rows.push({ label: `${h.symbol} · ${h.where}`, asset, before: sign * Math.abs(v), after: sign * Math.abs(v) * factor, debt });
  }
  return { rows, before: rows.reduce((a, r) => a + r.before, 0), after: rows.reduce((a, r) => a + r.after, 0), unpriced };
}

/**
 * Health factor after a shock, per venue: HF scales with the collateral's
 * value when the debt is USDC. Collateral is approximated as the venue's
 * non-debt holdings; the result is an estimate, labelled as one.
 */
export function shockedHealth(snapshot: FlockSnapshot, shocks: Shocks): { venue: string; before: number | null; after: number | null }[] {
  return snapshot.health.map((hf) => {
    const before = hf.healthFactor === null ? null : Number(hf.healthFactor);
    const at = snapshot.holdings.filter((h) => h.where === hf.venue && h.kind !== "debt" && h.usd !== null);
    const now = at.reduce((a, h) => a + Number(h.usd), 0);
    const then = at.reduce((a, h) => { const x = exposure(h); return a + Number(h.usd) * (x ? 1 + shocks[x] / 100 : 1); }, 0);
    return { venue: hf.venue, before, after: before === null || now <= 0 ? before : before * (then / now) };
  });
}
