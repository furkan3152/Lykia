/**
 * Plain words for every number, limit and term Lykia shows. The web, the
 * API and Lyko read the same sentences from here, so a limit is explained
 * the same way wherever it appears. Pure: no I/O.
 *
 * The form is "what this means for you": one short line in the owner's
 * terms, never ours.
 */
import type { Fence } from "./fence.js";
import { applyFoldShocks, type FoldShocks, type ShockHolding } from "./fold.js";

/* ------------------------------------------------------------ vocabulary */

/** Lykia's own words, each with the plain subtitle shown on first appearance in an area. */
export const LYKIA_TERMS = Object.freeze({
  fence: { word: "Fence", plain: "your spending rules", line: "The limits every move must pass before you sign: how much, where to, which tokens." },
  whistle: { word: "Whistle", plain: "stop everything", line: "One button that stops every new move and every agent. Money coming home still passes." },
  flock: { word: "Flock", plain: "your holdings", line: "Everything you own on Arc, in one list." },
  trails: { word: "Trails", plain: "your history", line: "Everything that happened: payments, plans, refusals and fees." },
  herding: { word: "Herding", plain: "everything running", line: "Everything in motion, one row each: automations, orders, watches, leashes, Autopilot, plans and payment links, each with its next step and one control." },
  pack: { word: "Pack", plain: "your agents and their leashes", line: "Agents that work for you; each one holds a leash with its own budget and rules." },
  leash: { word: "Leash", plain: "a budget for a bot", line: "A spending limit an outside bot cannot go past: per step, per day and in total, until a date." },
  tag: { word: "Tag", plain: "an agent's ID card", line: "An agent's public identity on Arc, with the rules it promises to follow." },
  scent: { word: "Scent", plain: "token check", line: "What can be proven about a token before you touch it. Never a promise that it is safe." },
} as const);

export type LykiaTerm = keyof typeof LYKIA_TERMS;

/** "Fence · your spending rules". */
export function termLabel(term: LykiaTerm): string {
  const t = LYKIA_TERMS[term];
  return `${t.word} · ${t.plain}`;
}

/** Plain meanings for the figures and words on screen. */
export const MEANINGS = Object.freeze({
  netWorth: "Everything you own on Arc minus what you borrowed, at today's prices.",
  allocation: "Where that money sits: resting in your wallet, earning somewhere, or borrowed against.",
  roomToday: "How much more Lyko may move for you today before your daily limit stops it. It resets at midnight UTC.",
  counts: "Instructions that run on their own, orders waiting for a price, and agents on a leash, counted from Herding's Running list.",
  apy: "APY is the yearly return if today's rate held for a year. Rates move every day.",
  borrowApy: "What borrowing costs a year at today's rate. It is added to your loan over time.",
  navYield: "How fast the fund's price grew over the last weeks, as a yearly rate.",
  healthFactor: "How safe a loan is. Above your floor is comfortable; at 1.00 part of your collateral can be sold to repay the loan.",
  ltv: "How much you borrowed compared with what backs it.",
  range: "A liquidity position earns swap fees only while the price stays inside its band.",
  slippage: "The most a swap may lose to price movement between quote and signing. Past that, it is refused instead.",
  minReceived: "The least you can get. If the price moves past it, the transaction fails and nothing is swapped.",
  gas: "The network fee for each transaction, paid in USDC on Arc. Usually a fraction of a cent.",
  lykiaFee: "Lykia's 1% fee on what moves, paid in the same transaction. Repaying and withdrawing home are free.",
  arcMemo: "A reference written into the transaction so you can find it in your history and on the explorer.",
  verdict: "Your Fence's answer to this plan: allowed, needs your OK, or refused.",
  security: "Lykia simulates what you will sign and lists every balance change before your wallet opens.",
  unpriced: "No reliable price right now, so it is left out of the total instead of being counted as zero.",
  overlay: "Money set aside for an order or a payment. It still sits in your wallet and is already counted there.",
} as const);

/* --------------------------------------------------------------- beta cap */

export interface BetaCap {
  readonly perStepUsd: string;
  readonly perDayUsd: string;
}

/** The mainnet beta cap when the API has not answered yet. */
export const DEFAULT_BETA_CAP: BetaCap = Object.freeze({ perStepUsd: "1000", perDayUsd: "5000" });

const dollars = (v: string | number) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export interface BetaCapExplain {
  /** "Lykia's beta limit". */
  readonly name: string;
  /** "$1,000 a step · $5,000 a day". */
  readonly figures: string;
  /** What it means for you, in one sentence. */
  readonly sentence: string;
  /** Why it exists, who it applies to, and what it never limits. */
  readonly why: string;
  readonly scope: string;
  readonly home: string;
}

/**
 * The beta cap in plain words. Shown wherever the beta cap number is shown,
 * so the number never stands alone.
 */
export function betaCapExplain(cap: BetaCap = DEFAULT_BETA_CAP): BetaCapExplain {
  const step = dollars(cap.perStepUsd);
  const day = dollars(cap.perDayUsd);
  return {
    name: "Lykia's beta limit",
    figures: `${step} a step · ${day} a day`,
    sentence: `Lyko won't move more than ${step} in one step or ${day} in one day on mainnet.`,
    why: "That is a safety limit while Lykia is in beta: its contracts have not been audited yet.",
    scope: "It applies to everyone, on top of your own rules. Your Fence can be stricter, never looser.",
    home: "Money coming home (repaying, withdrawing, redeeming) is never capped.",
  };
}

/* ------------------------------------------------------------- the Fence */

export interface FenceSentence {
  /** "yours": a rule in your Fence. "beta": Lykia's beta limit, above every Fence. */
  readonly source: "yours" | "beta";
  readonly rule: string;
  readonly text: string;
}

const money = (v: string) => dollars(v);

/** The Fence as plain sentences ("Lyko won't move more than $1,000 in one step."), strongest first. */
export function fenceSentences(f: Fence, beta: BetaCap | null = null): FenceSentence[] {
  const out: FenceSentence[] = [];
  const yours = (rule: string, text: string) => out.push({ source: "yours", rule, text });
  if (f.mode === "whistle") yours("Whistle", "The Whistle is blown: nothing new may start. Money coming home still passes.");
  else if (f.mode === "dry-run") yours("Practice mode", "Lyko plans and checks, but nothing can be signed.");
  const c = f.caps ?? {};
  if (c.perStepUsd) yours("Per step", `Lyko won't move more than ${money(c.perStepUsd)} in one step.`);
  if (c.perIntentUsd) yours("Per plan", `One plan moves at most ${money(c.perIntentUsd)} in total.`);
  if (c.dailyUsd) yours("Per day", `At most ${money(c.dailyUsd)} can leave in one day (resets at midnight UTC).`);
  if (c.weeklyUsd) yours("Per week", `At most ${money(c.weeklyUsd)} can leave in one week.`);
  const r = f.recipients?.mode ?? "own";
  yours("Who can be paid", r === "own" ? "Money only goes to your own addresses." : r === "allowlist" ? `Money only goes to the ${f.recipients?.allow?.length ?? 0} address${(f.recipients?.allow?.length ?? 0) === 1 ? "" : "es"} you approved.` : "Money may go to any address you name.");
  if (f.confirm?.aboveUsd) yours("Ask me first", Number(f.confirm.aboveUsd) === 0 ? "Lyko asks you before every move." : `Lyko asks you before anything above ${money(f.confirm.aboveUsd)}.`);
  if (f.limits?.maxSlippageBps !== undefined) yours("Price protection", `A swap may lose at most ${(f.limits.maxSlippageBps / 100).toFixed(2)}% to price movement, or it is refused.`);
  if (f.lending?.minHealthFactor) yours("Loan safety", `Borrowing never pushes a loan's health below ${f.lending.minHealthFactor} (at 1.00 it can be liquidated).`);
  if (f.fx?.maxDeviationBps !== undefined) yours("Currency rate", `A USDC/EURC rate may be at most ${(f.fx.maxDeviationBps / 100).toFixed(2)}% worse than the reference rate.`);
  if (f.scent?.require && f.scent.require !== "off") yours("Tokens", f.scent.require === "verified" ? "Only verified tokens." : "No token with red flags.");
  if (f.tokens?.unlisted === "deny") yours("Unknown tokens", "Tokens Lykia does not know are refused.");
  if (f.venues?.allow?.length) yours("Where", `Only these places: ${f.venues.allow.join(", ")}.`);
  if (f.venues?.deny?.length) yours("Never", `Never through ${f.venues.deny.join(", ")}.`);
  if (f.schedule) yours("Hours", `Only inside your office hours (${f.schedule.timezone}).`);
  if (beta) {
    const b = betaCapExplain(beta);
    out.push({ source: "beta", rule: "Beta limit", text: `${b.sentence} ${b.why}` });
  }
  return out;
}

/** The ready-made Fences: pick one, see what changes, Lyko drafts it and your wallet signs a looser one. */
export const FENCE_PRESET_IDS = ["careful", "balanced", "bold"] as const;
export type FencePresetId = (typeof FENCE_PRESET_IDS)[number];

export interface FencePreset {
  readonly id: FencePresetId;
  readonly label: string;
  /** One line: who it suits. */
  readonly line: string;
  readonly patch: Readonly<Record<string, unknown>>;
}

export const FENCE_PRESETS: Readonly<Record<FencePresetId, FencePreset>> = Object.freeze({
  careful: { id: "careful", label: "Careful", line: "Small moves, Lyko asks you often, only verified tokens.", patch: { caps: { perStepUsd: "250", perIntentUsd: "500", dailyUsd: "1000" }, confirm: { aboveUsd: "100" }, limits: { maxSlippageBps: 30 }, lending: { minHealthFactor: "1.8" }, scent: { require: "verified" } } },
  balanced: { id: "balanced", label: "Balanced", line: "Everyday amounts, Lyko asks above $500. Lykia's default.", patch: { caps: { perStepUsd: "1000", perIntentUsd: "2500", dailyUsd: "5000" }, confirm: { aboveUsd: "500" }, limits: { maxSlippageBps: 100 }, lending: { minHealthFactor: "1.5" }, scent: { require: "no-red-flags" } } },
  bold: { id: "bold", label: "Bold", line: "Bigger moves, fewer questions. Lykia's beta limit still applies.", patch: { caps: { perStepUsd: "5000", perIntentUsd: "10000", dailyUsd: "20000" }, confirm: { aboveUsd: "2500" }, limits: { maxSlippageBps: 300 }, lending: { minHealthFactor: "1.3" }, scent: { require: "no-red-flags" } } },
});

export interface PresetChange {
  readonly what: string;
  readonly from: string;
  readonly to: string;
  /** "tighter" applies at once; "looser" needs your wallet. */
  readonly direction: "tighter" | "looser";
}

export interface PresetPreview {
  readonly preset: FencePreset;
  readonly changes: readonly PresetChange[];
  /** True when any change loosens the Fence (your wallet signs it). */
  readonly needsWallet: boolean;
  /** A note when the preset allows more than Lykia's beta limit. */
  readonly betaNote: string | null;
  /** One line: "3 changes: 2 tighter, 1 looser (your wallet signs it)." */
  readonly summary: string;
}

/** What picking a preset changes, line by line, against the current Fence. */
export function fencePresetPreview(current: Fence, id: FencePresetId, beta: BetaCap | null = null): PresetPreview {
  const preset = FENCE_PRESETS[id];
  const p = preset.patch as { caps: Record<string, string>; confirm: { aboveUsd: string }; limits: { maxSlippageBps: number }; lending: { minHealthFactor: string }; scent: { require: string } };
  const changes: PresetChange[] = [];
  // Higher is looser for caps, slippage and the confirmation threshold; lower is looser for the health floor.
  const num = (what: string, from: string | number | undefined, to: string | number, fmt: (v: string | number) => string, higherIsLooser = true) => {
    const a = from === undefined ? null : Number(from);
    const b = Number(to);
    if (a !== null && a === b) return;
    const looser = a === null ? higherIsLooser : higherIsLooser ? b > a : b < a;
    changes.push({ what, from: a === null ? "no limit" : fmt(a), to: fmt(b), direction: looser ? "looser" : "tighter" });
  };
  const c = current.caps ?? {};
  num("Per step", c.perStepUsd, p.caps.perStepUsd!, dollars);
  num("Per plan", c.perIntentUsd, p.caps.perIntentUsd!, dollars);
  num("Per day", c.dailyUsd, p.caps.dailyUsd!, dollars);
  num("Ask me above", current.confirm?.aboveUsd, p.confirm.aboveUsd, dollars);
  num("Price protection", current.limits?.maxSlippageBps, p.limits.maxSlippageBps, (v) => `${(Number(v) / 100).toFixed(2)}%`);
  num("Loan safety floor", current.lending?.minHealthFactor, p.lending.minHealthFactor, (v) => Number(v).toFixed(2), false);
  const scentRank = (s: string | undefined) => (s === "verified" ? 2 : s === "no-red-flags" ? 1 : 0);
  const from = current.scent?.require ?? "off";
  if (from !== p.scent.require) changes.push({ what: "Tokens", from: from === "verified" ? "verified only" : from === "no-red-flags" ? "no red flags" : "any", to: p.scent.require === "verified" ? "verified only" : "no red flags", direction: scentRank(p.scent.require) >= scentRank(from) ? "tighter" : "looser" });
  const looser = changes.filter((x) => x.direction === "looser").length;
  const tighter = changes.length - looser;
  const overBeta = beta !== null && (Number(p.caps.perStepUsd) > Number(beta.perStepUsd) || Number(p.caps.dailyUsd) > Number(beta.perDayUsd));
  const b = beta ? betaCapExplain(beta) : null;
  return {
    preset,
    changes,
    needsWallet: looser > 0,
    betaNote: overBeta && b ? `While Lykia is in beta, ${b.figures} still applies on mainnet.` : null,
    summary: changes.length === 0 ? "This is already your Fence." : `${changes.length} change${changes.length === 1 ? "" : "s"}: ${[tighter > 0 ? `${tighter} tighter (applies at once)` : null, looser > 0 ? `${looser} looser (your wallet signs it)` : null].filter(Boolean).join(", ")}.`,
  };
}

/** Which preset the Fence matches, if any. */
export function fencePresetOf(f: Fence): FencePresetId | null {
  for (const id of FENCE_PRESET_IDS) if (fencePresetPreview(f, id).changes.length === 0) return id;
  return null;
}

/* ----------------------------------------------------------- room today */

/** "Room left today: $3,760 of $5,000 (your daily limit)". */
export function roomTodayLine(left: number | null, cap: number | null, capIsBeta: boolean): string {
  if (cap === null || left === null) return "No daily limit: your Fence sets none.";
  return `Room left today: ${dollars(Math.max(0, left))} of ${dollars(cap)} (${capIsBeta ? "Lykia's beta limit" : "your daily limit"}).`;
}

/* -------------------------------------------------------- stress test */

export const STRESS_SCENARIO_IDS = ["eurc-5", "btc-20", "rates-up-1", "eurc-10"] as const;
export type StressScenarioId = (typeof STRESS_SCENARIO_IDS)[number];

export interface StressScenario {
  readonly id: StressScenarioId;
  readonly label: string;
  readonly shocks: FoldShocks;
  /** How the scenario reads in a sentence: "If EURC drops 5%". */
  readonly lead: string;
}

export const STRESS_SCENARIOS: Readonly<Record<StressScenarioId, StressScenario>> = Object.freeze({
  "eurc-5": { id: "eurc-5", label: "EURC −5%", shocks: { EURC: -5, cirBTC: 0, ratesBps: 0 }, lead: "If EURC drops 5%" },
  "btc-20": { id: "btc-20", label: "Bitcoin −20%", shocks: { EURC: 0, cirBTC: -20, ratesBps: 0 }, lead: "If Bitcoin drops 20%" },
  "rates-up-1": { id: "rates-up-1", label: "Rates go up 1%", shocks: { EURC: 0, cirBTC: 0, ratesBps: 100 }, lead: "If lending rates go up 1 point" },
  "eurc-10": { id: "eurc-10", label: "EURC −10%", shocks: { EURC: -10, cirBTC: 0, ratesBps: 0 }, lead: "If EURC drops 10%" },
});

export interface StressAnswer {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  /** The loan closest to liquidation after the shock, and how much further its collateral could fall before it is liquidated. */
  readonly closest: { readonly venue: string; readonly health: number; readonly roomPercent: number } | null;
  readonly safe: boolean;
  readonly yearlyYieldDelta: number;
  /** One plain sentence with the key numbers. */
  readonly sentence: string;
}

/** Venue names for sentences when the caller passes none. */
const VENUE_WORDS: Readonly<Record<string, string>> = { "aave-v4": "Aave V4", "morpho-blue": "Morpho Blue", "morpho-vaults": "Morpho" };

/** A scenario's outcome in plain words: value before and after, and the closest liquidation. */
export function stressAnswer(holdings: readonly ShockHolding[], health: readonly { readonly venue: string; readonly healthFactor: string | null }[], shocks: FoldShocks, lead: string, minHealth = 1.5, names: Readonly<Record<string, string>> = {}): StressAnswer {
  const r = applyFoldShocks(holdings, health, shocks);
  const delta = r.after - r.before;
  const worst = r.health.filter((h) => h.after !== null).sort((a, b) => (a.after ?? 0) - (b.after ?? 0))[0];
  const closest = worst && worst.after !== null ? { venue: names[worst.venue] ?? VENUE_WORDS[worst.venue] ?? worst.venue, health: worst.after, roomPercent: worst.after > 1 ? (1 - 1 / worst.after) * 100 : 0 } : null;
  const safe = closest === null || closest.health >= 1;
  const value = `your holdings would be worth ${dollars(Math.round(r.after))} (${delta < 0 ? "−" : "+"}${dollars(Math.abs(Math.round(delta)))})`;
  const loan = closest === null ? "nothing you hold is borrowed against, so nothing can be liquidated" : closest.health < 1 ? `your loan on ${closest.venue} could be liquidated (health ${closest.health.toFixed(2)})` : closest.health < minHealth ? `you would stay clear of liquidation, but your loan on ${closest.venue} would sit at health ${closest.health.toFixed(2)}, under your ${minHealth} floor` : `you would stay safe from liquidation: your closest loan (${closest.venue}) would sit at health ${closest.health.toFixed(2)}, ${closest.roomPercent.toFixed(0)}% above it`;
  const rates = shocks.ratesBps !== 0 ? ` Your yearly yield would change by about ${r.yearlyYieldDelta < 0 ? "−" : "+"}${dollars(Math.abs(Math.round(r.yearlyYieldDelta)))}.` : "";
  return { before: r.before, after: r.after, delta, closest, safe, yearlyYieldDelta: r.yearlyYieldDelta, sentence: `${lead}, ${value} and ${loan}.${rates}` };
}

/** A stress scenario named in the owner's words ("what if EURC drops 8%"), or null. */
export function readStressQuestion(text: string): { readonly shocks: FoldShocks; readonly lead: string } | null {
  const t = text.toLowerCase();
  if (!/\b(what if|what happens if|what would happen|stress test|am i safe|would i be safe|suppose|how exposed)\b/u.test(t)) return null;
  const pct = (re: RegExp) => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };
  const fall = /\b(drop|drops|falls?|fell|crash(?:es)?|down|loses?|sinks?|goes down)\b/u.test(t);
  const rise = /\b(rises?|goes up|up|jumps?|climbs?)\b/u.test(t);
  if (/\beur(?:c|o)?\b/u.test(t)) {
    const n = pct(/(\d+(?:\.\d+)?)\s*%/u) ?? 5;
    const v = rise && !fall ? n : -n;
    return { shocks: { EURC: v, cirBTC: 0, ratesBps: 0 }, lead: `If EURC ${v < 0 ? "drops" : "rises"} ${Math.abs(v)}%` };
  }
  if (/\b(btc|bitcoin|cirbtc)\b/u.test(t)) {
    const n = pct(/(\d+(?:\.\d+)?)\s*%/u) ?? 20;
    const v = rise && !fall ? n : -n;
    return { shocks: { EURC: 0, cirBTC: v, ratesBps: 0 }, lead: `If Bitcoin ${v < 0 ? "drops" : "rises"} ${Math.abs(v)}%` };
  }
  if (/\brates?\b/u.test(t) && (fall || rise)) {
    const n = pct(/(\d+(?:\.\d+)?)\s*(?:%|points?|pts?)/u) ?? 1;
    const v = fall && !rise ? -n : n;
    return { shocks: { EURC: 0, cirBTC: 0, ratesBps: Math.round(v * 100) }, lead: `If lending rates go ${v < 0 ? "down" : "up"} ${Math.abs(v)} point${Math.abs(v) === 1 ? "" : "s"}` };
  }
  return null;
}

/* ------------------------------------------------------- position figures */

/** "Health 1.20: if this falls to 1.00, part of your collateral can be sold to repay the loan." */
export function healthMeaning(factor: number, floor: number): string {
  const room = factor > 1 ? (1 - 1 / factor) * 100 : 0;
  const head = `Health ${factor.toFixed(2)}: if this falls to 1.00, part of your collateral can be sold to repay the loan.`;
  if (factor < 1.1) return `${head} It is very close now.`;
  if (factor < floor) return `${head} It is under your ${floor} floor; your collateral could lose about ${room.toFixed(0)}% before that happens.`;
  return `${head} Your collateral could lose about ${room.toFixed(0)}% of its value before that happens.`;
}

export function apyMeaning(percent: number, kind: "supply" | "borrow" | "vault" | "nav" | "fees", valueUsd: number | null): string {
  const year = valueUsd !== null && Number.isFinite(valueUsd) ? Math.abs(valueUsd) * (percent / 100) : null;
  const yearly = year !== null && year >= 0.01 ? ` On ${dollars(Math.abs(valueUsd!).toFixed(0))}, that is about ${dollars(year.toFixed(2))} a year.` : "";
  if (kind === "borrow") return `Borrowing costs ${percent.toFixed(2)}% a year at today's rate.${yearly}`;
  if (kind === "nav") return `The fund grew at ${percent.toFixed(2)}% a year lately.${yearly}`;
  return `${percent.toFixed(2)}% a year if today's rate held.${yearly} Rates move every day.`;
}

export function ltvMeaning(ltvPercent: number, liquidationAtPercent: number | null): string {
  return `You borrowed ${ltvPercent.toFixed(0)}% of what backs the loan${liquidationAtPercent !== null ? `; at ${liquidationAtPercent.toFixed(0)}% it can be liquidated` : ""}.`;
}

export function rangeMeaning(inRange: boolean, lower: string, upper: string, quote: string): string {
  return inRange ? `The price is inside your band (${lower} to ${upper} ${quote}), so it earns swap fees.` : `The price left your band (${lower} to ${upper} ${quote}): it earns nothing until the price comes back or you move the band.`;
}

/** What each position state means for you. */
export const STATE_MEANINGS = Object.freeze({
  earning: "Earning: it is making a return right now.",
  idle: "Idle: it sits there earning nothing.",
  borrowing: "Borrowing: a loan you owe, with interest.",
  "at-risk": "At risk: a loan is close to liquidation. Repay some or add collateral.",
  "out-of-range": "Out of range: the price left your band, so it earns nothing.",
  pending: "On its way: a transfer that has not landed yet.",
  escrowed: "Set aside for an order that waits for its price.",
  committed: "Promised to a scheduled payment or a budget.",
  watching: "Watching: Lyko on watch checks it and tells you when it happens.",
} as const);

/** What a one-tap action will do, said before the tap. */
export function actionPreview(a: { readonly mode: "draft" | "ask"; readonly sentence: string }): string {
  return a.mode === "draft" ? `Lyko drafts "${a.sentence}" and checks it against your Fence. Nothing moves until you sign.` : `Opens Ask Lyko with this question: "${a.sentence}"`;
}

/** The shock model's inputs from the position map: every priced asset of every net position, and the lowest health per venue. */
export function shockInputsFromPositions(venues: readonly { readonly positions: readonly { readonly venue: string; readonly venueName?: string; readonly venueKind: string; readonly counts: "net" | "overlay"; readonly valueUsd?: string | null; readonly assets: readonly { readonly symbol: string; readonly valueUsd: string | null; readonly role: string }[]; readonly health?: { readonly factor: string | null } }[] }[]): { holdings: ShockHolding[]; health: { venue: string; healthFactor: string | null }[]; names: Record<string, string> } {
  const holdings: ShockHolding[] = [];
  const health = new Map<string, number>();
  const names: Record<string, string> = {};
  for (const v of venues) {
    for (const p of v.positions) {
      if (p.counts !== "net") continue;
      if (p.venueName) names[p.venue] = p.venueName;
      let assetsUsd = 0;
      let priced = true;
      for (const a of p.assets) {
        if (a.role === "fees") continue;
        const kind: ShockHolding["kind"] = a.role === "borrowed" ? "debt" : p.venueKind === "vault" ? "vault" : a.role === "supplied" || a.role === "collateral" ? "supply" : "token";
        holdings.push({ symbol: a.symbol, where: p.venue, kind, usd: a.valueUsd });
        if (a.valueUsd === null) priced = false;
        else assetsUsd += Math.abs(Number(a.valueUsd)) * (a.role === "borrowed" ? -1 : 1);
      }
      // What the position is worth beyond its listed assets (uncollected LP fees, accrued yield) still counts, so the
      // Stress test starts from the same net worth as the Fold bar.
      const value = p.valueUsd === undefined || p.valueUsd === null ? null : Number(p.valueUsd);
      if (priced && value !== null && Number.isFinite(value)) {
        const rest = Math.round((value - assetsUsd) * 100) / 100;
        if (Math.abs(rest) >= 0.01) holdings.push({ symbol: p.assets.map((a) => a.symbol).join("/") || "USD", where: p.venue, kind: rest < 0 ? "debt" : "token", usd: String(Math.abs(rest)) });
      }
      const hf = p.health?.factor ? Number(p.health.factor) : null;
      if (hf !== null && Number.isFinite(hf)) health.set(p.venue, Math.min(health.get(p.venue) ?? Infinity, hf));
    }
  }
  return { holdings, health: [...health.entries()].map(([venue, f]) => ({ venue, healthFactor: String(f) })), names };
}
