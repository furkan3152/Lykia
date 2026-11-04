/**
 * Lykia Program v1 (`lykia.program/v1`): the typed intermediate
 * representation of what the owner wants, between their words and the
 * artifacts Lykia executes.
 *
 * A sentence such as "keep three months of 400 USDC payroll liquid, put the
 * rest to work somewhere safe, move about a third into euros and pay my two
 * contractors 50 USDC each on the first of every month" is a program: a
 * reserve, two allocations (a share and the remainder), a recurring payment
 * and a few preferences (risk, liquidity). The intent compiler
 * (programCompile.ts) resolves it against the owner's live state and
 * compiles it into one signable plan for now plus drafts (automations,
 * orders, alerts) for what happens later.
 *
 * The program is data only: no amounts are resolved here, nothing is read
 * from the chain, and nothing is signed. It is validated like a Fence and
 * hashed (`programHash`) so the plan's Fence verdict can pin it.
 *
 * Pure: types, validation and hashing, no I/O.
 */
import { validateActions, type PlanAction } from "./actions.js";
import { isDecimalAmount } from "./amounts.js";
import { findToken } from "./assets.js";
import { canonicalDigest, type Sha256Digest } from "./canonical.js";
import { isAddress } from "./contracts.js";
import { isSupportedTimeZone, RATIO_PATTERN, timeMinutes, WEEKDAYS, type Weekday } from "./fence.js";
import { findCctpDestination } from "./networks.js";
import { RISK_ORDER, type RiskTier } from "./routes.js";
import { PRICE_FEEDS, type PriceFeed } from "./standing.js";

export const PROGRAM_SCHEMA = "lykia.program/v1" as const;

export const PROGRAM_LIMITS = Object.freeze({ text: 1000, elements: 16, recipients: 20, quote: 240, goals: 8, goal: 160, note: 300, questions: 6 });

export type Period = "day" | "week" | "month";
export const PERIODS: readonly Period[] = ["day", "week", "month"];

/**
 * How much, in the element's token, as the owner said it.
 * - exact: a decimal amount ("400 USDC");
 * - share: basis points of what is available after reserves ("a third" = 3333, of: "available")
 *   or of the whole liquid balance ("10% of everything", of: "total"); approx marks "about";
 * - rest: whatever is left after reserves, shares and exact amounts ("the rest");
 * - all: the whole liquid balance (minus the gas buffer);
 * - runway: perPeriod x periods ("3 months of 400 USDC payroll" = 1200);
 * - unspecified: the owner gave no amount; the resolver proposes a default or asks.
 */
export type Quantity =
  | { readonly type: "exact"; readonly amount: string }
  | { readonly type: "share"; readonly bps: number; readonly of: "available" | "total"; readonly approx?: boolean }
  | { readonly type: "rest" }
  | { readonly type: "all" }
  | { readonly type: "runway"; readonly perPeriod: string; readonly periods: number; readonly period: Period }
  | { readonly type: "unspecified" };

/** When an element happens. Absent = now. */
export type When =
  | { readonly type: "now" }
  | { readonly type: "schedule"; readonly every: Period; readonly weekday?: Weekday; readonly day?: number; readonly at?: string; readonly timezone?: string; readonly count?: number }
  | { readonly type: "price"; readonly feed: PriceFeed; readonly op: "above" | "below"; readonly value: string }
  | { readonly type: "balance"; readonly token: string; readonly op: "above" | "below"; readonly value: string }
  | { readonly type: "health"; readonly below: string };

export interface Recipient {
  readonly address?: string;
  /** A contact name the owner used ("Ada"); resolved from memory, never guessed. */
  readonly name?: string;
  /** Per-recipient amount when it differs from the element's quantity. */
  readonly amount?: string;
}

export const REFUSAL_CODES = ["injection", "fence-change", "unknown-venue", "unknown-token", "unsupported", "impossible", "unsafe"] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

interface Base {
  /** Unique within the program: e1, e2, ... */
  readonly id: string;
  /** The owner's words this element came from (for the rationale). */
  readonly quote: string;
  /** Set when the element (or its amount) is a default the owner did not state: the reason, shown as an assumption. */
  readonly assumed?: string;
}

export type ProgramElement =
  | (Base & { readonly kind: "reserve"; readonly token: string; readonly quantity: Quantity; readonly purpose?: string })
  | (Base & { readonly kind: "earn"; readonly token: string; readonly quantity: Quantity; readonly venue?: string; readonly when?: When })
  | (Base & { readonly kind: "convert"; readonly from: string; readonly to: string; readonly quantity: Quantity; readonly purpose?: "hedge" | "trade" | "take-profit" | "stop-loss"; readonly when?: When })
  | (Base & { readonly kind: "pay"; readonly token: string; readonly quantity: Quantity; readonly recipients: readonly Recipient[]; readonly memo?: string; readonly when?: When })
  | (Base & { readonly kind: "bridge"; readonly quantity: Quantity; readonly destination: string; readonly recipient?: string; readonly when?: When })
  | (Base & { readonly kind: "unify"; readonly quantity: Quantity })
  | (Base & { readonly kind: "withdraw"; readonly token: string; readonly quantity: Quantity; readonly venue?: string })
  | (Base & { readonly kind: "repay"; readonly token: string; readonly quantity: Quantity; readonly when?: When })
  /** Keep `keep` liquid and put everything above it to work, on a schedule or when the balance rises above `keep`. */
  | (Base & { readonly kind: "sweep"; readonly token: string; readonly keep: string; readonly when: When })
  /** Dollar-cost averaging on LykiaOrders: `amount` of `sell` per execution. */
  | (Base & { readonly kind: "dca"; readonly sell: string; readonly buy: string; readonly amount: string; readonly every: Period; readonly executions?: number })
  /** Tell the owner; moves no money. */
  | (Base & { readonly kind: "alert"; readonly when: When })
  /** A spending budget for an agent: a Fence suggestion the owner signs, never applied by the compiler. */
  | (Base & { readonly kind: "budget"; readonly agent?: string; readonly perDayUsd?: string; readonly perWeekUsd?: string; readonly purpose?: string })
  /** A plain plan action the program has no richer element for (borrow, supply, rebalance), validated like any action. */
  | (Base & { readonly kind: "action"; readonly action: PlanAction; readonly when?: When })
  /** Something Lykia will not do, with the reason (an override attempt, an unknown venue, an impossible promise). */
  | (Base & { readonly kind: "refuse"; readonly code: RefusalCode; readonly detail: string });

export type ElementKind = ProgramElement["kind"];
export const ELEMENT_KINDS: readonly ElementKind[] = ["reserve", "earn", "convert", "pay", "bridge", "unify", "withdraw", "repay", "sweep", "dca", "alert", "budget", "action", "refuse"];

export interface ProgramPreferences {
  /** Highest venue risk tier the owner accepts ("safe", "defensive" = low). */
  readonly risk?: RiskTier;
  /** Funds must come back within this many hours ("out within a day" = 24). */
  readonly liquidityHours?: number;
  /** false: no borrowing ("no leverage", "nothing risky"). */
  readonly leverage?: boolean;
  /** Protect against a weaker dollar: hold part in euros. */
  readonly hedge?: { readonly currency: "EUR" };
  readonly venues?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
  readonly maxSlippageBps?: number;
  /** IANA zone for schedules when the owner named one. */
  readonly timezone?: string;
}

export interface ProgramConflict {
  readonly between: readonly [string, string];
  /** How the compiler reads it (the safer side), stated as an assumption the owner can change. */
  readonly resolution: string;
}

export interface Program {
  readonly schema: typeof PROGRAM_SCHEMA;
  /** The owner's words (trimmed). */
  readonly text: string;
  /** ISO 639-1 language the owner wrote in, when known. */
  readonly language: string | null;
  /** The owner's goals in a few words each, in English. */
  readonly goals: readonly string[];
  readonly elements: readonly ProgramElement[];
  readonly preferences: ProgramPreferences;
  readonly conflicts: readonly ProgramConflict[];
  /** Hard facts the reader could not find and will not guess (a recipient address, a schedule it cannot express). */
  readonly questions: readonly string[];
  /** The text tried to override Lykia's rules: outside payments in it are not planned. */
  readonly untrusted?: boolean;
}

export interface ProgramIssue {
  readonly path: string;
  readonly message: string;
}

export type ProgramValidation = { readonly ok: true; readonly program: Program } | { readonly ok: false; readonly issues: readonly ProgramIssue[] };

const record = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const positiveDecimal = (v: unknown): v is string => isDecimalAmount(v) && !/^0(?:\.0+)?$/u.test(v);
const ID = /^[a-z][a-z0-9_-]{0,15}$/u;
const VENUE = /^[a-z0-9:-]{2,64}$/u;

function quantityIssues(q: unknown, path: string, add: (path: string, message: string) => void): void {
  const v = record(q);
  if (!v) return add(path, "A quantity is an object with a type.");
  switch (v.type) {
    case "exact":
      if (!positiveDecimal(v.amount)) add(`${path}.amount`, "A positive decimal string, e.g. \"400\".");
      return;
    case "share":
      if (!Number.isInteger(v.bps) || (v.bps as number) < 1 || (v.bps as number) > 10_000) add(`${path}.bps`, "Basis points from 1 to 10000.");
      if (v.of !== "available" && v.of !== "total") add(`${path}.of`, "available or total.");
      if (v.approx !== undefined && typeof v.approx !== "boolean") add(`${path}.approx`, "A boolean.");
      return;
    case "rest":
    case "all":
    case "unspecified":
      return;
    case "runway":
      if (!positiveDecimal(v.perPeriod)) add(`${path}.perPeriod`, "A positive decimal string.");
      if (!Number.isInteger(v.periods) || (v.periods as number) < 1 || (v.periods as number) > 120) add(`${path}.periods`, "A whole number from 1 to 120.");
      if (!PERIODS.includes(v.period as Period)) add(`${path}.period`, "day, week or month.");
      return;
    default:
      add(`${path}.type`, "exact, share, rest, all, runway or unspecified.");
  }
}

function whenIssues(w: unknown, path: string, add: (path: string, message: string) => void): void {
  const v = record(w);
  if (!v) return add(path, "when is an object with a type.");
  switch (v.type) {
    case "now":
      return;
    case "schedule":
      if (!PERIODS.includes(v.every as Period)) add(`${path}.every`, "day, week or month.");
      if (v.weekday !== undefined && !WEEKDAYS.includes(v.weekday as Weekday)) add(`${path}.weekday`, "mon..sun.");
      if (v.day !== undefined && !(Number.isInteger(v.day) && (v.day as number) >= 1 && (v.day as number) <= 31)) add(`${path}.day`, "A day of the month from 1 to 31.");
      if (v.at !== undefined && (typeof v.at !== "string" || timeMinutes(v.at) === null)) add(`${path}.at`, "HH:MM, 24-hour.");
      if (v.timezone !== undefined && !isSupportedTimeZone(v.timezone)) add(`${path}.timezone`, "An IANA time zone.");
      if (v.count !== undefined && !(Number.isInteger(v.count) && (v.count as number) >= 1 && (v.count as number) <= 1000)) add(`${path}.count`, "A whole number from 1 to 1000.");
      return;
    case "price":
      if (!PRICE_FEEDS.includes(v.feed as PriceFeed)) add(`${path}.feed`, `One of ${PRICE_FEEDS.join(", ")}.`);
      if (v.op !== "above" && v.op !== "below") add(`${path}.op`, "above or below.");
      if (!positiveDecimal(v.value)) add(`${path}.value`, "A positive price.");
      return;
    case "balance":
      if (typeof v.token !== "string" || !findToken("mainnet", v.token)) add(`${path}.token`, "A registry token.");
      if (v.op !== "above" && v.op !== "below") add(`${path}.op`, "above or below.");
      if (!isDecimalAmount(v.value)) add(`${path}.value`, "A decimal amount.");
      return;
    case "health":
      if (typeof v.below !== "string" || !RATIO_PATTERN.test(v.below) || Number(v.below) < 1) add(`${path}.below`, 'A health factor of at least "1.0".');
      return;
    default:
      add(`${path}.type`, "now, schedule, price, balance or health.");
  }
}

function tokenIssue(value: unknown, path: string, add: (path: string, message: string) => void): void {
  if (typeof value !== "string" || !findToken("mainnet", value)) add(path, "A registry token symbol (see GET /v1/tokens).");
}

/** Checks a program; unknown fields are refused so a model cannot smuggle extra instructions. */
export function validateProgram(input: unknown): ProgramValidation {
  const issues: ProgramIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const p = record(input);
  if (!p) return { ok: false, issues: [{ path: "", message: "A program is an object." }] };
  const allowedTop = new Set(["schema", "text", "language", "goals", "elements", "preferences", "conflicts", "questions", "untrusted"]);
  for (const key of Object.keys(p)) if (!allowedTop.has(key)) add(key, "Unknown field.");
  if (p.schema !== PROGRAM_SCHEMA) add("schema", `Must be "${PROGRAM_SCHEMA}".`);
  if (typeof p.text !== "string" || p.text.trim().length === 0 || p.text.length > PROGRAM_LIMITS.text) add("text", `The owner's words, 1 to ${PROGRAM_LIMITS.text} characters.`);
  if (p.language !== null && p.language !== undefined && (typeof p.language !== "string" || !/^[a-z]{2}$/u.test(p.language))) add("language", "ISO 639-1 code or null.");
  if (!Array.isArray(p.goals) || p.goals.length > PROGRAM_LIMITS.goals || !p.goals.every((g) => typeof g === "string" && g.length > 0 && g.length <= PROGRAM_LIMITS.goal)) add("goals", `Up to ${PROGRAM_LIMITS.goals} short strings.`);
  if (!Array.isArray(p.questions) || p.questions.length > PROGRAM_LIMITS.questions || !p.questions.every((q) => typeof q === "string" && q.length > 0 && q.length <= PROGRAM_LIMITS.note)) add("questions", `Up to ${PROGRAM_LIMITS.questions} short strings.`);
  if (p.untrusted !== undefined && typeof p.untrusted !== "boolean") add("untrusted", "A boolean.");

  const prefs = record(p.preferences);
  if (!prefs) add("preferences", "An object (may be empty).");
  else {
    for (const key of Object.keys(prefs)) if (!["risk", "liquidityHours", "leverage", "hedge", "venues", "maxSlippageBps", "timezone"].includes(key)) add(`preferences.${key}`, "Unknown field.");
    if (prefs.risk !== undefined && !RISK_ORDER.includes(prefs.risk as RiskTier)) add("preferences.risk", "low, medium or high.");
    if (prefs.liquidityHours !== undefined && !(typeof prefs.liquidityHours === "number" && prefs.liquidityHours > 0 && prefs.liquidityHours <= 24 * 365)) add("preferences.liquidityHours", "Hours, more than 0.");
    if (prefs.leverage !== undefined && typeof prefs.leverage !== "boolean") add("preferences.leverage", "A boolean.");
    if (prefs.hedge !== undefined && record(prefs.hedge)?.currency !== "EUR") add("preferences.hedge", '{ currency: "EUR" }.');
    if (prefs.maxSlippageBps !== undefined && !(Number.isInteger(prefs.maxSlippageBps) && (prefs.maxSlippageBps as number) >= 0 && (prefs.maxSlippageBps as number) <= 1000)) add("preferences.maxSlippageBps", "0 to 1000.");
    if (prefs.timezone !== undefined && !isSupportedTimeZone(prefs.timezone)) add("preferences.timezone", "An IANA time zone.");
    if (prefs.venues !== undefined) {
      const v = record(prefs.venues);
      const list = (x: unknown) => x === undefined || (Array.isArray(x) && x.length <= 24 && x.every((s) => typeof s === "string" && VENUE.test(s)));
      if (!v || !list(v.allow) || !list(v.deny)) add("preferences.venues", "{ allow?: venue ids, deny?: venue ids }.");
    }
  }

  if (!Array.isArray(p.conflicts) || p.conflicts.length > 6) add("conflicts", "Up to 6 conflicts.");
  else
    p.conflicts.forEach((c, i) => {
      const v = record(c);
      if (!v || !Array.isArray(v.between) || v.between.length !== 2 || !v.between.every((s) => typeof s === "string" && s.length <= PROGRAM_LIMITS.quote) || typeof v.resolution !== "string" || v.resolution.length > PROGRAM_LIMITS.note) add(`conflicts.${i}`, "{ between: [a, b], resolution }.");
    });

  if (!Array.isArray(p.elements) || p.elements.length > PROGRAM_LIMITS.elements) add("elements", `Up to ${PROGRAM_LIMITS.elements} elements.`);
  else {
    const ids = new Set<string>();
    p.elements.forEach((raw, i) => {
      const path = `elements.${i}`;
      const e = record(raw);
      if (!e) return add(path, "An element is an object.");
      if (typeof e.id !== "string" || !ID.test(e.id)) add(`${path}.id`, "A short id such as e1.");
      else if (ids.has(e.id)) add(`${path}.id`, "Duplicate id.");
      else ids.add(e.id);
      if (typeof e.quote !== "string" || e.quote.length > PROGRAM_LIMITS.quote) add(`${path}.quote`, `The owner's words, at most ${PROGRAM_LIMITS.quote} characters.`);
      if (e.assumed !== undefined && (typeof e.assumed !== "string" || e.assumed.length === 0 || e.assumed.length > PROGRAM_LIMITS.note)) add(`${path}.assumed`, "A short reason.");
      const when = () => {
        if (e.when !== undefined) whenIssues(e.when, `${path}.when`, add);
      };
      switch (e.kind) {
        case "reserve":
          tokenIssue(e.token, `${path}.token`, add);
          quantityIssues(e.quantity, `${path}.quantity`, add);
          if (record(e.quantity)?.type === "rest") add(`${path}.quantity`, "A reserve is an exact amount, a runway or a share.");
          break;
        case "earn":
        case "withdraw":
          tokenIssue(e.token, `${path}.token`, add);
          quantityIssues(e.quantity, `${path}.quantity`, add);
          if (e.venue !== undefined && (typeof e.venue !== "string" || !VENUE.test(e.venue))) add(`${path}.venue`, "A venue id.");
          when();
          break;
        case "convert":
          tokenIssue(e.from, `${path}.from`, add);
          tokenIssue(e.to, `${path}.to`, add);
          if (e.from === e.to) add(`${path}.to`, "from and to must differ.");
          quantityIssues(e.quantity, `${path}.quantity`, add);
          if (e.purpose !== undefined && !["hedge", "trade", "take-profit", "stop-loss"].includes(e.purpose as string)) add(`${path}.purpose`, "hedge, trade, take-profit or stop-loss.");
          when();
          break;
        case "pay": {
          tokenIssue(e.token, `${path}.token`, add);
          quantityIssues(e.quantity, `${path}.quantity`, add);
          if (!Array.isArray(e.recipients) || e.recipients.length === 0 || e.recipients.length > PROGRAM_LIMITS.recipients) add(`${path}.recipients`, `1 to ${PROGRAM_LIMITS.recipients} recipients.`);
          else
            e.recipients.forEach((r, k) => {
              const v = record(r);
              if (!v || (v.address === undefined && v.name === undefined)) return add(`${path}.recipients.${k}`, "An address or a contact name.");
              if (v.address !== undefined && !isAddress(v.address)) add(`${path}.recipients.${k}.address`, "A full 0x address.");
              if (v.name !== undefined && (typeof v.name !== "string" || v.name.length === 0 || v.name.length > 60)) add(`${path}.recipients.${k}.name`, "A contact name.");
              if (v.amount !== undefined && !positiveDecimal(v.amount)) add(`${path}.recipients.${k}.amount`, "A positive decimal string.");
            });
          if (e.memo !== undefined && (typeof e.memo !== "string" || e.memo.length > 120)) add(`${path}.memo`, "At most 120 characters.");
          when();
          break;
        }
        case "bridge":
          quantityIssues(e.quantity, `${path}.quantity`, add);
          if (typeof e.destination !== "string" || !findCctpDestination(e.destination)) add(`${path}.destination`, "A CCTP chain (base, ethereum, arbitrum, ...).");
          if (e.recipient !== undefined && !isAddress(e.recipient)) add(`${path}.recipient`, "A full 0x address.");
          when();
          break;
        case "unify":
          quantityIssues(e.quantity, `${path}.quantity`, add);
          break;
        case "repay":
          tokenIssue(e.token, `${path}.token`, add);
          quantityIssues(e.quantity, `${path}.quantity`, add);
          when();
          break;
        case "sweep":
          tokenIssue(e.token, `${path}.token`, add);
          if (!isDecimalAmount(e.keep)) add(`${path}.keep`, "A decimal amount to keep liquid.");
          whenIssues(e.when, `${path}.when`, add);
          if (!["schedule", "balance"].includes(record(e.when)?.type as string)) add(`${path}.when`, "A sweep runs on a schedule or when the balance rises.");
          break;
        case "dca":
          tokenIssue(e.sell, `${path}.sell`, add);
          tokenIssue(e.buy, `${path}.buy`, add);
          if (e.sell === e.buy) add(`${path}.buy`, "sell and buy must differ.");
          if (!positiveDecimal(e.amount)) add(`${path}.amount`, "Per-execution amount, a positive decimal string.");
          if (!PERIODS.includes(e.every as Period)) add(`${path}.every`, "day, week or month.");
          if (e.executions !== undefined && !(Number.isInteger(e.executions) && (e.executions as number) >= 2 && (e.executions as number) <= 1000)) add(`${path}.executions`, "2 to 1000.");
          break;
        case "alert":
          whenIssues(e.when, `${path}.when`, add);
          if (!["price", "health", "balance"].includes(record(e.when)?.type as string)) add(`${path}.when`, "An alert watches a price, a health factor or a balance.");
          break;
        case "budget":
          if (e.perDayUsd === undefined && e.perWeekUsd === undefined) add(path, "A budget needs perDayUsd or perWeekUsd.");
          if (e.perDayUsd !== undefined && !positiveDecimal(e.perDayUsd)) add(`${path}.perDayUsd`, "A positive decimal string.");
          if (e.perWeekUsd !== undefined && !positiveDecimal(e.perWeekUsd)) add(`${path}.perWeekUsd`, "A positive decimal string.");
          if (e.agent !== undefined && (typeof e.agent !== "string" || e.agent.length > 60)) add(`${path}.agent`, "A short agent name.");
          break;
        case "action": {
          const problems = validateActions([e.action]);
          for (const issue of problems) add(`${path}.action`, issue.message);
          when();
          break;
        }
        case "refuse":
          if (!REFUSAL_CODES.includes(e.code as RefusalCode)) add(`${path}.code`, `One of ${REFUSAL_CODES.join(", ")}.`);
          if (typeof e.detail !== "string" || e.detail.length === 0 || e.detail.length > PROGRAM_LIMITS.note) add(`${path}.detail`, "A short reason.");
          break;
        default:
          add(`${path}.kind`, `One of ${ELEMENT_KINDS.join(", ")}.`);
      }
    });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, program: input as Program };
}

/** The program's digest: the same program always hashes the same (canonical JSON, sha256). */
export function programHash(program: Program): Sha256Digest {
  return canonicalDigest({ ...program, schema: PROGRAM_SCHEMA });
}

/** An empty program around the owner's words (used before reading and for refusals). */
export function emptyProgram(text: string, language: string | null = null): Program {
  return { schema: PROGRAM_SCHEMA, text: text.trim().slice(0, PROGRAM_LIMITS.text), language, goals: [], elements: [], preferences: {}, conflicts: [], questions: [] };
}

const WORDS_PERIOD: Readonly<Record<Period, string>> = { day: "day", week: "week", month: "month" };

/** One line in plain English for an element, for lists and explanations. */
export function describeElement(e: ProgramElement): string {
  const q = (quantity: Quantity, token: string) => {
    switch (quantity.type) {
      case "exact":
        return `${quantity.amount} ${token}`;
      case "share":
        return `${quantity.approx ? "about " : ""}${(quantity.bps / 100).toFixed(quantity.bps % 100 === 0 ? 0 : 2)}% of ${quantity.of === "total" ? "all" : "the available"} ${token}`;
      case "rest":
        return `the rest of the ${token}`;
      case "all":
        return `all ${token}`;
      case "runway":
        return `${quantity.periods} ${WORDS_PERIOD[quantity.period]}${quantity.periods === 1 ? "" : "s"} of ${quantity.perPeriod} ${token}`;
      case "unspecified":
        return `some ${token}`;
    }
  };
  switch (e.kind) {
    case "reserve":
      return `Keep ${q(e.quantity, e.token)} liquid${e.purpose ? ` for ${e.purpose}` : ""}`;
    case "earn":
      return `Put ${q(e.quantity, e.token)} to work${e.venue ? ` at ${e.venue}` : ""}`;
    case "convert":
      return `Convert ${q(e.quantity, e.from)} to ${e.to}${e.purpose === "hedge" ? " as a hedge" : ""}`;
    case "pay":
      return `Pay ${e.recipients.length} recipient${e.recipients.length === 1 ? "" : "s"} ${q(e.quantity, e.token)}${e.recipients.length > 1 ? " each" : ""}`;
    case "bridge":
      return `Bridge ${q(e.quantity, "USDC")} to ${e.destination}`;
    case "unify":
      return `Move ${q(e.quantity, "USDC")} into the Circle Gateway balance`;
    case "withdraw":
      return `Withdraw ${q(e.quantity, e.token)}${e.venue ? ` from ${e.venue}` : ""}`;
    case "repay":
      return `Repay ${q(e.quantity, e.token)}`;
    case "sweep":
      return `Sweep ${e.token} above ${e.keep} to work`;
    case "dca":
      return `Buy ${e.buy} with ${e.amount} ${e.sell} every ${WORDS_PERIOD[e.every]}`;
    case "alert":
      return "Alert the owner";
    case "budget":
      return `Budget${e.agent ? ` for ${e.agent}` : ""}: ${e.perDayUsd ? `$${e.perDayUsd} a day` : ""}${e.perDayUsd && e.perWeekUsd ? ", " : ""}${e.perWeekUsd ? `$${e.perWeekUsd} a week` : ""}`;
    case "action":
      return `${e.action.verb[0]!.toUpperCase()}${e.action.verb.slice(1)}${"token" in e.action && typeof e.action.token === "string" ? ` ${e.action.token}` : ""}`;
    case "refuse":
      return `Not done: ${e.detail}`;
  }
}
