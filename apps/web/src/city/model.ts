/** Pure helpers for city mode: which shell a city gets, its accent colours, money formatting. */
import type { LeagueCity } from "@lykia/core";

export type ShellKind = "pay" | "agents" | "coming" | "generic";

/** Coming cities get the coming landing; otherwise the category picks the task-first shell. */
export function shellFor(city: Pick<LeagueCity, "league">): ShellKind {
  if (city.league.state === "coming") return "coming";
  if (city.league.category === "payments") return "pay";
  if (city.league.category === "agents") return "agents";
  return "generic";
}

const HEX = /^#[0-9a-fA-F]{6}$/u;

/** The city's accent from its project brand, falling back to Mosaic's sea and ochre. */
export function cityAccent(city: Pick<LeagueCity, "project">): { readonly primary: string; readonly accent: string } {
  const c = city.project.brand.colors ?? {};
  return { primary: c.primary && HEX.test(c.primary) ? c.primary : "#1e8fa3", accent: c.accent && HEX.test(c.accent) ? c.accent : "#d9a441" };
}

/** An 18-decimal base-unit string as dollars with two decimals ("12.50"). No floating point on the integer part. */
export function usdc18(units: string): string {
  if (!/^\d+$/u.test(units)) return "0.00";
  const padded = units.padStart(19, "0");
  const whole = padded.slice(0, -18).replace(/^0+(?=\d)/u, "");
  const cents = padded.slice(-18, -16);
  return `${Number(whole).toLocaleString("en-US")}.${cents}`;
}

/** Share of a daily budget used, 0..1 (unknown caps read 0). */
export function budgetUsed(spent: string | undefined, cap: string | undefined): number {
  const s = Number(spent ?? 0);
  const c = Number(cap ?? 0);
  if (!Number.isFinite(s) || !Number.isFinite(c) || c <= 0) return 0;
  return Math.max(0, Math.min(1, s / c));
}
