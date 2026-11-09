/**
 * The preflight ledger: the wallet walked through the plan stage by stage,
 * in base units, with the network fee of each stage taken in USDC before
 * the stage runs (on Arc the gas token is USDC, and a wallet must hold the
 * fee before it can send anything). Pure bigint arithmetic, no I/O.
 */
import type { PlanAction } from "../actions.js";
import { fromBaseUnits } from "../amounts.js";
import { getToken } from "../assets.js";
import { sentenceOf } from "../programCompile.js";
import type { PreflightPlan, PreflightState, PreflightStep } from "./types.js";

export const GAS_SYMBOL = "USDC";
const USDC_DECIMALS = 6;
/** Native USDC has 18 decimals; the ERC-20 view has 6. */
const NATIVE_TO_ERC20 = 10n ** 12n;

export const decimalsOf = (symbol: string): number => getToken(symbol)?.decimals ?? 6;
const plain = (symbol: string): boolean => !symbol.includes("@");

/** Rounds base units down to `places` decimals and prints them; a non-zero amount that would print as 0 gets up to 6 places. */
export function show(units: bigint, decimals: number, places = 2): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const keep = Math.min(places, decimals);
  const step = 10n ** BigInt(decimals - keep);
  const floored = abs - (abs % step);
  if (floored === 0n && abs > 0n && keep < Math.min(6, decimals)) return show(units, decimals, Math.min(6, decimals, keep + 2));
  const text = fromBaseUnits(floored, decimals);
  const [w = "0", f = ""] = text.split(".");
  const padded = keep > 0 ? `${w}.${f.padEnd(keep, "0").slice(0, keep)}` : w;
  return `${negative && floored > 0n ? "-" : ""}${padded}`;
}

/** Rounds base units up to `places` decimals (a fee "up to"). */
export function showUp(units: bigint, decimals: number, places = 4): string {
  const keep = Math.min(places, decimals);
  const step = 10n ** BigInt(decimals - keep);
  const up = units % step === 0n ? units : units - (units % step) + step;
  const text = show(up, decimals, keep);
  // Trailing zeros past the cents say nothing: "0.0250" reads as "0.025".
  return text.includes(".") ? text.replace(/(\.\d{2}\d*?)0+$/u, "$1") : text;
}

/** The fee per gas a wallet must be able to pay: twice the live price, never under the network's floor. */
export function feePerGasWei(state: Pick<PreflightState, "gas" | "minFeeGwei">): bigint {
  const floor = BigInt(Math.round(state.minFeeGwei * 1e9));
  const price = state.gas ? BigInt(state.gas.priceWei) : floor;
  return price * 2n > floor ? price * 2n : floor;
}

/** USDC base units (6 decimals) for `gasUnits` at `feeWei`, rounded up. */
export function gasUsdcUnits(gasUnits: number, feeWei: bigint): bigint {
  const wei = BigInt(Math.max(0, Math.ceil(gasUnits))) * feeWei;
  return (wei + NATIVE_TO_ERC20 - 1n) / NATIVE_TO_ERC20;
}

export interface Ledger {
  readonly start: ReadonlyMap<string, bigint>;
  /** After every step, network fees included. */
  readonly end: ReadonlyMap<string, bigint>;
  /** Spent and received per symbol (plain tokens on Arc only). */
  readonly spent: ReadonlyMap<string, bigint>;
  readonly received: ReadonlyMap<string, bigint>;
  /** Network fee of the whole plan, USDC base units (0 for a smart account: its session key pays). */
  readonly gas: bigint;
  /** The first stage whose network fee the wallet could not pay. */
  readonly gasShort: { readonly stage: number; readonly need: bigint; readonly have: bigint } | null;
  /** Per symbol: how far the balance would go below zero, network fees left out (what is missing to move the amounts). */
  readonly short: ReadonlyMap<string, bigint>;
  /** Lykia's fee per symbol (already inside `spent`). */
  readonly fees: ReadonlyMap<string, bigint>;
}

function stagesOf(steps: readonly PreflightStep[]): PreflightStep[][] {
  const groups: PreflightStep[][] = [];
  let key: number | null = null;
  for (const s of steps) {
    const last = groups[groups.length - 1];
    if (last && s.stage !== undefined && s.stage === key) last.push(s);
    else groups.push([s]);
    key = s.stage ?? null;
  }
  return groups;
}

const add = (m: Map<string, bigint>, k: string, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v);

export function walk(plan: PreflightPlan, state: PreflightState): Ledger {
  const start = new Map<string, bigint>();
  for (const [symbol, units] of Object.entries(state.wallet?.balances ?? {})) {
    try {
      start.set(symbol, BigInt(units));
    } catch {
      /* not a base-unit amount: left out */
    }
  }
  const feeWei = feePerGasWei(state);
  const paysGas = plan.accountKind === "eoa";
  const run = (withGas: boolean) => {
    const bal = new Map(start);
    const low = new Map<string, bigint>();
    const spent = new Map<string, bigint>();
    const received = new Map<string, bigint>();
    const fees = new Map<string, bigint>();
    let gas = 0n;
    let gasShort: Ledger["gasShort"] = null;
    const note = (symbol: string) => {
      const v = bal.get(symbol) ?? 0n;
      if (v < (low.get(symbol) ?? 0n)) low.set(symbol, v);
    };
    stagesOf(plan.steps).forEach((stage, i) => {
      if (stage.every((s) => s.status === "settled" || s.status === "stopped")) return;
      // A transaction is accepted only when the wallet holds its value and its fee at once: the fee is taken with the stage's spends.
      let need = 0n;
      if (withGas && paysGas) {
        need = gasUsdcUnits(stage.reduce((n, s) => n + s.gasUnits, 0), feeWei);
        add(bal, GAS_SYMBOL, -need);
        gas += need;
      }
      for (const s of stage) {
        for (const a of s.inputs) {
          if (!plain(a.symbol)) continue;
          const units = BigInt(a.amount);
          add(bal, a.symbol, -units);
          add(spent, a.symbol, units);
          note(a.symbol);
        }
        if (s.fee) add(fees, s.fee.symbol, BigInt(s.fee.amount) + (s.fee.integrator ? BigInt(s.fee.integrator.amount) : 0n));
      }
      const left = bal.get(GAS_SYMBOL) ?? 0n;
      if (withGas && paysGas && left < 0n && gasShort === null) gasShort = { stage: i + 1, need, have: left + need };
      for (const s of stage) {
        if (s.kind === "transfer") continue;
        for (const o of s.outputs) {
          if (!plain(o.symbol)) continue;
          const units = BigInt(o.minimum ?? o.amount);
          add(bal, o.symbol, units);
          add(received, o.symbol, units);
        }
      }
    });
    const short = new Map<string, bigint>();
    for (const [k, v] of low) if (v < 0n) short.set(k, -v);
    return { end: bal, spent, received, gas, gasShort, short, fees };
  };
  const amounts = run(false);
  const full = run(true);
  return { start, end: full.end, spent: full.spent, received: full.received, gas: full.gas, gasShort: full.gasShort, short: amounts.short, fees: full.fees };
}

/* ---------------------------------------------------------- adjusting */

export interface Adjusted {
  readonly actions: PlanAction[];
  readonly index: number;
  readonly units: bigint;
  readonly decimals: number;
  readonly symbol: string;
  readonly sentence: string;
}

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The one action that spends `symbol`, when exactly one does and its amount can be changed. */
export function spendingAction(plan: PreflightPlan, symbol: string): number | null {
  const indexes = new Set<number>();
  for (const s of plan.steps) if (s.action !== null && s.inputs.some((a) => a.symbol === symbol)) indexes.add(s.action);
  if (indexes.size !== 1) return null;
  const i = [...indexes][0]!;
  const a = plan.actions[i] as (PlanAction & { amount?: unknown }) | undefined;
  if (!a || !("amount" in a) || typeof a.amount !== "object" || a.amount === null || "previous" in (a.amount as object)) return null;
  if (plan.actions.some((x) => x.verb === "rebalance")) return null;
  return i;
}

/** Writes actions back as the sentence the owner "says" when a fix chip is tapped. */
export function sentenceFor(actions: readonly PlanAction[]): string {
  return capital(sentenceOf(actions));
}

/** The plan with the action spending `symbol` lowered so that `reduceBy` more stays in the wallet; null when no single amount can do it. */
export function lowerSpend(plan: PreflightPlan, symbol: string, reduceBy: bigint): Adjusted | null {
  const i = spendingAction(plan, symbol);
  if (i === null || reduceBy <= 0n) return null;
  const action = plan.actions[i] as PlanAction & { amount: object };
  const steps = plan.steps.filter((s) => s.action === i);
  const gross = steps.reduce((n, s) => n + s.inputs.filter((a) => a.symbol === symbol).reduce((m, a) => m + BigInt(a.amount), 0n), 0n);
  const decimals = decimalsOf(symbol);
  let units = gross - reduceBy;
  // An exact send pays the fee on top: the amount is what reaches the payee.
  const onTop = steps.find((s) => s.fee?.basis === "on-top")?.fee;
  if (onTop) units = (units * 10_000n) / (10_000n + BigInt(onTop.bps + (onTop.integrator?.bps ?? 0)));
  const cents = 10n ** BigInt(Math.max(0, decimals - 2));
  units -= units % cents;
  if (units <= 0n) return null;
  const next = plan.actions.slice();
  next[i] = { ...action, amount: { exact: fromBaseUnits(units, decimals) } } as PlanAction;
  return { actions: next, index: i, units, decimals, symbol, sentence: sentenceFor(next) };
}

/** The plan with one action's amount set to everything (dust left behind otherwise). */
export function spendAll(plan: PreflightPlan, symbol: string): Adjusted | null {
  const i = spendingAction(plan, symbol);
  if (i === null) return null;
  const action = plan.actions[i] as PlanAction & { amount: object };
  const next = plan.actions.slice();
  next[i] = { ...action, amount: { all: true } } as PlanAction;
  return { actions: next, index: i, units: 0n, decimals: decimalsOf(symbol), symbol, sentence: sentenceFor(next) };
}

/** The plan with a send or bridge recipient replaced. */
export function withRecipient(plan: PreflightPlan, index: number, to: string): { actions: PlanAction[]; sentence: string } | null {
  const a = plan.actions[index];
  if (!a) return null;
  const next = plan.actions.slice();
  if (a.verb === "send") next[index] = { ...a, to: to as `0x${string}` };
  else if (a.verb === "bridge") next[index] = { ...a, recipient: to };
  else return null;
  return { actions: next, sentence: sentenceFor(next) };
}

/** The plan with every amount scaled to `ratio` (bps), for "half now". */
export function scaled(plan: PreflightPlan, index: number, units: bigint, symbol: string): Adjusted | null {
  const a = plan.actions[index] as (PlanAction & { amount?: unknown }) | undefined;
  if (!a || !("amount" in a) || units <= 0n) return null;
  const decimals = decimalsOf(symbol);
  const cents = 10n ** BigInt(Math.max(0, decimals - 2));
  const u = units - (units % cents);
  if (u <= 0n) return null;
  const next = plan.actions.slice();
  next[index] = { ...a, amount: { exact: fromBaseUnits(u, decimals) } } as PlanAction;
  return { actions: next, index, units: u, decimals, symbol, sentence: sentenceFor(next) };
}

export { USDC_DECIMALS };
