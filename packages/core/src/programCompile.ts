/**
 * The intent compiler's pure half: a `lykia.program/v1` resolved against the
 * owner's state, then compiled into executable artifacts.
 *
 *   program + state  --resolveProgram-->  resolution (concrete amounts,
 *                                          assumptions, questions, blockers)
 *   resolution       --compileProgram-->  one plan for now (ordered plan
 *                                          actions) + drafts for later
 *                                          (automations, orders, alerts,
 *                                          standing orders, budgets) + why
 *
 * Rules the compiler keeps:
 * - Never invent an address, a venue or a token: recipients come from the
 *   owner's words or confirmed contacts; anything else becomes a question.
 * - Reserves come out first, then exact amounts, then shares, then the rest.
 *   A share without a base ("about a third") is a share of what is left
 *   after the reserves, stated as an assumption.
 * - When a hard fact is missing but a sensible default exists (the gas
 *   buffer, the time a schedule runs, a hedge share for "protect against a
 *   weaker dollar") the default is used and listed as an assumption the
 *   owner can change (`overrides`); otherwise the compiler asks.
 * - Lykia's fee and the mainnet beta cap are estimated per step. A step over
 *   the cap is a blocker: the compiler never splits a move to fit a cap.
 *
 * Pure: no I/O. The API gathers the state (Flock, prices, knowledge rows),
 * runs the route search and the Fence on the plan, and saves drafts only
 * for an owner who proved control.
 */
import { fromBaseUnits, toBaseUnitsBig, truncateDecimal } from "./amounts.js";
import type { ActionAmount, PlanAction } from "./actions.js";
import { getToken } from "./assets.js";
import { canonicalDigest, type Sha256Digest } from "./canonical.js";
import type { AlertDraft, AutomationDraft } from "./drafts.js";
import type { LeashDraft } from "./leash.js";
import type { AutomationTrigger } from "./devflows.js";
import type { Weekday } from "./fence.js";
import { WEEKDAYS } from "./fence.js";
import type { VenueKnowledge } from "./knowledge.js";
import type { OrderKind } from "./orders.js";
import { describeElement, programHash, type Period, type Program, type ProgramElement, type Quantity, type When } from "./program.js";
import { RISK_ORDER, type RiskTier } from "./routes.js";
import type { StandingOrderDraft } from "./standing.js";

export const RESOLUTION_SCHEMA = "lykia.resolution/v1" as const;
export const COMPILED_SCHEMA = "lykia.compiled/v1" as const;

/** What the compiler knows about a venue that can hold a deposit. */
export interface VenueFact {
  readonly venue: string;
  readonly executable: boolean;
  /** Base risk tier from the knowledge row. */
  readonly tier: RiskTier;
  /** The router refines the tier live (Morpho vaults: from TVL), so a low ceiling can still pick its largest vaults. */
  readonly liveTier: boolean;
  /** Tokens it accepts for yield. */
  readonly earns: readonly string[];
  /** Seconds until a withdrawal is back in the wallet; null when Lykia cannot withdraw it. */
  readonly withdrawSeconds: number | null;
  readonly note?: string;
}

export interface ProgramState {
  readonly owner: string | null;
  readonly environment: "mainnet" | "testnet";
  /** Liquid wallet balances in whole tokens; null when unknown (no owner). */
  readonly balances: Readonly<Record<string, string>> | null;
  /** Positions at venues (vault shares, supplies, debt), whole tokens. */
  readonly positions?: readonly { readonly symbol: string; readonly where: string; readonly amount: string; readonly kind: string }[];
  /** USD per token; null = unpriced. */
  readonly prices: Readonly<Record<string, string | null>>;
  readonly venues: readonly VenueFact[];
  /** Lykia's protocol fee (100 = 1%). */
  readonly feeBps: number;
  readonly beta: { readonly perStepUsd: string; readonly perDayUsd: string } | null;
  /** USDC kept for gas when a plan uses "the rest" or "everything" (Arc gas is paid in USDC). */
  readonly gasBufferUsdc: string;
  /** IANA zone used when the owner named none. */
  readonly timezone: string;
  readonly now: number;
  /** Confirmed contacts the owner saved (name -> address). */
  readonly contacts?: readonly { readonly name: string; readonly address: string }[];
  /** Balances given by the caller (what-if), not read from the chain. */
  readonly hypothetical?: boolean;
}

export interface Assumption {
  /** Stable id an override names: "share:e3", "buffer.gas", "buffer.schedule", "schedule.time", "schedule.timezone", "risk", "drop:e4". */
  readonly id: string;
  readonly text: string;
  readonly value: string;
  /** Other values the owner can pick (sent back as overrides). */
  readonly options: readonly string[];
}

export interface Question {
  readonly id: string;
  readonly text: string;
  readonly choices?: readonly string[];
}

export interface ResolvedLine {
  readonly elementId: string;
  readonly token: string;
  /** Whole tokens; null when it resolves only at plan time (balances unknown). */
  readonly amount: string | null;
  readonly usd: string | null;
  /** How the amount was derived, in words: "3 x 400", "33.33% of 1199 available". */
  readonly basis: string;
}

export interface FeeLine {
  readonly elementId: string;
  readonly amount: string;
  readonly token: string;
  readonly usd: string | null;
  readonly basis: "input" | "on-top";
}

export interface VenuePolicy {
  readonly maxRisk: RiskTier;
  readonly liquidityHours: number | null;
  readonly leverage: boolean;
  /** Venues the plan may deposit into. */
  readonly allow: readonly string[];
  /** Venues ruled out, each with the reason (they become a Fence deny list). */
  readonly excluded: readonly { readonly venue: string; readonly reason: string }[];
}

export interface Resolution {
  readonly schema: typeof RESOLUTION_SCHEMA;
  readonly programHash: Sha256Digest;
  readonly status: "ready" | "needs-input" | "refused";
  readonly balances: Readonly<Record<string, string>> | null;
  readonly hypothetical: boolean;
  readonly lines: readonly ResolvedLine[];
  /** What stays liquid per token, with its parts. */
  readonly kept: readonly { readonly token: string; readonly amount: string; readonly parts: readonly { readonly label: string; readonly amount: string }[] }[];
  readonly assumptions: readonly Assumption[];
  readonly questions: readonly Question[];
  readonly refusals: readonly { readonly elementId: string; readonly code: string; readonly text: string }[];
  /** Facts that stop the plan as asked (short balance, a step over the beta cap). */
  readonly blockers: readonly { readonly elementId: string | null; readonly text: string }[];
  readonly venuePolicy: VenuePolicy;
  readonly fees: { readonly bps: number; readonly totalUsd: string | null; readonly lines: readonly FeeLine[] };
  readonly overrides: Readonly<Record<string, string>>;
}

export interface OrderSpec {
  readonly kind: OrderKind;
  readonly sell: string;
  readonly buy: string;
  /** Whole tokens per execution. */
  readonly amount: string;
  readonly executions?: number;
  readonly intervalSeconds?: number;
  readonly triggerPrice?: string;
  readonly triggerAbove?: boolean;
}

export type ScheduledDraft =
  | { readonly kind: "automation"; readonly elementId: string; readonly summary: string; readonly rationale: string; readonly draft: AutomationDraft; readonly actions: readonly PlanAction[]; readonly firstRun: string | null }
  | { readonly kind: "order"; readonly elementId: string; readonly summary: string; readonly rationale: string; readonly order: OrderSpec }
  | { readonly kind: "alert"; readonly elementId: string; readonly summary: string; readonly rationale: string; readonly draft: AlertDraft }
  | { readonly kind: "standing"; readonly elementId: string; readonly summary: string; readonly rationale: string; readonly draft: StandingOrderDraft }
  | { readonly kind: "budget"; readonly elementId: string; readonly summary: string; readonly rationale: string; readonly suggestion: { readonly agent: string | null; readonly perDayUsd: string | null; readonly perWeekUsd: string | null } }
  | { readonly kind: "leash"; readonly elementId: string; readonly summary: string; readonly rationale: string; readonly draft: LeashDraft };

export interface NowPart {
  readonly elementId: string;
  /** Indexes into `actions`. */
  readonly actions: readonly number[];
  readonly summary: string;
  readonly rationale: string;
}

export interface Why {
  readonly summary: string;
  readonly assumptions: readonly Assumption[];
  readonly tradeoffs: readonly string[];
  readonly rejected: readonly { readonly option: string; readonly reason: string }[];
  readonly deferred: readonly string[];
}

export interface CompiledProgram {
  readonly schema: typeof COMPILED_SCHEMA;
  readonly status: "ready" | "needs-input" | "refused";
  readonly program: Program;
  readonly programHash: Sha256Digest;
  readonly resolution: Resolution;
  readonly resolutionHash: Sha256Digest;
  readonly now: { readonly actions: readonly PlanAction[]; readonly parts: readonly NowPart[] } | null;
  readonly scheduled: readonly ScheduledDraft[];
  readonly why: Why;
  readonly questions: readonly Question[];
}

/* ------------------------------------------------------------ venue facts */

/** Deposit venues and their withdrawal times, from the knowledge rows (plus the USYC Teller Lykia lists but cannot execute). */
export function venueFactsFrom(rows: readonly VenueKnowledge[]): VenueFact[] {
  const facts: VenueFact[] = [];
  for (const row of rows) {
    const deposits = row.capabilities.filter((c) => (c.verb === "deposit" || c.verb === "supply") && c.to === `${c.from}@${row.venue}` && c.note !== "collateral");
    if (deposits.length === 0) continue;
    const withdraws = row.capabilities.filter((c) => c.verb === "withdraw" && c.from.endsWith(`@${row.venue}`));
    facts.push({
      venue: row.venue,
      executable: row.executable,
      tier: row.risk.tier,
      liveTier: row.risk.notes.some((n) => /refined live/iu.test(n)),
      earns: [...new Set(deposits.map((c) => c.from))],
      withdrawSeconds: withdraws.length > 0 ? Math.max(...withdraws.map((c) => c.delaySeconds)) : null,
    });
  }
  facts.push({ venue: "usyc-teller", executable: false, tier: "low", liveTier: false, earns: ["USDC"], withdrawSeconds: null, note: "Tokenized T-bills for allowlisted holders; the Teller source is not verified, so Lykia lists it and does not execute it, and redemptions follow the Teller's schedule." });
  return facts;
}

/* ------------------------------------------------------------ helpers */

const PERIOD_SECONDS: Readonly<Record<Period, number>> = { day: 86_400, week: 604_800, month: 2_592_000 };
const PERIOD_WORD: Readonly<Record<Period, string>> = { day: "day", week: "week", month: "month" };

function decimalsOf(symbol: string): number {
  return getToken(symbol)?.decimals ?? 6;
}

/** Digits a resolved amount keeps: cents for fiat stablecoins, 6 for the rest. */
function keepDigits(symbol: string): number {
  const t = getToken(symbol);
  if (!t) return 6;
  return t.peg === "BTC" || t.peg === "ETH" ? Math.min(t.decimals, 6) : 2;
}

function units(amount: string, symbol: string): bigint {
  return toBaseUnitsBig(amount, decimalsOf(symbol));
}

function whole(u: bigint, symbol: string, digits = keepDigits(symbol)): string {
  if (u <= 0n) return "0";
  return truncateDecimal(fromBaseUnits(u, decimalsOf(symbol)), digits);
}

/** Rounds base units down to the digits the token keeps. */
function trim(u: bigint, symbol: string): bigint {
  const drop = decimalsOf(symbol) - keepDigits(symbol);
  if (drop <= 0 || u <= 0n) return u > 0n ? u : 0n;
  const step = 10n ** BigInt(drop);
  return (u / step) * step;
}

function usdOf(amount: string | null, symbol: string, prices: ProgramState["prices"]): string | null {
  if (amount === null) return null;
  const price = prices[symbol];
  if (price === null || price === undefined) return null;
  return (Number(amount) * Number(price)).toFixed(2);
}

function pctText(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function isNow(e: ProgramElement): boolean {
  if (e.kind === "sweep" || e.kind === "dca" || e.kind === "alert" || e.kind === "budget" || e.kind === "refuse") return false;
  const when = (e as { when?: When }).when;
  return !when || when.type === "now";
}

function quantityOf(e: ProgramElement): Quantity | null {
  return "quantity" in e ? e.quantity : null;
}

function spendToken(e: ProgramElement): string | null {
  switch (e.kind) {
    case "reserve":
    case "earn":
    case "pay":
    case "repay":
      return e.token;
    case "convert":
      return e.from;
    case "bridge":
    case "unify":
      return "USDC";
    default:
      return null;
  }
}

function recipientsCount(e: ProgramElement): number {
  return e.kind === "pay" ? e.recipients.length : 1;
}

/** Local calendar date of `now` in `timezone`, as [year, month (1-12), day, weekday index mon=0]. */
function localDate(now: number, timezone: string): [number, number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return [Number(get("year")), Number(get("month")), Number(get("day")), weekday < 0 ? 0 : weekday];
}

function isoDate(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toISOString().slice(0, 10);
}

/** The first date a schedule runs on (local calendar), strictly after today. */
export function firstRunDate(when: Extract<When, { type: "schedule" }>, now: number, timezone: string): string {
  const [y, m, d, wd] = localDate(now, timezone);
  if (when.every === "day") return isoDate(y, m, d + 1);
  if (when.every === "week") {
    const target = WEEKDAYS.indexOf(when.weekday ?? "mon");
    const ahead = ((target - wd + 7) % 7) || 7;
    return isoDate(y, m, d + ahead);
  }
  const day = Math.min(when.day ?? 1, 28);
  return day > d ? isoDate(y, m, day) : isoDate(y, m + 1, day);
}

/* ------------------------------------------------------------ resolution */

export interface ResolveOptions {
  /** Assumption id -> the owner's choice (see Assumption.id). */
  readonly overrides?: Readonly<Record<string, string>>;
}

interface Working {
  program: Program;
  state: ProgramState;
  overrides: Record<string, string>;
  lines: Map<string, ResolvedLine>;
  /** Resolved base units per now-element (per recipient for pay). */
  amounts: Map<string, bigint>;
  /** Plan-time amounts when balances are unknown. */
  relative: Map<string, ActionAmount>;
  kept: Map<string, { label: string; units: bigint }[]>;
  assumptions: Assumption[];
  questions: Question[];
  refusals: { elementId: string; code: string; text: string }[];
  blockers: { elementId: string | null; text: string }[];
  /** Resolved schedule details per element. */
  schedules: Map<string, { at: string; timezone: string; day?: number; weekday?: Weekday }>;
  recipients: Map<string, string[]>;
}

function assume(w: Working, a: Assumption): void {
  if (!w.assumptions.some((x) => x.id === a.id)) w.assumptions.push(a);
}

function ask(w: Working, q: Question): void {
  if (!w.questions.some((x) => x.text === q.text)) w.questions.push(q);
}

function overrideShare(w: Working, e: ProgramElement, q: Quantity): Quantity {
  const raw = w.overrides[`share:${e.id}`];
  if (raw === undefined || q.type !== "share") return q;
  const pct = Number(raw.replace(/%$/u, ""));
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return q;
  return { ...q, bps: Math.round(pct * 100), approx: false };
}

function venuePolicyOf(w: Working): VenuePolicy {
  const prefs = w.program.preferences;
  const overriddenRisk = w.overrides.risk as RiskTier | undefined;
  const maxRisk: RiskTier = overriddenRisk && RISK_ORDER.includes(overriddenRisk) ? overriddenRisk : (prefs.risk ?? "medium");
  const hours = prefs.liquidityHours ?? null;
  const allow: string[] = [];
  const excluded: { venue: string; reason: string }[] = [];
  const deny = new Set(prefs.venues?.deny ?? []);
  const only = prefs.venues?.allow;
  for (const v of w.state.venues) {
    if (!v.executable) {
      excluded.push({ venue: v.venue, reason: v.note ?? "Lykia cannot execute it." });
      continue;
    }
    if (deny.has(v.venue)) {
      excluded.push({ venue: v.venue, reason: "You asked to avoid it." });
      continue;
    }
    if (only && !only.includes(v.venue)) {
      excluded.push({ venue: v.venue, reason: "Not on the venues you allowed." });
      continue;
    }
    if (hours !== null && (v.withdrawSeconds === null || v.withdrawSeconds > hours * 3600)) {
      excluded.push({ venue: v.venue, reason: `Withdrawals take longer than ${hours} hours.` });
      continue;
    }
    if (RISK_ORDER.indexOf(v.tier) > RISK_ORDER.indexOf(maxRisk) && !v.liveTier) {
      excluded.push({ venue: v.venue, reason: `Risk tier ${v.tier} is above your ${maxRisk} ceiling.` });
      continue;
    }
    allow.push(v.venue);
  }
  return { maxRisk, liquidityHours: hours, leverage: prefs.leverage !== false, allow, excluded };
}

function scheduleOf(w: Working, e: ProgramElement, when: Extract<When, { type: "schedule" }>): void {
  const tzOverride = w.overrides["schedule.timezone"];
  const timezone = when.timezone ?? w.program.preferences.timezone ?? tzOverride ?? w.state.timezone;
  if (!when.timezone && !w.program.preferences.timezone) assume(w, { id: "schedule.timezone", text: `Schedules use the ${timezone} time zone.`, value: timezone, options: ["UTC", "Europe/Istanbul", "Europe/Berlin", "America/New_York"].filter((z) => z !== timezone) });
  const at = when.at ?? w.overrides["schedule.time"] ?? "09:00";
  if (!when.at) assume(w, { id: "schedule.time", text: `Scheduled runs happen at ${at}.`, value: at, options: ["08:00", "12:00", "17:00"].filter((t) => t !== at) });
  let day = when.day;
  if (when.every === "month") {
    if (day === undefined) {
      day = 1;
      assume(w, { id: `schedule.day:${e.id}`, text: "Monthly runs happen on the 1st.", value: "1", options: ["15", "28"] });
    } else if (day > 28) {
      day = 28;
      assume(w, { id: `schedule.day:${e.id}`, text: `Schedules run on days 1 to 28, so "day ${when.day}" runs on the 28th.`, value: "28", options: ["1"] });
    }
  }
  let weekday = when.weekday;
  if (when.every === "week" && !weekday) {
    weekday = "mon";
    assume(w, { id: `schedule.weekday:${e.id}`, text: "Weekly runs happen on Mondays.", value: "mon", options: ["fri"] });
  }
  w.schedules.set(e.id, { at, timezone, ...(day !== undefined ? { day } : {}), ...(weekday ? { weekday } : {}) });
}

function resolveRecipients(w: Working, e: Extract<ProgramElement, { kind: "pay" }>): void {
  const out: string[] = [];
  for (const r of e.recipients) {
    if (r.address) {
      out.push(r.address);
      continue;
    }
    const name = (r.name ?? "").trim().toLowerCase();
    const contact = w.state.contacts?.find((c) => c.name.trim().toLowerCase() === name);
    if (contact) out.push(contact.address);
    else ask(w, { id: `recipient:${e.id}`, text: `Which address should receive the payment to ${r.name ?? "this recipient"}? Lykia never guesses addresses: paste the full 0x address or save the contact first.` });
  }
  // An untrusted message pays no one but the owner; with no owner known, it pays no one.
  if (w.program.untrusted && out.some((a) => !w.state.owner || a.toLowerCase() !== w.state.owner.toLowerCase())) {
    w.refusals.push({ elementId: e.id, code: "injection", text: "This message also tries to override Lykia's rules, so no payment to an outside address in it is planned." });
    return;
  }
  w.recipients.set(e.id, out);
}

/** The program's amounts, assumptions, questions and blockers against the owner's state. */
export function resolveProgram(program: Program, state: ProgramState, options: ResolveOptions = {}): Resolution {
  return resolveWithInternal(program, state, options).resolution;
}

function resolveWithInternal(program: Program, state: ProgramState, options: ResolveOptions): { resolution: Resolution; internal: Internal } {
  const overrides = { ...(options.overrides ?? {}) };
  const dropped = new Set(Object.entries(overrides).filter(([k, v]) => k.startsWith("drop:") && v === "drop").map(([k]) => k.slice(5)));
  const effective: Program = dropped.size > 0 ? { ...program, elements: program.elements.filter((e) => !dropped.has(e.id)) } : program;
  const w: Working = { program: effective, state, overrides, lines: new Map(), amounts: new Map(), relative: new Map(), kept: new Map(), assumptions: [], questions: program.questions.map((text, i) => ({ id: `reader:${i}`, text })), refusals: [], blockers: [], schedules: new Map(), recipients: new Map() };
  const fee = BigInt(state.feeBps);

  // Refusals, element assumptions, recipients and schedules first.
  for (const e of effective.elements) {
    if (e.kind === "refuse") w.refusals.push({ elementId: e.id, code: e.code, text: e.detail });
    if (e.assumed) assume(w, { id: `drop:${e.id}`, text: `${describeElement(e)}: ${e.assumed}`, value: "keep", options: ["drop"] });
    if (e.kind === "pay") resolveRecipients(w, e);
    const when = (e as { when?: When }).when;
    if (when?.type === "schedule") scheduleOf(w, e, when);
  }
  for (const c of effective.conflicts) assume(w, { id: `conflict:${c.between.join("|").slice(0, 40)}`, text: `"${c.between[0]}" and "${c.between[1]}" pull in opposite directions: ${c.resolution}`, value: "safer reading", options: [] });

  const nowElements = effective.elements.filter((e) => isNow(e) && w.refusals.every((r) => r.elementId !== e.id));
  const balances = state.balances;

  if (balances === null) {
    // No balances (no owner): amounts stay relative and the planner resolves them at plan time.
    for (const e of nowElements) {
      const q = quantityOf(e);
      const token = spendToken(e) ?? (e.kind === "withdraw" ? e.token : "USDC");
      if (!q) continue;
      let rel: ActionAmount | null = null;
      let basis = "";
      const sq = overrideShare(w, e, q);
      if (sq.type === "exact") {
        rel = { exact: sq.amount };
        basis = "as stated";
      } else if (sq.type === "runway") {
        const total = units(sq.perPeriod, token) * BigInt(sq.periods);
        rel = { exact: whole(total, token, decimalsOf(token)) };
        basis = `${sq.periods} x ${sq.perPeriod}`;
      } else if (sq.type === "share") {
        rel = { percent: Math.max(1, Math.min(100, Math.round(sq.bps / 100))) };
        basis = `${pctText(sq.bps)} of the balance at plan time`;
      } else if (sq.type === "rest" || sq.type === "all") {
        rel = { all: true };
        basis = "what is left at plan time";
      } else ask(w, { id: `amount:${e.id}`, text: `How much for "${e.quote || describeElement(e)}"?`, choices: ["25%", "50%", "all"] });
      if (rel) {
        w.relative.set(e.id, rel);
        w.lines.set(e.id, { elementId: e.id, token, amount: "exact" in rel ? rel.exact : null, usd: "exact" in rel ? usdOf(rel.exact, token, state.prices) : null, basis });
      }
    }
    if (nowElements.some((e) => { const q = quantityOf(e); return q !== null && q.type !== "exact" && q.type !== "runway"; })) {
      assume(w, { id: "balances.unknown", text: "No wallet was read, so shares and \"the rest\" are resolved against the balance when the plan is made.", value: "plan time", options: [] });
    }
  } else {
    // "convert, then put the euros to work": the deposit takes exactly what the conversion produces,
    // so it is not resolved against the wallet balance of the target token.
    const followers = new Set<string>();
    for (const conv of nowElements.filter((x): x is Extract<ProgramElement, { kind: "convert" }> => x.kind === "convert")) {
      const f = nowElements.find((x) => x.kind === "earn" && x.token === conv.to && !followers.has(x.id) && ["rest", "all", "unspecified"].includes(x.quantity.type));
      if (f) followers.add(f.id);
    }
    const tokens = new Set(nowElements.filter((e) => !followers.has(e.id)).map((e) => spendToken(e)).filter((t): t is string => t !== null));
    const scheduledPays = effective.elements.filter((e): e is Extract<ProgramElement, { kind: "pay" }> => e.kind === "pay" && (e.when?.type === "schedule"));
    for (const token of tokens) {
      const liquid = units(balances[token] ?? "0", token);
      const mine = nowElements.filter((e) => spendToken(e) === token && !followers.has(e.id));
      const relativeUse = mine.some((e) => { const q = quantityOf(e); return e.kind !== "reserve" && q !== null && (q.type === "rest" || q.type === "all" || q.type === "share" || q.type === "unspecified"); });
      const kept: { label: string; units: bigint }[] = [];

      // 1. Reserves.
      for (const e of mine.filter((x) => x.kind === "reserve")) {
        const r = e as Extract<ProgramElement, { kind: "reserve" }>;
        const q = r.quantity;
        let u = 0n;
        let basis = "";
        if (q.type === "exact") {
          u = units(q.amount, token);
          basis = "as stated";
        } else if (q.type === "runway") {
          u = units(q.perPeriod, token) * BigInt(q.periods);
          basis = `${q.periods} ${PERIOD_WORD[q.period]}${q.periods === 1 ? "" : "s"} x ${q.perPeriod} ${token}`;
        } else if (q.type === "share") {
          const sq = overrideShare(w, e, q);
          u = trim((liquid * BigInt(sq.type === "share" ? sq.bps : 0)) / 10_000n, token);
          basis = `${pctText(sq.type === "share" ? sq.bps : 0)} of ${whole(liquid, token)} ${token}`;
        } else if (q.type === "unspecified" || q.type === "all") {
          ask(w, { id: `amount:${e.id}`, text: `How much ${token} should stay liquid?`, choices: ["1000", "5000", "10%"] });
          continue;
        }
        const override = w.overrides[`reserve:${e.id}`];
        if (override && /^\d+(?:\.\d+)?$/u.test(override)) {
          u = units(override, token);
          basis = "your amount";
        }
        kept.push({ label: r.purpose ? `${r.purpose} (${basis})` : basis, units: u });
        w.amounts.set(e.id, u);
        w.lines.set(e.id, { elementId: e.id, token, amount: whole(u, token), usd: usdOf(whole(u, token), token, state.prices), basis });
      }

      // 2. Buffers: the first period of scheduled payments in this token, and gas.
      const pays = scheduledPays.filter((p) => p.token === token && p.quantity.type === "exact");
      if (relativeUse && pays.length > 0 && w.overrides["buffer.schedule"] !== "off") {
        let perPeriod = 0n;
        for (const p of pays) {
          const each = units((p.quantity as { amount: string }).amount, token);
          const n = BigInt(p.recipients.length);
          perPeriod += each * n + (each * n * fee + 9_999n) / 10_000n;
        }
        const period = (pays[0]!.when as { every: Period }).every;
        kept.push({ label: `first ${PERIOD_WORD[period]} of scheduled payments, fee included`, units: perPeriod });
        assume(w, { id: "buffer.schedule", text: `${whole(perPeriod, token)} ${token} for the first ${PERIOD_WORD[period]} of scheduled payments (Lykia's ${state.feeBps / 100}% fee included) stays liquid too, so the first run never fails for lack of funds.`, value: "on", options: ["off"] });
      }
      if (token === "USDC" && relativeUse) {
        const raw = w.overrides["buffer.gas"];
        const gas = raw && /^\d+(?:\.\d+)?$/u.test(raw) ? raw : state.gasBufferUsdc;
        if (gas !== "0") {
          kept.push({ label: "gas buffer (Arc gas is paid in USDC)", units: units(gas, "USDC") });
          assume(w, { id: "buffer.gas", text: `${gas} USDC stays in the wallet for network fees (Arc gas is paid in USDC).`, value: gas, options: ["0", "5"].filter((g) => g !== gas) });
        }
      }
      const keptTotal = kept.reduce((s, k) => s + k.units, 0n);
      if (kept.length > 0) w.kept.set(token, kept);

      // 3. Exact amounts.
      let exactTotal = 0n;
      for (const e of mine.filter((x) => x.kind !== "reserve")) {
        const q = overrideShare(w, e, quantityOf(e)!);
        if (q.type !== "exact" && q.type !== "runway") continue;
        const each = q.type === "exact" ? units(q.amount, token) : units(q.perPeriod, token) * BigInt(q.periods);
        const n = BigInt(recipientsCount(e));
        const onTop = e.kind === "pay" ? (each * n * fee + 9_999n) / 10_000n : 0n;
        exactTotal += each * n + onTop;
        w.amounts.set(e.id, each);
        w.lines.set(e.id, { elementId: e.id, token, amount: whole(each, token, decimalsOf(token)), usd: usdOf(whole(each, token, decimalsOf(token)), token, state.prices), basis: q.type === "runway" ? `${q.periods} x ${q.perPeriod}` : n > 1n ? `${whole(each, token)} each to ${n} recipients` : "as stated" });
      }

      const available = liquid - keptTotal - exactTotal;
      if (available < 0n) {
        w.blockers.push({ elementId: null, text: `This needs ${whole(keptTotal + exactTotal, token)} ${token} (kept liquid ${whole(keptTotal, token)}, spent ${whole(exactTotal, token)}), but the wallet holds ${whole(liquid, token)} ${token}${state.hypothetical ? " (what-if balance)" : ""}.` });
        ask(w, { id: `short:${token}`, text: `The wallet is ${whole(-available, token)} ${token} short. Lower the reserve or the amounts, or add funds first?`, choices: ["Lower the reserve", "Add funds first"] });
      }
      const pool = available > 0n ? available : 0n;

      // 4. Shares.
      let sharesTotal = 0n;
      for (const e of mine.filter((x) => x.kind !== "reserve")) {
        const raw = quantityOf(e)!;
        const q = overrideShare(w, e, raw);
        if (q.type !== "share") continue;
        const base = q.of === "total" ? liquid : pool;
        let u = (base * BigInt(q.bps)) / 10_000n;
        u = trim(u, token);
        sharesTotal += u;
        w.amounts.set(e.id, u);
        const basis = `${pctText(q.bps)} of ${whole(base, token)} ${token} ${q.of === "total" ? "held" : "available after what stays liquid"}`;
        w.lines.set(e.id, { elementId: e.id, token, amount: whole(u, token), usd: usdOf(whole(u, token), token, state.prices), basis });
        if (e.assumed) {
          // The element's own assumption already says where the share comes from.
        } else if (q.of === "available" && raw.type === "share" && keptTotal > 0n) {
          assume(w, { id: `share:${e.id}`, text: `"${e.quote || describeElement(e)}" is read as ${pctText(q.bps)} of what is left after the reserve (${whole(pool, token)} ${token}), not of the whole balance.`, value: pctText(q.bps), options: ["20%", "25%", "50%"].filter((o) => o !== pctText(q.bps)) });
        } else if (raw.type === "share" && raw.approx) {
          assume(w, { id: `share:${e.id}`, text: `"About" is taken as exactly ${pctText(q.bps)}.`, value: pctText(q.bps), options: ["25%", "30%", "40%"].filter((o) => o !== pctText(q.bps)) });
        }
      }
      if (sharesTotal > pool && pool > 0n) w.blockers.push({ elementId: null, text: `The shares add up to more than the ${whole(pool, token)} ${token} available.` });

      // 5. The rest (and "all", and unspecified amounts that can take the rest).
      const restLike = mine.filter((x) => {
        if (x.kind === "reserve") return false;
        const t = quantityOf(x)!.type;
        return t === "rest" || t === "all" || (t === "unspecified" && x.kind === "earn");
      });
      const unspecified = mine.filter((x) => x.kind !== "reserve" && quantityOf(x)!.type === "unspecified" && x.kind !== "earn");
      for (const e of unspecified) ask(w, { id: `amount:${e.id}`, text: `How much for "${e.quote || describeElement(e)}"?`, choices: ["25%", "50%", "all"] });
      const remaining = pool > sharesTotal ? pool - sharesTotal : 0n;
      if (restLike.length > 0) {
        const each = trim(remaining / BigInt(restLike.length), token);
        if (restLike.length > 1) assume(w, { id: `rest-split:${token}`, text: `"The rest" appears ${restLike.length} times for ${token}; it is split evenly.`, value: "even", options: [] });
        for (const e of restLike) {
          if (quantityOf(e)!.type === "unspecified") assume(w, { id: `amount:${e.id}`, text: `No amount was given for "${e.quote || describeElement(e)}", so it uses what is left: ${whole(each, token)} ${token}.`, value: whole(each, token), options: [] });
          w.amounts.set(e.id, each);
          w.lines.set(e.id, { elementId: e.id, token, amount: whole(each, token), usd: usdOf(whole(each, token), token, state.prices), basis: `what is left: ${whole(liquid, token)} held − ${whole(keptTotal, token)} kept − ${whole(exactTotal + sharesTotal, token)} used` });
          if (each === 0n && available >= 0n) w.blockers.push({ elementId: e.id, text: `Nothing is left of ${token} for "${e.quote || describeElement(e)}" after what stays liquid.` });
        }
      }
    }
    for (const id of followers) {
      const f = nowElements.find((x) => x.id === id) as Extract<ProgramElement, { kind: "earn" }>;
      const conv = nowElements.find((x): x is Extract<ProgramElement, { kind: "convert" }> => x.kind === "convert" && x.to === f.token);
      const u = conv ? w.amounts.get(conv.id) : undefined;
      const pIn = conv ? state.prices[conv.from] : null;
      const pOut = state.prices[f.token];
      const estimate = u !== undefined && conv && pIn && pOut ? ((Number(fromBaseUnits(u, decimalsOf(conv.from))) * (1 - state.feeBps / 10_000) * Number(pIn)) / Number(pOut)).toFixed(2) : null;
      w.lines.set(id, { elementId: id, token: f.token, amount: estimate, usd: usdOf(estimate, f.token, state.prices), basis: `exactly what the conversion produces${estimate ? ` (about ${estimate} ${f.token} after the fee, at today's prices)` : ""}` });
    }
    // Withdrawals resolve against positions.
    for (const e of nowElements.filter((x): x is Extract<ProgramElement, { kind: "withdraw" }> => x.kind === "withdraw")) {
      const held = (state.positions ?? []).filter((p) => p.symbol === e.token && (p.kind === "vault" || p.kind === "supply") && (!e.venue || p.where === e.venue));
      const total = held.reduce((s, p) => s + units(p.amount, e.token), 0n);
      const q = e.quantity;
      const u = q.type === "exact" ? units(q.amount, e.token) : q.type === "share" ? trim((total * BigInt(q.bps)) / 10_000n, e.token) : total;
      if (u === 0n || u > total) w.blockers.push({ elementId: e.id, text: `There is ${whole(total, e.token)} ${e.token} at venues to withdraw.` });
      w.amounts.set(e.id, u);
      w.lines.set(e.id, { elementId: e.id, token: e.token, amount: whole(u, e.token, decimalsOf(e.token)), usd: usdOf(whole(u, e.token), e.token, state.prices), basis: q.type === "exact" ? "as stated" : `of ${whole(total, e.token)} ${e.token} held at venues` });
    }
  }

  // Conditional and scheduled parts that need an amount now (orders sized from holdings).
  for (const e of effective.elements) {
    if (isNow(e) || e.kind !== "convert" || w.refusals.some((r) => r.elementId === e.id)) continue;
    const q = e.quantity;
    if (q.type === "exact") {
      w.amounts.set(e.id, units(q.amount, e.from));
      continue;
    }
    if (!balances) {
      ask(w, { id: `amount:${e.id}`, text: `How much ${e.from} should "${e.quote || describeElement(e)}" use? Without a wallet Lykia cannot size it from your balance.`, choices: ["100", "500", "1000"] });
      continue;
    }
    const held = units(balances[e.from] ?? "0", e.from);
    const bps = q.type === "share" ? q.bps : q.type === "all" || q.type === "rest" ? 10_000 : 0;
    if (bps === 0) {
      ask(w, { id: `amount:${e.id}`, text: `How much ${e.from} for "${e.quote || describeElement(e)}"?`, choices: ["25%", "50%", "all"] });
      continue;
    }
    const u = trim((held * BigInt(bps)) / 10_000n, e.from);
    if (u === 0n) {
      w.blockers.push({ elementId: e.id, text: `The wallet holds no ${e.from} for "${e.quote || describeElement(e)}".` });
      continue;
    }
    w.amounts.set(e.id, u);
    w.lines.set(e.id, { elementId: e.id, token: e.from, amount: whole(u, e.from), usd: usdOf(whole(u, e.from), e.from, state.prices), basis: `${pctText(bps)} of the ${whole(held, e.from)} ${e.from} held now` });
    assume(w, { id: `size:${e.id}`, text: `The order is sized from today's balance: ${whole(u, e.from)} ${e.from}. If the balance changes, the order still sells only this amount.`, value: whole(u, e.from), options: [] });
  }

  // "Plan a smaller version": each step shrinks to the per-step beta cap. Less is planned; nothing is split.
  if (state.beta && overrides.beta === "fit" && balances) {
    for (const e of nowElements) {
      if (e.kind === "reserve" || e.kind === "withdraw" || e.kind === "repay" || e.kind === "pay") continue;
      const token = spendToken(e);
      const u = w.amounts.get(e.id);
      const price = token ? state.prices[token] : null;
      if (!token || u === undefined || !price) continue;
      const capUnits = trim(units((Number(state.beta.perStepUsd) / Number(price)).toFixed(decimalsOf(token)), token), token);
      if (u <= capUnits) continue;
      w.amounts.set(e.id, capUnits);
      const line = w.lines.get(e.id);
      if (line) w.lines.set(e.id, { ...line, amount: whole(capUnits, token), usd: usdOf(whole(capUnits, token), token, state.prices), basis: `${line.basis}, capped at the $${state.beta.perStepUsd} beta step cap` });
      assume(w, { id: "beta", text: `Steps are capped at the $${state.beta.perStepUsd} beta limit: ${whole(u - capUnits, token)} ${token} of "${e.quote || describeElement(e)}" stays in the wallet for now.`, value: "fit", options: ["preview"] });
    }
  }

  // Fees and the beta cap (estimates; the planner and the Fence decide).
  const feeLines: FeeLine[] = [];
  let feeUsd = 0;
  let feeUnpriced = false;
  let dayUsd = 0;
  for (const e of nowElements) {
    if (e.kind === "reserve" || e.kind === "withdraw" || e.kind === "repay") continue;
    const u = w.amounts.get(e.id);
    const token = spendToken(e);
    if (u === undefined || !token || u === 0n) continue;
    const gross = u * BigInt(recipientsCount(e));
    const f = (gross * fee + 9_999n) / 10_000n;
    const amount = whole(f, token, decimalsOf(token));
    const usd = usdOf(amount, token, state.prices);
    if (f > 0n) feeLines.push({ elementId: e.id, amount, token, usd, basis: e.kind === "pay" ? "on-top" : "input" });
    if (usd === null) feeUnpriced = true;
    else feeUsd += Number(usd);
    const stepUsd = usdOf(whole(gross, token, decimalsOf(token)), token, state.prices);
    if (stepUsd !== null) {
      dayUsd += Number(stepUsd);
      if (state.beta && e.kind !== "pay" && Number(stepUsd) > Number(state.beta.perStepUsd)) {
        w.blockers.push({ elementId: e.id, text: `"${e.quote || describeElement(e)}" moves about $${stepUsd}, above the $${state.beta.perStepUsd} per-step beta cap that applies to everyone while Lykia's contracts are unaudited. Lykia never splits a move to fit a cap.` });
      }
      if (state.beta && e.kind === "pay") {
        const each = Number(usdOf(whole(u, token, decimalsOf(token)), token, state.prices));
        if (each > Number(state.beta.perStepUsd)) w.blockers.push({ elementId: e.id, text: `A payment of about $${each.toFixed(2)} is above the $${state.beta.perStepUsd} per-step beta cap.` });
      }
    }
  }
  if (state.beta && dayUsd > Number(state.beta.perDayUsd)) w.blockers.push({ elementId: null, text: `Together the plan moves about $${dayUsd.toFixed(2)}, above the $${state.beta.perDayUsd} daily beta cap.` });
  if (w.blockers.some((b) => /beta cap/u.test(b.text))) ask(w, { id: "beta", text: `The mainnet beta cap is $${state.beta?.perStepUsd} per step and $${state.beta?.perDayUsd} a day. Plan a smaller version that fits, or keep this plan as a preview?`, choices: ["Plan a smaller version", "Keep it as a preview"] });

  const venuePolicy = venuePolicyOf(w);
  if (nowElements.some((e) => e.kind === "earn") && venuePolicy.allow.length === 0) {
    w.blockers.push({ elementId: null, text: "No venue Lykia executes meets your risk and liquidity limits." });
    ask(w, { id: "venues", text: "No venue meets these limits. Allow medium-risk venues, or keep the funds liquid?", choices: ["Allow medium risk", "Keep it liquid"] });
  }

  const actionable = effective.elements.filter((e) => e.kind !== "refuse" && w.refusals.every((r) => r.elementId !== e.id));
  const status: Resolution["status"] = actionable.length === 0 && w.refusals.length > 0 && w.questions.length === 0 ? "refused" : w.questions.length > 0 || actionable.length === 0 ? "needs-input" : "ready";
  const resolution: Resolution = {
    schema: RESOLUTION_SCHEMA,
    programHash: programHash(program),
    status,
    balances,
    hypothetical: state.hypothetical === true,
    lines: [...w.lines.values()],
    kept: [...w.kept.entries()].map(([token, parts]) => ({ token, amount: whole(parts.reduce((s, p) => s + p.units, 0n), token), parts: parts.map((p) => ({ label: p.label, amount: whole(p.units, token) })) })),
    assumptions: w.assumptions,
    questions: w.questions,
    refusals: w.refusals,
    blockers: w.blockers,
    venuePolicy,
    fees: { bps: state.feeBps, totalUsd: feeUnpriced ? null : feeUsd.toFixed(2), lines: feeLines },
    overrides,
  };
  return { resolution, internal: { amounts: w.amounts, relative: w.relative, schedules: w.schedules, recipients: w.recipients, now: state.now } };
}

interface Internal {
  readonly amounts: Map<string, bigint>;
  readonly relative: Map<string, ActionAmount>;
  readonly schedules: Map<string, { at: string; timezone: string; day?: number; weekday?: Weekday }>;
  readonly recipients: Map<string, string[]>;
  readonly now: number;
}

/* ------------------------------------------------------------ sentences */

function amountWords(a: ActionAmount, token: string): string {
  if ("exact" in a) return `${a.exact} ${token}`;
  if ("percent" in a) return `${a.percent}% of my ${token}`;
  if ("previous" in a) return "it";
  return `all my ${token}`;
}

/**
 * One English sentence the language reader turns back into exactly these
 * actions (the API checks the round trip before it drafts an automation).
 */
export function sentenceOf(actions: readonly PlanAction[], risk?: RiskTier): string {
  const parts: string[] = [];
  for (const a of actions) {
    switch (a.verb) {
      case "send":
        parts.push(`send ${amountWords(a.amount, a.token)} to ${a.to}${a.memo ? ` for ${a.memo}` : ""}`);
        break;
      case "reserve":
        parts.push(`keep ${amountWords(a.amount, a.token)} liquid`);
        break;
      case "earn":
        parts.push(`${"all" in a.amount && parts.length > 0 ? `earn the rest` : `earn ${amountWords(a.amount, a.token)}`}${a.maxRisk === "low" || risk === "low" ? " with low risk" : ""}`);
        break;
      case "fx":
      case "swap":
        parts.push(`convert ${amountWords(a.amount, a.from)} to ${a.to}`);
        break;
      case "bridge":
        parts.push(`bridge ${amountWords(a.amount, "USDC")} to ${a.destination}${a.recipient ? ` for ${a.recipient}` : ""}`);
        break;
      case "repay":
        parts.push(`repay ${amountWords(a.amount, a.token)}`);
        break;
      case "withdraw":
        parts.push(`withdraw ${amountWords(a.amount, a.token)}`);
        break;
      case "unify":
        parts.push(`move ${amountWords(a.amount, "USDC")} into the gateway`);
        break;
      default:
        parts.push(a.verb);
    }
  }
  return parts.join(" and ");
}

/* ------------------------------------------------------------ compile */

function exactOf(u: bigint, token: string): ActionAmount {
  return { exact: whole(u, token, decimalsOf(token)) };
}

function quoteOf(e: ProgramElement): string {
  return e.quote ? `“${e.quote}”` : describeElement(e);
}

function automationTrigger(when: When, sched: { at: string; timezone: string; day?: number; weekday?: Weekday } | undefined): AutomationTrigger | null {
  if (when.type === "schedule" && sched) return { type: "schedule", every: when.every, ...(when.every === "week" ? { weekday: sched.weekday ?? "mon" } : {}), ...(when.every === "month" ? { day: sched.day ?? 1 } : {}), at: sched.at, timezone: sched.timezone };
  if (when.type === "price") return { type: "price", feed: when.feed, op: when.op, value: when.value };
  if (when.type === "balance") return { type: "balance", token: when.token, op: when.op, value: when.value };
  return null;
}

function whenWords(when: When, sched?: { at: string; timezone: string; day?: number; weekday?: Weekday }): string {
  switch (when.type) {
    case "now":
      return "now";
    case "schedule":
      return when.every === "month" ? `every month on day ${sched?.day ?? when.day ?? 1} at ${sched?.at ?? "09:00"} ${sched?.timezone ?? "UTC"}` : when.every === "week" ? `every ${sched?.weekday ?? when.weekday ?? "mon"} at ${sched?.at ?? "09:00"} ${sched?.timezone ?? "UTC"}` : `every day at ${sched?.at ?? "09:00"} ${sched?.timezone ?? "UTC"}`;
    case "price":
      return `when ${when.feed} goes ${when.op} ${when.value}`;
    case "balance":
      return `when the ${when.token} balance goes ${when.op} ${when.value}`;
    case "health":
      return `when the health factor falls below ${when.below}`;
  }
}

const FEED_TOKEN: Readonly<Record<string, string>> = { "EURC/USD": "EURC", "EUR/USD": "EURC", "BTC/USD": "cirBTC", "ETH/USD": "WETH" };

/** Resolves the program against the state and compiles it: the plan for now, drafts for later and the why. */
export function compileProgram(program: Program, state: ProgramState, options: ResolveOptions = {}): CompiledProgram {
  const { resolution, internal } = resolveWithInternal(program, state, options);
  const { amounts, relative, schedules, recipients } = internal;
  const refused = new Set(resolution.refusals.map((r) => r.elementId));
  const dropped = new Set(Object.entries(resolution.overrides).filter(([k, v]) => k.startsWith("drop:") && v === "drop").map(([k]) => k.slice(5)));
  const elements = program.elements.filter((e) => !refused.has(e.id) && !dropped.has(e.id));
  const risk = resolution.venuePolicy.maxRisk;
  const lineOf = (id: string) => resolution.lines.find((l) => l.elementId === id);
  const amountFor = (e: ProgramElement, token: string): ActionAmount | null => {
    const u = amounts.get(e.id);
    if (u !== undefined) return u > 0n ? exactOf(u, token) : null;
    return relative.get(e.id) ?? null;
  };

  /* Now: reserves, conversions (and what consumes their output), payments and bridges, then deposits. */
  const keptBy = new Map(resolution.kept.map((k) => [k.token, k]));
  const actions: PlanAction[] = [];
  const parts: NowPart[] = [];
  /** The step in resolved amounts ("Convert 399.29 USDC to EURC as a hedge"), else the owner's terms. */
  const summaryOf = (e: ProgramElement): string => {
    const line = lineOf(e.id);
    const amt = line?.amount ? `${line.amount} ${line.token}` : null;
    if (!amt) return describeElement(e);
    switch (e.kind) {
      case "reserve": {
        const kept = keptBy.get(e.token);
        return `Keep ${kept && resolution.balances ? `${kept.amount} ${e.token}` : amt} liquid${e.purpose ? ` (${e.purpose})` : ""}`;
      }
      case "convert":
        return `Convert ${amt} to ${e.to}${e.purpose === "hedge" ? " as a hedge" : ""}`;
      case "earn":
        return `Put ${amt} to work`;
      case "pay":
        return `Pay ${amt} to ${e.recipients.length} recipient${e.recipients.length === 1 ? "" : "s"}${e.recipients.length > 1 ? " each" : ""}`;
      case "bridge":
        return `Bridge ${amt} to ${e.destination}`;
      case "unify":
        return `Move ${amt} into the Circle Gateway balance`;
      case "withdraw":
        return `Withdraw ${amt}`;
      case "repay":
        return `Repay ${amt}`;
      default:
        return describeElement(e);
    }
  };
  const push = (e: ProgramElement, list: PlanAction[], rationale: string) => {
    if (list.length === 0) return;
    const start = actions.length;
    actions.push(...list);
    parts.push({ elementId: e.id, actions: list.map((_, i) => start + i), summary: summaryOf(e), rationale });
  };
  const nowEls = elements.filter(isNow);
  const reserves = nowEls.filter((e): e is Extract<ProgramElement, { kind: "reserve" }> => e.kind === "reserve");
  const reservedTokens = new Set<string>();
  for (const e of reserves) {
    const kept = keptBy.get(e.token);
    if (reservedTokens.has(e.token)) continue;
    const amount: ActionAmount | null = kept && resolution.balances ? { exact: kept.amount } : amountFor(e, e.token);
    if (!amount) continue;
    reservedTokens.add(e.token);
    const line = lineOf(e.id);
    push(e, [{ verb: "reserve", token: e.token, amount, ...(e.purpose ? { reason: e.purpose.slice(0, 60) } : {}) }], `${quoteOf(e)} → ${line?.basis ?? "as stated"}${kept && kept.parts.length > 1 ? `; ${kept.amount} ${e.token} stays liquid in total (${kept.parts.map((p) => `${p.amount} ${p.label}`).join(", ")})` : ""}.`);
  }
  // Buffers without a reserve element still keep their USDC liquid in the plan.
  for (const k of resolution.kept) {
    if (reservedTokens.has(k.token) || !resolution.balances) continue;
    const anchor = nowEls.find((e) => spendToken(e) === k.token);
    if (!anchor) continue;
    reservedTokens.add(k.token);
    actions.push({ verb: "reserve", token: k.token, amount: { exact: k.amount }, reason: "buffer" });
    parts.push({ elementId: anchor.id, actions: [actions.length - 1], summary: `Keep ${k.amount} ${k.token} liquid`, rationale: `Kept liquid: ${k.parts.map((p) => `${p.amount} ${k.token} ${p.label}`).join(", ")}.` });
  }
  const consumed = new Set<string>();
  for (const e of nowEls.filter((x) => x.kind === "withdraw")) {
    const w = e as Extract<ProgramElement, { kind: "withdraw" }>;
    const amount = amountFor(e, w.token);
    if (amount) push(e, [{ verb: "withdraw", token: w.token, amount, ...(w.venue ? { venue: w.venue } : {}) }], `${quoteOf(e)} → ${lineOf(e.id)?.basis ?? "as stated"}; withdrawals home carry no Lykia fee.`);
  }
  for (const e of nowEls.filter((x) => x.kind === "convert")) {
    const c = e as Extract<ProgramElement, { kind: "convert" }>;
    const amount = amountFor(e, c.from);
    if (!amount) continue;
    const isFx = (c.from === "USDC" && c.to === "EURC") || (c.from === "EURC" && c.to === "USDC");
    const list: PlanAction[] = [isFx ? { verb: "fx", from: c.from, to: c.to, amount } : { verb: "swap", from: c.from, to: c.to, amount }];
    // "convert, then deposit what the conversion produced"
    const follower = nowEls.find((x) => x.kind === "earn" && x.token === c.to && !consumed.has(x.id) && ["rest", "all", "unspecified"].includes(x.quantity.type));
    let note = "";
    if (follower && follower.kind === "earn") {
      consumed.add(follower.id);
      list.push({ verb: "earn", token: c.to, amount: { previous: true }, maxRisk: risk, ...(follower.venue ? { venue: follower.venue } : {}) });
      note = ` Then ${quoteOf(follower)}: exactly what the conversion produced is deposited.`;
    }
    push(e, list, `${quoteOf(e)} → ${lineOf(e.id)?.basis ?? "as stated"}${c.purpose === "hedge" ? "; EURC tracks the euro, so this part holds its value if the dollar weakens" : ""}.${note}`);
  }
  for (const e of nowEls.filter((x) => x.kind === "pay")) {
    const p = e as Extract<ProgramElement, { kind: "pay" }>;
    const to = recipients.get(e.id) ?? [];
    if (to.length === 0) continue;
    const amount = amountFor(e, p.token);
    if (!amount) continue;
    push(e, to.map((address, i) => ({ verb: "send" as const, token: p.token, amount: p.recipients[i]?.amount ? { exact: p.recipients[i]!.amount! } : amount, to: address as `0x${string}`, ...(p.memo ? { memo: p.memo } : {}) })), `${quoteOf(e)} → ${to.length} transfer${to.length === 1 ? "" : "s"} with an Arc Memo; Lykia's fee is paid on top of a payment.`);
  }
  for (const e of nowEls.filter((x): x is Extract<ProgramElement, { kind: "action" }> => x.kind === "action")) {
    const a = e.action;
    if (a.verb === "borrow" && program.preferences.leverage === false) continue;
    push(e, [a], `${quoteOf(e)} → planned as asked; the Fence checks it like any step.`);
  }
  for (const e of nowEls.filter((x) => x.kind === "bridge" || x.kind === "unify" || x.kind === "repay")) {
    const amount = amountFor(e, spendToken(e) ?? "USDC");
    if (!amount) continue;
    if (e.kind === "bridge") push(e, [{ verb: "bridge", token: "USDC", amount, destination: e.destination, ...(e.recipient ? { recipient: e.recipient } : {}) }], `${quoteOf(e)} → CCTP V2 burns on Arc and Circle mints native USDC on ${e.destination}.`);
    else if (e.kind === "unify") push(e, [{ verb: "unify", amount }], `${quoteOf(e)} → a Circle Gateway deposit: one USDC balance spendable on every Gateway chain.`);
    else if (e.kind === "repay") push(e, [{ verb: "repay", token: e.token, amount }], `${quoteOf(e)} → repaying debt is homeward and carries no Lykia fee.`);
  }
  for (const e of nowEls.filter((x) => x.kind === "earn" && !consumed.has(x.id))) {
    const r = e as Extract<ProgramElement, { kind: "earn" }>;
    const amount = amountFor(e, r.token);
    if (!amount) continue;
    const policy = resolution.venuePolicy;
    push(e, [{ verb: "earn", token: r.token, amount, maxRisk: risk, ...(r.venue ? { venue: r.venue } : {}) }], `${quoteOf(e)} → ${lineOf(e.id)?.basis ?? "as stated"}; venues allowed: ${policy.allow.join(", ") || "none"} (risk ≤ ${policy.maxRisk}${policy.liquidityHours !== null ? `, withdrawable within ${policy.liquidityHours} h` : ""}).`);
  }

  /* Later: drafts. */
  const scheduled: ScheduledDraft[] = [];
  for (const e of elements) {
    const when = (e as { when?: When }).when;
    const sched = schedules.get(e.id);
    const firstRun = when?.type === "schedule" ? firstRunDate({ ...when, ...(sched?.day ? { day: sched.day } : {}), ...(sched?.weekday ? { weekday: sched.weekday } : {}) }, internal.now, sched?.timezone ?? "UTC") : null;
    if (e.kind === "dca") {
      const executions = e.executions ?? 12;
      scheduled.push({ kind: "order", elementId: e.id, summary: `DCA: ${e.amount} ${e.sell} into ${e.buy} every ${PERIOD_WORD[e.every]}, ${executions} times`, rationale: `${quoteOf(e)} → a LykiaOrders DCA order: funds stay in your wallet behind an allowance and a keeper executes each slice${e.executions ? "" : " (12 executions unless you say otherwise)"}${e.every === "month" ? "; a month is 30 days on LykiaOrders" : ""}.`, order: { kind: "dca", sell: e.sell, buy: e.buy, amount: e.amount, executions, intervalSeconds: PERIOD_SECONDS[e.every] } });
      continue;
    }
    if (e.kind === "sweep") {
      const actionsLater: PlanAction[] = [{ verb: "reserve", token: e.token, amount: { exact: e.keep } }, { verb: "earn", token: e.token, amount: { all: true }, ...(risk === "low" ? { maxRisk: "low" as const } : {}) }];
      const trigger = automationTrigger(e.when, sched);
      if (!trigger) continue;
      const sentence = sentenceOf(actionsLater, risk);
      scheduled.push({ kind: "automation", elementId: e.id, summary: `Sweep ${e.token} above ${e.keep} ${whenWords(e.when, sched)}`, rationale: `${quoteOf(e)} → an automation that plans "${sentence}" ${whenWords(e.when, sched)}; each run is a proposal the Fence checks and you sign.`, draft: { name: `Sweep ${e.token} above ${e.keep}`.slice(0, 120), trigger, action: { type: "plan", sentence } }, actions: actionsLater, firstRun });
      continue;
    }
    if (e.kind === "alert") {
      const w2 = e.when;
      let draft: AlertDraft | null = null;
      if (w2.type === "price" && FEED_TOKEN[w2.feed] && (FEED_TOKEN[w2.feed] === "EURC" || FEED_TOKEN[w2.feed] === "cirBTC")) draft = { kind: w2.op === "above" ? "price-above" : "price-below", token: FEED_TOKEN[w2.feed]!, threshold: w2.value };
      else if (w2.type === "health") draft = { kind: "health-below", threshold: w2.below };
      if (draft) scheduled.push({ kind: "alert", elementId: e.id, summary: `Alert ${whenWords(w2)}`, rationale: `${quoteOf(e)} → an alert in your inbox; alerts never move money.`, draft });
      else {
        const trigger = automationTrigger(w2, sched);
        if (trigger) scheduled.push({ kind: "automation", elementId: e.id, summary: `Notify ${whenWords(w2)}`, rationale: `${quoteOf(e)} → an automation that notifies your webhooks; it moves no money.`, draft: { name: `Notify ${whenWords(w2)}`.slice(0, 120), trigger, action: { type: "notify", channel: "webhook" } }, actions: [], firstRun: null });
      }
      continue;
    }
    if (e.kind === "budget" && e.perDayUsd !== undefined && (e.days !== undefined || e.leash !== undefined)) {
      // A daily budget with a duration or a purpose: a leash the owner sets up in the Fold and signs once.
      const template = e.leash ?? "pay-invoices";
      const days = e.days ?? 7;
      const label = e.agent ? `${e.agent.charAt(0).toUpperCase()}${e.agent.slice(1)}` : template === "pay-invoices" ? "Invoice bot" : template === "trade-small" ? "Trading bot" : "Yield bot";
      const draft: LeashDraft = { name: label.slice(0, 48), template, perDayUsd: e.perDayUsd, days };
      const titles = { "pay-invoices": "pay invoices", "trade-small": "trade small", earn: "earn" } as const;
      const notes = [e.days === undefined ? "No duration was named, so it runs for 7 days; change it in the sheet." : "", template === "pay-invoices" ? "Name the payees in the sheet: this leash pays known recipients only." : ""].filter(Boolean).join(" ");
      scheduled.push({ kind: "leash", elementId: e.id, summary: `Leash for ${draft.name}: $${e.perDayUsd} a day for ${days} day${days === 1 ? "" : "s"}, to ${titles[template]}`, rationale: `${quoteOf(e)} → a leash: a Pack agent with its own Fence and budget, an on-chain session on your LykiaAccount you sign once, and a key that works for that leash only.${notes ? ` ${notes}` : ""}`, draft });
      continue;
    }
    if (e.kind === "budget") {
      scheduled.push({ kind: "budget", elementId: e.id, summary: `Budget${e.agent ? ` for ${e.agent}` : ""}: ${[e.perDayUsd ? `$${e.perDayUsd}/day` : "", e.perWeekUsd ? `$${e.perWeekUsd}/week` : ""].filter(Boolean).join(", ")}`, rationale: `${quoteOf(e)} → a Fence for that agent with these caps. Lykia never changes a Fence on its own: you sign it on the Pack page.`, suggestion: { agent: e.agent ?? null, perDayUsd: e.perDayUsd ?? null, perWeekUsd: e.perWeekUsd ?? null } });
      continue;
    }
    if (!when || when.type === "now") continue;
    // Conditional conversions of a priced token: LykiaOrders.
    if (e.kind === "convert" && when.type === "price" && (FEED_TOKEN[when.feed] === e.from || FEED_TOKEN[when.feed] === e.to)) {
      const u = amounts.get(e.id);
      if (u === undefined || u === 0n) continue;
      const selling = e.from !== "USDC";
      const kind: OrderKind = e.purpose === "take-profit" || (selling && when.op === "above") ? "take-profit" : e.purpose === "stop-loss" || (selling && when.op === "below") ? "stop-loss" : "limit";
      const amount = whole(u, e.from, decimalsOf(e.from));
      scheduled.push({ kind: "order", elementId: e.id, summary: `${kind}: sell ${amount} ${e.from} for ${e.to} ${whenWords(when)}`, rationale: `${quoteOf(e)} → a LykiaOrders ${kind} order with a Chainlink trigger: nothing moves until ${when.feed} is ${when.op} ${when.value}, and the output must meet the signed minimum.`, order: { kind, sell: e.from, buy: e.to, amount, triggerPrice: when.value, triggerAbove: when.op === "above" } });
      continue;
    }
    // Everything else becomes plan actions re-planned at each fire.
    const later: PlanAction[] = [];
    const token = spendToken(e) ?? "USDC";
    const q = quantityOf(e);
    const a: ActionAmount | null = amounts.has(e.id) ? exactOf(amounts.get(e.id)!, token) : q?.type === "exact" ? { exact: q.amount } : q?.type === "share" ? { percent: Math.max(1, Math.min(100, Math.round(q.bps / 100))) } : q?.type === "all" || q?.type === "rest" ? { all: true } : null;
    if (!a) continue;
    if (e.kind === "pay") {
      for (const [i, address] of (recipients.get(e.id) ?? []).entries()) later.push({ verb: "send", token: e.token, amount: e.recipients[i]?.amount ? { exact: e.recipients[i]!.amount! } : a, to: address as `0x${string}`, ...(e.memo ? { memo: e.memo } : {}) });
    } else if (e.kind === "earn") later.push({ verb: "earn", token: e.token, amount: a, ...(risk === "low" ? { maxRisk: "low" as const } : {}) });
    else if (e.kind === "convert") later.push((e.from === "USDC" && e.to === "EURC") || (e.from === "EURC" && e.to === "USDC") ? { verb: "fx", from: e.from, to: e.to, amount: a } : { verb: "swap", from: e.from, to: e.to, amount: a });
    else if (e.kind === "bridge") later.push({ verb: "bridge", token: "USDC", amount: a, destination: e.destination, ...(e.recipient ? { recipient: e.recipient } : {}) });
    else if (e.kind === "repay") later.push({ verb: "repay", token: e.token, amount: a });
    if (later.length === 0) continue;
    if (when.type === "health") {
      scheduled.push({ kind: "standing", elementId: e.id, summary: `${describeElement(e)} ${whenWords(when)}`, rationale: `${quoteOf(e)} → a standing order on the health factor: when it fires Lykia plans the move and you sign it; an unreadable health factor never fires it.`, draft: { trigger: { kind: "health", below: when.below }, actions: later, text: e.quote || describeElement(e), maxFires: 1 } });
      continue;
    }
    const trigger = automationTrigger(when, sched);
    if (!trigger) continue;
    const sentence = sentenceOf(later, risk);
    scheduled.push({
      kind: "automation",
      elementId: e.id,
      summary: `${describeElement(e)} ${whenWords(when, sched)}`,
      rationale: `${quoteOf(e)} → an automation that plans "${sentence}" ${whenWords(when, sched)}${firstRun ? `, first on ${firstRun}` : ""}. Each run is a proposal the Fence checks and you sign; Lykia's fee is paid on top of each payment.`,
      draft: { name: (e.kind === "pay" ? `Pay ${e.recipients.length} recipient${e.recipients.length === 1 ? "" : "s"} ${e.memo ? `(${e.memo}) ` : ""}` : `${describeElement(e)} `).concat(when.type === "schedule" ? `every ${PERIOD_WORD[when.every]}` : "on trigger").slice(0, 120), trigger, action: { type: "plan", sentence } },
      actions: later,
      firstRun,
    });
  }

  const why = explain(program, resolution, actions, scheduled);
  const questions = resolution.questions;
  const status: CompiledProgram["status"] = resolution.status === "refused" ? "refused" : questions.length > 0 || (actions.length === 0 && scheduled.length === 0) ? (resolution.refusals.length > 0 && actions.length === 0 && scheduled.length === 0 && questions.length === 0 ? "refused" : "needs-input") : "ready";
  const clean = resolution;
  return {
    schema: COMPILED_SCHEMA,
    status,
    program,
    programHash: resolution.programHash,
    resolution: clean,
    resolutionHash: canonicalDigest(clean),
    // A plan that only keeps money liquid moves nothing; and while a missing fact (an amount, a recipient,
    // a short balance) is open, "the rest" is unknowable, so nothing is planned for now.
    now: actions.some((a) => a.verb !== "reserve") && !questions.some((q) => /^(?:reader|amount|recipient|short):/u.test(q.id)) ? { actions, parts } : null,
    scheduled,
    why,
    questions,
  };
}

function explain(program: Program, r: Resolution, actions: readonly PlanAction[], scheduled: readonly ScheduledDraft[]): Why {
  const tradeoffs: string[] = [];
  const rejected: { option: string; reason: string }[] = [];
  const policy = r.venuePolicy;
  const earns = actions.some((a) => a.verb === "earn");
  if (earns && policy.maxRisk === "low") tradeoffs.push(`Lower yield for lower risk: only the low-risk tier is used (${policy.allow.join(", ")}; Morpho vaults count as low only with at least $10M deposited, decided live). No venue is risk-free.`);
  if (earns && policy.liquidityHours !== null) tradeoffs.push(`Withdrawals: the allowed venues return funds in the same transaction while their markets have idle liquidity; a fully borrowed market can delay a withdrawal until borrowers repay.`);
  if (actions.some((a) => (a.verb === "fx" || a.verb === "swap") && a.to === "EURC")) tradeoffs.push("The EURC share follows EUR/USD: it gains in dollars if the dollar weakens and loses if the euro weakens.");
  const kept = r.kept.reduce((s, k) => s + Number(k.amount), 0);
  if (kept > 0) tradeoffs.push(`${r.kept.map((k) => `${k.amount} ${k.token}`).join(" and ")} stays liquid and earns nothing, so payments never wait on a withdrawal.`);
  if (r.fees.lines.length > 0) tradeoffs.push(`Lykia's ${r.fees.bps / 100}% fee on this plan: about ${r.fees.totalUsd !== null ? `$${r.fees.totalUsd}` : r.fees.lines.map((f) => `${f.amount} ${f.token}`).join(" + ")}${scheduled.some((s) => s.kind === "automation") ? ", plus the same rate on each scheduled payment or deposit" : ""}.`);
  for (const x of policy.excluded) rejected.push({ option: x.venue, reason: x.reason });
  if (program.preferences.leverage === false || policy.maxRisk === "low") rejected.push({ option: "Borrowing against collateral for more yield", reason: program.preferences.leverage === false ? "You ruled out leverage." : "Leverage is not defensive." });
  if (actions.some((a) => a.verb === "fx" && a.to === "EURC") && !actions.some((a) => a.verb === "earn" && a.token === "EURC")) rejected.push({ option: "Depositing the EURC into a vault", reason: "You asked for a hedge, not more yield on it; say \"and put the euros to work\" to add it." });
  if (r.blockers.some((b) => /beta cap/u.test(b.text))) rejected.push({ option: "Splitting a step to fit the beta cap", reason: "Lykia never works around a cap; it plans less or waits." });
  for (const x of r.refusals) rejected.push({ option: "Requested but not done", reason: x.text });
  const deferred = scheduled.map((s) => `${s.summary}${s.kind === "automation" && s.firstRun ? ` (first ${s.firstRun})` : ""}`);
  const nowCount = actions.filter((a) => a.verb !== "reserve").length;
  const summary =
    r.status === "refused"
      ? "Nothing to plan: every part of the request is something Lykia will not do."
      : `${nowCount > 0 ? `${nowCount} move${nowCount === 1 ? "" : "s"} now in one plan` : "Nothing to move now"}${scheduled.length > 0 ? `, ${scheduled.length} part${scheduled.length === 1 ? "" : "s"} for later` : ""}${r.assumptions.length > 0 ? `, ${r.assumptions.length} assumption${r.assumptions.length === 1 ? "" : "s"} you can change` : ""}${r.questions.length > 0 ? `, ${r.questions.length} question${r.questions.length === 1 ? "" : "s"} first` : ""}.`;
  return { summary, assumptions: r.assumptions, tradeoffs, rejected, deferred };
}
