/**
 * Grounding: every amount, recipient and venue a model puts into a tool call
 * must come from somewhere the owner can check.
 *
 *  1. The owner stated it: this message or an earlier owner turn of the
 *     thread (never an assistant turn, never text carried from the Fold).
 *  2. A tool returned it in this turn: a balance, a search winner, an
 *     insight's draft amount.
 *  3. A documented default computed by code: "my idle USDC" is the wallet's
 *     USDC above the owner's liquidity floor (the Fold's idle-usdc rule).
 *
 * Anything else is not guessed: the tool stops the turn with one short
 * question and options. A venue the owner did not name is dropped, so the
 * deterministic route search picks it (see plan_intent).
 */
import type { Locale } from "@lykia/core";
import { currentLocale } from "../i18n/context.js";
import { numberPattern, readNumber } from "../language/numbers.js";
import { protocolsFor, type Address, type ArcEnvironment, type PlanAction } from "@lykia/core";
import type { AppContext } from "../context.js";
import { getPreferences } from "../fold/preferences.js";
import { services } from "../services.js";

/** What this turn may cite, plus the one question a tool asked instead of guessing. */
export interface Ground {
  /** The owner's own words: this message, then earlier owner turns of the thread (newest first). */
  readonly ownerText: string;
  readonly ownerNumbers: ReadonlySet<string>;
  /** Numbers tools returned this turn, normalised ("1950.00" -> "1950"). */
  readonly toolNumbers: Set<string>;
  /** Addresses tools returned this turn (contacts, positions). */
  readonly toolAddresses: Set<string>;
  /** Set by a tool that needs the owner: the turn ends with this question. */
  question: { readonly question: string; readonly options: readonly string[] } | null;
}

/** How many earlier owner turns count as "stated" (the recent-thread window). */
export const THREAD_WINDOW = 6;

const NUMBERS = new Map<Locale, RegExp>();
/** Numbers written in the owner's or the answer's language ("$1,950.00", "1.950,00", "1 950,00"), with an optional k/m/bn. */
function numberRe(locale: Locale): RegExp {
  let re = NUMBERS.get(locale);
  if (!re) NUMBERS.set(locale, (re = new RegExp(`(?<![\\p{L}\\p{N}_.,])(?:\\$\\s?)?(${numberPattern(locale)})\\s*(k|m|bn)?(?![\\p{L}\\p{N}_])`, "giu")));
  return re;
}

/** "1,950.00" -> "1950"; "1.5k" -> "1500"; "1.950,00" (in a comma-decimal language) -> "1950"; null when it is not a finite number. */
export function normalizeNumber(raw: string, suffix?: string | null, locale: Locale = "en"): string | null {
  const read = readNumber(raw.trim(), locale);
  if (!read) return null;
  const value = read.value * (suffix ? ({ k: 1e3, m: 1e6, bn: 1e9 } as const)[suffix.toLowerCase() as "k" | "m" | "bn"] : 1);
  if (!Number.isFinite(value)) return null;
  return String(Number(value.toPrecision(15)));
}

/** Every number written in a text, normalised. English and the interface language's own way of writing numbers are both read. */
export function numbersIn(text: string, locale: Locale = currentLocale()): Set<string> {
  const out = new Set<string>();
  for (const l of locale === "en" ? (["en"] as const) : (["en", locale] as const)) {
    for (const m of text.matchAll(numberRe(l))) {
      const n = normalizeNumber(m[1]!, m[2] ?? null, l);
      if (n !== null) out.add(n);
    }
  }
  return out;
}

/** The owner's words for this turn: the message, then up to THREAD_WINDOW earlier owner turns. */
export function ownerWords(message: string, history: readonly { readonly role: "user" | "assistant"; readonly text: string }[]): string {
  const earlier = history.filter((h) => h.role === "user").slice(-THREAD_WINDOW).reverse().map((h) => h.text);
  return [message, ...earlier].join("\n");
}

export function newGround(message: string, history: readonly { readonly role: "user" | "assistant"; readonly text: string }[] = []): Ground {
  const ownerText = ownerWords(message, history);
  return { ownerText, ownerNumbers: numbersIn(ownerText), toolNumbers: new Set(), toolAddresses: new Set(), question: null };
}

/** Records every number and address a tool returned, so later calls (and the final text) may cite them. */
export function recordToolData(ground: Ground | undefined, data: unknown): void {
  if (!ground) return;
  const visit = (v: unknown, depth: number): void => {
    if (depth > 12 || v === null || v === undefined) return;
    if (typeof v === "number" && Number.isFinite(v)) {
      ground.toolNumbers.add(String(Number(v.toPrecision(15))));
      return;
    }
    if (typeof v === "bigint") return;
    if (typeof v === "string") {
      if (v.length > 4_000) return;
      for (const a of v.match(/0x[0-9a-fA-F]{40}/gu) ?? []) ground.toolAddresses.add(a.toLowerCase());
      for (const n of numbersIn(v)) ground.toolNumbers.add(n);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 200)) visit(x, depth + 1);
      return;
    }
    if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>).slice(0, 200)) visit(x, depth + 1);
  };
  visit(data, 0);
}

/** A value is grounded when the owner stated it or a tool returned it this turn (same number, any formatting). */
export function grounded(ground: Ground, value: string | number): boolean {
  const n = normalizeNumber(String(value));
  return n !== null && (ground.ownerNumbers.has(n) || ground.toolNumbers.has(n));
}

export function ownerStated(ground: Ground, value: string | number): boolean {
  const n = normalizeNumber(String(value));
  return n !== null && ground.ownerNumbers.has(n);
}

const GENERIC_VENUE_WORDS = new Set(["v2", "v3", "v4", "vault", "vaults", "finance", "protocol", "lykia", "practice", "slipstream", "curation", "financial", "blue", "market", "markets", "main", "spoke"]);

/** The distinctive words of a venue id and its registry name ("morpho-vaults:0x…" -> morpho; "aave-v4" -> aave). */
export function venueWords(environment: ArcEnvironment, venue: string): string[] {
  const id = venue.split(":")[0] ?? venue;
  const named = protocolsFor(environment).find((p) => p.id === id)?.name ?? "";
  const words = `${id} ${named}`.toLowerCase().split(/[^a-z0-9]+/u).filter((w) => w.length >= 4 && !GENERIC_VENUE_WORDS.has(w));
  return [...new Set(words)];
}

/** True when the owner named this venue (or its family) in their own words. */
export function venueNamed(ground: Ground, environment: ArcEnvironment, venue: string): boolean {
  const text = ground.ownerText.toLowerCase();
  const words = venueWords(environment, venue);
  return words.some((w) => new RegExp(`\\b${w}\\b`, "u").test(text));
}

/** "my idle USDC", "everything", "all of it", "the rest": the owner asked for the documented default, not a figure. */
const IDLE_WORDS = /\b(?:idle|sitting|resting|spare|unused|all|everything|the rest|whatever is left)\b/iu;

export function asksForDefault(ground: Ground, token: string): boolean {
  const t = ground.ownerText.toLowerCase();
  return IDLE_WORDS.test(t) && (t.includes(token.toLowerCase()) || /\b(?:cash|money|funds|balance|dollars|stablecoins?)\b/u.test(t));
}

/** The documented default for "idle": the wallet's balance of the token above the owner's liquidity floor (USDC) or the whole balance (other tokens). */
export async function idleAboveFloor(ctx: AppContext, environment: ArcEnvironment, owner: Address, token: string, personal: boolean): Promise<{ amount: string; walletAmount: string; floorUsd: string } | null> {
  const snap = await services(ctx).flock.snapshot(environment, owner).catch(() => null);
  if (!snap) return null;
  const held = snap.holdings.find((h) => h.where === "wallet" && h.kind === "token" && h.symbol.toUpperCase() === token.toUpperCase());
  if (!held) return { amount: "0", walletAmount: "0", floorUsd: "0" };
  const prefs = await getPreferences(ctx, personal ? owner : null).catch(() => null);
  const floor = token.toUpperCase() === "USDC" ? Number(prefs?.liquidityFloorUsd ?? "500") : 0;
  const idle = Math.max(0, Number(held.amount) - floor);
  // Two decimals, rounded down: the default never spends what is not there.
  const amount = String(Math.floor(idle * 100) / 100);
  return { amount, walletAmount: held.amount, floorUsd: String(floor) };
}

/** The tokens and kinds of value an action moves, for the question to ask about it. */
function tokenOf(action: PlanAction): string {
  const a = action as { token?: string; from?: string };
  return a.token ?? a.from ?? "USDC";
}

function exactOf(action: PlanAction): string | null {
  const amount = (action as { amount?: unknown }).amount;
  return typeof amount === "object" && amount !== null && "exact" in amount ? String((amount as { exact: string }).exact) : null;
}

function allOf(action: PlanAction): boolean {
  const amount = (action as { amount?: unknown }).amount;
  return typeof amount === "object" && amount !== null && (amount as { all?: unknown }).all === true;
}

function withAmount(action: PlanAction, exact: string): PlanAction {
  return { ...(action as object), amount: { exact } } as PlanAction;
}

function withoutVenue(action: PlanAction): PlanAction {
  const { venue: _drop, ...rest } = action as PlanAction & { venue?: string };
  return rest as PlanAction;
}

export function amountQuestion(token: string, verb: string): { question: string; options: string[] } {
  const what = verb === "earn" || verb === "supply" ? `How much ${token} should go to work?` : verb === "send" ? `How much ${token} should be sent?` : verb === "bridge" ? `How much ${token} should be bridged?` : `How much ${token} should this use?`;
  return { question: what, options: token === "USDC" ? ["All my idle USDC above the floor", "Half of my idle USDC", "Let me type an amount"] : [`All my ${token}`, `Half of my ${token}`, "Let me type an amount"] };
}

export type GroundedActions =
  | { readonly ok: true; readonly actions: PlanAction[]; readonly notes: readonly string[]; readonly venueFromOwner: boolean }
  | { readonly ok: false; readonly question: string; readonly options: readonly string[]; readonly reason: string };

/**
 * Grounds the actions a model's sentence reads into: amounts, recipients and venues.
 * Defaults are filled by code; an invented value becomes a question.
 */
export async function groundActions(ctx: AppContext, ground: Ground, actions: readonly PlanAction[], at: { readonly environment: ArcEnvironment; readonly owner: Address; readonly personal: boolean }): Promise<GroundedActions> {
  const out: PlanAction[] = [];
  const notes: string[] = [];
  let venueFromOwner = false;
  for (const action of actions) {
    let next = action;
    const token = tokenOf(action);
    const exact = exactOf(action);
    const wantsDefault = asksForDefault(ground, token) && (action.verb === "earn" || action.verb === "supply" || action.verb === "reserve");
    if (exact !== null && !grounded(ground, exact)) {
      if (!wantsDefault) {
        const q = amountQuestion(token, action.verb);
        return { ok: false, ...q, reason: `${exact} ${token} was not stated by the owner and no tool returned it this turn.` };
      }
      const idle = await idleAboveFloor(ctx, at.environment, at.owner, token, at.personal);
      if (!idle || Number(idle.amount) <= 0) return { ok: false, question: idle ? `Nothing sits above your ${idle.floorUsd} USD floor right now. How much ${token} should go to work?` : `I couldn't read your wallet. How much ${token} should go to work?`, options: ["Let me type an amount"], reason: "The idle default could not be computed." };
      ground.toolNumbers.add(normalizeNumber(idle.amount) ?? idle.amount);
      next = withAmount(next, idle.amount);
      notes.push(`Idle ${token}: ${idle.amount} above your floor of ${idle.floorUsd} USD (wallet ${idle.walletAmount}), computed by Lykia.`);
    } else if (allOf(action) && wantsDefault && token.toUpperCase() === "USDC" && action.verb !== "reserve") {
      // "Put my idle USDC to work" keeps the liquidity floor: the default is what sits above it, never the whole wallet.
      const idle = await idleAboveFloor(ctx, at.environment, at.owner, token, at.personal);
      if (idle && Number(idle.amount) > 0) {
        ground.toolNumbers.add(normalizeNumber(idle.amount) ?? idle.amount);
        next = withAmount(next, idle.amount);
        notes.push(`Idle ${token}: ${idle.amount} above your floor of ${idle.floorUsd} USD (wallet ${idle.walletAmount}), computed by Lykia.`);
      } else if (idle) return { ok: false, question: `Nothing sits above your ${idle.floorUsd} USD floor right now. How much ${token} should go to work?`, options: ["Let me type an amount"], reason: "Nothing is idle above the floor." };
    }
    for (const address of addressesOf(next)) {
      if (!ground.ownerText.toLowerCase().includes(address) && !ground.toolAddresses.has(address)) return { ok: false, question: "Who should receive it? Paste the address or name a saved contact.", options: [], reason: `The recipient ${address} was not given by the owner.` };
    }
    const venue = (next as { venue?: string }).venue;
    if (typeof venue === "string" && venue.length > 0) {
      if (venueNamed(ground, at.environment, venue)) venueFromOwner = true;
      else {
        next = withoutVenue(next);
        notes.push(`The owner named no venue, so the route search picks it (the sentence said ${venue}).`);
      }
    }
    out.push(next);
  }
  return { ok: true, actions: out, notes, venueFromOwner };
}

function addressesOf(action: PlanAction): string[] {
  const a = action as { to?: unknown; recipient?: unknown };
  return [a.to, a.recipient].filter((x): x is string => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/u.test(x)).map((x) => x.toLowerCase());
}

/** The verbs whose venue the deterministic route search decides unless the owner named one. */
export function searchBinds(actions: readonly PlanAction[]): boolean {
  return actions.some((a) => (a.verb === "earn" || a.verb === "fx" || a.verb === "swap" || a.verb === "bridge") && !(a as { venue?: string }).venue);
}

/** "17:00" or "5pm" in the owner's words for a schedule time. */
export function timeStated(ground: Ground, at: string): boolean {
  const [h, m] = at.split(":").map(Number) as [number, number];
  const t = ground.ownerText.toLowerCase();
  if (new RegExp(`\\b0?${h}[:.]${String(m).padStart(2, "0")}\\b`, "u").test(t)) return true;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  const half = h < 12 ? "am" : "pm";
  if (m === 0 && new RegExp(`\\b${twelve}\\s*${half}\\b`, "u").test(t)) return true;
  if (m === 0 && h === 12 && /\bnoon\b|\bmidday\b/u.test(t)) return true;
  if (m === 0 && h === 0 && /\bmidnight\b/u.test(t)) return true;
  return false;
}

/** A schedule interval the owner described: a time word ("hourly", "every 4 hours", "each day"). */
export function intervalStated(ground: Ground, seconds: number): boolean {
  const t = ground.ownerText.toLowerCase();
  const units: [RegExp, number][] = [[/\bminutes?\b|\bmins?\b/u, 60], [/\bhours?\b|\bhourly\b/u, 3600], [/\bdays?\b|\bdaily\b/u, 86_400], [/\bweeks?\b|\bweekly\b/u, 604_800]];
  for (const [re, unit] of units) {
    if (!re.test(t)) continue;
    if (seconds === unit && /\bhourly\b|\bdaily\b|\bweekly\b|\bevery (?:minute|hour|day|week)\b|\beach (?:minute|hour|day|week)\b/u.test(t)) return true;
    if (seconds % unit === 0 && ownerStated(ground, seconds / unit)) return true;
  }
  return false;
}
