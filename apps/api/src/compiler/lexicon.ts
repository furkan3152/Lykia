/**
 * The abstract-concept lexicon: English goal language to a
 * `lykia.program/v1`, deterministically (same words, same program) and
 * without a model.
 *
 * It knows the goal templates people actually use for money:
 *
 *   reserve / runway   "keep 3 months of 400 USDC payroll liquid", "never drop below 500"
 *   rest to work       "put the rest to work somewhere safe", "invest whatever is left"
 *   hedge share        "move about a third into euros", "protect against the dollar weakening"
 *   defensive          "safe", "conservative", "nothing risky", "out within a day"
 *   pay N people       "pay my two contractors 0x… and 0x… 50 USDC each on the 1st of every month"
 *   sweep              "every Friday sweep idle USDC above 500 into the vault"
 *   DCA                "buy 50 USDC of cirBTC every week for 10 weeks"
 *   take profit / stop "sell half my cirBTC if BTC goes above 120k", "stop loss at 60k"
 *   alerts             "tell me if EURC drops below 1.05"
 *   agent budgets      "let my research agent spend up to 20 USDC a day"
 *   cross-chain        "send 200 USDC to 0x… on Base", "keep 1000 USDC in Gateway"
 *
 * Clauses it does not recognise go to the sentence reader (language/reader.ts),
 * which turns concrete commands into plan actions. What it cannot resolve
 * becomes a question; what Lykia will not do becomes a refusal element:
 * attempts to override the Fence or the rules, unknown venues and tokens,
 * guaranteed yields. It never invents an address.
 */
import { findCctpDestination, findToken, PROGRAM_LIMITS, type ActionAmount, PROGRAM_SCHEMA, type PlanAction, type PriceFeed, type Program, type ProgramConflict, type ProgramElement, type ProgramPreferences, type Quantity, type Recipient, type RiskTier, type Weekday, type When, templateForPurpose } from "@lykia/core";
import { readSentence } from "../language/reader.js";

type Period = "day" | "week" | "month";

const L = "[\\p{L}\\p{N}_]";
const w = (body: string, flags = "iu") => new RegExp(`(?<!${L})(?:${body})(?!${L})`, flags);

const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1, couple: 2 };
const ORDINALS: Readonly<Record<string, number>> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, tenth: 10, fifteenth: 15, twentieth: 20, last: 31 };
const WEEKDAY: Readonly<Record<string, Weekday>> = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun", mondays: "mon", tuesdays: "tue", wednesdays: "wed", thursdays: "thu", fridays: "fri", saturdays: "sat", sundays: "sun" };
const ZONES: Readonly<Record<string, string>> = { istanbul: "Europe/Istanbul", turkey: "Europe/Istanbul", berlin: "Europe/Berlin", cet: "Europe/Berlin", paris: "Europe/Paris", london: "Europe/London", uk: "Europe/London", "new york": "America/New_York", nyc: "America/New_York", est: "America/New_York", et: "America/New_York", pst: "America/Los_Angeles", pt: "America/Los_Angeles", "san francisco": "America/Los_Angeles", tokyo: "Asia/Tokyo", singapore: "Asia/Singapore", dubai: "Asia/Dubai", utc: "UTC", gmt: "UTC", madrid: "Europe/Madrid", "mexico city": "America/Mexico_City", "sao paulo": "America/Sao_Paulo" };
/** Feed per price word. */
const FEEDS: Readonly<Record<string, PriceFeed>> = { eurc: "EURC/USD", euro: "EURC/USD", euros: "EURC/USD", eur: "EURC/USD", btc: "BTC/USD", bitcoin: "BTC/USD", cirbtc: "BTC/USD", eth: "ETH/USD", ether: "ETH/USD", weth: "ETH/USD", gold: "PAXG/USD", paxg: "PAXG/USD", yen: "JPY/USD", jpy: "JPY/USD" };
/** Token per word, beyond registry symbols. */
const TOKEN_WORDS: Readonly<Record<string, string>> = { euro: "EURC", euros: "EURC", eur: "EURC", dollars: "USDC", dollar: "USDC", usd: "USDC", bitcoin: "cirBTC", btc: "cirBTC", ether: "WETH", eth: "WETH" };
/** Protocols people name that Lykia does not execute on Arc. */
const UNKNOWN_VENUES = ["compound", "curve", "lido", "pendle", "yearn", "gmx", "maker", "makerdao", "spark", "ethena", "hyperliquid", "kamino", "convex", "beefy", "euler", "fluid", "venus", "jupiter", "rocket pool", "eigenlayer", "blast", "binance", "coinbase earn", "nexo", "celsius", "anchor"];
/** Venue words, most specific first (a curator's name wins over "morpho" in "Gauntlet's Morpho vault"). */
const KNOWN_VENUES: Readonly<Record<string, string>> = { galaxy: "galaxy-curation", keyrock: "keyrock", steakhouse: "steakhouse-financial", gauntlet: "gauntlet", bitwise: "bitwise", aave: "aave-v4", morpho: "morpho-vaults" };
const NOT_TICKERS = new Set(["USD", "EUR", "APY", "APR", "USDC", "EURC", "TVL", "CEO", "ETF", "OK", "AM", "PM", "UTC", "GMT", "CET", "EST", "PST", "NYC", "UK", "US", "EU", "ID", "DCA", "TWAP", "CCTP", "AI", "API", "FX", "IRL", "ETH", "BTC", "PAY", "HR", "DAO", "NFT", "KYC", "AML", "I"]);

const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/gu;
const ELIDED = /0x[0-9a-fA-F]{2,}(?:…|\.{2,3})[0-9a-fA-F]{2,}/u;

export interface LexiconOptions {
  readonly timezone?: string;
}

interface Ctx {
  readonly text: string;
  elements: ProgramElement[];
  prefs: { -readonly [K in keyof ProgramPreferences]: ProgramPreferences[K] };
  conflicts: ProgramConflict[];
  questions: string[];
  /** Questions about clauses the lexicon could not read (the sentence reader's clarifications), as opposed to hard facts it will not guess. */
  soft: string[];
  /** Clauses the lexicon skipped without reading anything from them. */
  unread: string[];
  goals: string[];
  untrusted: boolean;
  /** "my payroll is 400 USDC a month": a monthly cost a later "keep 3 months" can use. */
  costs: { perPeriod: string; period: Period; purpose: string; token: string } | null;
  riskSignals: { low: string | null; high: string | null };
  /** The text names savings/money to act on ("be defensive with my savings"). */
  anchor: boolean;
  lastToken: string;
  n: number;
}

const id = (c: Ctx) => `e${++c.n}`;
const clip = (s: string) => s.trim().replace(/\s+/gu, " ").slice(0, PROGRAM_LIMITS.quote);
const goal = (c: Ctx, g: string) => {
  if (!c.goals.includes(g) && c.goals.length < PROGRAM_LIMITS.goals) c.goals.push(g);
};
const question = (c: Ctx, q: string) => {
  if (!c.questions.includes(q) && c.questions.length < PROGRAM_LIMITS.questions) c.questions.push(q);
};
const softQuestion = (c: Ctx, q: string) => {
  question(c, q);
  if (!c.soft.includes(q)) c.soft.push(q);
};

/* --------------------------------------------------------------- numbers */

function englishThousands(text: string): string {
  return text.replace(/\b(\d{1,3})((?:,\d{3})+)(?![\d,])/gu, (_m, head: string, rest: string) => `${head}${rest.replace(/,/gu, "")}`);
}

function scaled(value: string, unit: string | undefined): string {
  if (!unit) return value;
  const [a = "0", b = ""] = value.split(".");
  const zeros = unit.toLowerCase() === "k" ? 3 : 6;
  return (BigInt(a) * 10n ** BigInt(zeros) + BigInt((b.padEnd(zeros, "0").slice(0, zeros)) || "0")).toString();
}

function numberWord(word: string | undefined): number | null {
  if (!word) return null;
  if (/^\d+$/u.test(word)) return Number(word);
  return NUMBER_WORDS[word.toLowerCase()] ?? null;
}

/** Strips addresses, times, ordinals and percentages so they are not read as amounts. */
function amountText(text: string): string {
  return text
    .replace(ADDRESS, " ")
    .replace(/\b\d{1,2}(?::\d{2})\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b/giu, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/giu, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:%|percent)/giu, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:hours?|days?|weeks?|months?|years?|times|x)\b/giu, " ")
    .replace(/(?:health(?:\s+factor)?|hf)\s*(?:above|below|of|at)?\s*\d+(?:\.\d+)?/giu, " ");
}

interface Amount {
  readonly amount: string;
  readonly token: string | null;
}

/** Every "400 USDC" / "$400" / "1.5k" in the text, in order. */
function amountsIn(text: string): Amount[] {
  const out: Amount[] = [];
  const re = /(?:(\$|€)\s?)?(?<![\w.])(\d+(?:\.\d+)?)(?:\s?(k|m)(?![a-z]))?\s*(usdc|eurc|cirbtc|weth|usyc|usd|dollars?|euros?|eur|btc|bitcoin|eth|ether)?(?![\w])/giu;
  for (const m of amountText(text).matchAll(re)) {
    const value = scaled(m[2] as string, m[3]);
    if (/^0(?:\.0+)?$/u.test(value)) continue;
    const word = (m[4] ?? "").toLowerCase();
    const token = m[1] === "$" ? "USDC" : m[1] === "€" ? "EURC" : word ? (findToken("mainnet", word)?.symbol ?? TOKEN_WORDS[word] ?? null) : null;
    out.push({ amount: value, token });
  }
  return out;
}

/** "a third" = 3333 bps, "40%" = 4000; approx for "about"; of "total" for "of everything". */
function shareIn(text: string): { bps: number; approx: boolean; of: "available" | "total" } | null {
  const t = text.toLowerCase();
  const approx = w("about|around|roughly|approximately|approx|some|~|close to|nearly").test(t);
  const of: "available" | "total" = w("of (?:everything|all of it|all|my total|the total|the whole|my whole|my savings|my balance|my money|my portfolio|my funds|it all)|of everything").test(t) ? "total" : "available";
  const pct = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/u.exec(t);
  if (pct) {
    const value = Number(pct[1]);
    if (value > 0 && value <= 100) return { bps: Math.round(value * 100), approx, of };
  }
  const fractions: [RegExp, number][] = [
    [w("two thirds|2/3"), 6667],
    [w("three quarters|3/4"), 7500],
    [w("(?:a|one) third|1/3|third of"), 3333],
    [w("(?:a|one) quarter|1/4|quarter of"), 2500],
    [w("half|1/2"), 5000],
    [w("(?:a|one) fifth|1/5"), 2000],
    [w("(?:a|one) tenth|1/10"), 1000],
  ];
  for (const [re, bps] of fractions) if (re.test(t)) return { bps, approx, of };
  return null;
}

function tokensIn(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(ADDRESS, " ").split(/[\s,()/]+/u)) {
    const word = raw.replace(/[.!?:;'’"]+$/u, "").replace(/^[$€]/u, "").replace(/['’]s$/u, "");
    if (!word || /^\d/u.test(word)) continue;
    const symbol = findToken("mainnet", word)?.symbol ?? TOKEN_WORDS[word.toLowerCase()];
    if (symbol && !out.includes(symbol)) out.push(symbol);
  }
  return out;
}

/* --------------------------------------------------------------- time */

function timeIn(text: string): { at?: string; timezone?: string } {
  const out: { at?: string; timezone?: string } = {};
  const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/iu.exec(text);
  if (m && (m[2] !== undefined || m[3] !== undefined || Number(m[1]) <= 23)) {
    let h = Number(m[1]);
    if (m[3]?.toLowerCase() === "pm" && h < 12) h += 12;
    if (m[3]?.toLowerCase() === "am" && h === 12) h = 0;
    if (h <= 23 && (m[2] !== undefined || m[3] !== undefined)) out.at = `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
  }
  if (/\bevery morning\b/iu.test(text) && !out.at) out.at = "09:00";
  const iana = /\b([A-Z][a-z]+\/[A-Z][A-Za-z_]+)\b/u.exec(text);
  if (iana) out.timezone = iana[1];
  else {
    for (const [word, zone] of Object.entries(ZONES)) {
      // Long names match in any case ("istanbul time"); abbreviations only in capitals ("CET", "UTC") or with "time".
      const hit = word.length > 3 ? w(`${word}(?: time)?`).test(text) : w(word.toUpperCase(), "u").test(text) || w(`${word} time`).test(text);
      if (!hit) continue;
      if (["et", "pt", "uk"].includes(word) && !w(`${word} time`).test(text)) continue;
      out.timezone = zone;
      break;
    }
  }
  return out;
}

interface ScheduleHit {
  readonly when: Extract<When, { type: "schedule" }> | null;
  /** Asked when the schedule cannot be expressed (every two weeks, quarterly). */
  readonly problem: string | null;
}

/** A recurring schedule in the clause, or null. */
function scheduleIn(text: string): ScheduleHit | null {
  const t = text.toLowerCase();
  if (w("every (?:two|2|other) weeks?|bi-?weekly|fortnightly|every (?:three|3|six|6) months|quarterly|every quarter|yearly|annually|every year|twice a (?:month|week)").test(t)) {
    return { when: null, problem: "Schedules run every day, every week or every month. Which one should this use?" };
  }
  const { at, timezone } = timeIn(text);
  const count = /\bfor\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(days?|weeks?|months?)\b|\b(\d+)\s+times\b/iu.exec(t);
  const extra = { ...(at ? { at } : {}), ...(timezone ? { timezone } : {}) };
  const withCount = (every: Period, base: Omit<Extract<When, { type: "schedule" }>, "count">): Extract<When, { type: "schedule" }> => {
    if (count) {
      if (count[3]) return { ...base, count: Number(count[3]) };
      const n = numberWord(count[1]);
      const unit = (count[2] ?? "").replace(/s$/u, "") as Period;
      if (n && unit === every) return { ...base, count: n };
    }
    return base;
  };
  const day = /\bon the\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:day\s+)?of\s+(?:every|each|the)\s+month)?|\b(?:on\s+)?the\s+(first|second|third|fifth|tenth|fifteenth|twentieth|last)\s+(?:day\s+)?of\s+(?:every|each|the)\s+month|\bevery month on the\s+(\d{1,2})(?:st|nd|rd|th)?|\bmonthly on the\s+(\d{1,2})(?:st|nd|rd|th)?|\bon the\s+(first|last)\b/iu.exec(t);
  const monthly = w("every month|each month|monthly|per month|a month|of every month|of each month").test(t);
  if (day && (monthly || /month/u.test(t))) {
    const raw = day[1] ?? day[3] ?? day[4] ?? day[2] ?? day[5];
    const n = raw ? (/^\d+$/u.test(raw) ? Number(raw) : ORDINALS[raw] ?? 1) : 1;
    return { when: withCount("month", { type: "schedule", every: "month", day: Math.min(Math.max(n, 1), 31), ...extra }), problem: null };
  }
  if (w("every month|each month|monthly|once a month").test(t)) return { when: withCount("month", { type: "schedule", every: "month", ...extra }), problem: null };
  const wd = /\b(?:every|each|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b|\b(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b|\bweekly on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/iu.exec(t);
  if (wd) {
    const word = (wd[1] ?? wd[2] ?? wd[3] ?? "").toLowerCase();
    const weekday = WEEKDAY[word];
    if (weekday && (wd[2] || wd[3] || /every|each/u.test(wd[0]) || w("weekly|every week").test(t))) return { when: withCount("week", { type: "schedule", every: "week", weekday, ...extra }), problem: null };
  }
  if (w("every week|each week|weekly|once a week|per week|a week").test(t) && !w("a week(?:'s)? (?:of|worth)|within a week").test(t)) return { when: withCount("week", { type: "schedule", every: "week", ...extra }), problem: null };
  if (w("every day|each day|daily|every morning|every evening|every night|once a day|per day").test(t)) return { when: withCount("day", { type: "schedule", every: "day", ...extra }), problem: null };
  return null;
}

/** A price, health or balance condition in the clause and the clause without it. */
function triggerIn(text: string): { when: When; rest: string } | null {
  const cut = (m: RegExpExecArray) => `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/gu, " ").replace(/^[,\s]+|[,\s]+$/gu, "").trim();
  const health = /(?<![\p{L}])(?:if|when|whenever|once|should)\s+(?:my\s+)?(?:health(?:\s+factor)?|hf)\s+(?:ever\s+)?(?:drops|falls|goes|gets|is|dips)?\s*(?:below|under|<|beneath)\s*(\d+(?:\.\d+)?)\s*,?\s*(?:then\s+)?/iu.exec(text);
  if (health) return { when: { type: "health", below: health[1] as string }, rest: cut(health) };
  const price = /(?<![\p{L}])(?:if|when|whenever|once|should|as soon as)\s+(?:the\s+)?(?:price\s+of\s+)?([\p{L}]+)(?:\s*\/\s*usd)?(?:'s)?(?:\s+price)?\s+(?:ever\s+)?(goes|is|gets|moves|rises|climbs|jumps|drops|falls|dips|trades|breaks|reaches|hits|crosses|sinks|tanks)?\s*(above|over|higher than|past|beyond|>|below|under|lower than|beneath|<|to)?\s*\$?(\d+(?:\.\d+)?)\s?(k)?\b\s*,?\s*(?:then\s+)?/iu.exec(text);
  if (price) {
    const feed = FEEDS[(price[1] as string).toLowerCase()];
    if (feed) {
      const verb = (price[2] ?? "").toLowerCase();
      const dir = (price[3] ?? "").toLowerCase();
      const below = /below|under|lower|beneath|</u.test(dir) || (!dir || dir === "to") && /drops|falls|dips|sinks|tanks/u.test(verb);
      return { when: { type: "price", feed, op: below ? "below" : "above", value: scaled(price[4] as string, price[5]) }, rest: cut(price) };
    }
  }
  const balance = /(?<![\p{L}])(?:if|when|whenever|once)\s+(?:my\s+)?(?:wallet\s+)?(usdc|eurc)?\s*(?:balance|wallet)\s+(?:goes|gets|rises|is|climbs|grows)?\s*(above|over|more than|below|under|less than)\s*\$?(\d+(?:\.\d+)?)\s?(k)?\s*,?\s*(?:then\s+)?/iu.exec(text);
  if (balance) return { when: { type: "balance", token: (balance[1] ?? "USDC").toUpperCase(), op: /below|under|less/iu.test(balance[2] as string) ? "below" : "above", value: scaled(balance[3] as string, balance[4]) }, rest: cut(balance) };
  return null;
}

/* --------------------------------------------------------------- clauses */

const STARTERS = "keep|leave|hold|reserve|set aside|put|move|park|invest|earn|deposit|lend|stake|save|convert|exchange|swap|buy|sell|hedge|pay|send|transfer|tip|bridge|sweep|dca|withdraw|repay|borrow|alert|tell|notify|warn|ping|let|allow|give|protect|make sure|ensure|never|always|take profit|stop|rebalance|split|allocate|if|when|whenever|once|every|each|use|cover|top up|shift|diversify|grow|maintain|close|exit|ignore|disable|bypass|turn off|raise|increase|remove";
const STARTER = w(`(?:please\\s+)?(?:${STARTERS})`);
/** Verbs that act (a condition's own verbs, such as "goes" or "drops", are not here). */
const ACTION = w("keep|put|move|park|invest|earn|deposit|convert|swap|sell|buy|pay|send|bridge|repay|withdraw|alert|tell|notify|warn|stop|take|sweep|hedge|exchange");
const PREFERENCE = w("safe|safely|safest|risky|risk|risks|defensive|conservative|aggressive|leverage|liquid|liquidity|within (?:a|one|an|\\d+) (?:day|hour|week)|any ?time|instant(?:ly)?|dollar|inflation|hedge|euros?|careful|cautious|yield");

/** Sentences, then commas and "and"/"then" when the right side stands on its own. */
export function goalClauses(text: string): string[] {
  const out: string[] = [];
  const sentences = text.split(/(?<=[.!?;:])\s+(?=\S)|\n+/u).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const pieces = sentence.split(/\s*,\s*(?:and\s+|then\s+|but\s+|plus\s+|also\s+)?|\s+(?:and then|then|after that|afterwards|but|plus|also)\s+|\s+-\s+|\s+—\s+/iu).filter((p) => p && p.trim().length > 0);
    const merged: string[] = [];
    for (const piece of pieces.flatMap((p) => p.split(/\s+and\s+(?=(?:please\s+)?(?:keep|put|move|park|invest|earn|deposit|convert|swap|buy|sell|hedge|pay|send|bridge|sweep|withdraw|repay|borrow|alert|tell|notify|make sure|ensure|never|always|let|protect|stop|take)\b)/iu))) {
      const clean = piece.replace(/^(?:and|then|also|plus)\s+/iu, "").replace(/[.!?;:]+$/u, "").trim();
      if (!clean) continue;
      const standalone = STARTER.test(clean) || PREFERENCE.test(clean) || /^(?:my|our)\s+\w+\s+(?:is|are|costs?)\b/iu.test(clean);
      if (merged.length > 0 && !standalone) merged[merged.length - 1] = `${merged[merged.length - 1]}, ${clean}`;
      else merged.push(clean);
    }
    // "if X happens, do Y" / "whenever X, do Y": the condition and its action stay one clause.
    for (let i = 0; i < merged.length - 1; i++) {
      const lead = /^(?:if|when|whenever|once|should|as soon as|every|each|on (?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|the \w+)|daily|weekly|monthly)\b/iu;
      if (lead.test(merged[i]!) && !ACTION.test(merged[i]!.replace(lead, ""))) {
        merged.splice(i, 2, `${merged[i]}, ${merged[i + 1]}`);
      }
    }
    out.push(...merged);
  }
  return out;
}

/* --------------------------------------------------------------- templates */

function refuse(c: Ctx, code: Extract<ProgramElement, { kind: "refuse" }>["code"], detail: string, quote: string): void {
  if (c.elements.some((e) => e.kind === "refuse" && e.code === code && e.detail === detail)) return;
  c.elements.push({ id: id(c), kind: "refuse", code, detail, quote: clip(quote) });
}

/** Phrases that try to override Lykia's rules (English), and common Spanish, German, French and Turkish ones. */
export const INJECTION_MARKER = /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|system|safety)?\s*(?:instructions|rules|prompts?|guidelines|messages)\b|\bsystem\s*(?:prompt|message|override)\b|\byou are now\b|\b(?:developer|admin|god|debug|jailbreak|dan)\s+mode\b|\bnew instructions\s*:|<\/?(?:system|tool_data|instructions)\b|\bact as (?:an?\s+)?(?:admin|root|unrestricted)\b|\bpretend (?:you|the fence)\b/iu;
export const FOREIGN_INJECTION_MARKER = /\b(?:ignora|olvida)\s+(?:todas\s+)?las\s+instrucciones\b|\bignoriere\s+(?:alle\s+)?(?:vorherigen\s+)?(?:anweisungen|regeln)\b|\bignore[sz]?\s+(?:toutes\s+)?les\s+instructions\b|\btalimatlar\u0131\s+(?:yok\s+say|unut)/iu;

/** Rule overrides anywhere in the text. They are refused and mark the program untrusted. */
function guard(c: Ctx): void {
  const t = c.text;
  const injection = INJECTION_MARKER.exec(t);
  const foreign = FOREIGN_INJECTION_MARKER.exec(t);
  if (injection || foreign) {
    c.untrusted = true;
    refuse(c, "injection", "Instructions that try to override Lykia's rules are ignored; only the owner's own request is planned, and no payment to an outside address in this message is.", (injection ?? foreign)![0]);
  }
  const fence = /\b(?:disable|bypass|turn off|switch off|remove|ignore|skip|override|raise|increase|lift|loosen|double)\s+(?:the\s+|my\s+|all\s+|any\s+)?(?:fence|limits?|caps?|beta cap|daily (?:limit|cap)|spending (?:limit|cap)|security|checks?|confirmations?|simulation|guard ?rails?)\b|\bwithout\s+(?:asking|confirmation|confirming|my (?:signature|approval)|checks?|the fence)\b|\b(?:sign|execute|broadcast)\s+(?:it|this|them|everything|the (?:plan|transactions?))\s+(?:for me|automatically|yourself|without)\b|\bauto-?sign\b/iu.exec(t);
  if (fence) refuse(c, "fence-change", "Lykia never changes or skips the Fence, the beta cap or a signature on its own: the owner signs every plan, and loosening a Fence needs the owner's signature on the Fence page.", fence[0]);
  const guarantee = /\bguarantee[ds]?\b.*?\b(?:yield|return|apy|apr|profit|income|\d+\s*%)|\b(?:risk[- ]free|riskless)\s+(?:\d+\s*%|yield|return|profit|income)|\b(?:double|triple|10x|100x)\s+my\s+(?:money|savings|usdc|funds)\b/iu.exec(t);
  if (guarantee) refuse(c, "impossible", "No venue guarantees a yield or a multiple: rates float with supply and demand and every venue carries risk. Lykia can show today's rates and their sources instead.", guarantee[0]);
  for (const name of UNKNOWN_VENUES) {
    const m = w(name).exec(t);
    if (m) refuse(c, "unknown-venue", `Lykia does not know a venue called ${m[0]} on Arc. It only routes to venues it has verified and can execute (Aave V4, Morpho vaults, Uniswap, CCTP, Gateway).`, m[0]);
  }
  for (const m of t.matchAll(/(?:\b(?:buy|sell|swap|convert|into|for|of|to)\s+(?:\d+(?:\.\d+)?\s+)?(?:worth of\s+|of\s+)?\$?)([A-Z]{2,6})\b/gu)) {
    const ticker = m[1] as string;
    if (NOT_TICKERS.has(ticker) || findToken("mainnet", ticker) || TOKEN_WORDS[ticker.toLowerCase()] || findCctpDestination(ticker.toLowerCase())) continue;
    refuse(c, "unknown-token", `${ticker} is not a token in Lykia's Arc registry, so Lykia will not trade it. Registry tokens are listed at GET /v1/tokens.`, m[0]);
  }
}

function riskSignals(c: Ctx, clause: string): void {
  const low = w("safe|safely|safest|somewhere safe|defensive|defensively|conservative|conservatively|low[- ]risk|nothing risky|no risk|zero risk|risk[- ]free|without risk|careful|cautious|preserve|capital preservation|don't (?:want to )?lose").exec(clause);
  const high = w("max(?:imum|imize|imise)?[- ](?:yield|return|returns|apy)|highest[- ](?:yield|return|apy|rate)|best (?:possible )?(?:yield|return|apy)|aggressive|aggressively|riskiest|degen|yolo|high[- ]risk|as much (?:yield|return) as possible").exec(clause);
  if (low && !c.riskSignals.low) c.riskSignals.low = low[0];
  if (high && !c.riskSignals.high) c.riskSignals.high = high[0];
  if (w("no leverage|without leverage|never borrow|don't borrow|do not borrow|no borrowing|nothing risky|defensive|conservative").test(clause)) c.prefs.leverage = false;
  const hours = /(?:get|take|pull|withdraw|access|have|move)\b[^.]*?\b(?:out|back|access|available|withdrawn)?\b[^.]*?\b(?:within|in|inside|under)\s+(a|an|one|\d+|two|three|seven)\s+(hours?|days?|weeks?)\b/iu.exec(clause);
  if (hours) {
    const n = numberWord(hours[1]) ?? 1;
    const unit = (hours[2] as string).toLowerCase();
    c.prefs.liquidityHours = n * (unit.startsWith("hour") ? 1 : unit.startsWith("day") ? 24 : 168);
    goal(c, `Withdrawable within ${c.prefs.liquidityHours} hours`);
  } else if (w("any ?time|instant(?:ly)? (?:access|withdraw\\w*)|withdraw (?:at )?any ?time|on demand|always (?:be able to )?(?:get|access|withdraw)").test(clause)) {
    c.prefs.liquidityHours = 24;
    goal(c, "Withdrawable at any time");
  }
  if (w("(?:dollar|usd)\\s+(?:weaken\\w*|fall\\w*|drop\\w*|los\\w+ value|debasement|devaluation|declin\\w*|crash\\w*)|weak(?:er|ening)? (?:dollar|usd)|(?:protect|hedge|guard)\\w* against (?:the )?(?:dollar|usd|inflation)|diversify (?:out of|away from) (?:the )?(?:dollar|usd)|currency risk").test(clause)) {
    c.prefs.hedge = { currency: "EUR" };
    goal(c, "Hedge against a weaker dollar");
  }
  if (w("my savings|my money|my funds|my cash|my treasury|our treasury|our cash|idle (?:cash|funds|money|usdc)|my portfolio|my stablecoins|my usdc").test(clause)) c.anchor = true;
  const venues = [...clause.matchAll(new RegExp(`(?:avoid|not|never|no|except|without|skip)\\s+(?:using\\s+)?(${Object.keys(KNOWN_VENUES).join("|")})`, "giu"))];
  for (const m of venues) c.prefs.venues = { ...c.prefs.venues, deny: [...new Set([...(c.prefs.venues?.deny ?? []), KNOWN_VENUES[(m[1] as string).toLowerCase()]!])] };
  const slippage = /(?:max(?:imum)?\s+)?(\d+(?:\.\d+)?)\s*%\s*slippage|slippage\s+(?:under|below|of at most|max)\s+(\d+(?:\.\d+)?)\s*%/iu.exec(clause);
  if (slippage) c.prefs.maxSlippageBps = Math.round(Number(slippage[1] ?? slippage[2]) * 100);
  const { timezone } = timeIn(clause);
  if (timezone) c.prefs.timezone = timezone;
}

/** "my payroll is 400 USDC a month", "we burn 2k a month". */
function costFact(c: Ctx, clause: string): boolean {
  const m = /\b(?:my|our|the)?\s*(?:monthly\s+|weekly\s+)?(payroll|burn|rent|expenses|costs|bills|salaries|opex|spend(?:ing)?)\s+(?:is|are|runs?|comes? to|costs?|of)\s+(?:about\s+|around\s+)?\$?(\d+(?:\.\d+)?)\s?(k)?\s*(usdc|eurc|dollars|euros)?\s*(?:a|per|\/|each)\s*(month|week)/iu.exec(clause)
    ?? /\bwe\s+(?:burn|spend|pay out)\s+(?:about\s+|around\s+)?\$?(\d+(?:\.\d+)?)\s?(k)?\s*(usdc|eurc|dollars|euros)?\s*(?:a|per|\/|each)\s*(month|week)/iu.exec(clause);
  if (!m) return false;
  const named = m.length === 6;
  const purpose = named ? (m[1] as string).toLowerCase() : "burn";
  const amount = scaled((named ? m[2] : m[1]) as string, named ? m[3] : m[2]);
  const word = ((named ? m[4] : m[3]) ?? "usdc").toLowerCase();
  const period = ((named ? m[5] : m[4]) as string).toLowerCase() as Period;
  c.costs = { perPeriod: amount, period, purpose, token: findToken("mainnet", word)?.symbol ?? TOKEN_WORDS[word] ?? "USDC" };
  return !STARTER.test(clause) || /^(?:my|our|the)\b/iu.test(clause);
}

function reserveTemplate(c: Ctx, clause: string): boolean {
  const t = clause.toLowerCase();
  const keepish = w("keep|leave|hold|reserve|set aside|put aside|maintain|cover|have|always have|retain|park|stash").test(t) && w("liquid|aside|on hand|in (?:the |my )?wallet|available|untouched|as cash|in cash|buffer|runway|emergency|for (?:payroll|rent|salar\\w*|wages|expenses|bills|taxes|costs|the team)|reserve|enough|months? of|weeks? of|cushion|float").test(t);
  const floor = /\bnever\s+(?:let\s+(?:my\s+|the\s+)?(?:usdc\s+|eurc\s+)?(?:balance|wallet)\s+)?(?:go|drop|fall|dip)\s+below\s+\$?(\d+(?:\.\d+)?)\s?(k)?\s*(usdc|eurc)?|\balways\s+keep\s+(?:at least\s+)?\$?(\d+(?:\.\d+)?)\s?(k)?\s*(usdc|eurc)?/iu.exec(clause);
  if (!keepish && !floor) return false;
  if (w("in (?:the |my )?(?:circle )?gateway|unified balance").test(t)) return false;
  // "keep the rest liquid": nothing to move.
  if (w("the rest|the remainder|everything else|whatever is left").test(t) && !amountsIn(clause).length) {
    goal(c, "Keep the rest liquid");
    return true;
  }
  const runway = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(months?|weeks?|days?)['’]?\s*(?:of|worth of|of runway at|runway at)\s*(?:runway\s*(?:at|of)\s*)?(?:a\s+)?\$?(\d+(?:\.\d+)?)?\s?(k)?\s*(usdc|eurc|dollars|euros)?\s*(?:\/\s*(?:month|week)|(?:a|per)\s+(?:month|week))?\s*(?:monthly\s+|weekly\s+)?([\p{L}]+)?/iu.exec(clause);
  const purposeWord = /\b(payroll|salar(?:y|ies)|wages|rent|expenses|bills|taxes|costs|burn|runway|emergenc(?:y|ies)|operations|opex)\b/iu.exec(clause)?.[1]?.toLowerCase();
  const token = tokensIn(clause).find((x) => x === "USDC" || x === "EURC") ?? "USDC";
  if (runway) {
    const periods = numberWord(runway[1]) ?? 1;
    const period = (runway[2] as string).toLowerCase().replace(/s$/u, "") as Period;
    let perPeriod = runway[3] ? scaled(runway[3], runway[4]) : null;
    let purpose = purposeWord ?? (runway[6] ?? "").toLowerCase();
    if (!perPeriod && c.costs && c.costs.period === period) {
      perPeriod = c.costs.perPeriod;
      purpose = purpose || c.costs.purpose;
    }
    if (!perPeriod) {
      question(c, `How much is one ${period} of ${purpose || "costs"}? Lykia needs the amount to size the reserve.`);
      return true;
    }
    c.elements.push({ id: id(c), kind: "reserve", token: c.costs && !runway[5] ? c.costs.token : token, quantity: { type: "runway", perPeriod, periods, period }, ...(purpose && !["of", "a", "per"].includes(purpose) ? { purpose } : {}), quote: clip(clause) });
    goal(c, `Keep ${periods} ${period}${periods === 1 ? "" : "s"} of ${purpose || "costs"} liquid`);
    return true;
  }
  const share = shareIn(clause);
  if (share && !amountsIn(clause).length) {
    c.elements.push({ id: id(c), kind: "reserve", token, quantity: { type: "share", bps: share.bps, of: "total", ...(share.approx ? { approx: true } : {}) }, ...(purposeWord ? { purpose: purposeWord } : {}), quote: clip(clause) });
    goal(c, "Keep part of the balance liquid");
    return true;
  }
  const amount = floor ? { amount: scaled((floor[1] ?? floor[4]) as string, floor[2] ?? floor[5]), token: ((floor[3] ?? floor[6]) as string | undefined)?.toUpperCase() ?? null } : amountsIn(clause)[0];
  if (amount) {
    c.elements.push({ id: id(c), kind: "reserve", token: amount.token ?? token, quantity: { type: "exact", amount: amount.amount }, ...(purposeWord ? { purpose: purposeWord } : {}), quote: clip(clause) });
    goal(c, `Keep ${amount.amount} ${amount.token ?? token} liquid`);
    return true;
  }
  if (c.costs && w("enough|runway|cover").test(t)) {
    question(c, `How many ${c.costs.period}s of ${c.costs.purpose} should stay liquid?`);
    return true;
  }
  if (w("enough|runway|cover|reserve").test(t) || purposeWord) {
    question(c, `How much ${token} should stay liquid${purposeWord ? ` for ${purposeWord}` : ""}? For example "3 months of 400 USDC payroll" or "1000 USDC".`);
    return true;
  }
  return false;
}

function venueIn(clause: string): string | undefined {
  for (const [word, venue] of Object.entries(KNOWN_VENUES)) if (w(word).test(clause)) return venue;
  return undefined;
}

function earnTemplate(c: Ctx, clause: string): boolean {
  const t = clause.toLowerCase();
  const verb = w("put|move|park|invest|deposit|lend|let|stake|grow|earn|save|allocate|place");
  const restWords = w("the rest|rest of (?:it|my \\w+|the \\w+)|the remainder|remainder|everything else|whatever(?:'s| is)? left|what(?:'s| is) left|the balance|the excess|idle (?:cash|usdc|money|funds|eurc|euros|balance)|leftover|left over|the others?");
  const workWords = w("to work|into (?:a |the )?(?:best |safest |highest |top )?(?:[\\p{L}-]+ )?(?:vault|vaults|savings|yield|lending|money market)|somewhere (?:safe|productive)|in yield|earning|earn(?:s|ing)? (?:yield|interest)?|for yield|interest|invested|productive|grow");
  // "I want my idle USDC earning", "have the rest working".
  if (!verb.test(t) && w("earning|working|earn(?:s)? (?:yield|interest)|generating yield").test(t) && (restWords.test(t) || w("idle|my usdc|my eurc|my cash|my savings").test(t))) {
    c.elements.push({ id: id(c), kind: "earn", token: w("eurc|euros").test(t) ? "EURC" : "USDC", quantity: { type: "rest" }, quote: clip(clause) });
    goal(c, "Put idle funds to work");
    return true;
  }
  const verbless = !verb.test(t) && w("yield|apy|interest|returns?") .test(t) && amountsIn(clause).length > 0 && !w("pay|send|convert|swap|bridge|sell|buy|guarantee\\w*").test(t);
  if (!verbless && (!verb.test(t) || !(workWords.test(t) || w("invest|deposit|lend|earn|stake").test(t)))) return false;
  if (w("into (?:euros?|eurc|eur)|in euros?|as a hedge").test(t) && !w("euros? to work|eurc to work").test(t)) return false;
  const quote = clip(clause);
  const tokens = tokensIn(clause);
  const token = w("the euros|my euros|eurc|euros") .test(t) && (w("euros? to work|eurc to work|euros? (?:in|into) (?:a )?vault").test(t) || tokens[0] === "EURC") ? "EURC" : (tokens.find((x) => x === "USDC" || x === "EURC") ?? "USDC");
  const venue = venueIn(clause);
  const share = shareIn(clause);
  const amount = amountsIn(clause)[0];
  let quantity: Quantity;
  if (restWords.test(t)) quantity = { type: "rest" };
  else if (share) quantity = { type: "share", bps: share.bps, of: share.of, ...(share.approx ? { approx: true } : {}) };
  else if (amount) quantity = { type: "exact", amount: amount.amount };
  else if (w("everything|all of it|all my|all of my|it all|whole").test(t)) quantity = { type: "all" };
  else if (w("some|a bit|a little|part of|a portion|a few|a chunk").test(t)) {
    question(c, `How much ${token} should go to work? For example "1000 USDC", "40%" or "the rest after keeping 500 liquid".`);
    return true;
  } else quantity = { type: "unspecified" };
  c.elements.push({ id: id(c), kind: "earn", token, quantity, ...(venue ? { venue } : {}), quote });
  goal(c, quantity.type === "rest" ? "Put the rest to work" : "Earn yield");
  return true;
}

function hedgeTemplate(c: Ctx, clause: string): boolean {
  const t = clause.toLowerCase();
  const intoEuro = w("(?:into|to|in|as|for) (?:euros?|eurc|eur)\\b|euro (?:hedge|exposure|side)|in euro");
  const hedge = w("hedge|hedging|diversify");
  const verb = w("move|put|convert|swap|shift|change|hedge|keep|hold|allocate|exchange|switch|park|diversify");
  if (!(intoEuro.test(t) || (hedge.test(t) && w("euros?|eurc|eur").test(t)))) return false;
  if (!verb.test(t)) return false;
  if (triggerIn(clause)) return false;
  const quote = clip(clause);
  const share = shareIn(clause);
  const amounts = amountsIn(clause);
  const from = tokensIn(clause).find((x) => x !== "EURC") ?? "USDC";
  let quantity: Quantity;
  if (share) quantity = { type: "share", bps: share.bps, of: share.of, ...(share.approx ? { approx: true } : {}) };
  else if (amounts[0]) quantity = { type: "exact", amount: amounts[0].amount };
  else if (w("the rest|the remainder|what(?:'s| is) left").test(t)) quantity = { type: "rest" };
  else quantity = { type: "unspecified" };
  const purpose = hedge.test(t) || w("protect|safety|diversif").test(t) ? "hedge" : "trade";
  if (purpose === "hedge") c.prefs.hedge = { currency: "EUR" };
  if (quantity.type === "unspecified") {
    c.elements.push({ id: id(c), kind: "convert", from, to: "EURC", quantity: { type: "share", bps: 2000, of: "available" }, purpose: "hedge", quote, assumed: "No share was given, so 20% of what is available goes to EURC, a common defensive hedge." });
  } else c.elements.push({ id: id(c), kind: "convert", from, to: "EURC", quantity, purpose, quote });
  goal(c, purpose === "hedge" ? "Hedge part into euros" : "Convert to euros");
  return true;
}

function payTemplate(c: Ctx, clause: string): boolean {
  const t = clause.toLowerCase();
  if (!w("pay|send|transfer|tip|wire|remit|reimburse").test(t)) return false;
  if (w("pay (?:back|off|down)").test(t)) return false;
  const addresses = [...clause.matchAll(ADDRESS)].map((m) => m[0]);
  const destination = [...clause.matchAll(/\b(?:on|to)\s+(base|ethereum|arbitrum|optimism|op mainnet|polygon|avalanche|solana|unichain|linea)\b/giu)].map((m) => findCctpDestination(m[1] as string)?.key).find(Boolean);
  const schedule = scheduleIn(clause);
  const quote = clip(clause);
  if (ELIDED.test(clause) && addresses.length === 0) {
    question(c, `The address ${ELIDED.exec(clause)?.[0]} is shortened. Paste the full 0x address: Lykia never guesses addresses.`);
    return true;
  }
  const amounts = amountsIn(clause);
  const token = amounts.find((a) => a.token)?.token ?? tokensIn(clause).find((x) => x === "USDC" || x === "EURC") ?? "USDC";
  if (destination) {
    if (token !== "USDC") {
      refuse(c, "unsupported", `CCTP moves USDC only, so ${token} cannot be sent to ${destination}. Convert it to USDC first, or keep it on Arc.`, quote);
      return true;
    }
    if (!amounts[0]) {
      question(c, `How much USDC should go to ${destination}?`);
      return true;
    }
    c.elements.push({ id: id(c), kind: "bridge", quantity: { type: "exact", amount: amounts[0].amount }, destination, ...(addresses[0] ? { recipient: addresses[0] } : {}), ...(schedule?.when ? { when: schedule.when } : {}), quote });
    goal(c, `Send USDC to ${destination}`);
    return true;
  }
  const countWord = /\b(?:my|our|the|both|all)?\s*(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(contractors?|freelancers?|employees?|people|devs?|developers?|designers?|team members?|staff|suppliers?|vendors?|workers?|interns?)\b/iu.exec(clause);
  const role = /\b(contractors?|freelancers?|employees?|devs?|developers?|designers?|team|staff|suppliers?|vendors?|landlord|interns?|payroll|salar(?:y|ies)|rent)\b/iu.exec(clause)?.[1]?.toLowerCase();
  const memoMatch = /\bfor\s+(invoice\s*#?\s*[\w-]+|order\s*#?\s*[\w-]+|rent|payroll|salary|salaries|services|consulting|design work|hosting)\b/iu.exec(clause);
  const memo = memoMatch?.[1] ?? (role ? role.replace(/s$/u, "") : undefined);
  const recipients: Recipient[] = addresses.map((address) => ({ address }));
  if (recipients.length === 0) {
    const named = /\b(?:pay|send|transfer|tip)\s+(?:\$?\d+(?:\.\d+)?\s*(?:k\s*)?(?:usdc|eurc|dollars?)?\s+to\s+)?([A-Z][a-z]{1,30})(?:\s+and\s+([A-Z][a-z]{1,30}))?\b/u.exec(clause) ?? /\bto\s+([A-Z][a-z]{1,30})(?:\s+and\s+([A-Z][a-z]{1,30}))?\b/u.exec(clause);
    const skip = new Set(["My", "The", "Our", "Me", "Base", "Arc", "Lykia", "USDC", "EURC", "Every", "Each", "On", "If", "When"]);
    for (const n of [named?.[1], named?.[2]]) if (n && !skip.has(n)) recipients.push({ name: n });
  }
  const expected = countWord ? numberWord(countWord[1]) : null;
  if (recipients.length === 0) {
    question(c, `Who should be paid${role ? ` (the ${role})` : ""}? Paste each full 0x address or use a saved contact name: Lykia never guesses addresses.`);
    return true;
  }
  if (expected && expected !== recipients.length) {
    question(c, `You mentioned ${expected} ${countWord?.[2]} but ${recipients.length} address${recipients.length === 1 ? "" : "es"}. Paste all ${expected} full addresses.`);
    return true;
  }
  // "50 USDC each" or "50 USDC to A and 70 USDC to B".
  const perRecipient = [...clause.matchAll(/\$?(\d+(?:\.\d+)?)\s?(k)?\s*(?:usdc|eurc|dollars?)?\s+to\s+(0x[0-9a-fA-F]{40})/giu)];
  if (perRecipient.length >= 2 && perRecipient.length === recipients.length) {
    const first = scaled(perRecipient[0]![1] as string, perRecipient[0]![2]);
    c.elements.push({ id: id(c), kind: "pay", token, quantity: { type: "exact", amount: first }, recipients: perRecipient.map((m) => ({ address: m[3] as string, amount: scaled(m[1] as string, m[2]) })), ...(memo ? { memo } : {}), ...(schedule?.when ? { when: schedule.when } : {}), quote });
  } else if (amounts[0]) {
    const total = w("in total|total|split|between them|shared").test(t) && recipients.length > 1;
    if (total) {
      question(c, `Split ${amounts[0].amount} ${token} between ${recipients.length} recipients how? Say the amount each one gets.`);
      return true;
    }
    c.elements.push({ id: id(c), kind: "pay", token, quantity: { type: "exact", amount: amounts[0].amount }, recipients, ...(memo ? { memo } : {}), ...(schedule?.when ? { when: schedule.when } : {}), quote });
  } else {
    question(c, `How much should each recipient get${role ? ` (the ${role})` : ""}?`);
    return true;
  }
  if (schedule?.problem) question(c, schedule.problem);
  goal(c, schedule?.when ? `Pay ${recipients.length} recipient${recipients.length === 1 ? "" : "s"} every ${schedule.when.every}` : `Pay ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`);
  return true;
}

function bridgeTemplate(c: Ctx, clause: string): boolean {
  const t = clause.toLowerCase();
  const gateway = w("(?:in|into|to|on) (?:the |my )?(?:circle )?gateway|unified (?:usdc )?balance|spendable on (?:any|every) chain|chain[- ]abstracted");
  if (gateway.test(t) && w("keep|put|move|deposit|park|hold|unify|consolidate").test(t)) {
    const amount = amountsIn(clause)[0];
    const share = shareIn(clause);
    c.elements.push({ id: id(c), kind: "unify", quantity: amount ? { type: "exact", amount: amount.amount } : share ? { type: "share", bps: share.bps, of: share.of } : w("the rest|everything|all").test(t) ? { type: "rest" } : { type: "unspecified" }, quote: clip(clause) });
    goal(c, "Keep USDC spendable on every chain (Gateway)");
    return true;
  }
  if (!w("bridge|move|send|cctp|take").test(t)) return false;
  const dest = /\b(?:to|on|onto|over to)\s+(base|ethereum|arbitrum|optimism|op mainnet|polygon|avalanche|solana|unichain|linea|bnb|bsc|tron|sui|aptos|ton|cosmos|bitcoin network)\b/iu.exec(clause);
  if (!dest) return false;
  const key = findCctpDestination((dest[1] as string).toLowerCase())?.key;
  const quote = clip(clause);
  if (!key) {
    refuse(c, "unsupported", `CCTP does not reach ${dest[1]} from Arc. Destinations: Ethereum, Base, Arbitrum, OP Mainnet, Polygon, Avalanche, Solana, Unichain and Linea.`, quote);
    return true;
  }
  const tokens = tokensIn(clause).filter((x) => x !== "USDC");
  if (tokens.length > 0 && !w("usdc").test(t)) {
    refuse(c, "unsupported", `CCTP moves USDC only, so ${tokens[0]} cannot be bridged to ${key}. Convert it to USDC on Arc first.`, quote);
    return true;
  }
  const address = clause.match(ADDRESS)?.[0];
  const amount = amountsIn(clause)[0];
  const share = shareIn(clause);
  const schedule = scheduleIn(clause);
  c.elements.push({ id: id(c), kind: "bridge", quantity: amount ? { type: "exact", amount: amount.amount } : share ? { type: "share", bps: share.bps, of: share.of } : w("the rest|everything|all").test(t) ? { type: "rest" } : { type: "unspecified" }, destination: key, ...(address ? { recipient: address } : {}), ...(schedule?.when ? { when: schedule.when } : {}), quote });
  goal(c, `Bridge USDC to ${key}`);
  return true;
}

function sweepTemplate(c: Ctx, clause: string): boolean {
  const t = clause.toLowerCase();
  const m = /\b(?:sweep|move|put|send|push)\b[^.]*?\b(?:above|over|beyond|in excess of|more than)\s+\$?(\d+(?:\.\d+)?)\s?(k)?\s*(usdc|eurc)?/iu.exec(clause)
    ?? /\b(?:anything|everything|whatever(?: is)?|all)\s+(?:above|over|beyond|in excess of)\s+\$?(\d+(?:\.\d+)?)\s?(k)?\s*(usdc|eurc)?/iu.exec(clause)
    ?? /\bsweep\b[^.]*?\b(?:keep|leave|leaving)\s+\$?(\d+(?:\.\d+)?)\s?(k)?\s*(usdc|eurc)?/iu.exec(clause);
  const trig = triggerIn(clause);
  if (!m && trig?.when.type === "balance" && trig.when.op === "above" && w("excess|surplus|extra|the rest|anything (?:above|over)|everything (?:above|over)|difference|the overflow").test(t)) {
    c.elements.push({ id: id(c), kind: "sweep", token: trig.when.token, keep: trig.when.value, when: trig.when, quote: clip(clause) });
    goal(c, `Sweep idle ${trig.when.token} above ${trig.when.value} to work`);
    return true;
  }
  if (!m && !(w("sweep").test(t))) return false;
  const quote = clip(clause);
  const token = ((m?.[3] as string | undefined)?.toUpperCase()) ?? tokensIn(clause).find((x) => x === "USDC" || x === "EURC") ?? "USDC";
  const keep = m ? scaled(m[1] as string, m[2]) : null;
  if (!keep) {
    question(c, `Sweep everything above how much ${token}? For example "sweep idle USDC above 500 into the vault every Friday".`);
    return true;
  }
  const schedule = scheduleIn(clause);
  if (schedule?.problem) question(c, schedule.problem);
  const when: When = schedule?.when ?? { type: "balance", token, op: "above", value: keep };
  c.elements.push({ id: id(c), kind: "sweep", token, keep, when, quote });
  goal(c, `Sweep idle ${token} above ${keep} to work`);
  return true;
}

function dcaTemplate(c: Ctx, clause: string): boolean {
  const t = clause.toLowerCase();
  if (!w("dca|dollar[- ]cost|buy|accumulate|invest|stack").test(t)) return false;
  const schedule = scheduleIn(clause);
  if (!schedule && !w("dca|dollar[- ]cost").test(t)) return false;
  const tokens = tokensIn(clause);
  const buy = tokens.find((x) => x !== "USDC" && x !== "EURC") ?? (tokens.includes("EURC") ? "EURC" : null);
  if (!buy) return false;
  const sell = tokens.find((x) => x !== buy && (x === "USDC" || x === "EURC")) ?? "USDC";
  const quote = clip(clause);
  const amount = amountsIn(clause).find((a) => a.token === null || a.token === sell || a.token === "USDC");
  if (schedule?.problem) {
    question(c, schedule.problem);
    return true;
  }
  if (!amount) {
    question(c, `How much ${sell} should each ${buy} purchase use?`);
    return true;
  }
  const every = schedule?.when?.every ?? "week";
  c.elements.push({ id: id(c), kind: "dca", sell, buy, amount: amount.amount, every, ...(schedule?.when?.count && schedule.when.count >= 2 ? { executions: schedule.when.count } : {}), quote, ...(schedule ? {} : { assumed: "No interval was given, so it buys once a week." }) });
  goal(c, `Buy ${buy} every ${every}`);
  return true;
}

function exitTemplate(c: Ctx, clause: string): boolean {
  const t = clause.toLowerCase();
  const tp = w("take profit|take some profit|take profits|lock in (?:gains|profit)|sell|cash out|exit|dump|close");
  const sl = w("stop[- ]loss|stop loss|cut (?:my )?loss(?:es)?|protect (?:my )?downside");
  if (!tp.test(t) && !sl.test(t)) return false;
  const tokens = tokensIn(clause).filter((x) => x !== "USDC");
  const from = tokens.find((x) => x !== "EURC") ?? tokens[0];
  if (!from) return false;
  const feedWord = from === "cirBTC" ? "BTC/USD" : from === "WETH" ? "ETH/USD" : from === "EURC" ? "EURC/USD" : null;
  if (!feedWord) return false;
  let trigger = triggerIn(clause)?.when ?? null;
  if (!trigger) {
    const at = /\b(?:at|above|over|below|under|hits?|reaches)\s+\$?(\d+(?:\.\d+)?)\s?(k)?\b/iu.exec(clause);
    if (!at) {
      if (sl.test(t) || w("if|when|once").test(t)) question(c, `At what ${feedWord} price should the ${sl.test(t) ? "stop-loss" : "order"} fire?`);
      else return false;
      return true;
    }
    const below = sl.test(t) || /below|under/iu.test(at[0]);
    trigger = { type: "price", feed: feedWord as PriceFeed, op: below ? "below" : "above", value: scaled(at[1] as string, at[2]) };
  }
  if (trigger.type !== "price") return false;
  const share = shareIn(clause);
  const amount = amountsIn(clause).find((a) => a.token === from);
  const purpose = sl.test(t) || trigger.op === "below" ? "stop-loss" : "take-profit";
  const quantity: Quantity = amount ? { type: "exact", amount: amount.amount } : share ? { type: "share", bps: share.bps, of: "total" } : { type: "all" };
  c.elements.push({ id: id(c), kind: "convert", from, to: "USDC", quantity, purpose, when: trigger, quote: clip(clause), ...(amount || share ? {} : { assumed: `No amount was given, so the ${purpose} order sells all the ${from} held now.` }) });
  goal(c, purpose === "stop-loss" ? `Stop-loss on ${from}` : `Take profit on ${from}`);
  return true;
}

function alertTemplate(c: Ctx, clause: string): boolean {
  const t = clause.toLowerCase();
  const told = w("alert|tell|notify|warn|ping|message|let me know|remind|email|text me|heads up");
  if (told.test(t)) {
    const trigger = triggerIn(clause);
    if (!trigger) return false;
    c.elements.push({ id: id(c), kind: "alert", when: trigger.when, quote: clip(clause) });
    goal(c, "Watch and alert");
    return true;
  }
  const keepHealth = /\bkeep\s+(?:my\s+|the\s+)?(?:health(?:\s+factor)?|hf)\s+(?:above|over|at least)\s+(\d+(?:\.\d+)?)/iu.exec(clause);
  // "borrow 500 USDC against my cirBTC but keep health above 1.8": the floor belongs to the borrow.
  const borrow = c.elements.findIndex((e) => e.kind === "action" && e.action.verb === "borrow");
  if (keepHealth && borrow >= 0) {
    const e = c.elements[borrow] as Extract<ProgramElement, { kind: "action" }>;
    if (e.action.verb === "borrow" && !e.action.minHealth) c.elements[borrow] = { ...e, action: { ...e.action, minHealth: keepHealth[1] as string } };
    return true;
  }
  if (keepHealth && !w("borrow").test(c.text)) {
    c.elements.push({ id: id(c), kind: "alert", when: { type: "health", below: keepHealth[1] as string }, quote: clip(clause), assumed: "Lykia warns you when the health factor falls below this; it does not repay on its own." });
    goal(c, "Watch the health factor");
    return true;
  }
  return false;
}

function budgetTemplate(c: Ctx, clause: string): boolean {
  const m = /\b(?:let|allow|give|cap|limit|budget)\b[^.]*?\b(?:my\s+|the\s+|our\s+)?([\p{L}-]+\s+)?(?:agent|bot|assistant)\b[^.]*?\$?(\d+(?:\.\d+)?)\s?(k)?\s*(?:usdc|dollars?|usd)?\s*(?:a|per|each|\/)\s*(day|week)/iu.exec(clause);
  if (!m) return false;
  const agent = (m[1] ?? "").trim() || undefined;
  const value = scaled(m[2] as string, m[3]);
  const period = (m[4] as string).toLowerCase();
  // What follows the amount: a duration ("for a week", "for 10 days", "for two weeks", "for a month") and a purpose.
  const tail = clause.slice((m.index ?? 0) + m[0].length);
  const duration = /\bfor\s+(?:(a|an|one|two|three|four|\d{1,2})\s+)?(days?|weeks?|month)\b/iu.exec(tail);
  const unit = (duration?.[2] ?? "").toLowerCase();
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
  const n = duration ? (duration[1] === undefined ? 1 : words[duration[1].toLowerCase()] ?? Number(duration[1])) : 0;
  const days = duration ? Math.min(90, n * (unit.startsWith("week") ? 7 : unit === "month" ? 30 : 1)) : undefined;
  const leash = templateForPurpose(tail) ?? undefined;
  const noun = /\b(bot|agent|assistant)\b/iu.exec(m[0])?.[1]?.toLowerCase() ?? "agent";
  c.elements.push({ id: id(c), kind: "budget", ...(agent ? { agent: `${agent} ${noun}` } : {}), ...(period === "day" ? { perDayUsd: value } : { perWeekUsd: value }), ...(/x402|api|data|research/iu.test(clause) ? { purpose: "paid APIs (x402)" } : {}), ...(days && period === "day" ? { days } : {}), ...(leash && period === "day" ? { leash } : {}), quote: clip(clause) });
  goal(c, "Give an agent a budget");
  return true;
}

/** Concrete commands the sentence reader understands, as program elements. */
function fallback(c: Ctx, clause: string, when?: When): boolean {
  const parsed = readSentence(clause);
  if (parsed.command || parsed.easterEgg) return false;
  const quote = clip(clause);
  const elements: ProgramElement[] = [];
  const toElement = (a: PlanAction, w2?: When): ProgramElement => {
    const q = (amount: ActionAmount): Quantity => ("exact" in amount ? { type: "exact", amount: amount.exact } : "percent" in amount ? { type: "share", bps: amount.percent * 100, of: "available" } : { type: "rest" });
    const extra = w2 ? { when: w2 } : {};
    switch (a.verb) {
      case "send":
        return { id: id(c), kind: "pay", token: a.token, quantity: q(a.amount), recipients: [{ address: a.to }], ...(a.memo ? { memo: a.memo } : {}), ...extra, quote };
      case "fx":
      case "swap":
        return { id: id(c), kind: "convert", from: a.from, to: a.to, quantity: q(a.amount), purpose: "trade", ...extra, quote };
      case "earn":
        return { id: id(c), kind: "earn", token: a.token, quantity: q(a.amount), ...(a.venue ? { venue: a.venue } : {}), ...extra, quote };
      case "withdraw":
        return { id: id(c), kind: "withdraw", token: a.token, quantity: q(a.amount), ...(a.venue ? { venue: a.venue } : {}), quote };
      case "repay":
        return { id: id(c), kind: "repay", token: a.token, quantity: q(a.amount), ...extra, quote };
      case "bridge":
        return { id: id(c), kind: "bridge", quantity: q(a.amount), destination: a.destination, ...(a.recipient ? { recipient: a.recipient } : {}), ...extra, quote };
      case "unify":
        return { id: id(c), kind: "unify", quantity: q(a.amount), quote };
      case "reserve":
        return { id: id(c), kind: "reserve", token: a.token, quantity: "exact" in a.amount ? { type: "exact", amount: a.amount.exact } : "percent" in a.amount ? { type: "share", bps: a.amount.percent * 100, of: "total" } : { type: "unspecified" }, ...(a.reason ? { purpose: a.reason } : {}), quote };
      default:
        return { id: id(c), kind: "action", action: a, ...extra, quote };
    }
  };
  if (parsed.standing && parsed.standing.length > 0) {
    for (const s of parsed.standing) {
      const trig = s.trigger;
      const w2: When = trig.kind === "price" ? { type: "price", feed: trig.feed, op: trig.op, value: trig.value } : trig.kind === "health" ? { type: "health", below: trig.below } : { type: "schedule", every: trig.every, ...(trig.weekday ? { weekday: trig.weekday } : {}), ...(trig.day ? { day: trig.day } : {}), at: trig.at, ...(trig.timezone !== "UTC" ? { timezone: trig.timezone } : {}) };
      for (const a of s.actions) elements.push(toElement(a, w2));
    }
  } else for (const a of parsed.actions) elements.push(toElement(a, when));
  if (elements.length === 0) {
    if (parsed.clarify.length > 0 && STARTER.test(clause)) for (const q of parsed.clarify) softQuestion(c, q);
    return parsed.clarify.length > 0 && STARTER.test(clause);
  }
  for (const e of elements) {
    if (e.kind === "action" && e.action.verb === "borrow" && c.prefs.leverage === false) {
      c.conflicts.push({ between: [clip(clause).slice(0, 80), "no leverage"], resolution: "Borrowing is left out: you also asked for no leverage." });
      continue;
    }
    c.elements.push(e);
    if ("token" in e && typeof e.token === "string") c.lastToken = e.token;
  }
  if (parsed.clarify.length > 0) for (const q of parsed.clarify) softQuestion(c, q);
  return true;
}

function conditional(c: Ctx, clause: string): boolean {
  const trigger = triggerIn(clause);
  if (!trigger || !trigger.rest) return false;
  const before = c.elements.length;
  const rest = trigger.rest;
  if (hedgeTemplateConditional(c, rest, trigger.when) || earnTemplate(c, rest) || payTemplate(c, rest) || bridgeTemplate(c, rest) || fallback(c, rest, trigger.when)) {
    for (let i = before; i < c.elements.length; i++) {
      const e = c.elements[i]!;
      if (e.kind === "refuse" || e.kind === "alert" || e.kind === "sweep" || e.kind === "dca" || e.kind === "budget" || e.kind === "unify" || e.kind === "withdraw" || e.kind === "reserve") continue;
      if (!(e as { when?: When }).when) c.elements[i] = { ...e, when: trigger.when } as ProgramElement;
    }
    goal(c, "Act on a condition");
    return true;
  }
  return false;
}

/** "if EURC goes above 1.12 convert 1000 EURC to USDC": a conditional conversion. */
function hedgeTemplateConditional(c: Ctx, rest: string, when: When): boolean {
  const t = rest.toLowerCase();
  if (!w("convert|swap|exchange|move|sell|buy").test(t)) return false;
  const tokens = tokensIn(rest);
  const amount = amountsIn(rest)[0];
  const share = shareIn(rest);
  if (tokens.length < 1) return false;
  const toMatch = /\b(?:to|into|for)\s+\$?([\p{L}]+)/iu.exec(rest);
  const target = toMatch ? (findToken("mainnet", toMatch[1] as string)?.symbol ?? TOKEN_WORDS[(toMatch[1] as string).toLowerCase()]) : undefined;
  let from = tokens[0] as string;
  let to = target ?? (from === "USDC" ? "EURC" : "USDC");
  if (target && from === target) from = tokens.find((x) => x !== target) ?? (target === "USDC" ? "EURC" : "USDC");
  if (w("buy").test(t) && !w("sell").test(t) && tokens.length === 1) {
    to = tokens[0] as string;
    from = "USDC";
  }
  if (from === to) return false;
  const quantity: Quantity = amount ? { type: "exact", amount: amount.amount } : share ? { type: "share", bps: share.bps, of: "total" } : w("all|everything").test(t) ? { type: "all" } : { type: "unspecified" };
  if (quantity.type === "unspecified") {
    question(c, `How much ${from} should be converted when it fires?`);
    return true;
  }
  c.elements.push({ id: id(c), kind: "convert", from, to, quantity, purpose: "trade", when, quote: clip(rest) });
  return true;
}

/* --------------------------------------------------------------- program */

/** The question the lexicon asks when it read nothing it can act on. */
export const NOTHING_READ = "What should Lykia do? For example: keep 1000 USDC liquid and put the rest to work, convert 20% to EURC, or pay 0x… 50 USDC every month.";

/** Reads English goal language into a program. Deterministic; never throws on odd input. */
export function readProgram(raw: string, options: LexiconOptions = {}): Program {
  return readProgramDetailed(raw, options).program;
}

/**
 * The lexicon's reading with what it could not read: `soft` lists the
 * questions about clauses it did not understand (as opposed to hard facts,
 * such as an address or a missing amount, it will not guess), and `unread`
 * the clauses it skipped without reading anything from them.
 */
export function readProgramDetailed(raw: string, options: LexiconOptions = {}): { readonly program: Program; readonly soft: readonly string[]; readonly unread: readonly string[] } {
  const text = englishThousands(raw.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').trim()).slice(0, PROGRAM_LIMITS.text);
  const c: Ctx = { text, elements: [], prefs: {}, conflicts: [], questions: [], soft: [], unread: [], goals: [], untrusted: false, costs: null, riskSignals: { low: null, high: null }, anchor: false, lastToken: "USDC", n: 0 };
  guard(c);
  if (/\d,\d/u.test(text)) {
    // "1,5" is one and a half in many locales and a thousands separator elsewhere: never guessed.
    question(c, "Use a dot for decimals (1.5) and no thousands separators (1500).");
    return { program: { schema: PROGRAM_SCHEMA, text, language: "en", goals: [], elements: c.elements, preferences: {}, conflicts: [], questions: c.questions, ...(c.untrusted ? { untrusted: true } : {}) }, soft: [], unread: [] };
  }
  const footprint = () => JSON.stringify([c.prefs, c.riskSignals, c.anchor, c.costs, c.elements.length, c.questions.length, c.conflicts.length, c.goals.length]);
  for (const clause of goalClauses(text)) {
    const before = footprint();
    riskSignals(c, clause);
    if (costFact(c, clause)) continue;
    // A clause about a venue or token Lykia refused is not planned somewhere else instead.
    if (UNKNOWN_VENUES.some((name) => w(name).test(clause))) continue;
    if (c.elements.some((e) => e.kind === "refuse" && e.code === "unknown-token" && clause.includes(e.quote.trim().split(/\s+/u).pop() ?? "\u0000"))) continue;
    const handled = budgetTemplate(c, clause) || alertTemplate(c, clause) || exitTemplate(c, clause) || sweepTemplate(c, clause) || dcaTemplate(c, clause) || conditional(c, clause) || reserveTemplate(c, clause) || payTemplate(c, clause) || bridgeTemplate(c, clause) || hedgeTemplate(c, clause) || earnTemplate(c, clause);
    if (handled) continue;
    if (c.elements.some((e) => e.kind === "refuse" && clause.toLowerCase().includes(e.quote.toLowerCase().slice(0, 12)))) continue;
    if (/^(?:i|we)\s+(?:run|own|have|am|are|manage|work)\b/iu.test(clause) && !/\d/u.test(clause)) continue;
    fallback(c, clause);
    // Nothing in the clause changed the reading: the lexicon did not understand it.
    // Preference wording repeated ("nothing risky" after "be defensive") and lone words ("SYSTEM") count as read.
    if (footprint() === before && !PREFERENCE.test(clause) && !INJECTION_MARKER.test(clause) && /\s/u.test(clause.trim())) c.unread.push(clip(clause));
  }

  // Risk: the safer reading wins when both are said.
  if (c.riskSignals.low && c.riskSignals.high) {
    c.prefs.risk = "low";
    c.conflicts.push({ between: [c.riskSignals.high, c.riskSignals.low], resolution: "Read as the lowest-risk tier: no venue is risk-free, and the highest yields carry the most risk. Say \"medium risk is fine\" to trade some safety for yield." });
  } else if (c.riskSignals.low) c.prefs.risk = "low";
  else if (c.riskSignals.high) c.prefs.risk = "high" as RiskTier;
  if (c.prefs.risk === "low" || c.prefs.leverage === false) goal(c, "Stay low-risk, no leverage");

  // "Max yield but zero risk on 1000 USDC": a yield goal with an amount and no verb is an earn.
  if (!c.elements.some((e) => e.kind !== "refuse") && w("yield|apy|interest|returns?").test(text) && !c.elements.some((e) => e.kind === "refuse") && c.questions.length === 0) {
    const amount = amountsIn(text)[0];
    if (amount) c.elements.push({ id: id(c), kind: "earn", token: amount.token === "EURC" ? "EURC" : "USDC", quantity: { type: "exact", amount: amount.amount }, quote: clip(text) });
  }
  // Abstract goals with no explicit moves: propose a defensive default, stated as assumptions.
  const acting = c.elements.filter((e) => e.kind !== "refuse");
  const abstractOnly = acting.length === 0 && (c.prefs.risk !== undefined || c.prefs.hedge !== undefined || c.prefs.liquidityHours !== undefined);
  if (abstractOnly && (c.anchor || c.prefs.hedge || c.prefs.liquidityHours !== undefined) && c.questions.length === 0 && !c.untrusted) {
    if (c.prefs.liquidityHours !== undefined) c.elements.push({ id: id(c), kind: "reserve", token: "USDC", quantity: { type: "share", bps: 1000, of: "total" }, purpose: "instant access", quote: "", assumed: "A tenth stays liquid so getting money out never depends on a vault's liquidity." });
    if (c.prefs.hedge) c.elements.push({ id: id(c), kind: "convert", from: "USDC", to: "EURC", quantity: { type: "share", bps: 2000, of: "available" }, purpose: "hedge", quote: "", assumed: "No share was given for the hedge, so 20% goes to EURC, a common defensive split." });
    c.elements.push({ id: id(c), kind: "earn", token: "USDC", quantity: { type: "rest" }, quote: "", assumed: c.prefs.risk === "low" ? "The rest earns in the low-risk tier only." : "The rest earns yield." });
    if (c.prefs.risk === undefined) c.prefs.risk = "low";
    goal(c, "Defensive savings");
  } else if (c.prefs.hedge && !c.elements.some((e) => e.kind === "convert" && e.to === "EURC") && acting.some((e) => e.kind === "earn")) {
    c.elements.push({ id: id(c), kind: "convert", from: "USDC", to: "EURC", quantity: { type: "share", bps: 2000, of: "available" }, purpose: "hedge", quote: "", assumed: "No share was given for the hedge, so 20% of what is available goes to EURC." });
  }
  if (acting.length === 0 && c.elements.every((e) => e.kind !== "refuse") && c.questions.length === 0 && c.elements.length === 0) {
    softQuestion(c, NOTHING_READ);
  }
  // A borrow next to "no leverage".
  if (c.prefs.leverage === false && c.elements.some((e) => e.kind === "action" && e.action.verb === "borrow")) {
    c.elements = c.elements.filter((e) => !(e.kind === "action" && e.action.verb === "borrow"));
    c.conflicts.push({ between: ["borrow", "no leverage"], resolution: "Borrowing is left out: you also asked for no leverage." });
  }

  const preferences: ProgramPreferences = { ...c.prefs, ...(options.timezone && !c.prefs.timezone ? {} : {}) };
  const program: Program = {
    schema: PROGRAM_SCHEMA,
    text,
    language: "en",
    goals: c.goals,
    elements: c.elements.slice(0, PROGRAM_LIMITS.elements),
    preferences,
    conflicts: c.conflicts.slice(0, 6),
    questions: c.questions,
    ...(c.untrusted ? { untrusted: true } : {}),
  };
  return { program, soft: c.soft.filter((q) => c.questions.includes(q)), unread: c.unread };
}

/** Several goals, a time dimension or abstract wording: worth compiling rather than reading as one command. */
export function isGoalLanguage(text: string): boolean {
  const t = text.toLowerCase();
  const signals = [
    w("the rest|remainder|whatever is left|everything else|idle"),
    w("every|each|monthly|weekly|daily|on the (?:\\d+|first|last)"),
    w("safe|safely|defensive|conservative|risky|risk|leverage|hedge|protect|runway|savings|liquid|within a day|any ?time|dollar weaken"),
    w("if|when|whenever|once|unless"),
    w("months? of|weeks? of|a third|a quarter|half"),
    w("sweep|dca|dollar[- ]cost|take profit|stop[- ]loss|budget|agent"),
  ].filter((re) => re.test(t)).length;
  const clauses = goalClauses(text).length;
  return signals >= 2 || clauses >= 3 || (signals >= 1 && clauses >= 2) || text.length > 160;
}
