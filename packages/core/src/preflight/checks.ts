/**
 * The plan checks. Each one reads the plan and the state it was given and
 * returns findings; none reads the network, none guesses a figure. A figure
 * a check could not read leaves its finding out (or says "unavailable"),
 * never zero.
 */
import { CCTP_DESTINATIONS, networkFor } from "../networks.js";
import type { Finding, FindingFigure, FindingFix, PreflightPlan, PreflightState, PreflightStep } from "./types.js";
import { decimalsOf, GAS_SYMBOL, lowerSpend, show, showUp, spendAll, withRecipient, scaled, type Ledger } from "./ledger.js";

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
const dollars = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function replanFix(id: string, label: string, adjusted: { readonly sentence: string; readonly actions: readonly import("../actions.js").PlanAction[] }, extra: Partial<FindingFix> = {}): FindingFix {
  return { id, kind: "replan", label, sentence: adjusted.sentence, actions: adjusted.actions, needsGas: true, ...extra };
}

function waitFixes(c: CheckContext, symbol: string, need: bigint): FindingFix[] {
  return c.state.incoming
    .filter((i) => i.symbol === symbol && units(i.units) >= need)
    .slice(0, 1)
    .map((i) => ({ id: `wait:${symbol}`, kind: "wait" as const, label: `Wait for ${show(units(i.units), i.decimals)} ${symbol}`, detail: `${i.label}${i.etaSeconds !== null ? ` (~${Math.max(1, Math.round(i.etaSeconds / 60))} min)` : ""}`, ...(i.etaSeconds !== null ? { etaSeconds: i.etaSeconds } : {}), needsGas: false }));
}

function addFundsFix(c: CheckContext): FindingFix {
  return { id: "add-funds", kind: "add-funds", label: "Add USDC to this wallet", detail: `Send USDC on Arc to ${short(c.plan.account)} from an exchange or another wallet; no gas needed from this one.`, address: c.plan.account, needsGas: false };
}

/* ------------------------------------------------- 1 · gas reserve on Arc */

export const gasReserve: PlanCheck = (c) => {
  const { plan, state, ledger } = c;
  if (plan.accountKind !== "eoa" || plan.steps.length === 0 || !state.wallet) return [];
  const reserve = toUnits(state.prefs.gasReserveUsdc, 6);
  const start = ledger.start.get(USDC) ?? 0n;
  const end = ledger.end.get(USDC) ?? 0n;
  const spends = (ledger.spent.get(USDC) ?? 0n) > 0n;
  const gasFig = fig("Network fee for this plan (up to)", `${showUp(ledger.gas, 6)} USDC`, GAS(c));
  const figs = [fig("USDC in the wallet now", `${show(start, 6)} USDC`, WALLET(c)), gasFig, fig("Your network fee reserve", `${state.prefs.gasReserveUsdc} USDC`, PREFS(c))];
  if (ledger.gasShort && !ledger.short.has(USDC)) {
    const g = ledger.gasShort;
    const fixes: FindingFix[] = [];
    const keep = lowerSpend(plan, USDC, reserve - end);
    const fit = lowerSpend(plan, USDC, -end);
    if (spends && keep) fixes.push(replanFix("keep-reserve", `Use ${show(keep.units, 6)} USDC`, keep, { detail: `keeps ${state.prefs.gasReserveUsdc} USDC for gas`, question: `Use ${show(keep.units, 6)} USDC and keep ${state.prefs.gasReserveUsdc} for gas?` }));
    else if (spends && fit) fixes.push(replanFix("max-fit", `Use ${show(fit.units, 6)} USDC`, fit, { detail: "the most that still pays the network fee" }));
    fixes.push(...waitFixes(c, USDC, g.need - g.have), addFundsFix(c));
    return [{
      id: "gas-reserve",
      check: "gas-reserve",
      family: "gas",
      severity: "block",
      title: `Not enough USDC to pay the network fee`,
      why: `On Arc the network fee is paid in USDC. Step ${g.stage} needs up to ${showUp(g.need, 6)} USDC for it and the wallet would have ${show(g.have, 6)} USDC then, so the wallet could not send it.`,
      say: `That can't go through: on Arc the network fee is paid in USDC, and step ${g.stage} needs up to ${showUp(g.need, 6)} USDC for it while the wallet would hold ${show(g.have < 0n ? 0n : g.have, 6)}.`,
      figures: figs,
      change: { label: "USDC for gas", before: show(start, 6), after: show(end < 0n ? 0n : end, 6) },
      fixes,
    }];
  }
  if (end >= reserve || ledger.short.has(USDC)) return [];
  if (!spends) {
    return [{ id: "gas-reserve", check: "gas-reserve", family: "gas", severity: "note", title: `Gas stays low: ${show(end, 6)} USDC after this plan`, why: `Your network fee reserve is ${state.prefs.gasReserveUsdc} USDC. This plan does not spend USDC, but the next one may not have enough for its fee.`, say: `Gas stays low after this: ${show(end, 6)} USDC, under your ${state.prefs.gasReserveUsdc} USDC reserve.`, figures: figs, change: { label: "USDC for gas", before: show(start, 6), after: show(end, 6) }, fixes: [addFundsFix(c)] }];
  }
  const keep = lowerSpend(plan, USDC, reserve - end);
  const fixes: FindingFix[] = keep ? [replanFix("keep-reserve", `Use ${show(keep.units, 6)} USDC`, keep, { detail: `keeps ${state.prefs.gasReserveUsdc} USDC for gas`, question: `Use ${show(keep.units, 6)} USDC and keep ${state.prefs.gasReserveUsdc} for gas?` })] : [];
  const acquires = plan.steps.some((s) => s.outputs.some((o) => !o.symbol.includes("@") && o.symbol !== USDC));
  return [{
    id: "gas-reserve",
    check: "gas-reserve",
    family: "gas",
    severity: "warn",
    title: `Leaves only ${show(end, 6)} USDC for gas`,
    why: `On Arc gas is paid in USDC. After this plan the wallet keeps ${show(end, 6)} USDC, under your network fee reserve of ${state.prefs.gasReserveUsdc} USDC, so you might not be able to send anything after${acquires ? ", not even to swap back" : ""}.`,
    say: `That would leave ${show(end, 6)} USDC for gas: on Arc, gas is paid in USDC, so you couldn't send anything after${acquires ? ", not even to swap back" : ""}.`,
    figures: [...figs, fig("USDC left after the plan", `${show(end, 6)} USDC`, PLAN(c))],
    change: { label: "USDC for gas", before: show(start, 6), after: show(end, 6) },
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
    title: `Takes you under your cash floor of $${state.prefs.cashFloorUsd}`,
    why: `You asked to always keep $${state.prefs.cashFloorUsd} of USDC at hand. After this plan $${show(end, 6)} would be left.`,
    say: `That takes you under the $${state.prefs.cashFloorUsd} you keep at hand: $${show(end, 6)} would be left.`,
    figures: [fig("USDC now", `${show(start, 6)} USDC`, WALLET(c)), fig("Cash to keep at hand", `$${state.prefs.cashFloorUsd}`, PREFS(c)), fig("USDC after the plan", `${show(end, 6)} USDC`, PLAN(c))],
    change: { label: "USDC at hand", before: show(start, 6), after: show(end, 6) },
    fixes: [...(keep ? [replanFix("keep-floor", `Use ${show(keep.units, 6)} USDC`, keep, { detail: `keeps $${state.prefs.cashFloorUsd} at hand`, question: `Use ${show(keep.units, 6)} USDC and keep your $${state.prefs.cashFloorUsd} at hand?` })] : []), { id: "change-floor", kind: "open", label: "Change my floor", path: "/app/you", needsGas: false }],
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
      title: `Leaves too little ${symbol} for what is due this week`,
      why: `${due.length === 1 ? `${due[0]!.name} takes` : `${due.length} scheduled moves take`} ${show(total, d)} ${symbol} in the next 7 days; after this plan ${show(end < 0n ? 0n : end, d)} ${symbol} would be left, so ${due.length === 1 ? "it" : "some"} would fail.`,
      say: `Careful: ${show(total, d)} ${symbol} is due in the next 7 days and this would leave ${show(end < 0n ? 0n : end, d)}.`,
      figures: [...due.slice(0, 4).map((o) => fig(`${o.kind}: ${o.name}`, `${show(units(o.units), o.decimals)} ${symbol}${o.dueAt ? ` · ${new Date(o.dueAt).toISOString().slice(0, 10)}` : ""}`, { source: "Herding", readAt: iso(state.now) })), fig(`${symbol} after the plan`, `${show(end < 0n ? 0n : end, d)} ${symbol}`, PLAN(c))],
      change: { label: `${symbol} left for what's due`, before: show(ledger.start.get(symbol) ?? 0n, d), after: show(end < 0n ? 0n : end, d) },
      fixes: [
        ...(lowered ? [replanFix(`cover:${symbol}`, `Use ${show(lowered.units, d)} ${symbol}`, lowered, { detail: "covers what is due this week" })] : []),
        ...due.filter((o) => o.pause).slice(0, 2).map((o): FindingFix => ({ id: `pause:${o.id}`, kind: "pause", label: `Pause ${o.name.slice(0, 40)}`, path: o.pause!.path, method: o.pause!.method, ...(o.pause!.body ? { body: o.pause!.body } : {}), detail: "in Herding; resume it any time", needsGas: false })),
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
      title: `Leaves ${show(end, d, 6)} ${symbol} behind`,
      why: `${dollars(usd)} of ${symbol} would stay in the wallet: less than it costs to move it later.`,
      say: `This leaves ${show(end, d, 6)} ${symbol} (${dollars(usd)}) behind, too little to move later.`,
      figures: [fig(`${symbol} left`, `${show(end, d, 6)} ${symbol}`, PLAN(c)), fig("Worth", dollars(usd), { source: state.prices[symbol]?.source ?? "Chainlink", readAt: state.prices[symbol]?.updatedAt ?? null })],
      fixes: all ? [replanFix(`all:${symbol}`, `Use all my ${symbol}`, all, { detail: "nothing left behind" })] : [],
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
    const parts = [`${show(moved, d)} to move`, ...(fee > 0n ? [`${showUp(fee, d)} Lykia fee`] : []), ...(gas > 0n ? [`up to ${showUp(gas, 6)} network fee`] : [])];
    const need = missing + (symbol === USDC ? gas : 0n);
    const max = lowerSpend(plan, symbol, need + (symbol === USDC ? toUnits(state.prefs.gasReserveUsdc, 6) : 0n));
    const maxNoReserve = symbol === USDC && !max ? lowerSpend(plan, symbol, need) : null;
    const best = max ?? maxNoReserve;
    out.push({
      id: `insufficient:${symbol}`,
      check: "insufficient",
      family: "money",
      severity: "block",
      title: `Not enough ${symbol}: ${show(need, d)} short`,
      why: `This plan needs ${parts.join(" + ")}; the wallet has ${show(have, d)} ${symbol}.`,
      say: `You're ${show(need, d)} ${symbol} short: this needs ${parts.join(" + ")}, and the wallet has ${show(have, d)}.`,
      figures: [fig(`${symbol} in the wallet`, `${show(have, d)} ${symbol}`, WALLET(c)), fig("To move", `${show(moved, d)} ${symbol}`, PLAN(c)), ...(fee > 0n ? [fig("Lykia fee", `${showUp(fee, d)} ${symbol}`, LYKIA_FEE)] : []), ...(gas > 0n ? [fig("Network fee (up to)", `${showUp(gas, 6)} USDC`, GAS(c))] : [])],
      change: { label: symbol, before: show(have, d), after: `-${show(need, d)}` },
      fixes: [...(best ? [replanFix(`max:${symbol}`, `Use ${show(best.units, d)} ${symbol}`, best, { detail: max && symbol === USDC ? `the most that fits and keeps ${state.prefs.gasReserveUsdc} USDC for gas` : "the most that fits" })] : []), ...waitFixes(c, symbol, need), ...(symbol === USDC ? [addFundsFix(c)] : [])],
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
  const parts = [feeUsd > 0 ? `Lykia fee ${dollars(feeUsd)}` : null, gasUsd > 0 ? `network fee up to ${dollars(gasUsd)}` : null, impactUsd > 0 ? `price impact and spread ${dollars(impactUsd)}` : null].filter(Boolean);
  return [{
    id: "cost-ratio",
    check: "cost-ratio",
    family: "cost",
    severity: pct > 5 ? "warn" : "note",
    title: `Costs are ${pct.toFixed(1)}% of the amount`,
    why: `You'd pay ${dollars(cost)} to move ${dollars(amountUsd)} (${pct.toFixed(1)}%): ${parts.join(", ")}.`,
    say: `You'd pay ${dollars(cost)} to move ${dollars(amountUsd)} (${pct.toFixed(1)}%).`,
    figures: [fig("Amount", dollars(amountUsd), PLAN(c)), fig("Lykia fee", dollars(feeUsd), LYKIA_FEE), fig("Network fee (up to)", dollars(gasUsd), GAS(c)), fig("Price impact and spread", dollars(impactUsd), { source: "This plan's quote against Chainlink", readAt: plan.createdAt })],
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
      title: `Price impact ${(bps / 100).toFixed(2)}% on ${s.route?.chosen.label ?? s.venue}`,
      why: `The pool pays ${dollars(outUsd)} for ${dollars(inUsd)} at reference prices, ${(bps / 100).toFixed(2)}% worse, above ${limit === 100 ? "1%" : `your Fence's ${(limit / 100).toFixed(2)}%`}.`,
      say: `The pool would pay ${(bps / 100).toFixed(2)}% under the reference price for this size.`,
      figures: [fig("You put in", dollars(inUsd), { source: "Chainlink", readAt: state.prices[i.symbol]?.updatedAt ?? null }), fig("You get, at reference", dollars(outUsd), { source: "Chainlink", readAt: state.prices[o.symbol]?.updatedAt ?? null }), fig("Pool depth", s.route?.chosen.tvlUsd ? `$${Number(s.route.chosen.tvlUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "unavailable", { source: s.route?.chosen.label ?? s.venue, readAt: plan.createdAt })],
      step: s.id,
      fixes: [
        ...(half ? [replanFix("half", `Swap ${show(half.units, i.decimals)} ${i.symbol} now`, half, { detail: "half now, the rest later" })] : []),
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
      out.push({ id: `fx-band:${s.id}`, check: "fx-band", family: "risk", severity: "warn", title: "No reference rate to check this conversion against", why: "Chainlink's EURC/USD could not be read, so nobody can tell whether the pool's rate is fair. Your Fence treats it as unknown.", say: "There is no reference rate to check this conversion against right now.", figures: [fig("EURC/USD reference", "unavailable", refRead)], step: s.id, fixes: [] });
      continue;
    }
    if (band === null) continue;
    const dev = s.fxDeviationBps ?? 0;
    const i = s.inputs[0];
    const o = s.outputs[0];
    const rate = i && o && units(i.amount) > 0n ? (Number(o.amount) / 10 ** o.decimals) / (Number(units(i.amount) - units(s.fee?.amount ?? "0")) / 10 ** i.decimals) : null;
    const figures = [fig("Pool rate", rate === null ? "unavailable" : `1 ${i!.symbol} = ${rate.toFixed(4)} ${o!.symbol}`, PLAN(c)), fig("Reference EURC/USD", ref?.usd ?? "unavailable", refRead), fig("Off the reference", `${(dev / 100).toFixed(2)}%`, PLAN(c)), fig("Your FX band", `${(band / 100).toFixed(2)}%`, { source: "Your Fence", readAt: null })];
    if (dev > band) out.push({ id: `fx-band:${s.id}`, check: "fx-band", family: "risk", severity: "block", title: `The rate is ${(dev / 100).toFixed(2)}% off the reference`, why: `Your Fence allows ${(band / 100).toFixed(2)}% from Chainlink's EURC/USD; this pool is further off.`, say: `The pool's rate is ${(dev / 100).toFixed(2)}% worse than the reference, outside your ${(band / 100).toFixed(2)}% band.`, figures, step: s.id, fixes: [{ id: "change-fence", kind: "change-fence", label: "Change my FX band", path: "/app/fold/fence", needsGas: false }] });
    else if (dev > band * 0.75 && dev > 0) out.push({ id: `fx-band:${s.id}`, check: "fx-band", family: "risk", severity: "note", title: `The rate is close to your FX band`, why: `${(dev / 100).toFixed(2)}% off Chainlink's EURC/USD; your band is ${(band / 100).toFixed(2)}%.`, say: `The rate is ${(dev / 100).toFixed(2)}% off the reference, close to your band.`, figures, step: s.id, fixes: [] });
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
    out.push({ id: `price-stale:${symbol}`, check: "price-stale", family: "time", severity: "warn", title: `The ${symbol} price is ${hours} h old`, why: `Chainlink's round for ${symbol} is older than its heartbeat allows (${Math.round(p.maxAgeSeconds / 3600)} h), so values and caps on it are not current.`, say: `The ${symbol} price feed is ${hours} hours old, past its heartbeat.`, figures: [fig(`${symbol} last updated`, p.updatedAt, { source: p.source, readAt: p.updatedAt }), fig("Allowed age", `${Math.round(p.maxAgeSeconds / 3600)} h`, { source: p.source, readAt: null })], fixes: [] });
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
    out.push({ id: `round-trip:${s.id}`, check: "round-trip", family: "cost", severity: "warn", title: `You converted ${to} to ${from} ${hours} h ago`, why: `Going back now pays the fee and the spread twice: you'd lose about ${dollars(lost)} in fees and spread over the two trades.`, say: `You swapped ${to} to ${from} ${hours} h ago; going back loses about ${dollars(lost)} in fees and spread.`, figures: [fig("Earlier trade", `${to} → ${from}`, { source: "Your plans on Arc", readAt: back.w.settledAt }), fig("Fees and spread, both trades", dollars(lost), PLAN(c))], step: s.id, fixes: [{ id: "open-earlier", kind: "open", label: "Open the earlier plan", path: `/app/outrun/${back.r.id}`, needsGas: false }] });
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
    const figures = [fig("Health now", before ?? "unavailable", { source: "Arc chain · lending venue", readAt: plan.createdAt }), fig("Health after", after === null ? "unavailable" : after.toFixed(2), PLAN(c)), fig("Your Fence floor", floor.toFixed(2), { source: "Your Fence", readAt: null })];
    const change = { label: "Loan health", before: before ? Number(before).toFixed(2) : "?", after: after === null ? "?" : after.toFixed(2) };
    if (after === null) out.push({ id: `loan-health:${s.id}`, check: "loan-health", family: "risk", severity: "warn", title: "Loan health after this step could not be read", why: "Without it nobody can tell how close the loan gets to liquidation; your Fence refuses borrowing it cannot judge.", say: "The loan's health after this step can't be read right now.", figures, change, step: s.id, fixes: [] });
    else if (after < floor) out.push({ id: `loan-health:${s.id}`, check: "loan-health", family: "risk", severity: "block", title: `Loan health would drop to ${after.toFixed(2)}`, why: `Your Fence keeps loans above ${floor.toFixed(2)}. At 1.00 part of the collateral can be sold to repay the loan.`, say: `That would take the loan's health to ${after.toFixed(2)}, under your ${floor.toFixed(2)} floor.`, figures, change, step: s.id, fixes: [] });
    else if (after < floor + 0.25) out.push({ id: `loan-health:${s.id}`, check: "loan-health", family: "risk", severity: "warn", title: `Loan health would be ${after.toFixed(2)}, close to your floor`, why: `Your floor is ${floor.toFixed(2)}; a small price move would push it under.`, say: `The loan's health would be ${after.toFixed(2)}, close to your ${floor.toFixed(2)} floor.`, figures, change, step: s.id, fixes: [] });
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
        out.push({ id: `vault-state:cap:${s.id}`, check: "vault-state", family: "risk", severity: "block", title: `${name} is nearly full`, why: `The vault takes at most ${show(room, d)} ${symbol} more (its deposit cap), less than this deposit.`, say: `${name} only takes ${show(room, d)} ${symbol} more right now.`, figures: [fig("Room left in the vault", `${show(room, d)} ${symbol}`, v.read), fig("This deposit", `${show(amount, d)} ${symbol}`, PLAN(c))], step: s.id, fixes: fit ? [replanFix("fit-cap", `Deposit ${show(fit.units, d)} ${symbol}`, fit, { detail: "what the vault still takes" })] : [] });
      } else if (room < amount * 2n) out.push({ id: `vault-state:cap:${s.id}`, check: "vault-state", family: "risk", severity: "note", title: `${name} is close to its cap`, why: `It takes ${show(room, d)} ${symbol} more; a deposit after yours may be refused.`, say: `${name} is close to its deposit cap.`, figures: [fig("Room left in the vault", `${show(room, d)} ${symbol}`, v.read)], step: s.id, fixes: [] });
    }
    if (v && v.apyNow !== null && v.apyWeekAgo !== null && v.apyWeekAgo > 0 && (v.apyWeekAgo - v.apyNow) / v.apyWeekAgo > 0.3) {
      out.push({ id: `vault-state:apy:${s.id}`, check: "vault-state", family: "risk", severity: "warn", title: `${name}'s rate fell ${Math.round(((v.apyWeekAgo - v.apyNow) / v.apyWeekAgo) * 100)}% this week`, why: `It pays ${(v.apyNow * 100).toFixed(2)}% now against ${(v.apyWeekAgo * 100).toFixed(2)}% a week ago. A sharp drop can mean money is leaving it.`, say: `${name}'s rate dropped from ${(v.apyWeekAgo * 100).toFixed(2)}% to ${(v.apyNow * 100).toFixed(2)}% in a week.`, figures: [fig("APY now", `${(v.apyNow * 100).toFixed(2)}%`, v.read), fig("APY 7 days ago", `${(v.apyWeekAgo * 100).toFixed(2)}%`, { source: "Lykia's daily rate readings", readAt: null })], step: s.id, fixes: [] });
    }
    if (s.route?.chosen.risk === "high") out.push({ id: `vault-state:risk:${s.id}`, check: "vault-state", family: "risk", severity: "warn", title: `${name} has a high risk rating`, why: `Lykia rates it high risk${s.route.chosen.tvlUsd ? ` (it holds $${Number(s.route.chosen.tvlUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })})` : ""}: smaller or newer venues can lose money or freeze withdrawals.`, say: `${name} is rated high risk.`, figures: [fig("Risk rating", "high", { source: s.route.chosen.apySource ?? "Lykia venue registry", readAt: plan.createdAt }), fig("Held in it", s.route.chosen.tvlUsd ? `$${Number(s.route.chosen.tvlUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "unavailable", { source: s.route.chosen.apySource ?? "venue API", readAt: plan.createdAt })], step: s.id, fixes: [] });
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
    .map((a): Finding => ({ id: `approvals:${a.symbol}:${lc(a.spender)}`, check: "approvals", family: "approval", severity: "note", title: `An old unlimited ${a.symbol} approval to ${a.venue} is still open`, why: `Lykia's steps approve the exact amount, but ${a.venue} (${short(a.spender)}) can already pull any amount of your ${a.symbol}. Revoking it closes that door.`, say: `You still have an unlimited ${a.symbol} approval open to ${a.venue}.`, figures: [fig("Allowance", "unlimited", { source: "Arc chain · allowance()", readAt: iso(state.now) })], fixes: [{ id: "revoke", kind: "open", label: "Revoke it in the Fold", path: "/app/fold/fence", needsGas: true }] }));
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
        out.push({ id: `approvals:unlimited:${spender}`, check: "approvals", family: "approval", severity: "block", title: "This would create an unlimited approval", why: `One call approves ${short(spender)} to pull any amount of a token. Lykia only signs exact approvals; plan it again.`, say: "This would leave an unlimited approval behind, so it is held back.", figures: [fig("Spender", short(spender), { source: "The prepared calls", readAt: null })], fixes: [] });
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
    const fact = fig("Recipient", s.recipient!, { source: "This plan", readAt: plan.createdAt });
    if (to === ZERO) {
      out.push({ id, check: "recipient", family: "address", severity: "block", title: "The recipient is the zero address", why: "Nobody holds the key to 0x000…0000: whatever is sent there is gone for good.", say: "That address is the zero address: anything sent there is lost.", figures: [fact], step: s.id, fixes: [] });
      continue;
    }
    const contract = state.contracts.find((k) => lc(k.address) === to);
    if (contract) {
      out.push({ id, check: "recipient", family: "address", severity: "block", title: `That's the ${contract.name} contract, not a wallet`, why: `Tokens sent to a token or protocol contract are usually stuck there for good.`, say: `That address is the ${contract.name} contract, not someone's wallet.`, figures: [fact], step: s.id, fixes: [] });
      continue;
    }
    const known = state.counterparties ?? [];
    const twin = known.find((k) => lookalike(k.address, to));
    if (twin && !known.some((k) => lc(k.address) === to)) {
      const fixed = s.action !== null ? withRecipient(plan, s.action, twin.address) : null;
      out.push({ id, check: "recipient", family: "address", severity: "block", title: "This address only looks like one you paid before", why: `It starts and ends like ${twin.label ? `${twin.label} (${distinct(twin.address)})` : distinct(twin.address)} but is a different address. Scammers send tiny amounts from lookalikes so they show up in your history.`, say: `Stop: ${distinct(s.recipient!)} only looks like ${twin.label ?? distinct(twin.address)}, an address you paid before; it's a different one.`, figures: [fact, fig("You paid before", twin.address, { source: twin.label ? "Your contacts" : "Your settled sends", readAt: null })], step: s.id, fixes: fixed ? [replanFix("did-you-mean", `Did you mean ${distinct(twin.address)}?`, fixed, { detail: twin.label ?? "the address you paid before" })] : [] });
      continue;
    }
    if (s.kind === "transfer" && to === lc(plan.owner)) {
      out.push({ id, check: "recipient", family: "address", severity: "warn", title: "You're sending to your own address", why: "Nothing changes hands, but the fee and gas are still paid.", say: "That sends to your own address: nothing moves but the fees.", figures: [fact], step: s.id, fixes: [] });
      continue;
    }
    if (s.kind === "transfer" && state.code[to]) out.push({ id: `${id}:contract`, check: "recipient", family: "address", severity: "warn", title: "The recipient is a contract", why: "A contract can hold USDC, but only its own code can move it. Make sure this one is meant to receive payments.", say: `${distinct(s.recipient!)} is a contract, not a person's wallet.`, figures: [fact, fig("Code at the address", "yes", { source: "Arc chain · eth_getCode", readAt: iso(state.now) })], step: s.id, fixes: [] });
    if (state.counterparties !== null && to !== lc(plan.owner) && !known.some((k) => lc(k.address) === to)) out.push({ id: `${id}:first`, check: "recipient", family: "address", severity: "note", title: "First payment to this address", why: "You have not paid it before. Check it character by character, or send a small amount first.", say: `This is your first payment to ${distinct(s.recipient!)}.`, figures: [fact], step: s.id, fixes: [] });
  }
  return out;
};

/* ------------------------------------------------- 16 · bridge destination */

export const bridgeDestination: PlanCheck = (c) => {
  const { plan, state } = c;
  const out: Finding[] = [];
  for (const s of plan.steps.filter((x) => x.kind === "bridge")) {
    const dest = CCTP_DESTINATIONS.find((d) => d.key === s.destination || d.key === s.params.destination);
    const name = dest?.name ?? s.params.destinationName ?? s.destination ?? "the other chain";
    const recipient = s.recipient ?? plan.owner;
    const read = state.destinations[`${dest?.key ?? s.destination}:${lc(recipient)}`];
    if (read && read.nativeWei === "0") {
      out.push({ id: `bridge-destination:gas:${s.id}`, check: "bridge-destination", family: "bridge", severity: "warn", title: `The recipient has no ${read.nativeSymbol} on ${name}`, why: `The USDC arrives, but moving it on ${name} costs ${read.nativeSymbol} there, and ${short(recipient)} holds none. Lykia's routes don't carry gas yet: send a little ${read.nativeSymbol} to it on ${name} first.`, say: `${short(recipient)} has no ${read.nativeSymbol} on ${name}, so it couldn't move the USDC once it lands.`, figures: [fig(`${read.nativeSymbol} on ${name}`, "0", read.read)], step: s.id, fixes: [] });
    } else if (read && read.nativeWei === null) {
      out.push({ id: `bridge-destination:gas:${s.id}`, check: "bridge-destination", family: "bridge", severity: "note", title: `Gas on ${name} could not be read`, why: `To move the USDC on ${name} the recipient needs ${read.nativeSymbol} there; Lykia could not check it.`, say: `I couldn't check whether the recipient has ${read.nativeSymbol} on ${name}.`, figures: [fig(`${read.nativeSymbol} on ${name}`, "unavailable", read.read)], step: s.id, fixes: [] });
    }
    const minutes = s.settlement.kind === "cctp" ? Math.max(1, Math.round(s.settlement.expectedSeconds / 60)) : null;
    const fee = s.params.maxFee ? units(s.params.maxFee) : null;
    out.push({ id: `bridge-destination:time:${s.id}`, check: "bridge-destination", family: "bridge", severity: "note", title: `${s.route?.chosen.label ?? `CCTP to ${name}`}${minutes ? `: about ${minutes} min` : ""}`, why: `${s.params.forward === "1" ? "Circle forwards the mint, so no gas is needed on arrival." : s.settlement.kind === "cctp" ? "After Circle's attestation the USDC is minted on the other chain." : "A solver pays on the other chain and is repaid on Arc."}${fee !== null && fee > 0n ? ` The bridge fee is up to ${showUp(fee, 6)} USDC.` : ""}`, say: `The bridge to ${name}${minutes ? ` takes about ${minutes} min` : ""}.`, figures: [...(minutes ? [fig("Expected time", `${minutes} min`, { source: "Circle CCTP", readAt: plan.createdAt })] : []), ...(fee !== null ? [fig("Bridge fee (up to)", `${showUp(fee, 6)} USDC`, { source: "Circle Iris API", readAt: plan.createdAt })] : [])], step: s.id, fixes: [] });
  }
  return out;
};

/** A bridge the planner refused: unsupported chain, below the route minimum. Built from the planner's own message. */
export function bridgeRefusal(environment: "mainnet" | "testnet", message: string): Finding {
  const supported = CCTP_DESTINATIONS.filter((d) => d.vm === "evm" && d.chainIds[environment] !== null);
  const unsupported = /not a CCTP destination|needs a token account/iu.test(message);
  return {
    id: unsupported ? "bridge-destination:unsupported" : "bridge-destination:minimum",
    check: "bridge-destination",
    family: "bridge",
    severity: "block",
    title: unsupported ? "Lykia can't bridge there" : "Below the bridge's minimum",
    why: unsupported ? `${message} Supported: ${supported.map((d) => d.name).join(", ")}.` : message,
    say: unsupported ? `I can't bridge there: Lykia bridges USDC to ${supported.slice(0, 6).map((d) => d.name).join(", ")}${supported.length > 6 ? " and more" : ""}.` : message,
    figures: [fig("Supported destinations", supported.map((d) => d.name).join(", "), { source: "Circle CCTP route table", readAt: null })],
    fixes: [],
  };
}

/* ------------------------------------------------- 17 · network and wallet */

export const network: PlanCheck = (c) => {
  const head = c.state.head;
  if (!head || head.ageSeconds <= 30) return [];
  return [{ id: "network:lag", check: "network", family: "network", severity: "warn", title: `Arc's RPC looks behind: last block ${Math.round(head.ageSeconds)} s ago`, why: "Arc makes a block every second or so. Balances and quotes read now may be out of date, and a transaction may wait.", say: `Arc's RPC is lagging: its latest block is ${Math.round(head.ageSeconds)} s old.`, figures: [fig("Latest block age", `${Math.round(head.ageSeconds)} s`, head.read)], fixes: [] }];
};

/** Client side: the wallet is on another chain than the plan. */
export function walletNetworkFinding(walletChainId: number | null | undefined, environment: "mainnet" | "testnet"): Finding | null {
  const want = networkFor(environment);
  if (walletChainId === null || walletChainId === undefined || walletChainId === want.chainId) return null;
  const other = networkFor(environment === "mainnet" ? "testnet" : "mainnet");
  const where = walletChainId === other.chainId ? other.name : `chain ${walletChainId}`;
  return { id: "network:wallet", check: "network", family: "network", severity: "block", title: `Your wallet is on ${where}`, why: `This plan is for ${want.name}. Signing on another chain would fail or go somewhere else.`, say: `Your wallet is on ${where}; this plan is for ${want.name}.`, figures: [fig("Wallet network", where, { source: "Your wallet", readAt: null }), fig("Plan network", want.name, { source: "This plan", readAt: null })], fixes: [{ id: "switch", kind: "switch-network", label: `Switch to ${want.name}`, chainId: want.chainId, needsGas: false }] };
}

/** Client side: a quote older than 30 s is rebuilt before it is signed. */
export function quoteAgeFinding(quotedAtMs: number | null, nowMs: number, ttlMs = 30_000): Finding | null {
  if (quotedAtMs === null || nowMs - quotedAtMs <= ttlMs) return null;
  const s = Math.round((nowMs - quotedAtMs) / 1000);
  return { id: "quote-age", check: "quote-age", family: "time", severity: "note", title: `The quote is ${s} s old`, why: "Lykia rebuilds it from Arc before your wallet opens, so you never sign a stale price.", say: `The quote is ${s} s old; it is rebuilt before you sign.`, figures: [fig("Quoted at", new Date(quotedAtMs).toISOString(), { source: "Lykia API · prepare", readAt: new Date(quotedAtMs).toISOString() })], fixes: [] };
}

/* ---------------------------------------------------------- 18 · duplicate */

export const duplicate: PlanCheck = (c) => {
  const { plan, state } = c;
  const mine = fingerprintOf(plan.steps);
  // Pending (being signed), in flight or settled: a plan that was only drafted is not a repeat.
  const twin = state.recent.find((r) => r.id !== plan.id && r.fingerprint === mine && (r.status === "running" || r.status === "settled") && state.now - Date.parse(r.createdAt) <= 10 * 60_000 && Date.parse(r.createdAt) <= Date.parse(plan.createdAt));
  if (!twin) return [];
  const minutes = Math.round((state.now - Date.parse(twin.createdAt)) / 60_000);
  const ago = minutes < 1 ? "a moment ago" : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const what = twin.status === "settled" ? "signed" : "started signing";
  return [{ id: "duplicate", check: "duplicate", family: "time", severity: "warn", title: `Looks like a repeat of a plan from ${minutes < 1 ? "a moment" : `${minutes} min`} ago`, why: `The same steps, amounts and recipients were ${what} ${ago}${twin.status === "settled" ? " and already settled" : ""}.`, say: `This looks like a repeat of the plan you ${what} ${ago}.`, figures: [fig("Earlier plan", twin.id, { source: "Your plans", readAt: twin.createdAt })], fixes: [{ id: "open-earlier", kind: "open", label: "Open the earlier plan", path: `/app/outrun/${twin.id}`, needsGas: false }] }];
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
      if (today) fixes.push(replanFix("split-days", `Do $${Math.floor(room)} today`, today, { detail: `then ask for the other $${Math.ceil(total - room)} tomorrow` }));
    }
  }
  if (!beta) fixes.push({ id: "change-fence", kind: "change-fence", label: "Change my Fence", path: "/app/fold/fence", detail: "a looser cap needs your signature", needsGas: false });
  const which = beta ? "the beta cap" : hit.rule === "caps.weekly" ? "this week's cap" : "today's cap";
  return [{ id: `fence-room:${hit.rule}`, check: "fence-room", family: "limits", severity: "block", title: `Over ${which}${room !== null ? `: $${room.toFixed(2)} left` : ""}`, why: `${hit.message}${room !== null && total !== null ? ` This plan moves $${total.toFixed(2)}.` : ""}`, say: `That's over ${which}${room !== null ? `: $${room.toFixed(2)} is left` : ""}.`, figures: [...(cap !== null ? [fig(beta ? "Beta cap a day" : "Cap", `$${cap}`, { source: beta ? "Lykia beta cap" : "Your Fence", readAt: null })] : []), fig("Spent so far", spent ? `$${spent}` : "unavailable", { source: "Settled steps", readAt: iso(state.now) }), ...(total !== null ? [fig("This plan", `$${total.toFixed(2)}`, PLAN(c))] : [])], fixes }];
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
  const who = state.budget.kind === "fence" ? "today's budget in your Fence" : `${state.budget.name}'s budget for today`;
  return [{ id: "budget:day", check: "budget", family: "limits", severity: "warn", title: `Uses ${Math.round(used * 100)}% of ${who}`, why: `After it, $${Math.max(0, cap - spent - total).toFixed(2)} is left today; later moves are refused until the day resets (UTC).`, say: `This uses ${Math.round(used * 100)}% of ${who}.`, figures: [fig("Daily budget", `$${cap.toFixed(2)}`, { source: state.budget.kind === "fence" ? "Your Fence" : state.budget.name, readAt: null }), fig("Spent today", `$${spent.toFixed(2)}`, { source: "Settled steps", readAt: iso(state.now) }), fig("This plan", `$${total.toFixed(2)}`, PLAN(c))], fixes: [] }];
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
    out.push({ id: `conflict:${r.id}`, check: "conflict", family: "time", severity: "warn", title: `"${r.name.slice(0, 60)}" moves ${symbol} in ${hours} h`, why: `It plans with the ${symbol} it finds then. After this plan there is less, so it may move less or fail.`, say: `Heads up: your ${r.kind.toLowerCase()} "${r.name.slice(0, 60)}" moves ${symbol} in ${hours} h.`, figures: [fig(r.kind, r.name.slice(0, 80), { source: "Herding", readAt: iso(state.now) }), fig("Next run", r.nextRunAt, { source: "Herding", readAt: iso(state.now) })], fixes: r.pause ? [{ id: `pause:${r.id}`, kind: "pause", label: `Pause it`, detail: `${r.name.slice(0, 40)} in Herding`, path: r.pause.path, method: r.pause.method, ...(r.pause.body ? { body: r.pause.body } : {}), needsGas: false }] : [] });
  }
  return out.slice(0, 2);
};

/* ------------------------------------------------------------ unpriced */

export const unpriced: PlanCheck = (c) => {
  const steps = c.plan.steps.filter((s) => moving(s) && s.usd === null);
  if (steps.length === 0) return [];
  const symbols = [...new Set(steps.flatMap((s) => s.inputs.map((a) => a.symbol)))];
  return [{ id: "unpriced", check: "unpriced", family: "cost", severity: "note", title: `No USD price for ${symbols.join(", ")}`, why: "Without one, your Fence counts these steps as unknown under its caps, and costs can't be compared.", say: `There's no USD price for ${symbols.join(", ")} right now.`, figures: symbols.map((s) => fig(`${s} price`, "unavailable", { source: c.state.prices[s]?.source ?? "Chainlink", readAt: null })), fixes: [] }];
};

/** Every plan check, in the order findings of equal weight are listed. */
export const PLAN_CHECKS: readonly PlanCheck[] = [insufficient, gasReserve, recipients, fenceRoom, loanHealth, fxBand, vaultState, obligations, cashFloor, duplicate, roundTrip, priceImpact, conflicts, budget, network, priceStale, costRatio, dust, approvals, bridgeDestination, unpriced];

