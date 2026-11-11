/**
 * The plan checks. Each one reads the plan and the state it was given and
 * returns findings; none reads the network, none guesses a figure. A figure
 * a check could not read leaves its finding out (or says "unavailable"),
 * never zero.
 */
import { coreIntlTag } from "../i18n/index.js";
import { CCTP_DESTINATIONS, networkFor } from "../networks.js";
import type { Finding, FindingFigure, FindingFix, PreflightPlan, PreflightState, PreflightStep } from "./types.js";
import { decimalsOf, GAS_SYMBOL, lowerSpend, show, showUp, spendAll, withRecipient, scaled, type Ledger } from "./ledger.js";

import { tx, englishText } from "../i18n/index.js";
export interface CheckContext {
  readonly plan: PreflightPlan;
  readonly state: PreflightState;
  readonly ledger: Ledger;
}

export type PlanCheck = (c: CheckContext) => Finding[];

const ZERO = "0x0000000000000000000000000000000000000000";
const USDC = GAS_SYMBOL;
const DAY = 86_400_000;
const lc = (a: string) => a.toLowerCase();
const iso = (ms: number) => new Date(ms).toISOString();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** Long enough to tell a lookalike apart: they share the first and last four characters by design. */
const distinct = (a: string) => `${a.slice(0, 10)}…${a.slice(-4)}`;
const moving = (s: PreflightStep) => s.kind !== "approve" && s.kind !== "attest" && s.kind !== "register-agent";

function fig(label: string, value: string, read: { readonly source: string; readonly readAt: string | null }): FindingFigure {
  return { label, value, source: read.source, readAt: read.readAt };
}

const LYKIA_FEE = { source: "Lykia fee schedule", readAt: null } as const;
const PLAN = (c: CheckContext) => ({ source: "This plan's quote", readAt: c.plan.createdAt });
const WALLET = (c: CheckContext) => c.state.wallet?.read ?? { source: "Arc chain", readAt: null };
const PREFS = (c: CheckContext) => c.state.prefs.read;
const GAS = (c: CheckContext) => c.state.gas?.read ?? { source: `Arc fee floor (${c.state.minFeeGwei} gwei); live price unavailable`, readAt: null };

const units = (s: string) => {
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
};

function toUnits(decimal: string, decimals: number): bigint {
  const [w = "0", f = ""] = decimal.split(".");
  try {
    return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  } catch {
    return 0n;
  }
}

const usdOf = (state: PreflightState, symbol: string, amount: bigint): number | null => {
  const p = symbol === USDC ? "1" : (state.prices[symbol]?.usd ?? null);
  if (p === null) return null;
  return (Number(amount) / 10 ** decimalsOf(symbol)) * Number(p);
};
const dollars = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toLocaleString(coreIntlTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function replanFix(id: string, label: string, adjusted: { readonly sentence: string; readonly actions: readonly import("../actions.js").PlanAction[] }, extra: Partial<FindingFix> = {}): FindingFix {
  return { id, kind: "replan", label, sentence: adjusted.sentence, actions: adjusted.actions, needsGas: true, ...extra };
}

function waitFixes(c: CheckContext, symbol: string, need: bigint): FindingFix[] {
  return c.state.incoming
    .filter((i) => i.symbol === symbol && units(i.units) >= need)
    .slice(0, 1)
    .map((i) => ({ id: `wait:${symbol}`, kind: "wait" as const, label: tx("Wait for {value} {symbol}", { value: show(units(i.units), i.decimals), symbol }), detail: `${i.label}${i.etaSeconds !== null ? tx(" (~{value} min)", { value: Math.max(1, Math.round(i.etaSeconds / 60)) }) : ""}`, ...(i.etaSeconds !== null ? { etaSeconds: i.etaSeconds } : {}), needsGas: false }));
}

function addFundsFix(c: CheckContext): FindingFix {
  return { id: "add-funds", kind: "add-funds", label: tx("Add USDC to this wallet"), detail: tx("Send USDC on Arc to {address} from an exchange or another wallet; no gas needed from this one.", { address: short(c.plan.account) }), address: c.plan.account, needsGas: false };
}

/* ------------------------------------------------- 1 · gas reserve on Arc */

export const gasReserve: PlanCheck = (c) => {
  const { plan, state, ledger } = c;
  if (plan.accountKind !== "eoa" || plan.steps.length === 0 || !state.wallet) return [];
  const reserve = toUnits(state.prefs.gasReserveUsdc, 6);
  const start = ledger.start.get(USDC) ?? 0n;
  const end = ledger.end.get(USDC) ?? 0n;
  const spends = (ledger.spent.get(USDC) ?? 0n) > 0n;
  const gasFig = fig(tx("Network fee for this plan (up to)"), `${showUp(ledger.gas, 6)} USDC`, GAS(c));
  const figs = [fig(tx("USDC in the wallet now"), `${show(start, 6)} USDC`, WALLET(c)), gasFig, fig(tx("Your network fee reserve"), `${state.prefs.gasReserveUsdc} USDC`, PREFS(c))];
  if (ledger.gasShort && !ledger.short.has(USDC)) {
    const g = ledger.gasShort;
    const fixes: FindingFix[] = [];
    const keep = lowerSpend(plan, USDC, reserve - end);
    const fit = lowerSpend(plan, USDC, -end);
    if (spends && keep) fixes.push(replanFix("keep-reserve", tx("Use {value} USDC", { value: show(keep.units, 6) }), keep, { detail: tx("keeps {gasReserveUsdc} USDC for gas", { gasReserveUsdc: state.prefs.gasReserveUsdc }), question: tx("Use {value} USDC and keep {gasReserveUsdc} for gas?", { value: show(keep.units, 6), gasReserveUsdc: state.prefs.gasReserveUsdc }) }));
    else if (spends && fit) fixes.push(replanFix("max-fit", tx("Use {value} USDC", { value: show(fit.units, 6) }), fit, { detail: tx("the most that still pays the network fee") }));
    fixes.push(...waitFixes(c, USDC, g.need - g.have), addFundsFix(c));
    return [{
      id: "gas-reserve",
      check: "gas-reserve",
      family: "gas",
      severity: "block",
      title: tx("Not enough USDC to pay the network fee"),
      why: tx("On Arc the network fee is paid in USDC. Step {stage} needs up to {value} USDC for it and the wallet would have {value2} USDC then, so the wallet could not send it.", { stage: g.stage, value: showUp(g.need, 6), value2: show(g.have, 6) }),
      say: tx("That can't go through: on Arc the network fee is paid in USDC, and step {stage} needs up to {value} USDC for it while the wallet would hold {value2}.", { stage: g.stage, value: showUp(g.need, 6), value2: show(g.have < 0n ? 0n : g.have, 6) }),
      figures: figs,
      change: { label: tx("USDC for gas"), before: show(start, 6), after: show(end < 0n ? 0n : end, 6) },
      fixes,
    }];
  }
  if (end >= reserve || ledger.short.has(USDC)) return [];
  if (!spends) {
    return [{ id: "gas-reserve", check: "gas-reserve", family: "gas", severity: "note", title: tx("Gas stays low: {value} USDC after this plan", { value: show(end, 6) }), why: tx("Your network fee reserve is {gasReserveUsdc} USDC. This plan does not spend USDC, but the next one may not have enough for its fee.", { gasReserveUsdc: state.prefs.gasReserveUsdc }), say: tx("Gas stays low after this: {value} USDC, under your {gasReserveUsdc} USDC reserve.", { value: show(end, 6), gasReserveUsdc: state.prefs.gasReserveUsdc }), figures: figs, change: { label: tx("USDC for gas"), before: show(start, 6), after: show(end, 6) }, fixes: [addFundsFix(c)] }];
  }
  const keep = lowerSpend(plan, USDC, reserve - end);
  const fixes: FindingFix[] = keep ? [replanFix("keep-reserve", tx("Use {value} USDC", { value: show(keep.units, 6) }), keep, { detail: tx("keeps {gasReserveUsdc} USDC for gas", { gasReserveUsdc: state.prefs.gasReserveUsdc }), question: tx("Use {value} USDC and keep {gasReserveUsdc} for gas?", { value: show(keep.units, 6), gasReserveUsdc: state.prefs.gasReserveUsdc }) })] : [];
  const acquires = plan.steps.some((s) => s.outputs.some((o) => !o.symbol.includes("@") && o.symbol !== USDC));
  return [{
    id: "gas-reserve",
    check: "gas-reserve",
    family: "gas",
    severity: "warn",
    title: tx("Leaves only {value} USDC for gas", { value: show(end, 6) }),
    why: tx("On Arc gas is paid in USDC. After this plan the wallet keeps {value} USDC, under your network fee reserve of {gasReserveUsdc} USDC, so you might not be able to send anything after{value2}.", { value: show(end, 6), gasReserveUsdc: state.prefs.gasReserveUsdc, value2: acquires ? tx(", not even to swap back") : "" }),
    say: tx("That would leave {value} USDC for gas: on Arc, gas is paid in USDC, so you couldn't send anything after{value2}.", { value: show(end, 6), value2: acquires ? tx(", not even to swap back") : "" }),
    figures: [...figs, fig(tx("USDC left after the plan"), `${show(end, 6)} USDC`, PLAN(c))],
    change: { label: tx("USDC for gas"), before: show(start, 6), after: show(end, 6) },
    fixes,
  }];
};

/* ---------------------------------------------- 2 · cash to keep at hand */

export const cashFloor: PlanCheck = (c) => {
  const { plan, state, ledger } = c;
  if (!state.wallet || plan.steps.every((s) => s.kind === "repay")) return [];
  const floor = toUnits(state.prefs.cashFloorUsd, 6);
  const start = ledger.start.get(USDC) ?? 0n;
  const end = ledger.end.get(USDC) ?? 0n;
  if (floor <= 0n || start < floor || end >= floor || (ledger.spent.get(USDC) ?? 0n) === 0n) return [];
  const keep = lowerSpend(plan, USDC, floor - end);
  return [{
    id: "cash-floor",
    check: "cash-floor",
    family: "money",
    // Lykia's default floor is only a note; one the owner set in Your Lyko is a warning.
    severity: state.prefs.explicit ? "warn" : "note",
    title: tx("Takes you under your cash floor of ${cashFloorUsd}", { cashFloorUsd: state.prefs.cashFloorUsd }),
    why: tx("You asked to always keep ${cashFloorUsd} of USDC at hand. After this plan ${value} would be left.", { cashFloorUsd: state.prefs.cashFloorUsd, value: show(end, 6) }),
    say: tx("That takes you under the ${cashFloorUsd} you keep at hand: ${value} would be left.", { cashFloorUsd: state.prefs.cashFloorUsd, value: show(end, 6) }),
    figures: [fig(tx("USDC now"), `${show(start, 6)} USDC`, WALLET(c)), fig(tx("Cash to keep at hand"), `$${state.prefs.cashFloorUsd}`, PREFS(c)), fig(tx("USDC after the plan"), `${show(end, 6)} USDC`, PLAN(c))],
    change: { label: tx("USDC at hand"), before: show(start, 6), after: show(end, 6) },
    fixes: [...(keep ? [replanFix("keep-floor", tx("Use {value} USDC", { value: show(keep.units, 6) }), keep, { detail: tx("keeps ${cashFloorUsd} at hand", { cashFloorUsd: state.prefs.cashFloorUsd }), question: tx("Use {value} USDC and keep your ${cashFloorUsd} at hand?", { value: show(keep.units, 6), cashFloorUsd: state.prefs.cashFloorUsd }) })] : []), { id: "change-floor", kind: "open", label: tx("Change my floor"), path: "/app/you", needsGas: false }],
  }];
};

/* ------------------------------------------------ 3 · upcoming obligations */

export const obligations: PlanCheck = (c) => {
  const { plan, state, ledger } = c;
  const soon = state.obligations.filter((o) => o.dueAt === null || Date.parse(o.dueAt) - state.now <= 7 * DAY);
  const out: Finding[] = [];
  for (const symbol of new Set(soon.map((o) => o.symbol))) {
    if ((ledger.spent.get(symbol) ?? 0n) === 0n) continue;
    const due = soon.filter((o) => o.symbol === symbol);
    const total = due.reduce((n, o) => n + units(o.units), 0n);
    const end = ledger.end.get(symbol) ?? 0n;
    if (end >= total) continue;
    const d = decimalsOf(symbol);
    const lowered = lowerSpend(plan, symbol, total - end);
    out.push({
      id: `obligations:${symbol}`,
      check: "obligations",
      family: "time",
      severity: "warn",
      title: tx("Leaves too little {symbol} for what is due this week", { symbol }),
      why: tx("{value} {value2} {symbol} in the next 7 days; after this plan {value3} {symbol} would be left, so {value4} would fail.", { value: due.length === 1 ? `${due[0]!.name} takes` : tx("{length} scheduled moves take", { length: due.length }), value2: show(total, d), symbol, value3: show(end < 0n ? 0n : end, d), value4: due.length === 1 ? "it" : "some" }),
      say: tx("Careful: {value} {symbol} is due in the next 7 days and this would leave {value2}.", { value: show(total, d), symbol, value2: show(end < 0n ? 0n : end, d) }),
      figures: [...due.slice(0, 4).map((o) => fig(`${o.kind}: ${o.name}`, `${show(units(o.units), o.decimals)} ${symbol}${o.dueAt ? ` · ${new Date(o.dueAt).toISOString().slice(0, 10)}` : ""}`, { source: "Herding", readAt: iso(state.now) })), fig(tx("{symbol} after the plan", { symbol }), `${show(end < 0n ? 0n : end, d)} ${symbol}`, PLAN(c))],
      change: { label: tx("{symbol} left for what's due", { symbol }), before: show(ledger.start.get(symbol) ?? 0n, d), after: show(end < 0n ? 0n : end, d) },
      fixes: [
        ...(lowered ? [replanFix(`cover:${symbol}`, tx("Use {value} {symbol}", { value: show(lowered.units, d), symbol }), lowered, { detail: tx("covers what is due this week") })] : []),
        ...due.filter((o) => o.pause).slice(0, 2).map((o): FindingFix => ({ id: `pause:${o.id}`, kind: "pause", label: tx("Pause {value}", { value: o.name.slice(0, 40) }), path: o.pause!.path, method: o.pause!.method, ...(o.pause!.body ? { body: o.pause!.body } : {}), detail: tx("in Herding; resume it any time"), needsGas: false })),
      ],
    });
  }
  return out;
};

/* --------------------------------------------------------------- 4 · dust */

export const dust: PlanCheck = (c) => {
  const { plan, state, ledger } = c;
  const out: Finding[] = [];
  for (const [symbol, spent] of ledger.spent) {
    if (symbol === USDC || spent === 0n) continue;
    const end = ledger.end.get(symbol) ?? 0n;
    if (end <= 0n) continue;
    const usd = usdOf(state, symbol, end);
    if (usd === null || usd >= 0.05) continue;
    const d = decimalsOf(symbol);
    const all = spendAll(plan, symbol);
    out.push({
      id: `dust:${symbol}`,
      check: "dust",
      family: "money",
      severity: "note",
      title: tx("Leaves {value} {symbol} behind", { value: show(end, d, 6), symbol }),
      why: tx("{amount} of {symbol} would stay in the wallet: less than it costs to move it later.", { amount: dollars(usd), symbol }),
      say: tx("This leaves {value} {symbol} ({amount}) behind, too little to move later.", { value: show(end, d, 6), symbol, amount: dollars(usd) }),
      figures: [fig(`${symbol} left`, `${show(end, d, 6)} ${symbol}`, PLAN(c)), fig(tx("Worth"), dollars(usd), { source: state.prices[symbol]?.source ?? "Chainlink", readAt: state.prices[symbol]?.updatedAt ?? null })],
      fixes: all ? [replanFix(`all:${symbol}`, tx("Use all my {symbol}", { symbol }), all, { detail: tx("nothing left behind") })] : [],
    });
  }
  return out;
};

/* ------------------------------------------------- 5 · insufficient balance */

export const insufficient: PlanCheck = (c) => {
  const { plan, state, ledger } = c;
  if (!state.wallet) return [];
  const out: Finding[] = [];
  for (const [symbol, missing] of ledger.short) {
    const d = decimalsOf(symbol);
    const have = ledger.start.get(symbol) ?? 0n;
    const fee = ledger.fees.get(symbol) ?? 0n;
    const spent = ledger.spent.get(symbol) ?? 0n;
    const gas = symbol === USDC ? ledger.gas : 0n;
    const moved = spent - fee;
    const parts = [tx("{value} to move", { value: show(moved, d) }), ...(fee > 0n ? [tx("{value} Lykia fee", { value: showUp(fee, d) })] : []), ...(gas > 0n ? [tx("up to {value} network fee", { value: showUp(gas, 6) })] : [])];
    const need = missing + (symbol === USDC ? gas : 0n);
    const max = lowerSpend(plan, symbol, need + (symbol === USDC ? toUnits(state.prefs.gasReserveUsdc, 6) : 0n));
    const maxNoReserve = symbol === USDC && !max ? lowerSpend(plan, symbol, need) : null;
    const best = max ?? maxNoReserve;
    out.push({
      id: `insufficient:${symbol}`,
      check: "insufficient",
      family: "money",
      severity: "block",
      title: tx("Not enough {symbol}: {value} short", { symbol, value: show(need, d) }),
      why: tx("This plan needs {value}; the wallet has {value2} {symbol}.", { value: parts.join(" + "), value2: show(have, d), symbol }),
      say: tx("You're {value} {symbol} short: this needs {value2}, and the wallet has {value3}.", { value: show(need, d), symbol, value2: parts.join(" + "), value3: show(have, d) }),
      figures: [fig(tx("{symbol} in the wallet", { symbol }), `${show(have, d)} ${symbol}`, WALLET(c)), fig(tx("To move"), `${show(moved, d)} ${symbol}`, PLAN(c)), ...(fee > 0n ? [fig(tx("Lykia fee"), `${showUp(fee, d)} ${symbol}`, LYKIA_FEE)] : []), ...(gas > 0n ? [fig(tx("Network fee (up to)"), `${showUp(gas, 6)} USDC`, GAS(c))] : [])],
      change: { label: symbol, before: show(have, d), after: `-${show(need, d)}` },
      fixes: [...(best ? [replanFix(`max:${symbol}`, tx("Use {value} {symbol}", { value: show(best.units, d), symbol }), best, { detail: max && symbol === USDC ? tx("the most that fits and keeps {gasReserveUsdc} USDC for gas", { gasReserveUsdc: state.prefs.gasReserveUsdc }) : tx("the most that fits") })] : []), ...waitFixes(c, symbol, need), ...(symbol === USDC ? [addFundsFix(c)] : [])],
    });
  }
  return out;
};

/* -------------------------------------------- 6 · costs too high for it */

export const costRatio: PlanCheck = (c) => {
  const { plan, state, ledger } = c;
  const steps = plan.steps.filter(moving);
  const amountUsd = steps.reduce<number | null>((n, s) => (n === null || s.usd === null ? null : n + Number(s.usd)), 0);
  if (amountUsd === null || amountUsd <= 0) return [];
  const feeUsd = steps.reduce((n, s) => n + Number(s.fee?.usd ?? 0) + Number(s.fee?.integrator?.usd ?? 0), 0);
  const gasUsd = plan.accountKind === "eoa" ? Number(ledger.gas) / 1e6 : 0;
  let impactUsd = 0;
  for (const s of steps.filter((x) => x.kind === "swap" || x.kind === "fx")) {
    const i = s.inputs[0];
    const o = s.outputs[0];
    if (!i || !o) continue;
    const net = units(i.amount) - (s.fee && s.fee.symbol === i.symbol ? units(s.fee.amount) + units(s.fee.integrator?.amount ?? "0") : 0n);
    const inUsd = usdOf(state, i.symbol, net);
    const outUsd = usdOf(state, o.symbol, units(o.amount));
    if (inUsd !== null && outUsd !== null && inUsd > outUsd) impactUsd += inUsd - outUsd;
  }
  const cost = feeUsd + gasUsd + impactUsd;
  const pct = (cost / amountUsd) * 100;
  if (pct <= 2) return [];
  const parts = [feeUsd > 0 ? tx("Lykia fee {amount}", { amount: dollars(feeUsd) }) : null, gasUsd > 0 ? tx("network fee up to {amount}", { amount: dollars(gasUsd) }) : null, impactUsd > 0 ? tx("price impact and spread {amount}", { amount: dollars(impactUsd) }) : null].filter(Boolean);
  return [{
    id: "cost-ratio",
    check: "cost-ratio",
    family: "cost",
    severity: pct > 5 ? "warn" : "note",
    title: tx("Costs are {value}% of the amount", { value: pct.toFixed(1) }),
    why: tx("You'd pay {amount} to move {amount2} ({value}%): {value2}.", { amount: dollars(cost), amount2: dollars(amountUsd), value: pct.toFixed(1), value2: parts.join(", ") }),
    say: tx("You'd pay {amount} to move {amount2} ({value}%).", { amount: dollars(cost), amount2: dollars(amountUsd), value: pct.toFixed(1) }),
    figures: [fig(tx("Amount"), dollars(amountUsd), PLAN(c)), fig(tx("Lykia fee"), dollars(feeUsd), LYKIA_FEE), fig(tx("Network fee (up to)"), dollars(gasUsd), GAS(c)), fig(tx("Price impact and spread"), dollars(impactUsd), { source: "This plan's quote against Chainlink", readAt: plan.createdAt })],
    fixes: [],
  }];
};

/* ----------------------------------------------- 7 · price impact (swaps) */

export const priceImpact: PlanCheck = (c) => {
  const { plan, state } = c;
  const out: Finding[] = [];
  const limit = Math.min(plan.fence.limits?.maxSlippageBps ?? 100, 100);
  for (const s of plan.steps.filter((x) => x.kind === "swap")) {
    const i = s.inputs[0];
    const o = s.outputs[0];
    if (!i || !o) continue;
    const net = units(i.amount) - (s.fee && s.fee.symbol === i.symbol ? units(s.fee.amount) : 0n);
    const inUsd = usdOf(state, i.symbol, net);
    const outUsd = usdOf(state, o.symbol, units(o.amount));
    if (inUsd === null || outUsd === null || inUsd <= 0) continue;
    const bps = Math.round(((inUsd - outUsd) / inUsd) * 10_000);
    if (bps <= limit) continue;
    const half = s.action !== null ? scaled(plan, s.action, net / 2n, i.symbol) : null;
    out.push({
      id: `price-impact:${s.id}`,
      check: "price-impact",
      family: "cost",
      severity: "warn",
      title: tx("Price impact {value}% on {value2}", { value: (bps / 100).toFixed(2), value2: s.route?.chosen.label ?? s.venue }),
      why: tx("The pool pays {amount} for {amount2} at reference prices, {value}% worse, above {value2}.", { amount: dollars(outUsd), amount2: dollars(inUsd), value: (bps / 100).toFixed(2), value2: limit === 100 ? "1%" : tx("your Fence's {value}%", { value: (limit / 100).toFixed(2) }) }),
      say: tx("The pool would pay {value}% under the reference price for this size.", { value: (bps / 100).toFixed(2) }),
      figures: [fig(tx("You put in"), dollars(inUsd), { source: "Chainlink", readAt: state.prices[i.symbol]?.updatedAt ?? null }), fig(tx("You get, at reference"), dollars(outUsd), { source: "Chainlink", readAt: state.prices[o.symbol]?.updatedAt ?? null }), fig(tx("Pool depth"), s.route?.chosen.tvlUsd ? `$${Number(s.route.chosen.tvlUsd).toLocaleString(coreIntlTag(), { maximumFractionDigits: 0 })}` : "unavailable", { source: s.route?.chosen.label ?? s.venue, readAt: plan.createdAt })],
      step: s.id,
      fixes: [
        ...(half ? [replanFix("half", tx("Swap {value} {symbol} now", { value: show(half.units, i.decimals), symbol: i.symbol }), half, { detail: tx("half now, the rest later") })] : []),
      ],
    });
  }
  return out;
};

/* --------------------------------------------------- 8 · the FX band */

export const fxBand: PlanCheck = (c) => {
  const { plan, state } = c;
  const band = plan.fence.fx?.maxDeviationBps ?? null;
  const out: Finding[] = [];
  for (const s of plan.steps.filter((x) => x.fxDeviationBps !== undefined)) {
    const ref = state.prices.EURC;
    const refRead = { source: ref?.source ?? "Chainlink EURC/USD", readAt: ref?.updatedAt ?? null };
    if (s.fxDeviationBps === null) {
      out.push({ id: `fx-band:${s.id}`, check: "fx-band", family: "risk", severity: "warn", title: tx("No reference rate to check this conversion against"), why: tx("Chainlink's EURC/USD could not be read, so nobody can tell whether the pool's rate is fair. Your Fence treats it as unknown."), say: tx("There is no reference rate to check this conversion against right now."), figures: [fig(tx("EURC/USD reference"), "unavailable", refRead)], step: s.id, fixes: [] });
      continue;
    }
    if (band === null) continue;
    const dev = s.fxDeviationBps ?? 0;
    const i = s.inputs[0];
    const o = s.outputs[0];
    const rate = i && o && units(i.amount) > 0n ? (Number(o.amount) / 10 ** o.decimals) / (Number(units(i.amount) - units(s.fee?.amount ?? "0")) / 10 ** i.decimals) : null;
    const figures = [fig(tx("Pool rate"), rate === null ? "unavailable" : `1 ${i!.symbol} = ${rate.toFixed(4)} ${o!.symbol}`, PLAN(c)), fig(tx("Reference EURC/USD"), ref?.usd ?? "unavailable", refRead), fig(tx("Off the reference"), `${(dev / 100).toFixed(2)}%`, PLAN(c)), fig(tx("Your FX band"), `${(band / 100).toFixed(2)}%`, { source: "Your Fence", readAt: null })];
    if (dev > band) out.push({ id: `fx-band:${s.id}`, check: "fx-band", family: "risk", severity: "block", title: tx("The rate is {value}% off the reference", { value: (dev / 100).toFixed(2) }), why: tx("Your Fence allows {value}% from Chainlink's EURC/USD; this pool is further off.", { value: (band / 100).toFixed(2) }), say: tx("The pool's rate is {value}% worse than the reference, outside your {value2}% band.", { value: (dev / 100).toFixed(2), value2: (band / 100).toFixed(2) }), figures, step: s.id, fixes: [{ id: "change-fence", kind: "change-fence", label: tx("Change my FX band"), path: "/app/fold/fence", needsGas: false }] });
    else if (dev > band * 0.75 && dev > 0) out.push({ id: `fx-band:${s.id}`, check: "fx-band", family: "risk", severity: "note", title: tx("The rate is close to your FX band"), why: tx("{value}% off Chainlink's EURC/USD; your band is {value2}%.", { value: (dev / 100).toFixed(2), value2: (band / 100).toFixed(2) }), say: tx("The rate is {value}% off the reference, close to your band.", { value: (dev / 100).toFixed(2) }), figures, step: s.id, fixes: [] });
  }
  return out;
};

/* ------------------------------------------------- 9 · stale price feeds */

export const priceStale: PlanCheck = (c) => {
  const { plan, state } = c;
  const symbols = new Set(plan.steps.flatMap((s) => [...s.inputs, ...s.outputs].map((a) => a.symbol.split("@")[0]!)));
  const out: Finding[] = [];
  for (const symbol of symbols) {
    const p = state.prices[symbol];
    if (!p || p.maxAgeSeconds === null || !p.updatedAt) continue;
    const age = (state.now - Date.parse(p.updatedAt)) / 1000;
    if (!Number.isFinite(age) || age <= p.maxAgeSeconds) continue;
    const hours = (age / 3600).toFixed(1);
    out.push({ id: `price-stale:${symbol}`, check: "price-stale", family: "time", severity: "warn", title: tx("The {symbol} price is {hours} h old", { symbol, hours }), why: tx("Chainlink's round for {symbol} is older than its heartbeat allows ({value} h), so values and caps on it are not current.", { symbol, value: Math.round(p.maxAgeSeconds / 3600) }), say: tx("The {symbol} price feed is {hours} hours old, past its heartbeat.", { symbol, hours }), figures: [fig(tx("{symbol} last updated", { symbol }), p.updatedAt, { source: p.source, readAt: p.updatedAt }), fig(tx("Allowed age"), `${Math.round(p.maxAgeSeconds / 3600)} h`, { source: p.source, readAt: null })], fixes: [] });
  }
  return out;
};

/* ------------------------------------------------------ 10 · round trip */

export const roundTrip: PlanCheck = (c) => {
  const { plan, state } = c;
  const out: Finding[] = [];
  for (const s of plan.steps.filter((x) => x.kind === "swap" || x.kind === "fx")) {
    const from = s.inputs[0]?.symbol;
    const to = s.outputs[0]?.symbol;
    if (!from || !to) continue;
    const back = state.recent.flatMap((r) => r.swaps.map((w) => ({ r, w }))).find(({ r, w }) => r.id !== plan.id && w.from === to && w.to === from && w.settledAt !== null && state.now - Date.parse(w.settledAt) <= DAY);
    if (!back) continue;
    const net = units(s.inputs[0]!.amount) - units(s.fee?.amount ?? "0");
    const inUsd = usdOf(state, from, net) ?? 0;
    const outUsd = usdOf(state, to, units(s.outputs[0]!.amount)) ?? inUsd;
    const lost = Number(s.fee?.usd ?? 0) + Math.max(0, inUsd - outUsd) + Number(back.w.feeUsd ?? 0);
    const hours = Math.max(1, Math.round((state.now - Date.parse(back.w.settledAt!)) / 3_600_000));
    out.push({ id: `round-trip:${s.id}`, check: "round-trip", family: "cost", severity: "warn", title: tx("You converted {to} to {from} {hours} h ago", { to, from, hours }), why: tx("Going back now pays the fee and the spread twice: you'd lose about {amount} in fees and spread over the two trades.", { amount: dollars(lost) }), say: tx("You swapped {to} to {from} {hours} h ago; going back loses about {amount} in fees and spread.", { to, from, hours, amount: dollars(lost) }), figures: [fig(tx("Earlier trade"), `${to} → ${from}`, { source: "Your plans on Arc", readAt: back.w.settledAt }), fig(tx("Fees and spread, both trades"), dollars(lost), PLAN(c))], step: s.id, fixes: [{ id: "open-earlier", kind: "open", label: tx("Open the earlier plan"), path: `/app/outrun/${back.r.id}`, needsGas: false }] });
  }
  return out;
};

/* ------------------------------------------------------ 11 · loan health */

export const loanHealth: PlanCheck = (c) => {
  const { plan, state } = c;
  const floor = Number(plan.fence.lending?.minHealthFactor ?? "1.5");
  const out: Finding[] = [];
  for (const s of plan.steps.filter((x) => x.healthFactorAfter !== undefined)) {
    const before = state.health[s.venue] ?? null;
    const after = s.healthFactorAfter === null || s.healthFactorAfter === undefined ? null : Number(s.healthFactorAfter);
    const figures = [fig(tx("Health now"), before ?? "unavailable", { source: "Arc chain · lending venue", readAt: plan.createdAt }), fig(tx("Health after"), after === null ? "unavailable" : after.toFixed(2), PLAN(c)), fig(tx("Your Fence floor"), floor.toFixed(2), { source: "Your Fence", readAt: null })];
    const change = { label: tx("Loan health"), before: before ? Number(before).toFixed(2) : "?", after: after === null ? "?" : after.toFixed(2) };
    if (after === null) out.push({ id: `loan-health:${s.id}`, check: "loan-health", family: "risk", severity: "warn", title: tx("Loan health after this step could not be read"), why: tx("Without it nobody can tell how close the loan gets to liquidation; your Fence refuses borrowing it cannot judge."), say: tx("The loan's health after this step can't be read right now."), figures, change, step: s.id, fixes: [] });
    else if (after < floor) out.push({ id: `loan-health:${s.id}`, check: "loan-health", family: "risk", severity: "block", title: tx("Loan health would drop to {value}", { value: after.toFixed(2) }), why: tx("Your Fence keeps loans above {value}. At 1.00 part of the collateral can be sold to repay the loan.", { value: floor.toFixed(2) }), say: tx("That would take the loan's health to {value}, under your {value2} floor.", { value: after.toFixed(2), value2: floor.toFixed(2) }), figures, change, step: s.id, fixes: [] });
    else if (after < floor + 0.25) out.push({ id: `loan-health:${s.id}`, check: "loan-health", family: "risk", severity: "warn", title: tx("Loan health would be {value}, close to your floor", { value: after.toFixed(2) }), why: tx("Your floor is {value}; a small price move would push it under.", { value: floor.toFixed(2) }), say: tx("The loan's health would be {value}, close to your {value2} floor.", { value: after.toFixed(2), value2: floor.toFixed(2) }), figures, change, step: s.id, fixes: [] });
  }
  return out;
};

/* ------------------------------------------------------ 12 · vault state */

export const vaultState: PlanCheck = (c) => {
  const { plan, state } = c;
  const out: Finding[] = [];
  for (const s of plan.steps.filter((x) => x.kind === "deposit" || x.kind === "supply")) {
    const vault = s.params.vault ? lc(s.params.vault) : null;
    const v = vault ? state.vaults[vault] : undefined;
    const name = s.route?.chosen.label ?? s.params.vaultName ?? s.venue;
    const amount = units(s.inputs[0]?.amount ?? "0") - units(s.fee?.amount ?? "0");
    const symbol = s.inputs[0]?.symbol ?? USDC;
    const d = decimalsOf(symbol);
    if (v && v.maxDeposit !== null) {
      const room = units(v.maxDeposit);
      if (room < amount) {
        const fit = s.action !== null ? scaled(plan, s.action, room, symbol) : null;
        out.push({ id: `vault-state:cap:${s.id}`, check: "vault-state", family: "risk", severity: "block", title: tx("{name} is nearly full", { name }), why: tx("The vault takes at most {value} {symbol} more (its deposit cap), less than this deposit.", { value: show(room, d), symbol }), say: tx("{name} only takes {value} {symbol} more right now.", { name, value: show(room, d), symbol }), figures: [fig(tx("Room left in the vault"), `${show(room, d)} ${symbol}`, v.read), fig(tx("This deposit"), `${show(amount, d)} ${symbol}`, PLAN(c))], step: s.id, fixes: fit ? [replanFix("fit-cap", tx("Deposit {value} {symbol}", { value: show(fit.units, d), symbol }), fit, { detail: tx("what the vault still takes") })] : [] });
      } else if (room < amount * 2n) out.push({ id: `vault-state:cap:${s.id}`, check: "vault-state", family: "risk", severity: "note", title: tx("{name} is close to its cap", { name }), why: tx("It takes {value} {symbol} more; a deposit after yours may be refused.", { value: show(room, d), symbol }), say: tx("{name} is close to its deposit cap.", { name }), figures: [fig(tx("Room left in the vault"), `${show(room, d)} ${symbol}`, v.read)], step: s.id, fixes: [] });
    }
    if (v && v.apyNow !== null && v.apyWeekAgo !== null && v.apyWeekAgo > 0 && (v.apyWeekAgo - v.apyNow) / v.apyWeekAgo > 0.3) {
      out.push({ id: `vault-state:apy:${s.id}`, check: "vault-state", family: "risk", severity: "warn", title: tx("{name}'s rate fell {value}% this week", { name, value: Math.round(((v.apyWeekAgo - v.apyNow) / v.apyWeekAgo) * 100) }), why: tx("It pays {value}% now against {value2}% a week ago. A sharp drop can mean money is leaving it.", { value: (v.apyNow * 100).toFixed(2), value2: (v.apyWeekAgo * 100).toFixed(2) }), say: tx("{name}'s rate dropped from {value}% to {value2}% in a week.", { name, value: (v.apyWeekAgo * 100).toFixed(2), value2: (v.apyNow * 100).toFixed(2) }), figures: [fig(tx("APY now"), `${(v.apyNow * 100).toFixed(2)}%`, v.read), fig(tx("APY 7 days ago"), `${(v.apyWeekAgo * 100).toFixed(2)}%`, { source: "Lykia's daily rate readings", readAt: null })], step: s.id, fixes: [] });
    }
    if (s.route?.chosen.risk === "high") out.push({ id: `vault-state:risk:${s.id}`, check: "vault-state", family: "risk", severity: "warn", title: tx("{name} has a high risk rating", { name }), why: tx("Lykia rates it high risk{value}: smaller or newer venues can lose money or freeze withdrawals.", { value: s.route.chosen.tvlUsd ? tx(" (it holds ${value})", { value: Number(s.route.chosen.tvlUsd).toLocaleString(coreIntlTag(), { maximumFractionDigits: 0 }) }) : "" }), say: tx("{name} is rated high risk.", { name }), figures: [fig(tx("Risk rating"), "high", { source: s.route.chosen.apySource ?? "Lykia venue registry", readAt: plan.createdAt }), fig(tx("Held in it"), s.route.chosen.tvlUsd ? `$${Number(s.route.chosen.tvlUsd).toLocaleString(coreIntlTag(), { maximumFractionDigits: 0 })}` : "unavailable", { source: s.route.chosen.apySource ?? "venue API", readAt: plan.createdAt })], step: s.id, fixes: [] });
  }
  return out;
};

/* ------------------------------------------------------- 14 · approvals */

export const approvals: PlanCheck = (c) => {
  const { plan, state } = c;
  const touched = new Set(plan.steps.flatMap((s) => Object.values(s.params).filter((v) => /^0x[0-9a-fA-F]{40}$/u.test(v)).map(lc)));
  return state.unlimitedApprovals
    .filter((a) => touched.has(lc(a.spender)))
    .slice(0, 2)
    .map((a): Finding => ({ id: `approvals:${a.symbol}:${lc(a.spender)}`, check: "approvals", family: "approval", severity: "note", title: tx("An old unlimited {symbol} approval to {venue} is still open", { symbol: a.symbol, venue: a.venue }), why: tx("Lykia's steps approve the exact amount, but {venue} ({address}) can already pull any amount of your {symbol}. Revoking it closes that door.", { venue: a.venue, address: short(a.spender), symbol: a.symbol }), say: tx("You still have an unlimited {symbol} approval open to {venue}.", { symbol: a.symbol, venue: a.venue }), figures: [fig(tx("Allowance"), "unlimited", { source: "Arc chain · allowance()", readAt: iso(state.now) })], fixes: [{ id: "revoke", kind: "open", label: tx("Revoke it in the Fold"), path: "/app/fold/fence", needsGas: true }] }));
};

/** At prepare time: an approve() call inside the transactions for an unlimited amount. Lykia never builds one; this is the guard. */
export function unlimitedApprovalFindings(transactions: readonly { readonly data: string; readonly to: string }[]): Finding[] {
  const out: Finding[] = [];
  for (const t of transactions) {
    const data = t.data.toLowerCase();
    for (let i = data.indexOf("095ea7b3"); i >= 0; i = data.indexOf("095ea7b3", i + 8)) {
      const amount = data.slice(i + 8 + 64, i + 8 + 128);
      if (amount.length === 64 && /^[0-9a-f]+$/u.test(amount) && BigInt(`0x${amount}`) >= 2n ** 255n) {
        const spender = `0x${data.slice(i + 8 + 24, i + 8 + 64)}`;
        out.push({ id: `approvals:unlimited:${spender}`, check: "approvals", family: "approval", severity: "block", title: tx("This would create an unlimited approval"), why: tx("One call approves {address} to pull any amount of a token. Lykia only signs exact approvals; plan it again.", { address: short(spender) }), say: tx("This would leave an unlimited approval behind, so it is held back."), figures: [fig(tx("Spender"), short(spender), { source: "The prepared calls", readAt: null })], fixes: [] });
      }
    }
  }
  return out;
}

/* --------------------------------------------------- 15 · address checks */

/** Same first and last four hex characters, a different address: the shape of address poisoning. */
export function lookalike(a: string, b: string): boolean {
  const x = lc(a).slice(2);
  const y = lc(b).slice(2);
  return x !== y && x.slice(0, 4) === y.slice(0, 4) && x.slice(-4) === y.slice(-4);
}

export const recipients: PlanCheck = (c) => {
  const { plan, state } = c;
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const s of plan.steps.filter((x) => x.recipient && (x.kind === "transfer" || x.kind === "bridge"))) {
    const to = lc(s.recipient!);
    if (seen.has(to)) continue;
    seen.add(to);
    const id = `recipient:${s.id}`;
    const fact = fig(tx("Recipient"), s.recipient!, { source: "This plan", readAt: plan.createdAt });
    if (to === ZERO) {
      out.push({ id, check: "recipient", family: "address", severity: "block", title: tx("The recipient is the zero address"), why: tx("Nobody holds the key to 0x000…0000: whatever is sent there is gone for good."), say: tx("That address is the zero address: anything sent there is lost."), figures: [fact], step: s.id, fixes: [] });
      continue;
    }
    const contract = state.contracts.find((k) => lc(k.address) === to);
    if (contract) {
      out.push({ id, check: "recipient", family: "address", severity: "block", title: tx("That's the {name} contract, not a wallet", { name: contract.name }), why: tx("Tokens sent to a token or protocol contract are usually stuck there for good."), say: tx("That address is the {name} contract, not someone's wallet.", { name: contract.name }), figures: [fact], step: s.id, fixes: [] });
      continue;
    }
    const known = state.counterparties ?? [];
    const twin = known.find((k) => lookalike(k.address, to));
    if (twin && !known.some((k) => lc(k.address) === to)) {
      const fixed = s.action !== null ? withRecipient(plan, s.action, twin.address) : null;
      out.push({ id, check: "recipient", family: "address", severity: "block", title: tx("This address only looks like one you paid before"), why: tx("It starts and ends like {value} but is a different address. Scammers send tiny amounts from lookalikes so they show up in your history.", { value: twin.label ? `${twin.label} (${distinct(twin.address)})` : distinct(twin.address) }), say: tx("Stop: {recipient} only looks like {value}, an address you paid before; it's a different one.", { recipient: distinct(s.recipient!), value: twin.label ?? distinct(twin.address) }), figures: [fact, fig(tx("You paid before"), twin.address, { source: twin.label ? "Your contacts" : "Your settled sends", readAt: null })], step: s.id, fixes: fixed ? [replanFix("did-you-mean", tx("Did you mean {address}?", { address: distinct(twin.address) }), fixed, { detail: twin.label ?? tx("the address you paid before") })] : [] });
      continue;
    }
    if (s.kind === "transfer" && to === lc(plan.owner)) {
      out.push({ id, check: "recipient", family: "address", severity: "warn", title: tx("You're sending to your own address"), why: tx("Nothing changes hands, but the fee and gas are still paid."), say: tx("That sends to your own address: nothing moves but the fees."), figures: [fact], step: s.id, fixes: [] });
      continue;
    }
    if (s.kind === "transfer" && state.code[to]) out.push({ id: `${id}:contract`, check: "recipient", family: "address", severity: "warn", title: tx("The recipient is a contract"), why: tx("A contract can hold USDC, but only its own code can move it. Make sure this one is meant to receive payments."), say: tx("{recipient} is a contract, not a person's wallet.", { recipient: distinct(s.recipient!) }), figures: [fact, fig(tx("Code at the address"), "yes", { source: "Arc chain · eth_getCode", readAt: iso(state.now) })], step: s.id, fixes: [] });
    if (state.counterparties !== null && to !== lc(plan.owner) && !known.some((k) => lc(k.address) === to)) out.push({ id: `${id}:first`, check: "recipient", family: "address", severity: "note", title: tx("First payment to this address"), why: tx("You have not paid it before. Check it character by character, or send a small amount first."), say: tx("This is your first payment to {recipient}.", { recipient: distinct(s.recipient!) }), figures: [fact], step: s.id, fixes: [] });
  }
  return out;
};

/* ------------------------------------------------- 16 · bridge destination */

export const bridgeDestination: PlanCheck = (c) => {
  const { plan, state } = c;
  const out: Finding[] = [];
  for (const s of plan.steps.filter((x) => x.kind === "bridge")) {
    const dest = CCTP_DESTINATIONS.find((d) => d.key === s.destination || d.key === s.params.destination);
    const name = dest?.name ?? s.params.destinationName ?? s.destination ?? tx("the other chain");
    const recipient = s.recipient ?? plan.owner;
    const read = state.destinations[`${dest?.key ?? s.destination}:${lc(recipient)}`];
    if (read && read.nativeWei === "0") {
      out.push({ id: `bridge-destination:gas:${s.id}`, check: "bridge-destination", family: "bridge", severity: "warn", title: tx("The recipient has no {nativeSymbol} on {name}", { nativeSymbol: read.nativeSymbol, name }), why: tx("The USDC arrives, but moving it on {name} costs {nativeSymbol} there, and {address} holds none. Lykia's routes don't carry gas yet: send a little {nativeSymbol} to it on {name} first.", { name, nativeSymbol: read.nativeSymbol, address: short(recipient) }), say: tx("{address} has no {nativeSymbol} on {name}, so it couldn't move the USDC once it lands.", { address: short(recipient), nativeSymbol: read.nativeSymbol, name }), figures: [fig(`${read.nativeSymbol} on ${name}`, "0", read.read)], step: s.id, fixes: [] });
    } else if (read && read.nativeWei === null) {
      out.push({ id: `bridge-destination:gas:${s.id}`, check: "bridge-destination", family: "bridge", severity: "note", title: tx("Gas on {name} could not be read", { name }), why: tx("To move the USDC on {name} the recipient needs {nativeSymbol} there; Lykia could not check it.", { name, nativeSymbol: read.nativeSymbol }), say: tx("I couldn't check whether the recipient has {nativeSymbol} on {name}.", { nativeSymbol: read.nativeSymbol, name }), figures: [fig(`${read.nativeSymbol} on ${name}`, "unavailable", read.read)], step: s.id, fixes: [] });
    }
    const minutes = s.settlement.kind === "cctp" ? Math.max(1, Math.round(s.settlement.expectedSeconds / 60)) : null;
    const fee = s.params.maxFee ? units(s.params.maxFee) : null;
    out.push({ id: `bridge-destination:time:${s.id}`, check: "bridge-destination", family: "bridge", severity: "note", title: `${s.route?.chosen.label ?? tx("CCTP to {name}", { name })}${minutes ? tx(": about {minutes} min", { minutes }) : ""}`, why: `${s.params.forward === "1" ? tx("Circle forwards the mint, so no gas is needed on arrival.") : s.settlement.kind === "cctp" ? tx("After Circle's attestation the USDC is minted on the other chain.") : tx("A solver pays on the other chain and is repaid on Arc.")}${fee !== null && fee > 0n ? tx(" The bridge fee is up to {value} USDC.", { value: showUp(fee, 6) }) : ""}`, say: tx("The bridge to {name}{value}.", { name, value: minutes ? tx(" takes about {minutes} min", { minutes }) : "" }), figures: [...(minutes ? [fig(tx("Expected time"), `${minutes} min`, { source: "Circle CCTP", readAt: plan.createdAt })] : []), ...(fee !== null ? [fig(tx("Bridge fee (up to)"), `${showUp(fee, 6)} USDC`, { source: "Circle Iris API", readAt: plan.createdAt })] : [])], step: s.id, fixes: [] });
  }
  return out;
};

/** A bridge the planner refused: unsupported chain, below the route minimum. Built from the planner's own message. */
export function bridgeRefusal(environment: "mainnet" | "testnet", message: string): Finding {
  const supported = CCTP_DESTINATIONS.filter((d) => d.vm === "evm" && d.chainIds[environment] !== null);
  const unsupported = /not a CCTP destination|needs a token account/iu.test(englishText(message));
  return {
    id: unsupported ? "bridge-destination:unsupported" : "bridge-destination:minimum",
    check: "bridge-destination",
    family: "bridge",
    severity: "block",
    title: unsupported ? tx("Lykia can't bridge there") : tx("Below the bridge's minimum"),
    why: unsupported ? tx("{message} Supported: {value}.", { message, value: supported.map((d) => d.name).join(", ") }) : message,
    say: unsupported ? tx("I can't bridge there: Lykia bridges USDC to {value}{value2}.", { value: supported.slice(0, 6).map((d) => d.name).join(", "), value2: supported.length > 6 ? tx(" and more") : "" }) : message,
    figures: [fig(tx("Supported destinations"), supported.map((d) => d.name).join(", "), { source: "Circle CCTP route table", readAt: null })],
    fixes: [],
  };
}

/* ------------------------------------------------- 17 · network and wallet */

export const network: PlanCheck = (c) => {
  const head = c.state.head;
  if (!head || head.ageSeconds <= 30) return [];
  return [{ id: "network:lag", check: "network", family: "network", severity: "warn", title: tx("Arc's RPC looks behind: last block {ageSeconds} s ago", { ageSeconds: Math.round(head.ageSeconds) }), why: tx("Arc makes a block every second or so. Balances and quotes read now may be out of date, and a transaction may wait."), say: tx("Arc's RPC is lagging: its latest block is {ageSeconds} s old.", { ageSeconds: Math.round(head.ageSeconds) }), figures: [fig(tx("Latest block age"), `${Math.round(head.ageSeconds)} s`, head.read)], fixes: [] }];
};

/** Client side: the wallet is on another chain than the plan. */
export function walletNetworkFinding(walletChainId: number | null | undefined, environment: "mainnet" | "testnet"): Finding | null {
  const want = networkFor(environment);
  if (walletChainId === null || walletChainId === undefined || walletChainId === want.chainId) return null;
  const other = networkFor(environment === "mainnet" ? "testnet" : "mainnet");
  const where = walletChainId === other.chainId ? other.name : `chain ${walletChainId}`;
  return { id: "network:wallet", check: "network", family: "network", severity: "block", title: tx("Your wallet is on {where}", { where }), why: tx("This plan is for {name}. Signing on another chain would fail or go somewhere else.", { name: want.name }), say: tx("Your wallet is on {where}; this plan is for {name}.", { where, name: want.name }), figures: [fig(tx("Wallet network"), where, { source: "Your wallet", readAt: null }), fig(tx("Plan network"), want.name, { source: "This plan", readAt: null })], fixes: [{ id: "switch", kind: "switch-network", label: tx("Switch to {name}", { name: want.name }), chainId: want.chainId, needsGas: false }] };
}

/** Client side: a quote older than 30 s is rebuilt before it is signed. */
export function quoteAgeFinding(quotedAtMs: number | null, nowMs: number, ttlMs = 30_000): Finding | null {
  if (quotedAtMs === null || nowMs - quotedAtMs <= ttlMs) return null;
  const s = Math.round((nowMs - quotedAtMs) / 1000);
  return { id: "quote-age", check: "quote-age", family: "time", severity: "note", title: tx("The quote is {s} s old", { s }), why: tx("Lykia rebuilds it from Arc before your wallet opens, so you never sign a stale price."), say: tx("The quote is {s} s old; it is rebuilt before you sign.", { s }), figures: [fig(tx("Quoted at"), new Date(quotedAtMs).toISOString(), { source: "Lykia API · prepare", readAt: new Date(quotedAtMs).toISOString() })], fixes: [] };
}

/* ---------------------------------------------------------- 18 · duplicate */

export const duplicate: PlanCheck = (c) => {
  const { plan, state } = c;
  const mine = fingerprintOf(plan.steps);
  // Pending (being signed), in flight or settled: a plan that was only drafted is not a repeat.
  const twin = state.recent.find((r) => r.id !== plan.id && r.fingerprint === mine && (r.status === "running" || r.status === "settled") && state.now - Date.parse(r.createdAt) <= 10 * 60_000 && Date.parse(r.createdAt) <= Date.parse(plan.createdAt));
  if (!twin) return [];
  const minutes = Math.round((state.now - Date.parse(twin.createdAt)) / 60_000);
  const ago = minutes < 1 ? tx("a moment ago") : tx("{minutes, plural, one {# minute} other {# minutes}} ago", { minutes });
  const what = twin.status === "settled" ? "signed" : tx("started signing");
  return [{ id: "duplicate", check: "duplicate", family: "time", severity: "warn", title: tx("Looks like a repeat of a plan from {value} ago", { value: minutes < 1 ? tx("a moment") : `${minutes} min` }), why: tx("The same steps, amounts and recipients were {what} {ago}{value}.", { what, ago, value: twin.status === "settled" ? tx(" and already settled") : "" }), say: tx("This looks like a repeat of the plan you {what} {ago}.", { what, ago }), figures: [fig(tx("Earlier plan"), twin.id, { source: "Your plans", readAt: twin.createdAt })], fixes: [{ id: "open-earlier", kind: "open", label: tx("Open the earlier plan"), path: `/app/outrun/${twin.id}`, needsGas: false }] }];
};

/** Equal for the same steps, amounts and recipients. */
export function fingerprintOf(steps: readonly Pick<PreflightStep, "kind" | "inputs" | "recipient" | "destination">[]): string {
  return steps.filter((s) => s.kind !== "approve").map((s) => `${s.kind}:${s.inputs.map((a) => `${a.symbol}=${a.amount}`).join("+")}:${lc(s.recipient ?? "")}:${s.destination ?? ""}`).join("|");
}

/* ----------------------------------------------------------- 19 · Fence room */

export const fenceRoom: PlanCheck = (c) => {
  const { plan, state } = c;
  const hit = plan.verdict.reasons.find((r) => r.decision === "deny" && (r.rule === "caps.daily" || r.rule === "beta.cap" || r.rule === "caps.weekly"));
  if (!hit) return [];
  const beta = hit.rule === "beta.cap";
  const cap = beta ? (state.beta?.perDayUsd ?? null) : hit.rule === "caps.weekly" ? (plan.fence.caps?.weeklyUsd ?? null) : (plan.fence.caps?.dailyUsd ?? null);
  const spent = hit.rule === "caps.weekly" ? plan.spent?.weekUsd : plan.spent?.dayUsd;
  const total = plan.steps.filter(moving).reduce<number | null>((n, s) => (n === null || s.usd === null ? null : n + Number(s.usd)), 0);
  const room = cap !== null && spent !== null && spent !== undefined ? Math.max(0, Number(cap) - Number(spent)) : null;
  const fixes: FindingFix[] = [];
  const symbol = plan.steps.find(moving)?.inputs[0]?.symbol;
  if (room !== null && total !== null && room >= 1 && symbol && hit.rule !== "caps.weekly") {
    const price = symbol === USDC ? 1 : Number(state.prices[symbol]?.usd ?? NaN);
    if (Number.isFinite(price) && price > 0) {
      const index = plan.steps.find(moving)?.action ?? null;
      const gross = plan.steps.filter((s) => s.action === index).reduce((n, s) => n + s.inputs.filter((a) => a.symbol === symbol).reduce((m, a) => m + units(a.amount), 0n), 0n);
      const target = BigInt(Math.floor((room / price) * 10 ** decimalsOf(symbol)));
      const today = lowerSpend(plan, symbol, gross - target);
      if (today) fixes.push(replanFix("split-days", tx("Do ${room} today", { room: Math.floor(room) }), today, { detail: tx("then ask for the other ${value} tomorrow", { value: Math.ceil(total - room) }) }));
    }
  }
  if (!beta) fixes.push({ id: "change-fence", kind: "change-fence", label: tx("Change my Fence"), path: "/app/fold/fence", detail: tx("a looser cap needs your signature"), needsGas: false });
  const which = beta ? tx("the beta cap") : hit.rule === "caps.weekly" ? tx("this week's cap") : tx("today's cap");
  return [{ id: `fence-room:${hit.rule}`, check: "fence-room", family: "limits", severity: "block", title: tx("Over {which}{value}", { which, value: room !== null ? tx(": ${value} left", { value: room.toFixed(2) }) : "" }), why: `${hit.message}${room !== null && total !== null ? tx(" This plan moves ${value}.", { value: total.toFixed(2) }) : ""}`, say: tx("That's over {which}{value}.", { which, value: room !== null ? tx(": ${value} is left", { value: room.toFixed(2) }) : "" }), figures: [...(cap !== null ? [fig(beta ? tx("Beta cap a day") : tx("Cap"), `$${cap}`, { source: beta ? "Lykia beta cap" : "Your Fence", readAt: null })] : []), fig(tx("Spent so far"), spent ? `$${spent}` : "unavailable", { source: "Settled steps", readAt: iso(state.now) }), ...(total !== null ? [fig(tx("This plan"), `$${total.toFixed(2)}`, PLAN(c))] : [])], fixes }];
};

/* ------------------------------------------------- 20 · leash and budgets */

export const budget: PlanCheck = (c) => {
  const { plan, state } = c;
  if (plan.verdict.decision === "deny") return [];
  const cap = Number(plan.fence.caps?.dailyUsd ?? NaN);
  const spent = Number(plan.spent?.dayUsd ?? NaN);
  const total = plan.steps.filter(moving).reduce<number | null>((n, s) => (n === null || s.usd === null ? null : n + Number(s.usd)), 0);
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(spent) || total === null) return [];
  const used = (spent + total) / cap;
  if (used < 0.8) return [];
  const who = state.budget.kind === "fence" ? tx("today's budget in your Fence") : tx("{name}'s budget for today", { name: state.budget.name });
  return [{ id: "budget:day", check: "budget", family: "limits", severity: "warn", title: tx("Uses {value}% of {who}", { value: Math.round(used * 100), who }), why: tx("After it, ${value} is left today; later moves are refused until the day resets (UTC).", { value: Math.max(0, cap - spent - total).toFixed(2) }), say: tx("This uses {value}% of {who}.", { value: Math.round(used * 100), who }), figures: [fig(tx("Daily budget"), `$${cap.toFixed(2)}`, { source: state.budget.kind === "fence" ? "Your Fence" : state.budget.name, readAt: null }), fig(tx("Spent today"), `$${spent.toFixed(2)}`, { source: "Settled steps", readAt: iso(state.now) }), fig(tx("This plan"), `$${total.toFixed(2)}`, PLAN(c))], fixes: [] }];
};

/* ------------------------------------------------ 22 · conflicts in Herding */

const MOVES_WORDS = /\b(sweep|idle|the rest|all|earn|put .* to work|move|convert|send|pay|deposit|bridge)\b/iu;

export const conflicts: PlanCheck = (c) => {
  const { state, ledger } = c;
  const symbols = [...ledger.spent.keys()];
  if (symbols.length === 0) return [];
  const out: Finding[] = [];
  for (const r of state.running) {
    if (!r.nextRunAt || Date.parse(r.nextRunAt) - state.now > DAY || Date.parse(r.nextRunAt) < state.now - 60_000) continue;
    const text = `${r.name} ${r.text ?? ""}`;
    const symbol = symbols.find((s) => new RegExp(`\\b${s}\\b`, "iu").test(text));
    if (!symbol || !MOVES_WORDS.test(text)) continue;
    const hours = Math.max(1, Math.round((Date.parse(r.nextRunAt) - state.now) / 3_600_000));
    out.push({ id: `conflict:${r.id}`, check: "conflict", family: "time", severity: "warn", title: tx("\"{value}\" moves {symbol} in {hours} h", { value: r.name.slice(0, 60), symbol, hours }), why: tx("It plans with the {symbol} it finds then. After this plan there is less, so it may move less or fail.", { symbol }), say: tx("Heads up: your {value} \"{value2}\" moves {symbol} in {hours} h.", { value: r.kind.toLowerCase(), value2: r.name.slice(0, 60), symbol, hours }), figures: [fig(r.kind, r.name.slice(0, 80), { source: "Herding", readAt: iso(state.now) }), fig(tx("Next run"), r.nextRunAt, { source: "Herding", readAt: iso(state.now) })], fixes: r.pause ? [{ id: `pause:${r.id}`, kind: "pause", label: tx("Pause it"), detail: tx("{value} in Herding", { value: r.name.slice(0, 40) }), path: r.pause.path, method: r.pause.method, ...(r.pause.body ? { body: r.pause.body } : {}), needsGas: false }] : [] });
  }
  return out.slice(0, 2);
};

/* ------------------------------------------------------------ unpriced */

export const unpriced: PlanCheck = (c) => {
  const steps = c.plan.steps.filter((s) => moving(s) && s.usd === null);
  if (steps.length === 0) return [];
  const symbols = [...new Set(steps.flatMap((s) => s.inputs.map((a) => a.symbol)))];
  return [{ id: "unpriced", check: "unpriced", family: "cost", severity: "note", title: tx("No USD price for {value}", { value: symbols.join(", ") }), why: tx("Without one, your Fence counts these steps as unknown under its caps, and costs can't be compared."), say: tx("There's no USD price for {value} right now.", { value: symbols.join(", ") }), figures: symbols.map((s) => fig(`${s} price`, "unavailable", { source: c.state.prices[s]?.source ?? "Chainlink", readAt: null })), fixes: [] }];
};

/** Every plan check, in the order findings of equal weight are listed. */
export const PLAN_CHECKS: readonly PlanCheck[] = [insufficient, gasReserve, recipients, fenceRoom, loanHealth, fxBand, vaultState, obligations, cashFloor, duplicate, roundTrip, priceImpact, conflicts, budget, network, priceStale, costRatio, dust, approvals, bridgeDestination, unpriced];

