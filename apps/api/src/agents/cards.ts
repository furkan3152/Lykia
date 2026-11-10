/**
 * Answer cards and work steps for Lyko's chat.
 *
 * Cards (`block` events) are built here from data the server holds: the
 * wallet snapshot, the owner's preferences, the Fence and its verdict, the
 * oracle prices and the planned intent. A model can ask for a card by kind
 * (show_card), but every number in it comes from these reads, never from
 * the model's words.
 *
 * Steps (`step` events) mark real work as it starts and ends, with the
 * measured time, so the chat can lay one tessera per step.
 */
import { fromBaseUnits, type Address, type ArcEnvironment, type Fence, type IntentGraph } from "@lykia/core";
import { parseAnswerBlock, parseChatStep, type AnswerBlock, type ChatStep, type ChatStepKind } from "@lykia/core/api/answer";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { PositionsResponse } from "@lykia/core";
import type { AppContext } from "../context.js";
import { getPreferences } from "../fold/preferences.js";
import { services } from "../services.js";
import { FEEDS } from "../arc/prices.js";
import type { Emit } from "./orchestrator.js";

/* ------------------------------------------------------------------ steps */

export interface StepHandle {
  end(state: Exclude<ChatStep["state"], "running">, result?: string, detail?: string): void;
}

export interface Stepper {
  start(kind: ChatStepKind, label: string, agent?: string): StepHandle;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const steppers = new WeakMap<Emit, Stepper>();

/** One stepper per turn (per emit function), so ids stay unique across perception, the reader and the tool loop. */
export function stepsFor(emit: Emit): Stepper {
  const known = steppers.get(emit);
  if (known) return known;
  let n = 0;
  const stepper: Stepper = {
    start(kind, label, agent) {
      n += 1;
      const id = `s${n}`;
      const t0 = Date.now();
      const base = { id, kind, label: clip(label, 80), ...(agent ? { agent: clip(agent, 60) } : {}) };
      const send = (step: ChatStep) => {
        const valid = parseChatStep(step);
        if (valid) emit("step", valid);
      };
      send({ ...base, state: "running" });
      let ended = false;
      return {
        end(state, result, detail) {
          if (ended) return;
          ended = true;
          send({ ...base, state, ...(result ? { result: clip(result.replace(/\s+/gu, " ").trim(), 160) } : {}), ...(detail ? { detail: clip(detail.replace(/\s+/gu, " ").trim(), 600) } : {}), ms: Date.now() - t0 });
        },
      };
    },
  };
  steppers.set(emit, stepper);
  return stepper;
}

/** Emits a block only when it validates. */
export function emitBlock(emit: Emit, block: AnswerBlock | null): AnswerBlock | null {
  const valid = block ? parseAnswerBlock(block) : null;
  if (valid) emit("block", valid);
  return valid;
}

/* ------------------------------------------------------------------ cards */

/** Trims a decimal string to at most `places` decimals, without trailing zeros. */
export function trimDecimal(value: string, places = 6): string {
  const [w = "0", f = ""] = value.split(".");
  const frac = f.slice(0, places).replace(/0+$/u, "");
  return frac ? `${w}.${frac}` : w;
}

/** The gas gauge: native USDC (Arc's gas) against the owner's gas floor. */
export async function gasCard(ctx: AppContext, environment: ArcEnvironment, owner: Address, snap: FlockSnapshot, sample: boolean): Promise<AnswerBlock | null> {
  const prefs = await getPreferences(ctx, sample ? null : owner).catch(() => null);
  const floor = prefs?.gasFloorUsdc ?? "0.5";
  let balance: string;
  try {
    balance = trimDecimal(fromBaseUnits(BigInt(snap.native.usdc18), 18), 6);
  } catch {
    return null;
  }
  const pulse = ctx.pulse.latest(environment);
  const gwei = pulse?.gasPriceGwei;
  return { kind: "gas", balance, floor, address: sample ? null : owner, gasPriceGwei: gwei !== undefined && gwei !== null && /^\d+(?:\.\d+)?$/u.test(String(gwei)) ? trimDecimal(String(gwei), 4) : null, from: { source: "Arc chain · native USDC", readAt: isoOf(snap.at), block: blockOf(snap.block) } };
}

/** The pasture mosaic: the largest holdings by USD value. */
export function balanceCard(snap: FlockSnapshot): AnswerBlock | null {
  const holdings = snap.holdings
    .filter((h) => h.kind !== "debt")
    .slice()
    .sort((a, b) => Number(b.usd ?? -1) - Number(a.usd ?? -1))
    .slice(0, 8)
    .map((h) => ({ symbol: h.symbol, amount: trimDecimal(String(h.amount), 6), usd: h.usd === null ? null : trimDecimal(String(h.usd), 2), where: String(h.where).slice(0, 60) || "wallet" }));
  const unpriced = snap.holdings.filter((h) => h.usd === null).length;
  return { kind: "balance", totalUsd: snap.totalUsd === null ? null : trimDecimal(snap.totalUsd, 2), holdings, ...(unpriced > 0 ? { unpriced } : {}), from: { source: "Arc chain · Chainlink prices", readAt: isoOf(snap.at), block: blockOf(snap.block) } };
}

/** A read time as the card's ISO form (milliseconds kept, timezone Z). */
export function isoOf(at: string | number | null | undefined): string {
  const ms = typeof at === "number" ? at : at ? Date.parse(at) : Number.NaN;
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

/** A block number as a decimal string, or null. */
export function blockOf(block: string | number | bigint | null | undefined): string | null {
  if (block === null || block === undefined) return null;
  const s = String(block);
  return /^\d{1,20}$/u.test(s) && s !== "0" ? s : null;
}

/** Under this value a position is dust: it is counted, never listed. */
export const DUST_USD = 1;

/**
 * The positions worth a line, and how many are folded away. Dust and unpriced lines (a wallet full of airdropped
 * tokens, a dust LP) are not portfolio facts: they are counted in one line ("55 small or unpriced lines hidden").
 * A debt, anything with a health factor and anything in motion always keeps its line.
 */
export function materialPositions(res: PositionsResponse): { readonly shown: PositionsResponse["venues"][number]["positions"]; readonly hidden: number } {
  const all = res.venues.flatMap((v) => v.positions);
  const keep = all.filter((p) => {
    const value = p.valueUsd === null ? null : Number(p.valueUsd);
    if (value !== null && value < 0) return true;
    if (p.health?.factor) return true;
    if (p.counts === "overlay" || p.state === "pending" || p.state === "escrowed" || p.state === "committed" || p.state === "watching") return true;
    return value !== null && Math.abs(value) >= DUST_USD;
  });
  return { shown: keep, hidden: all.length - keep.length };
}

/** "55 small or unpriced lines hidden", or null when nothing is folded away. */
export function hiddenLine(hidden: number): string | null {
  return hidden > 0 ? `${hidden} small or unpriced line${hidden === 1 ? "" : "s"} hidden` : null;
}

/** Where the money is: the largest positions by value with their state and one line each, and the venues that could not be read. */
export function positionsCard(res: PositionsResponse): AnswerBlock | null {
  const material = materialPositions(res);
  const rows = material.shown
    .slice()
    .sort((a, b) => Math.abs(Number(b.valueUsd ?? 0)) - Math.abs(Number(a.valueUsd ?? 0)))
    .slice(0, 8)
    .map((p) => ({ venue: p.venueName.slice(0, 60), label: p.label.slice(0, 120), state: p.state, valueUsd: p.valueUsd === null ? null : trimDecimal(p.valueUsd, 2), doing: p.doing.slice(0, 200) }));
  const lowest = res.summary.lowestHealth?.factor ?? null;
  return {
    kind: "positions",
    netUsd: res.summary.netUsd === null ? null : trimDecimal(res.summary.netUsd, 2),
    weightedApyPercent: res.summary.weightedApyPercent,
    lowestHealth: lowest === null ? null : trimDecimal(lowest, 4),
    rows,
    unavailable: res.summary.unavailable.slice(0, 12).map((u) => u.slice(0, 60)),
    // Derived figures come from code (core summarizePositions), so prose never has to add them up.
    ...(res.summary.yearlyYieldUsd !== null ? { yearlyYieldUsd: trimDecimal(res.summary.yearlyYieldUsd, 2) } : {}),
    ...(material.hidden > 0 ? { hidden: material.hidden } : {}),
    ...(res.summary.netUsd === null ? { pricedNetUsd: trimDecimal(res.summary.pricedNetUsd, 2) } : {}),
    from: { source: "Arc chain and venue APIs", readAt: isoOf(res.at), block: blockOf(res.block) },
  };
}

/** The rate tile for a pair: the oracle reference, and the Fence's FX band when it has one. */
export async function rateCard(ctx: AppContext, base: string, quote: string, fence: Fence, quoted?: string): Promise<AnswerBlock | null> {
  const prices = await services(ctx).prices.prices([base, quote]).catch(() => null);
  const b = prices?.[base];
  const q = prices?.[quote];
  const reference = b?.usd && q?.usd && Number(q.usd) > 0 ? trimDecimal(String(Number(b.usd) / Number(q.usd)), 6) : null;
  const rate = quoted ?? reference;
  if (!rate) return null;
  const source = [b?.source, q?.source].filter((s): s is string => Boolean(s) && !/unit of account/u.test(s!)).map((s) => s.replace(/^chainlink:/iu, "Chainlink ")).join(" · ") || null;
  const read = [b?.updatedAt, q?.updatedAt].filter((t): t is string => Boolean(t)).sort()[0] ?? null;
  const stale = [base, quote].map((sym) => staleFeed(prices?.[sym] ?? null)).find((x) => x !== null) ?? null;
  return { kind: "rate", base, quote, rate, reference: quoted ? reference : null, bandBps: fence.fx?.maxDeviationBps ?? null, source: source ? source.slice(0, 80) : null, from: { source: (source ?? "Lykia reference").slice(0, 80), readAt: isoOf(read ?? Date.now()), block: null, ...(stale ? { stale } : {}) } };
}

/** "Chainlink EURC/USD price is 30 h old, past its 26 h heartbeat": why a price is stale, or null. */
export function staleFeed(quote: { readonly symbol: string; readonly source: string; readonly updatedAt: string | null } | null): string | null {
  if (!quote || !/\(stale\)/u.test(quote.source)) return null;
  const feed = FEEDS[quote.symbol];
  const age = quote.updatedAt ? Math.round((Date.now() - Date.parse(quote.updatedAt)) / 3_600_000) : null;
  return `${feed?.pair ?? quote.symbol} price ${age !== null ? `is ${age} h old, ` : ""}past its ${feed ? Math.round(feed.maxAgeSeconds / 3600) : "?"} h heartbeat`;
}

/** The rate a planned conversion gets: output per input of its first conversion step. */
export function quotedRate(intent: Pick<IntentGraph, "steps">): { base: string; quote: string; rate: string } | null {
  for (const step of intent.steps) {
    if (step.kind !== "swap" && step.kind !== "fx") continue;
    const inp = step.inputs[0];
    const out = step.outputs[0];
    if (!inp || !out) continue;
    // The protocol fee comes off the input before the swap: the rate is what the rest buys.
    const fee = step.fee && step.fee.basis === "input" && step.fee.token.toLowerCase() === inp.token.toLowerCase() ? Number(fromBaseUnits(step.fee.amount, step.fee.decimals)) : 0;
    const a = Number(fromBaseUnits(inp.amount, inp.decimals)) - fee;
    const b = Number(fromBaseUnits(out.amount, out.decimals));
    if (!(a > 0) || !(b > 0)) continue;
    return { base: inp.symbol, quote: out.symbol, rate: trimDecimal(String(b / a), 6) };
  }
  return null;
}

/** "$124.6M", "$12.4k", "$950": a TVL as people read it. */
export function compactUsd(v: string | number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}bn`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const percentOf = (fraction: string | null | undefined): string | null => (fraction === null || fraction === undefined || !Number.isFinite(Number(fraction)) ? null : `${(Number(fraction) * 100).toFixed(2)}%`);
const units = (amount: string, decimals: number): string => {
  try {
    return trimDecimal(fromBaseUnits(BigInt(amount), decimals), 6);
  } catch {
    return amount;
  }
};

/**
 * What a plan costs and why it goes where it goes: Lykia's fee per step, the least each step can deliver, and for a
 * routed step the place chosen and the ones it beat (rate, size, or what each would deliver). Every figure a model
 * may want to say about a plan is here, so the owner sees it beside the plan.
 */
export function planFactsCard(intent: Pick<IntentGraph, "steps" | "createdAt">): AnswerBlock | null {
  const from = { source: "Lykia's planner and route search", readAt: isoOf(intent.createdAt), block: null };
  const rows: { label: string; value: string; note: string | null; from: typeof from }[] = [];
  const short = (summary: string) => summary.replace(/\s*\(.*$/u, "").slice(0, 60);
  for (const st of intent.steps) {
    if (st.kind === "approve") continue;
    if (st.fee) rows.push({ label: `Lykia fee · ${short(st.summary)}`.slice(0, 80), value: `${units(st.fee.amount, st.fee.decimals)} ${st.fee.symbol}`, note: `${Number((st.fee.bps / 100).toFixed(2))}% ${st.fee.basis === "on-top" ? "paid on top of the amount" : st.fee.basis === "output" ? "taken from the borrowed amount" : "taken from the amount"}`, from });
    const out = st.outputs.find((o) => o.minimum && !o.symbol.includes("@"));
    if (out?.minimum) rows.push({ label: `At least · ${short(st.summary)}`.slice(0, 80), value: `${units(out.minimum, out.decimals)} ${out.symbol}`.slice(0, 60), note: `expected ${units(out.amount, out.decimals)} ${out.symbol}; less and the step fails, nothing moves`.slice(0, 200), from });
    const route = st.route;
    if (route) {
      const decimals = st.outputs[0]?.decimals ?? 6;
      const symbol = st.outputs[0]?.symbol.replace(/@.*$/u, "") ?? "";
      // The headline figure goes in the value (what it delivers, its rate, or the health after); the rest in the note.
      const describe = (o: (typeof route)["chosen"]) => {
        const apy = percentOf(o.apy);
        const head = o.amountOut ? `${units(o.amountOut, decimals)} ${symbol}` : apy ? `${apy} APY` : o.healthFactor ? `health after ${Number(o.healthFactor).toFixed(2)}` : `${o.risk} risk`;
        const rest = [o.amountOut && apy ? `${apy} APY` : null, o.tvlUsd ? `${compactUsd(o.tvlUsd)} TVL` : null, o.amountOut || apy || o.healthFactor ? `${o.risk} risk` : null, o.amountOut && o.healthFactor ? `health after ${Number(o.healthFactor).toFixed(2)}` : null, !o.amountOut && apy && o.healthFactor ? `health after ${Number(o.healthFactor).toFixed(2)}` : null];
        return { value: head.slice(0, 60), note: rest.filter(Boolean).join(" · ").slice(0, 200) || null };
      };
      rows.push({ label: `Chosen · ${route.chosen.label}`.slice(0, 80), ...describe(route.chosen), from });
      for (const alt of route.alternatives.filter((a) => a.executable).slice(0, 2)) rows.push({ label: `Also compared · ${alt.label}`.slice(0, 80), ...describe(alt), from });
    }
  }
  if (rows.length === 0) return null;
  return { kind: "facts", title: "What this plan costs, and why this route", rows: rows.slice(0, 8), note: "Figures from the plan itself; the route is rebuilt and checked again before you sign." };
}

/** The Fence as numbers: caps, when Lyko asks, slippage and the loan floor. Shown when a turn reads the rules. */
export function fenceFactsCard(fence: Fence, beta: { readonly perStepUsd: string; readonly perDayUsd: string } | null, readAt: string): AnswerBlock | null {
  const from = { source: "Your Fence", readAt: isoOf(readAt), block: null };
  const money = (v: string) => `$${Number(v).toLocaleString("en-US")}`;
  const caps = fence.caps ?? {};
  const rows = [
    caps.perStepUsd ? { label: "Most in one step", value: money(caps.perStepUsd), note: null, from } : null,
    caps.perIntentUsd ? { label: "Most in one plan", value: money(caps.perIntentUsd), note: null, from } : null,
    caps.dailyUsd ? { label: "Most in one day", value: money(caps.dailyUsd), note: null, from } : null,
    fence.confirm?.aboveUsd ? { label: "Lyko asks you above", value: money(fence.confirm.aboveUsd), note: null, from } : null,
    fence.limits?.maxSlippageBps !== undefined ? { label: "Slippage at most", value: `${(fence.limits.maxSlippageBps / 100).toFixed(2)}%`, note: null, from } : null,
    fence.lending?.minHealthFactor ? { label: "Loans never under health", value: fence.lending.minHealthFactor, note: null, from } : null,
    beta ? { label: "Lykia's beta limit, above every Fence", value: `${money(beta.perStepUsd)} a step · ${money(beta.perDayUsd)} a day`, note: null, from: { ...from, source: "Lykia's beta limit" } } : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);
  return rows.length > 0 ? { kind: "facts", title: `${fence.label ?? "Your"} Fence, in numbers`.slice(0, 120), rows: rows.slice(0, 8), note: null } : null;
}

/** The Fence gate: the rules that refused or want a confirmation, and the room left under the caps. */
export function fenceCard(intent: Pick<IntentGraph, "verdict">, fence: Fence): AnswerBlock | null {
  const decision = intent.verdict.decision;
  if (decision !== "deny" && decision !== "confirm") return null;
  const rules = intent.verdict.reasons
    .filter((r) => r.decision === decision)
    .slice(0, 6)
    .map((r) => ({ rule: String(r.rule).slice(0, 40), message: r.message.slice(0, 400) }));
  if (rules.length === 0) return null;
  const caps = fence.caps ?? {};
  const headroom = [
    caps.perStepUsd ? { label: "Per step", value: `$${caps.perStepUsd}` } : null,
    caps.perIntentUsd ? { label: "Per plan", value: `$${caps.perIntentUsd}` } : null,
    caps.dailyUsd ? { label: "Per day", value: `$${caps.dailyUsd}` } : null,
    fence.limits?.maxSlippageBps !== undefined ? { label: "Max slippage", value: `${(fence.limits.maxSlippageBps / 100).toFixed(2)}%` } : null,
  ].filter((h): h is { label: string; value: string } => h !== null);
  return { kind: "fence", decision, rules, headroom };
}

/* -------------------------------------------------------------- questions */

export type InfoQuestion = { readonly kind: "gas" } | { readonly kind: "balance" } | { readonly kind: "positions" } | { readonly kind: "rate"; readonly base: string; readonly quote: string };

const ACTION_VERB = /\b(?:send|pay|swap|convert|move|bridge|deposit|withdraw|earn|put|buy|sell|stake|lend|borrow|hedge|keep|sweep|create|set|every|rebalance|allocate|split|top up|alert|notify|remind)\b/iu;

/**
 * Plain questions the reader answers with a card instead of a plan: gas,
 * balances and the EURC rate. A sentence with an action verb is a plan,
 * never a question.
 */
export function infoQuestion(text: string): InfoQuestion | null {
  const t = text.trim().toLowerCase();
  if (t.length > 160 || ACTION_VERB.test(t)) return null;
  if (/\b(?:where(?:'s| is| are) my (?:money|funds|usdc)|what(?:'s| is) my money doing|what are my (?:funds|positions) doing|my positions|position map)\b/u.test(t)) return { kind: "positions" };
  if (/\bgas\b/u.test(t)) return { kind: "gas" };
  if (/\b(?:eurc|euro|eur)\b/u.test(t) && /\b(?:rate|price|worth|fx|quote|exchange)\b/u.test(t)) return { kind: "rate", base: "USDC", quote: "EURC" };
  if (/\b(?:balance|balances|holdings|portfolio|my flock|what do i (?:hold|have|own)|how much (?:do i|have i))\b/u.test(t)) return { kind: "balance" };
  return null;
}

/* ------------------------------------------------------------------ facts */

const dollars = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Lyko on watch's sourced answer from the position map: net worth, what earns and at what blended rate, the yearly
 * estimate and the lowest health factor, each computed by core (summarizePositions) and stamped with where and when
 * it was read. A figure that cannot be computed says "unavailable", never an estimate.
 */
export function positionsFacts(res: PositionsResponse, title = "Your Fold, read now", options: { readonly sample?: boolean } = {}): AnswerBlock {
  const at = { source: options.sample ? "sample" : "Arc chain and venue APIs", readAt: isoOf(res.at), block: blockOf(res.block) };
  const s = res.summary;
  const unpricedNote = s.unpriced > 0 ? "lines without a price are left out, never counted as zero" : null;
  const earning = res.venues.filter((v) => v.positions.some((p) => p.apy && (p.state === "earning" || p.state === "at-risk")));
  const first = earning[0];
  const rateFrom = options.sample ? at : first ? { source: first.source === "api" ? `${first.venueName} rate API`.slice(0, 80) : `${first.venueName} on Arc`.slice(0, 80), readAt: isoOf(first.readAt), block: blockOf(first.block), venue: earning.length === 1 ? first.venueName.slice(0, 60) : `${earning.length} venues` } : at;
  const lowest = s.lowestHealth;
  const lowestRead = lowest ? res.venues.find((v) => v.venue === lowest.venue) : undefined;
  const rows = [
    { label: "Net worth", value: s.netUsd === null ? (Number(s.pricedNetUsd) !== 0 ? `${dollars(s.pricedNetUsd)} priced` : "unavailable") : dollars(s.netUsd), note: unpricedNote, from: at },
    { label: "Blended APY on what earns", value: s.weightedApyPercent === null ? "unavailable" : `${s.weightedApyPercent}%`, note: s.weightedApyPercent === null ? "no earning position with a readable rate" : null, from: rateFrom },
    { label: "Yearly estimate, net of borrowing", value: s.yearlyYieldUsd === null ? "unavailable" : dollars(s.yearlyYieldUsd), note: s.yearlyYieldUsd === null ? null : "at today's rates", from: rateFrom },
    ...(lowest ? [{ label: "Lowest health factor", value: Number(lowest.factor).toFixed(2), note: `${lowest.label}; your floor is ${res.healthFloor}`.slice(0, 200), from: lowestRead && !options.sample ? { source: `${lowestRead.venueName} on Arc`.slice(0, 80), readAt: isoOf(lowestRead.readAt), block: blockOf(lowestRead.block), venue: lowestRead.venueName.slice(0, 60) } : at }] : []),
    ...(s.unavailable.length > 0 ? [{ label: "Not read", value: `${s.unavailable.length} venue${s.unavailable.length === 1 ? "" : "s"}`, note: s.unavailable.slice(0, 4).join(", ").slice(0, 200), from: at }] : []),
  ];
  return { kind: "facts", title, rows, note: s.unavailable.length > 0 ? "Venues that could not be read are named, never counted as zero." : null };
}
