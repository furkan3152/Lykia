/**
 * Hybrid reading: the model's program reconciled with the deterministic
 * lexicon, then put through the deterministic guard.
 *
 * The model reads any language but a small, fast model drifts: it asks
 * questions a documented default answers, drops an element, or forgets to
 * mark a default as an assumption. The lexicon is deterministic and reads
 * English goal language with the same defaults every time. So:
 *
 * 1. English, and the lexicon read every clause (elements, or hard-fact
 *    questions such as a missing address): the lexicon's program wins. The
 *    model adds only refusals, the untrusted flag and preferences the
 *    lexicon left open (never a looser one), and a model refusal of a clause
 *    removes the lexicon's element for it (fail closed).
 * 2. English, and the lexicon read only part of the text: the model's
 *    program is the base; the lexicon's version replaces a model element of
 *    the same kind for the same words (the lexicon wins on amounts,
 *    defaults and schedules it recognised), lexicon elements the model
 *    missed are added, and the lexicon's hard-fact questions are kept.
 * 3. Otherwise (other languages, or nothing the lexicon could read): the
 *    model's program, completed with the lexicon's documented defaults for
 *    abstract savings goals (see `completeDefaults`).
 *
 * Every path ends with `stripInjected`: text after an override marker, or
 * inside tool/system tags, is data. No element read from it is planned and
 * no address that only appears there is paid, whoever read the program.
 */
import { PROGRAM_LIMITS, type Program, type ProgramElement, type ProgramPreferences } from "@lykia/core";
import { FOREIGN_INJECTION_MARKER, INJECTION_MARKER, NOTHING_READ, readProgramDetailed } from "./lexicon.js";

export interface LexiconReading {
  readonly program: Program;
  /** The lexicon read something it can act on or a hard fact it asks about. */
  readonly understood: boolean;
  /** It read every clause: none skipped, and no question about a clause it did not understand. */
  readonly complete: boolean;
  readonly unread: readonly string[];
  readonly hardQuestions: readonly string[];
}

export function lexiconReading(text: string): LexiconReading {
  const { program, soft, unread } = readProgramDetailed(text);
  const softSet = new Set([...soft, NOTHING_READ]);
  const hardQuestions = program.questions.filter((q) => !softSet.has(q));
  const acting = program.elements.filter((e) => e.kind !== "refuse");
  const understood = acting.length > 0 || hardQuestions.length > 0;
  return { program, understood, complete: understood && unread.length === 0 && program.questions.every((q) => !softSet.has(q)), unread, hardQuestions };
}

/* ------------------------------------------------------------ injected data */

const TAG = /<\/?(?:system|tool_data|tool_result|tool_use|function_results?|function_calls?|instructions|assistant|user)\b[^>]*>/giu;
const MARKERS = [new RegExp(INJECTION_MARKER.source, "giu"), new RegExp(FOREIGN_INJECTION_MARKER.source, "giu"), /\bnew instructions\b\s*:?|\bsystem\s*:/giu];

const normalize = (s: string) => s.toLowerCase().replace(/\s+/gu, " ");

/**
 * Spans of the text that are data, not the owner's request: the inside of a
 * tag pair (<tool_data>…</tool_data>), and everything from the first
 * override marker or unpaired tag to the end.
 */
export function injectedSpans(text: string): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  const t = normalize(text);
  const tags = [...t.matchAll(TAG)];
  const paired = new Set<number>();
  for (let i = 0; i < tags.length; i++) {
    const open = tags[i]!;
    if (open[0].startsWith("</")) continue;
    const name = /^<\s*([a-z_]+)/u.exec(open[0])?.[1];
    const close = tags.findIndex((m, k) => k > i && !paired.has(k) && m[0].startsWith(`</${name}`));
    if (close < 0) continue;
    paired.add(i).add(close);
    spans.push([open.index!, tags[close]!.index! + tags[close]![0].length]);
  }
  let first = Infinity;
  tags.forEach((m, k) => {
    if (!paired.has(k)) first = Math.min(first, m.index!);
  });
  for (const re of MARKERS) for (const m of t.matchAll(re)) if (!spans.some(([a, b]) => m.index! >= a && m.index! < b)) first = Math.min(first, m.index!);
  if (first < Infinity) spans.push([first, t.length]);
  return spans;
}

/** Marker words themselves are not content: "earn yield on 500 USDC </tool_data> new instructions" still starts as the owner's words. */
const stripMarkers = (s: string) => [TAG, ...MARKERS].reduce((acc, re) => acc.replace(new RegExp(re.source, "giu"), " "), s);

function quoteIsData(quote: string, text: string, spans: readonly (readonly [number, number])[]): boolean {
  const q = normalize(quote).trim();
  if (!q) return false;
  const t = normalize(text);
  const at = t.indexOf(q);
  if (at < 0) return false;
  for (const [a, b] of spans) {
    const from = Math.max(a, at);
    const to = Math.min(b, at + q.length);
    if (to > from && /[\p{L}\p{N}]{2,}/u.test(stripMarkers(t.slice(from, to)))) return true;
  }
  return false;
}

function addressIsData(address: string, text: string, spans: readonly (readonly [number, number])[]): boolean {
  const t = normalize(text);
  const a = address.toLowerCase();
  const hits: number[] = [];
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) hits.push(i);
  return hits.length > 0 && hits.every((i) => spans.some(([s, e]) => i >= s && i < e));
}

function outsideAddresses(e: ProgramElement): string[] {
  if (e.kind === "pay") return e.recipients.flatMap((r) => (r.address ? [r.address] : []));
  if (e.kind === "bridge") return e.recipient ? [e.recipient] : [];
  if (e.kind === "action" && e.action.verb === "send") return [e.action.to];
  return [];
}

/** Drops every acting element read from injected data, and every payment to an address that appears only there. Refusals stay. */
export function stripInjected(program: Program): { program: Program; dropped: number } {
  const spans = injectedSpans(program.text);
  if (spans.length === 0) return { program, dropped: 0 };
  const kept = program.elements.filter((e) => e.kind === "refuse" || !(quoteIsData(e.quote, program.text, spans) || outsideAddresses(e).some((a) => addressIsData(a, program.text, spans))));
  const dropped = program.elements.length - kept.length;
  return { program: dropped === 0 ? program : { ...program, elements: kept }, dropped };
}

/* ------------------------------------------------------------ defaults */

const acting = (p: Program) => p.elements.filter((e) => e.kind !== "refuse");
const hasExact = (e: ProgramElement) => "quantity" in e && (e.quantity.type === "exact" || e.quantity.type === "runway");

function nextId(used: Set<string>, prefix = "d"): string {
  let n = used.size;
  let id = `${prefix}${++n}`;
  while (used.has(id)) id = `${prefix}${++n}`;
  used.add(id);
  return id;
}

/**
 * Abstract savings goals ("be defensive", "protect against a weaker
 * dollar", "out within a day") with no stated moves get the lexicon's
 * documented defaults, whatever language they came in: 10% of the total
 * stays liquid when liquidity was asked for, 20% of what is available goes
 * to EURC when a hedge was asked for, and the rest earns in the low-risk
 * tier. Each default is an assumption the owner can drop. The program has
 * no recipient and no amount to ask about, so the reader's questions are
 * answered by these defaults.
 */
export function completeDefaults(program: Program): Program {
  const prefs = program.preferences;
  if (program.untrusted || (!prefs.hedge && prefs.liquidityHours === undefined)) return program;
  const moves = acting(program);
  const abstract = moves.every((e) => (e.kind === "reserve" || (e.kind === "convert" && e.to === "EURC" && e.purpose === "hedge") || e.kind === "earn") && !hasExact(e) && !("when" in e && e.when && e.when.type !== "now"));
  if (!abstract) return program;
  const used = new Set(program.elements.map((e) => e.id));
  const elements: ProgramElement[] = program.elements.map((e) => {
    if (e.kind === "reserve" && e.quantity.type === "unspecified") return { ...e, quantity: { type: "share", bps: 1000, of: "total" }, assumed: e.assumed ?? "No share was given, so a tenth stays liquid." };
    if (e.kind === "convert" && e.quantity.type === "unspecified") return { ...e, quantity: { type: "share", bps: 2000, of: "available" }, assumed: e.assumed ?? "No share was given for the hedge, so 20% goes to EURC, a common defensive split." };
    return e;
  });
  const added: ProgramElement[] = [];
  if (prefs.liquidityHours !== undefined && !moves.some((e) => e.kind === "reserve")) added.push({ id: nextId(used), kind: "reserve", token: "USDC", quantity: { type: "share", bps: 1000, of: "total" }, purpose: "instant access", quote: "", assumed: "A tenth stays liquid so getting money out never depends on a vault's liquidity." });
  if (prefs.hedge && !moves.some((e) => e.kind === "convert")) added.push({ id: nextId(used), kind: "convert", from: "USDC", to: "EURC", quantity: { type: "share", bps: 2000, of: "available" }, purpose: "hedge", quote: "", assumed: "No share was given for the hedge, so 20% goes to EURC, a common defensive split." });
  if (!moves.some((e) => e.kind === "earn")) added.push({ id: nextId(used), kind: "earn", token: "USDC", quantity: { type: "rest" }, quote: "", assumed: "The rest earns in the low-risk tier only." });
  const changed = added.length > 0 || elements.some((e, i) => e !== program.elements[i]);
  if (!changed) return program;
  const preferences: ProgramPreferences = { ...prefs, risk: prefs.risk ?? "low" };
  return { ...program, elements: [...elements, ...added].slice(0, PROGRAM_LIMITS.elements), preferences, questions: [] };
}

/* ------------------------------------------------------------ reconcile */

function overlaps(a: string, b: string): boolean {
  const x = normalize(a).trim();
  const y = normalize(b).trim();
  if (!x || !y) return false;
  const head = (s: string) => s.slice(0, Math.min(24, s.length));
  return x.includes(head(y)) || y.includes(head(x));
}

function renamed(elements: readonly ProgramElement[], taken: Set<string>, prefix: string): ProgramElement[] {
  return elements.map((e) => (taken.has(e.id) ? { ...e, id: nextId(taken, prefix) } : (taken.add(e.id), e)));
}

/** Model preferences fill what the lexicon left open, never loosening it. */
function mergedPreferences(lexicon: ProgramPreferences, model: ProgramPreferences): ProgramPreferences {
  const out: Record<string, unknown> = { ...lexicon };
  for (const [k, v] of Object.entries(model)) {
    if (out[k] !== undefined) continue;
    if (k === "risk" && v === "high") continue;
    if (k === "leverage" && v === true) continue;
    out[k] = v;
  }
  return out as ProgramPreferences;
}

function preferLexicon(model: Program, lex: LexiconReading): Program {
  const base = lex.program;
  const modelRefusals = model.elements.filter((e) => e.kind === "refuse");
  // A clause the model refused is not planned from the lexicon's reading either. Override refusals quote the
  // marker, not a clause: what follows a marker is handled by stripInjected.
  const kept = base.elements.filter((e) => e.kind === "refuse" || !modelRefusals.some((r) => r.kind === "refuse" && r.code !== "injection" && r.code !== "fence-change" && r.quote && overlaps(r.quote, e.quote)));
  const extra = modelRefusals.filter((r) => r.kind === "refuse" && !kept.some((e) => e.kind === "refuse" && e.code === r.code));
  const taken = new Set(kept.map((e) => e.id));
  return {
    ...base,
    language: "en",
    goals: base.goals.length > 0 ? base.goals : model.goals,
    elements: [...kept, ...renamed(extra, taken, "m")].slice(0, PROGRAM_LIMITS.elements),
    preferences: mergedPreferences(base.preferences, model.preferences),
    conflicts: base.conflicts.length > 0 ? base.conflicts : model.conflicts,
    questions: [...lex.hardQuestions],
    ...(base.untrusted || model.untrusted ? { untrusted: true } : {}),
  };
}

function unionWithLexicon(model: Program, lex: LexiconReading): Program {
  const lexActing = acting(lex.program);
  const replaced = new Set<string>();
  const elements: ProgramElement[] = model.elements.map((m) => {
    if (m.kind === "refuse") return m;
    const twin = lexActing.find((l) => !replaced.has(l.id) && l.kind === m.kind && overlaps(l.quote, m.quote));
    if (!twin) return m;
    replaced.add(twin.id);
    return { ...twin, id: m.id };
  });
  const missing = lexActing.filter((l) => !replaced.has(l.id) && !elements.some((m) => m.kind === l.kind || (m.quote && overlaps(m.quote, l.quote))));
  const refusals = lex.program.elements.filter((l) => l.kind === "refuse" && !elements.some((m) => m.kind === "refuse" && m.code === l.code));
  const taken = new Set(elements.map((e) => e.id));
  const questions = [...model.questions, ...lex.hardQuestions.filter((q) => !model.questions.includes(q))].slice(0, PROGRAM_LIMITS.questions);
  return {
    ...model,
    elements: [...elements, ...renamed([...missing, ...refusals], taken, "l")].slice(0, PROGRAM_LIMITS.elements),
    preferences: mergedPreferences(model.preferences, lex.program.preferences),
    questions,
    ...(lex.program.untrusted || model.untrusted ? { untrusted: true } : {}),
  };
}

export interface Reconciled {
  readonly program: Program;
  readonly strategy: "lexicon" | "union" | "model";
  readonly note: string | null;
}

/** The model's (already validated, grounded and guarded) program reconciled with the lexicon, then stripped of injected data. */
export function reconcile(rawModel: Program, language: string | null): Reconciled {
  // Ground the model's own reading first: the lexicon's deterministic defaults are never second-guessed.
  const grounded = groundAmounts(rawModel);
  const model = grounded.program;
  const english = (language ?? model.language) === "en";
  const lex = english ? lexiconReading(model.text) : null;
  let program: Program;
  let strategy: Reconciled["strategy"] = "model";
  if (lex?.understood && lex.complete) {
    program = preferLexicon(model, lex);
    strategy = "lexicon";
  } else if (lex?.understood) {
    program = unionWithLexicon(model, lex);
    strategy = "union";
  } else program = completeDefaults(model);
  const kept = respectKeepLiquid(program);
  program = kept.program;
  const vague = english && strategy === "model" ? askWhenVague(program) : { program, asked: false };
  program = vague.program;
  const stripped = stripInjected(program);
  const notes = [
    grounded.dropped > 0 ? "Amounts the owner did not state were turned into questions." : null,
    vague.asked ? "The request names no goal, so Lykia asks before planning." : null,
    kept.dropped > 0 ? "The owner asked to keep the rest liquid, so no earn step was added for it." : null,
    strategy === "lexicon" ? "The deterministic lexicon read every clause, so its amounts and documented defaults were used; the model added refusals and preferences." : null,
    strategy === "union" ? "The model's reading was merged with the deterministic lexicon's for the clauses it recognised." : null,
    stripped.dropped > 0 ? `${stripped.dropped} element${stripped.dropped === 1 ? "" : "s"} read from injected data ${stripped.dropped === 1 ? "was" : "were"} dropped.` : null,
  ].filter((n): n is string => n !== null);
  return { program: stripped.program, strategy, note: notes.length > 0 ? notes.join(" ") : null };
}

/** Every number written in the owner's text, normalised ("1,000" and "1k" read as 1000). */
function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/giu)) {
    const raw = (m[1] ?? "").replace(/,/gu, "");
    const value = Number(raw) * (m[2] ? 1000 : 1);
    if (Number.isFinite(value)) out.add(String(value));
  }
  return out;
}

function stated(amount: string, numbers: Set<string>): boolean {
  const value = Number(amount);
  return Number.isFinite(value) && numbers.has(String(value));
}

/**
 * A model may not invent an amount: an exact amount or a runway figure that does not appear in the
 * owner's words is dropped and asked about instead. Shares, "the rest" and documented defaults stay.
 */
function groundAmounts(program: Program): { program: Program; dropped: number } {
  const numbers = numbersIn(program.text);
  const questions = [...program.questions];
  const elements = program.elements.filter((e) => {
    const q = "quantity" in e ? e.quantity : null;
    if (!q) return true;
    const invented = (q.type === "exact" && !stated(q.amount, numbers)) || (q.type === "runway" && !stated(q.perPeriod, numbers));
    if (invented) {
      const what = e.quote ? `\u201c${e.quote}\u201d` : `the ${e.kind} step`;
      const question = `How much should ${what} use? Give an amount, for example 1200 USDC, or a share such as 30%.`;
      if (questions.length < PROGRAM_LIMITS.questions && !questions.includes(question)) questions.push(question);
    }
    return !invented;
  });
  const dropped = program.elements.length - elements.length;
  return dropped === 0 ? { program, dropped } : { program: { ...program, elements, questions }, dropped };
}

const GOAL_WORDS = /\b(?:keep|reserve|save|saving|savings|earn|yield|interest|invest|work|deposit|vault|lend|hedge|euros?|eurc|convert|swap|exchange|pay|payroll|send|transfer|bridge|move|withdraw|repay|protect|defensive|safe|liquid|runway|dca|buy|sell|alert|notify|budget|sweep|split|allocate|diversify|rebalance)\b/iu;

/** A request that names no goal at all ("do something smart with my money") is asked about, never guessed. */
function askWhenVague(program: Program): { program: Program; asked: boolean } {
  if (GOAL_WORDS.test(program.text) || program.elements.length === 0) return { program, asked: false };
  const acting = program.elements.filter((e) => e.kind !== "refuse");
  if (acting.length === 0) return { program, asked: false };
  const question = "What would you like your money to do: stay liquid, earn yield, hedge into euros, or pay someone? An amount or a share helps too.";
  const questions = program.questions.includes(question) ? program.questions : [...program.questions, question].slice(0, PROGRAM_LIMITS.questions);
  return { program: { ...program, elements: program.elements.filter((e) => e.kind === "refuse"), questions }, asked: true };
}

/** "Keep the rest liquid" / "leave the remainder in USDC": what is left must not be put to work. */
const KEEP_REST_LIQUID = /\b(?:keep|leave|hold)\s+(?:the\s+)?(?:rest|remainder|remaining|everything else)\b[^.;]*?\b(?:liquid|in usdc|as (?:it is|is)|in (?:my|the) wallet|idle|untouched)\b/iu;

/**
 * Drops earn elements a model added for the remainder when the owner explicitly asked to keep the
 * remainder liquid. An earn the owner asked for in their own words (its quote outside that clause) stays.
 */
function respectKeepLiquid(program: Program): { program: Program; dropped: number } {
  const match = KEEP_REST_LIQUID.exec(program.text);
  if (!match) return { program, dropped: 0 };
  const keepClause = match[0].toLowerCase();
  const elements = program.elements.filter((e) => {
    if (e.kind !== "earn") return true;
    const quote = (e.quote ?? "").toLowerCase();
    const asked = quote.length > 0 && !keepClause.includes(quote) && /\b(?:earn|yield|deposit|invest|put\b[^.]*\bwork|vault|lend)\b/u.test(quote);
    return asked;
  });
  const dropped = program.elements.length - elements.length;
  return dropped === 0 ? { program, dropped } : { program: { ...program, elements }, dropped };
}

/** The lexicon's own reading through the same guard: what the deterministic path compiles. */
export function readDeterministic(text: string): Program {
  return stripInjected(readProgramDetailed(text).program).program;
}
