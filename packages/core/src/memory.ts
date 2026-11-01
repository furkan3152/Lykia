/**
 * Intent memory ("niyet hafızası"): what an owner did, what they prefer,
 * who they pay, and what they repeat. Pure functions over plain records;
 * the API stores them per owner and the owner can see, edit, export and
 * forget every item.
 *
 * Safety rules:
 *  - Memory resolves references ("again", "pay Ahmet", "my usual vault")
 *    into ordinary plan actions. The Fence still judges every plan.
 *  - A learned contact is never trusted by being learned: until the owner
 *    has confirmed a send to it, plans that pay it carry `confirmContact`.
 *  - Memory text handed to a model is data, not instructions.
 */
import type { ActionAmount, PlanAction } from "./actions.js";
import { isAddress, type Address } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";

export const MEMORY_SCHEMA = "lykia.memory/v1" as const;

export type IntentOutcome = "planned" | "settled" | "failed" | "stopped" | "denied";

/** One remembered plan. `resolved` carries the concrete amounts each step moved, for "again" and "undo". */
export interface IntentRecord {
  readonly id: string;
  readonly intentId: string;
  readonly at: string;
  readonly environment: ArcEnvironment;
  readonly source: string;
  readonly lang: "en" | "tr";
  readonly actions: readonly PlanAction[];
  /** Per action: what actually went in and came out (decimal strings), once known. */
  readonly resolved: readonly ResolvedStep[];
  readonly venues: readonly string[];
  readonly usd: string | null;
  outcome: IntentOutcome;
}

export interface ResolvedStep {
  readonly verb: string;
  readonly venue: string;
  readonly tokenIn?: string;
  readonly amountIn?: string;
  readonly tokenOut?: string;
  readonly amountOut?: string;
  readonly recipient?: Address;
  readonly slippageBps?: number;
}

export interface Contact {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly address: Address;
  readonly origin: "manual" | "learned";
  /** Sends the owner confirmed and that settled. 0 = not trusted yet. */
  readonly confirmedSends: number;
  readonly note?: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface Preferences {
  /** Most used venue per verb. */
  readonly venues: Readonly<Record<string, string>>;
  /** Median amount per "verb:token" (decimal string). */
  readonly typicalAmounts: Readonly<Record<string, string>>;
  readonly slippageBps: number | null;
  readonly destinations: readonly string[];
  readonly language: "en" | "tr" | null;
  readonly intents: number;
}

export interface PatternSuggestion {
  readonly kind: "weekly" | "monthly";
  readonly text: string;
  readonly textTr: string;
  readonly occurrences: number;
  readonly action: PlanAction;
  /** 0 = Sunday … 6 = Saturday, or day of month for monthly. */
  readonly day: number;
}

export interface MemorySnapshot {
  readonly intents: readonly IntentRecord[];
  readonly contacts: readonly Contact[];
}

/* ------------------------------------------------------------ preferences */

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function amountOf(a: ActionAmount): number | null {
  return "exact" in a ? Number(a.exact) : null;
}

export function computePreferences(intents: readonly IntentRecord[]): Preferences {
  const done = intents.filter((r) => r.outcome === "settled" || r.outcome === "planned");
  const venueCounts = new Map<string, Map<string, number>>();
  const amounts = new Map<string, number[]>();
  const slips: number[] = [];
  const dest = new Map<string, number>();
  let tr = 0;
  let en = 0;
  for (const r of done) {
    if (r.lang === "tr") tr += 1;
    else en += 1;
    for (const s of r.resolved) {
      if (!s.venue) continue;
      const m = venueCounts.get(s.verb) ?? new Map<string, number>();
      m.set(s.venue, (m.get(s.venue) ?? 0) + 1);
      venueCounts.set(s.verb, m);
      if (s.slippageBps !== undefined) slips.push(s.slippageBps);
    }
    for (const a of r.actions) {
      if ("token" in a && "amount" in a) {
        const n = amountOf(a.amount);
        if (n !== null) amounts.set(`${a.verb}:${a.token}`, [...(amounts.get(`${a.verb}:${a.token}`) ?? []), n]);
      }
      if (a.verb === "bridge") dest.set(a.destination, (dest.get(a.destination) ?? 0) + 1);
    }
  }
  const venues: Record<string, string> = {};
  for (const [verb, m] of venueCounts) venues[verb] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const typicalAmounts: Record<string, string> = {};
  for (const [k, list] of amounts) { const md = median(list); if (md !== null) typicalAmounts[k] = String(Math.round(md * 1e6) / 1e6); }
  const sl = median(slips);
  return {
    venues,
    typicalAmounts,
    slippageBps: sl === null ? null : Math.round(sl),
    destinations: [...dest.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d).slice(0, 3),
    language: tr + en === 0 ? null : tr > en ? "tr" : "en",
    intents: intents.length,
  };
}

/* ---------------------------------------------------------------- patterns */

/** Repeated sends to the same address with the same token on the same weekday (3+ times) suggest a weekly standing order. */
export function detectPatterns(intents: readonly IntentRecord[]): PatternSuggestion[] {
  const groups = new Map<string, { days: number[]; amounts: number[]; action: PlanAction }>();
  for (const r of intents) {
    if (r.outcome !== "settled") continue;
    for (const a of r.actions) {
      if (a.verb !== "send" || !("exact" in a.amount)) continue;
      const key = `${a.to.toLowerCase()}|${a.token}`;
      const g = groups.get(key) ?? { days: [], amounts: [], action: a };
      g.days.push(new Date(r.at).getUTCDay());
      g.amounts.push(Number(a.amount.exact));
      groups.set(key, g);
    }
  }
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const GUN = ["pazar", "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi"];
  const out: PatternSuggestion[] = [];
  for (const g of groups.values()) {
    if (g.days.length < 3) continue;
    const counts = new Map<number, number>();
    for (const d of g.days) counts.set(d, (counts.get(d) ?? 0) + 1);
    const [day, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] as [number, number];
    if (n < 3) continue;
    const a = g.action as Extract<PlanAction, { verb: "send" }>;
    const amount = String(median(g.amounts) ?? 0);
    const action: PlanAction = { ...a, amount: { exact: amount } };
    out.push({ kind: "weekly", day, occurrences: n, action, text: `every ${DAYS[day]} send ${amount} ${a.token} to ${a.to}`, textTr: `her ${GUN[day]} ${a.to} adresine ${amount} ${a.token} gönder` });
  }
  return out;
}

/* ---------------------------------------------------------------- contacts */

export function normalizeName(name: string): string {
  return name.toLocaleLowerCase("tr").normalize("NFKC").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/gu, " ").trim();
}

export function validateContact(input: { name?: unknown; address?: unknown; aliases?: unknown; note?: unknown }): string[] {
  const issues: string[] = [];
  if (typeof input.name !== "string" || !/^[\p{L}\p{N} .'-]{1,40}$/u.test(input.name.trim())) issues.push("name: 1 to 40 letters, digits or spaces.");
  if (!isAddress(input.address)) issues.push("address: an EVM address.");
  if (input.aliases !== undefined && (!Array.isArray(input.aliases) || input.aliases.length > 8 || !input.aliases.every((a) => typeof a === "string" && a.length >= 1 && a.length <= 40))) issues.push("aliases: up to 8 strings.");
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 200)) issues.push("note: up to 200 characters.");
  return issues;
}

/**
 * Finds contact names in a sentence and replaces them with addresses.
 * Turkish case endings after a name ("Ahmet'e", "Ayşe'ye", "Mehmet'in")
 * are handled. Longest names match first.
 */
export function substituteContacts(text: string, contacts: readonly Contact[]): { text: string; used: Contact[] } {
  const used: Contact[] = [];
  let out = text;
  const names = contacts.flatMap((c) => [c.name, ...c.aliases].map((n) => ({ n, c }))).filter((x) => x.n.trim().length >= 2).sort((a, b) => b.n.length - a.n.length);
  for (const { n, c } of names) {
    const escaped = n.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const re = new RegExp(`(^|[\\s,])(${escaped})(?:['’](?:[a-zçğıöşü]{1,4}))?(?=$|[\\s,.!?])`, "giu");
    if (re.test(out)) {
      out = out.replace(re, (_m, pre: string) => `${pre}${c.address}`);
      if (!used.includes(c)) used.push(c);
    }
  }
  return { text: out, used };
}

/** Contacts that a plan pays but that the owner has not confirmed a send to yet. */
export function untrustedContacts(actions: readonly PlanAction[], contacts: readonly Contact[]): Contact[] {
  const out: Contact[] = [];
  for (const a of actions) {
    if (a.verb !== "send") continue;
    const c = contacts.find((x) => x.address.toLowerCase() === a.to.toLowerCase());
    // Manual contacts are the owner's own entries; learned ones earn trust with a confirmed, settled send.
    if (c && c.origin === "learned" && c.confirmedSends === 0 && !out.includes(c)) out.push(c);
  }
  return out;
}

/* ------------------------------------------------------------- references */

export type MemoryReference =
  | { readonly kind: "repeat"; readonly actions: readonly PlanAction[]; readonly from: IntentRecord; readonly explanation: string }
  | { readonly kind: "undo"; readonly actions: readonly PlanAction[]; readonly from: IntentRecord; readonly explanation: string }
  | { readonly kind: "cannot-undo"; readonly from: IntentRecord | null; readonly explanation: string }
  | { readonly kind: "more-than-last"; readonly base: IntentRecord; readonly clarify: string; readonly choices: readonly string[] }
  | { readonly kind: "none" };

const REPEAT = /\b(again|repeat(?: that| it| the last(?: one)?)?|do (?:it|that) again|same again)\b|\b(tekrar(?:la|la| yap| et)?|aynısını(?: yap| tekrarla)?|bir daha(?: yap)?)\b/iu;
const LAST_WEEK = /\bsame as last (week|time)\b|\bgeçen (hafta|sefer)(?:ki)? gibi\b|\bgeçen haftakinin aynısı\b/iu;
const UNDO = /\b(undo|reverse|revert|roll back)\b|\bgeri al\b|\bgeri çevir\b/iu;
const MORE = /\bmore than last time\b|\bgeçen seferden (?:daha )?fazla\b/iu;
const VERB_WORDS: Readonly<Record<string, readonly string[]>> = {
  swap: ["swap", "takas"], fx: ["fx", "conversion", "convert", "çevir", "dönüşüm", "değişim"], earn: ["deposit", "earn", "vault", "yatır", "kasa", "getiri"],
  supply: ["supply"], borrow: ["borrow", "loan", "borç", "kredi"], send: ["send", "payment", "transfer", "gönder", "ödeme"], bridge: ["bridge", "köprü"],
};

function verbHint(text: string): string | null {
  const lower = text.toLocaleLowerCase("tr");
  for (const [verb, words] of Object.entries(VERB_WORDS)) if (words.some((w) => lower.includes(w))) return verb;
  return null;
}

function lastMatching(intents: readonly IntentRecord[], pred: (r: IntentRecord) => boolean): IntentRecord | null {
  const sorted = [...intents].sort((a, b) => (a.at < b.at ? 1 : -1));
  return sorted.find(pred) ?? null;
}

/** The inverse of one remembered step (by its step kind), planned fresh (new quotes) by the engine. Null when it cannot be undone. */
export function inverseAction(step: ResolvedStep): PlanAction | null {
  switch (step.verb) {
    case "swap":
    case "fx":
      if (!step.amountOut || !step.tokenOut || !step.tokenIn) return null;
      return step.verb === "fx" ? { verb: "fx", from: step.tokenOut, to: step.tokenIn, amount: { exact: step.amountOut } } : { verb: "swap", from: step.tokenOut, to: step.tokenIn, amount: { exact: step.amountOut } };
    case "deposit":
    case "supply":
      if (!step.amountIn || !step.tokenIn) return null;
      return { verb: "withdraw", token: step.tokenIn, amount: { exact: step.amountIn }, venue: step.venue };
    case "withdraw":
      if (!step.amountOut || !step.tokenOut) return null;
      return { verb: "earn", token: step.tokenOut, amount: { exact: step.amountOut }, venue: step.venue };
    case "borrow":
      if (!step.amountOut || !step.tokenOut) return null;
      return { verb: "repay", token: step.tokenOut, amount: { exact: step.amountOut }, venue: step.venue };
    default:
      return null;
  }
}

const STEP_OF_VERB: Readonly<Record<string, readonly string[]>> = { earn: ["deposit", "supply"], supply: ["supply"], swap: ["swap", "fx"], fx: ["fx", "swap"], borrow: ["borrow"], withdraw: ["withdraw"], repay: ["repay"], send: ["transfer"], bridge: ["bridge"], unify: ["gateway-deposit"] };

function stepsFor(verb: string | null, steps: readonly ResolvedStep[]): ResolvedStep[] {
  if (verb === null) return [...steps];
  const kinds = STEP_OF_VERB[verb] ?? [verb];
  return steps.filter((s) => kinds.includes(s.verb));
}

/**
 * Resolves "again", "same as last week", "undo the last swap" and "more than
 * last time" against the owner's memory. Returns plain actions; everything
 * else in the sentence is left to the language reader.
 */
export function resolveReference(text: string, memory: MemorySnapshot, now: number): MemoryReference {
  const tr = /[çğışöü]|\b(tekrar|geri|geçen|aynısını|yap)\b/iu.test(text);
  const usable = memory.intents.filter((r) => r.outcome === "settled" || r.outcome === "planned");
  if (UNDO.test(text)) {
    const verb = verbHint(text.replace(UNDO, " "));
    const from = lastMatching(memory.intents.filter((r) => r.outcome === "settled"), (r) => stepsFor(verb, r.resolved).length > 0);
    if (!from) return { kind: "cannot-undo", from: null, explanation: tr ? "Geri alınacak tamamlanmış bir işlem bulamadım." : "I found no settled plan to undo." };
    const inverse: PlanAction[] = [];
    const skipped: string[] = [];
    for (const step of stepsFor(verb, from.resolved)) {
      const inv = inverseAction(step);
      if (inv) inverse.push(inv);
      else skipped.push(step.verb);
    }
    if (inverse.length === 0 && skipped.length === 0) skipped.push(verb ?? "that");
    if (inverse.length === 0) return { kind: "cannot-undo", from, explanation: tr ? `Bunu geri alamam: ${skipped.join(", ")} geri çevrilemez (gönderilen para alıcıda, köprülenen para diğer zincirde).` : `I can't undo that: ${skipped.join(", ")} cannot be reversed (sent money is with the recipient, bridged money is on the other chain).` };
    return { kind: "undo", actions: inverse.reverse(), from, explanation: tr ? `Son işlemin tersi, yeni fiyatlarla: ${from.source}` : `The reverse of your last plan, at fresh prices: ${from.source}` };
  }
  if (MORE.test(text)) {
    const verb = verbHint(text);
    const base = lastMatching(usable, (r) => verb === null || r.actions.some((a) => a.verb === verb));
    if (base) return { kind: "more-than-last", base, clarify: tr ? "Geçen seferden ne kadar fazla?" : "How much more than last time?", choices: ["+10%", "+25%", "+50%"] };
  }
  if (LAST_WEEK.test(text)) {
    const week = 7 * 86_400_000;
    const from = lastMatching(usable, (r) => Math.abs(now - Date.parse(r.at) - week) <= 2 * 86_400_000) ?? lastMatching(usable, () => true);
    if (from) return { kind: "repeat", actions: concretize(from), from, explanation: tr ? `Geçen haftakiyle aynı: ${from.source}` : `Same as last week: ${from.source}` };
  }
  if (REPEAT.test(text) && text.trim().split(/\s+/u).length <= 5) {
    const verb = verbHint(text);
    const from = lastMatching(usable, (r) => verb === null || r.actions.some((a) => a.verb === verb));
    if (from) return { kind: "repeat", actions: concretize(from), from, explanation: tr ? `Tekrar: ${from.source}` : `Again: ${from.source}` };
  }
  return { kind: "none" };
}

/** A repeated plan uses the amounts that actually moved, so "again" means the same money, not the same percentage. */
export function concretize(record: IntentRecord): PlanAction[] {
  const used = new Set<ResolvedStep>();
  return record.actions.map((a) => {
    if (!("amount" in a) || "exact" in a.amount) return a;
    const token = "token" in a ? a.token : "from" in a ? a.from : "USDC";
    const step = stepsFor(a.verb, record.resolved).find((s) => !used.has(s) && s.tokenIn === token && s.amountIn);
    if (!step || !step.amountIn) return a;
    used.add(step);
    return { ...a, amount: { exact: step.amountIn } } as PlanAction;
  });
}

/** Scales the amounts of a remembered plan ("+25%"). */
export function scaleActions(actions: readonly PlanAction[], percent: number): PlanAction[] {
  return actions.map((a) => {
    if (!("amount" in a) || !("exact" in a.amount)) return a;
    const v = Number(a.amount.exact) * (1 + percent / 100);
    return { ...a, amount: { exact: String(Math.round(v * 1e6) / 1e6) } } as PlanAction;
  });
}

/** "my usual vault / her zamanki kasam": the venue to prefer for a verb, from preferences. */
export function usualVenue(text: string, prefs: Preferences): { readonly venue: string; readonly verb: string } | null {
  if (!/\b(my usual|the usual|as usual|usual (?:vault|pen|venue|place))\b|\bher zamanki\b|\bhep kullandığım\b/iu.test(text)) return null;
  const verb = verbHint(text) ?? "earn";
  const venue = prefs.venues[verb] ?? prefs.venues.deposit ?? prefs.venues.supply;
  return venue ? { venue, verb } : null;
}

/** Rewrites "my usual vault / her zamanki kasam" into words the reader knows; the venue is applied after parsing. */
export function stripUsualPhrase(text: string): string {
  return text
    .replace(/\b(?:in|into|to|at)?\s*(?:my|the)\s+usual\s+(?:vault|pen|venue|place|spot)\b/giu, " into a vault")
    .replace(/\bas usual\b/giu, " ")
    .replace(/\bher zamanki\s+(?:kasam[ae]?|kasaya|kasa|yere|ağıla|ağılım[ae]?)\b/giu, " kasaya")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

/** A compact, data-only summary for a model's context (never instructions). */
export function summarizeMemory(memory: MemorySnapshot, prefs: Preferences, maxChars = 900): string {
  const lines: string[] = [];
  lines.push(`intents_remembered=${memory.intents.length}`);
  const v = Object.entries(prefs.venues).map(([k, x]) => `${k}:${x}`).join(",");
  if (v) lines.push(`preferred_venues=${v}`);
  const t = Object.entries(prefs.typicalAmounts).slice(0, 6).map(([k, x]) => `${k}=${x}`).join(",");
  if (t) lines.push(`typical_amounts=${t}`);
  if (prefs.slippageBps !== null) lines.push(`typical_slippage_bps=${prefs.slippageBps}`);
  if (prefs.destinations.length) lines.push(`bridge_destinations=${prefs.destinations.join(",")}`);
  if (memory.contacts.length) lines.push(`contacts=${memory.contacts.slice(0, 12).map((c) => `${c.name.replace(/[^\p{L}\p{N} ]/gu, "")}(${c.address.slice(0, 8)}…${c.confirmedSends > 0 ? ",trusted" : ",unconfirmed"})`).join(";")}`);
  const recent = [...memory.intents].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5).map((r) => `${r.at.slice(0, 10)} ${r.outcome} "${r.source.replace(/["\n]/gu, " ").slice(0, 80)}"`);
  if (recent.length) lines.push(`recent=${recent.join(" | ")}`);
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
