/**
 * Loan health, fixed by arithmetic. For every lending account under the
 * owner's health floor this computes, in code, the two moves that bring it
 * back: how much debt to repay, or how much collateral to add, to reach the
 * floor plus a small buffer, each limited by what the wallet holds.
 *
 *   health = collateral value x liquidation threshold / debt
 *   repay R:           health' = health x debt / (debt - R)   ->  R = debt x (1 - health / target)
 *   add collateral C:  health' = health x (coll + C) / coll   ->  C = coll x (target / health - 1)
 *
 * Pure: the caller passes the position map it read. Nothing here is a model's
 * figure; the planner and preflight still judge the resulting plan.
 */
import type { Position, PositionsResponse } from "@lykia/core";

import { tx } from "@lykia/core";
/** How far above the floor a fix aims, so the next small price move does not undo it. */
export const HEALTH_BUFFER = 0.05;

export interface HealthMove {
  readonly symbol: string;
  /** Whole tokens, as a decimal string the planner reads. */
  readonly amount: string;
  readonly usd: string;
  /** The health factor after this move, two decimals. */
  readonly reaches: string;
  /** True when the wallet holds less than the full fix needs: this is the most that fits. */
  readonly capped: boolean;
}

export interface HealthFix {
  readonly venue: string;
  /** "Aave V4 Main Spoke". */
  readonly account: string;
  readonly health: string;
  readonly floor: string;
  readonly target: string;
  readonly debt: { readonly symbol: string; readonly amount: string; readonly usd: string };
  readonly repay: HealthMove | null;
  readonly collateral: HealthMove | null;
  /** Why a move is missing (nothing of that token in the wallet). */
  readonly notes: readonly string[];
  readonly readAt: string;
  readonly block: string | null;
}

export interface HealthReport {
  readonly floor: string;
  /** Loans under the floor, lowest health first. */
  readonly atRisk: readonly HealthFix[];
  /** The lowest health factor of any loan, at risk or not. */
  readonly lowest: { readonly account: string; readonly venue: string; readonly health: string; readonly readAt: string; readonly block: string | null } | null;
  readonly loans: number;
  /** Lending venues that could not be read: their loans are unknown, never assumed fine. */
  readonly unread: readonly string[];
}

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const up = (n: number, places: number) => (Math.ceil(n * 10 ** places - 1e-9) / 10 ** places).toFixed(places);
const down = (n: number, places: number) => (Math.floor(n * 10 ** places + 1e-9) / 10 ** places).toFixed(places);
const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/u, "").replace(/\.$/u, "") : s);
/** Stablecoins move in cents; everything else keeps six decimals. */
const placesFor = (symbol: string) => (/^(?:USDC|EURC|USDT|USYC)$/iu.test(symbol) ? 2 : 6);

function accountOf(p: Position): string {
  return `${p.venue}|${p.label.split(" · ")[0] ?? p.venueName}`;
}

/** What the wallet holds of each token (whole tokens). */
export function walletBalances(res: PositionsResponse): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of res.venues) {
    if (v.venueKind !== "wallet") continue;
    for (const p of v.positions) {
      const n = num(p.amount);
      if (n !== null && n > 0) out.set(p.symbol.toUpperCase(), (out.get(p.symbol.toUpperCase()) ?? 0) + n);
    }
  }
  return out;
}

/** Every loan's health, and the computed fixes for the ones under the floor. */
export function healthReport(res: PositionsResponse, floorOverride?: string): HealthReport {
  const floor = num(floorOverride ?? res.healthFloor) ?? 1.5;
  const target = floor + HEALTH_BUFFER;
  const wallet = walletBalances(res);
  const accounts = new Map<string, { venue: string; account: string; health: number; debt: Position | null; collateral: Position[]; readAt: string; block: string | null }>();
  for (const v of res.venues) {
    for (const p of v.positions) {
      const hf = num(p.health?.factor);
      if (hf === null) continue;
      const key = accountOf(p);
      const row = accounts.get(key) ?? { venue: p.venue, account: key.split("|")[1] ?? p.venueName, health: hf, debt: null, collateral: [], readAt: v.readAt, block: v.block };
      row.health = Math.min(row.health, hf);
      if ((num(p.valueUsd) ?? 0) < 0 || p.assets.some((a) => a.role === "borrowed")) row.debt = row.debt ?? p;
      else if (p.collateral === true || p.assets.some((a) => a.role === "collateral")) row.collateral.push(p);
      accounts.set(key, row);
    }
  }
  const loans = [...accounts.values()].filter((a) => a.debt !== null).sort((a, b) => a.health - b.health);
  const atRisk: HealthFix[] = [];
  for (const a of loans) {
    if (a.health >= floor) continue;
    const debt = a.debt!;
    const debtAmount = Math.abs(num(debt.amount) ?? 0);
    const debtUsd = Math.abs(num(debt.valueUsd) ?? 0);
    const notes: string[] = [];
    let repay: HealthMove | null = null;
    if (debtAmount > 0 && debtUsd > 0) {
      const places = placesFor(debt.symbol);
      const need = debtAmount * (1 - a.health / target);
      const held = wallet.get(debt.symbol.toUpperCase()) ?? 0;
      const fits = Math.min(need, held, debtAmount);
      if (fits > 0 && Number(down(fits, places)) > 0) {
        const capped = held < need;
        const amount = capped ? down(fits, places) : up(need, places);
        const left = debtAmount - Number(amount);
        repay = { symbol: debt.symbol, amount: trim(amount), usd: ((Number(amount) / debtAmount) * debtUsd).toFixed(2), reaches: left > 0 ? down((a.health * debtAmount) / left, 2) : tx("no debt left"), capped };
      } else notes.push(tx("No {symbol} in the wallet to repay with.", { symbol: debt.symbol }));
    }
    let collateral: HealthMove | null = null;
    const coll = a.collateral.slice().sort((x, y) => Math.abs(num(y.valueUsd) ?? 0) - Math.abs(num(x.valueUsd) ?? 0))[0];
    const collUsdTotal = a.collateral.reduce((s, p) => s + Math.abs(num(p.valueUsd) ?? 0), 0);
    if (coll && collUsdTotal > 0) {
      const price = (num(coll.valueUsd) ?? 0) / (num(coll.amount) ?? 0);
      const needUsd = collUsdTotal * (target / a.health - 1);
      const held = wallet.get(coll.symbol.toUpperCase()) ?? 0;
      if (Number.isFinite(price) && price > 0) {
        const needTokens = needUsd / price;
        const fits = Math.min(needTokens, held);
        const places = placesFor(coll.symbol);
        if (fits > 0 && Number(down(fits, places)) > 0) {
          const capped = held < needTokens;
          const amount = capped ? down(fits, places) : up(needTokens, places);
          collateral = { symbol: coll.symbol, amount: trim(amount), usd: (Number(amount) * price).toFixed(2), reaches: down((a.health * (collUsdTotal + Number(amount) * price)) / collUsdTotal, 2), capped };
        } else notes.push(tx("No {symbol} in the wallet to add as collateral.", { symbol: coll.symbol }));
      }
    }
    atRisk.push({ venue: a.venue, account: a.account, health: a.health.toFixed(2), floor: trim(floor.toFixed(2)), target: target.toFixed(2), debt: { symbol: debt.symbol, amount: trim(down(debtAmount, placesFor(debt.symbol))), usd: debtUsd.toFixed(2) }, repay, collateral, notes, readAt: a.readAt, block: a.block });
  }
  const low = loans[0];
  return {
    floor: trim(floor.toFixed(2)),
    atRisk,
    lowest: low ? { account: low.account, venue: low.venue, health: low.health.toFixed(2), readAt: low.readAt, block: low.block } : null,
    loans: loans.length,
    unread: res.venues.filter((v) => (v.venueKind === "lending" || v.venueKind === "market") && v.status === "unavailable").map((v) => v.venueName),
  };
}
