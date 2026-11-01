/**
 * The language reader: English and Turkish sentences to plan actions and
 * standing orders. Deterministic (same text, same result), it refuses to
 * guess amounts ("1,5" is ambiguous, so it asks, with choices), and answers
 * in Lyko's voice. Sheepdog commands and the hidden words come first.
 *
 *   "send 20 USDC to 0x… for invoice 4411"                       -> send + memo
 *   "put 40% of my USDC in the best vault, convert 20% to EURC
 *    and bridge the rest to Base"                                -> earn 40%, fx 20%, bridge all
 *   "maaş için 30 günlük 5000 USDC'yi likit tut,
 *    kalanını en iyi getiriye koy"                               -> reserve 5000, earn all
 *   "borrow 1000 USDC against my cirBTC but keep health above 1.8" -> borrow with collateral + floor
 *   "rebalance to 60% USDC 40% EURC"                             -> rebalance targets
 *   "if EURC/USD goes above 1.12 convert 1000 EURC to USDC"       -> standing order (price)
 *   "every friday pay 0x… 200 USDC for rent"                     -> standing order (schedule)
 *
 * Shares are shares of the starting balance (see core/actions.ts), so the
 * clauses of one sentence never double-count.
 */
import {
  commandOf,
  COMMANDS,
  easterEggOf,
  EASTER_EGGS,
  findCctpDestination,
  findToken,
  LYKO_LINES,
  CCTP_DESTINATIONS,
  type ActionAmount,
  type Address,
  type AllocationTarget,
  type PlanAction,
  type PriceFeed,
  type RiskTier,
  type StandingOrderDraft,
  type StandingTrigger,
  type Weekday,
} from "@lykia/core";
import type { ClarifyChoice, ParseResponse } from "@lykia/core/api/language";

/** Word boundaries that work with Turkish letters. */
const L = "[\\p{L}\\p{N}_]";
function w(body: string, flags = "iu"): RegExp {
  return new RegExp(`(?<!${L})(?:${body})(?!${L})`, flags);
}
/** Word start only: Turkish suffixes may follow ("köprüle" -> "köprüleyip"). */
function ws(body: string, flags = "iu"): RegExp {
  return new RegExp(`(?<!${L})(?:${body})`, flags);
}

const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/u;
const TR_WORDS = w("gönder|yolla|öde|çevir|dönüştür|yatır|faize|getiri|kazan|çek|borç|köprü|taşı|aktar|hepsi|hepsini|tümünü|tamamını|yarısı|yarısını|çeyreği|yüzde|fatura|için|sonra|ardından|birleştir|al|sat|takas|tut|koy|dengele|her|ise|olursa|geçerse|düşerse|likit|kalanını|teminat|sağlık");

/** Turkish case suffixes after an apostrophe. */
const TR_SUFFIX = /['’](?:y?[ıiuü]|y?[ae]|n[ıiuü]n|d[ae]n|t[ae]n|d[ae]|t[ae]|y?l[ae]|[ıiuü]n|s[ıiuü]|m|[ıiuü]m|n[ıiuü]|y[ıiuü]|[ıiuü]n[ıiuü]|s[ıiuü]n[ıiuü]|[ıiuü]n[ıiuü]n)$/iu;

export function stripSuffix(word: string): string {
  return word.replace(TR_SUFFIX, "");
}

export function detectLang(text: string): "en" | "tr" {
  return TR_CHARS.test(text) || TR_WORDS.test(text) ? "tr" : "en";
}

type Verb = PlanAction["verb"];

/** Order matters: the first verb that matches a clause wins. */
const VERB_PATTERNS: readonly { readonly verb: Verb; readonly re: readonly RegExp[] }[] = [
  { verb: "rebalance", re: [w("rebalance|re-balance|reallocate|allocate"), ws("dengele|yeniden dağıt|yeniden böl")] },
  { verb: "reserve", re: [w("(?:keep|leave|hold|reserve|set aside|put aside)(?:[^,]*?)(?:liquid|aside|untouched|in (?:the |my )?wallet|on hand|available|as cash)"), w("set aside|put aside"), ws("(?:likit|kenarda|cüzdanda|nakit|elde)\\s*(?:tut|bırak|kalsın|dursun)|ayır")] },
  { verb: "repay", re: [w("repay|pay back|pay off|pay down"), ws("borcu(?:mu|nu)?\\s+(?:öde|kapat)|geri öde|borç öde")] },
  { verb: "borrow", re: [w("borrow|take a loan|take out a loan"), ws("borç al|ödünç al|kredi çek|borçlan")] },
  { verb: "bridge", re: [w("bridge|move .* to (?:base|ethereum|arbitrum|optimism|op|polygon|avalanche|solana|unichain|linea)|send .* to (?:base|ethereum|arbitrum|optimism|polygon|avalanche|solana|unichain|linea)"), ws("köprüle|köprü|taşı|aktar")] },
  { verb: "unify", re: [w("unify|consolidate|unified balance|into gateway"), ws("birleştir|tek bakiye")] },
  { verb: "supply", re: [w("supply|post collateral|add collateral|deposit collateral"), ws("teminat (?:yatır|ekle|koy)")] },
  { verb: "withdraw", re: [w("withdraw|take out|pull out|redeem|unstake"), ws("çek|geri al")] },
  { verb: "earn", re: [w("earn|deposit|invest|stake|save|park|lend|put .*(?:to work|in(?:to)? (?:the |a |my )?(?:best |safest |highest |top )?(?:vault|yield|earn|aave|morpho|lending|savings))"), ws("yatır|faize|getiri|kazan|biriktir|değerlendir|çalıştır|(?:kasa|vault|faiz|getiri)\\p{L}*\\s+koy")] },
  { verb: "fx", re: [w("convert|exchange|fx"), ws("çevir|dönüştür|bozdur")] },
  { verb: "swap", re: [w("swap|buy|sell|trade"), w("takas|swap|satın al|al|sat")] },
  { verb: "send", re: [w("send|pay|transfer|tip"), ws("gönder|yolla|öde|transfer")] },
];

const VENUE_WORDS: Readonly<Record<string, string>> = {
  morpho: "morpho-vaults",
  galaxy: "morpho-vaults:galaxyUsdc",
  keyrock: "morpho-vaults:keyrockPrimeUsdc",
  steakhouse: "morpho-vaults:steakhousePrimeUsdc",
  gauntlet: "morpho-vaults:gauntletUsdcPrime",
  aave: "aave-v4",
  uniswap: "uniswap-v3",
  stablefx: "stablefx",
  gateway: "gateway",
  cctp: "cctp",
  practice: "lykia-practice",
};

const WEEKDAY_WORDS: Readonly<Record<string, Weekday>> = {
  monday: "mon", mon: "mon", pazartesi: "mon",
  tuesday: "tue", tue: "tue", salı: "tue",
  wednesday: "wed", wed: "wed", çarşamba: "wed",
  thursday: "thu", thu: "thu", perşembe: "thu",
  friday: "fri", fri: "fri", cuma: "fri",
  saturday: "sat", sat: "sat", cumartesi: "sat",
  sunday: "sun", sun: "sun", pazar: "sun",
};

const FEED_WORDS: Readonly<Record<string, PriceFeed>> = { eurc: "EURC/USD", eur: "EUR/USD", euro: "EUR/USD", avro: "EUR/USD", btc: "BTC/USD", cirbtc: "BTC/USD", bitcoin: "BTC/USD", eth: "ETH/USD", weth: "ETH/USD", ether: "ETH/USD", jpy: "JPY/USD", yen: "JPY/USD", brl: "BRL/USD", mxn: "MXN/USD", paxg: "PAXG/USD", gold: "PAXG/USD", altın: "PAXG/USD", usdc: "USDC/USD" };

export interface ReadOptions {
  /** IANA zone for schedules ("every friday at 9"); defaults to Europe/Istanbul for Turkish, UTC otherwise. */
  readonly timezone?: string;
}

export interface ReadResult {
  readonly actions: PlanAction[];
  readonly clarify: string[];
}

/* ------------------------------------------------------------ clauses */

function verbOf(clause: string): Verb | null {
  for (const p of VERB_PATTERNS) if (p.re.some((r) => r.test(clause))) return p.verb;
  return null;
}

const HEALTH_EN = /health(?:\s+factor)?\s*(?:stays?\s+|remains?\s+)?(?:above|over|>=?|at least|of|no lower than|not below)\s*(\d+(?:\.\d+)?)/iu;
const HEALTH_TR = /sağlık(?:\s+faktörü)?(?:nü|nu)?\s*(?:en az\s*)?(\d+(?:\.\d+)?)(?:['’]\p{L}+)?\s*(?:ve\s+)?(?:üstünde|üzerinde|altına (?:düşmesin|inmesin)|olsun|kalsın|tut)/iu;

function isConstraintOnly(piece: string): boolean {
  return (HEALTH_EN.test(piece) || HEALTH_TR.test(piece) || /slippage|kayma/iu.test(piece)) && !/(?:borrow|repay|send|swap|convert|bridge|deposit|withdraw|borç|gönder|çevir|köprü|yatır|çek)/iu.test(piece);
}

/** Sequencers first, then commas / "and" / "ve" / "but" when the right side is its own action. */
export function splitClauses(text: string): string[] {
  const coarse = text
    .split(/\s*(?:,?\s+(?:and then|then|after that|afterwards|sonra|ardından|ve sonra|daha sonra|sonrasında)\s+|;\s*|\.\s+(?=\p{L}))/iu)
    .map((c) => c.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of coarse) {
    const pieces = part.split(/\s*,\s*|\s+(?:and|ve|but|ama|fakat|yet)\s+/iu).filter(Boolean);
    const merged: string[] = [];
    for (const piece of pieces) {
      const standalone = verbOf(piece) !== null && !isConstraintOnly(piece);
      if (merged.length > 0 && !standalone) merged[merged.length - 1] = `${merged[merged.length - 1]} ${piece}`;
      else merged.push(piece);
    }
    out.push(...merged);
  }
  return out;
}

/** Strips "30 günlük", "30 days of", "with 1% slippage" and health floors so they are not read as the amount. */
function amountText(clause: string): string {
  return clause
    .toLowerCase()
    .replace(/(?:with|max|en fazla)?\s*%?\s*\d+(?:\.\d+)?\s*%?\s*(?:slippage|kayma)/giu, " ")
    .replace(/\d+\s*(?:günlük|gün|aylık|haftalık|days?(?:\s+of|['’]s(?:\s+worth)?(?:\s+of)?)?|weeks?(?:\s+of)?|months?(?:\s+of)?)(?!\p{L})/giu, " ")
    .replace(HEALTH_EN, " ")
    .replace(HEALTH_TR, " ")
    .replace(/0x[0-9a-f]{40}/giu, " ");
}

/** The amount in a clause: exact decimal, a share, or everything; or a problem to ask about. */
export function readAmount(clause: string): { amount: ActionAmount | null; problem: string | null } {
  const text = amountText(clause);
  if (w("\\d+,\\d+", "u").test(text) && !w("\\d{1,3}(?:,\\d{3})+", "u").test(text)) return { amount: null, problem: `“${/\d+,\d+/u.exec(text)?.[0]}” is ambiguous: write decimals with a dot (1.5).` };
  if (w("\\d{1,3}(?:,\\d{3})+", "u").test(text)) return { amount: null, problem: "Write amounts without thousands separators (1500, not 1,500)." };
  const percent = /(?:%\s*(\d{1,3})|(\d{1,3})\s*%|yüzde\s*(\d{1,3})|(\d{1,3})\s*percent)/iu.exec(text);
  if (percent) {
    const value = Number(percent[1] ?? percent[2] ?? percent[3] ?? percent[4]);
    if (value >= 1 && value <= 100) return { amount: value === 100 ? { all: true } : { percent: value }, problem: null };
    return { amount: null, problem: "A share must be between 1% and 100%." };
  }
  if (w("half|yarı(?:sı|sını|m|mı)?").test(text)) return { amount: { percent: 50 }, problem: null };
  if (w("quarter|çeyre(?:k|ği|ğini)").test(text)) return { amount: { percent: 25 }, problem: null };
  if (w("a third|üçte bir(?:i|ini)?").test(text)) return { amount: { percent: 33 }, problem: null };
  if (w("all|everything|the rest|rest|remainder|max|whatever is left|hepsi(?:ni)?|tümü(?:nü)?|tamamı(?:nı)?|kalan(?:ı|ını)?|geri kalan(?:ı|ını)?|artan(?:ı|ını)?").test(text)) return { amount: { all: true }, problem: null };
  const exact = /(?:^|[\s$€(])(\d+(?:\.\d+)?)(k|m)?(?![\p{L}\p{N}.])/u.exec(text) ?? /(?:^|[\s$€(])(\d+(?:\.\d+)?)(k|m)?(?=['’])/u.exec(text);
  if (exact) {
    let value = exact[1] as string;
    const unit = exact[2];
    if (unit) {
      const [whole = "0", frac = ""] = value.split(".");
      const zeros = unit === "k" ? 3 : 6;
      value = (BigInt(whole) * 10n ** BigInt(zeros) + BigInt(frac.padEnd(zeros, "0").slice(0, zeros) || "0")).toString();
    }
    if (/^0(?:\.0+)?$/u.test(value)) return { amount: null, problem: "The amount must be more than zero." };
    return { amount: { exact: value }, problem: null };
  }
  return { amount: null, problem: null };
}

function words(clause: string): string[] {
  return clause
    .split(/[\s,()]+/u)
    .map((x) => stripSuffix(x.replace(/[.!?:]+$/u, "")))
    .filter(Boolean);
}

function tokensIn(clause: string): string[] {
  const out: string[] = [];
  for (const raw of words(clause)) {
    const word = raw.replace(/^[$€%]/u, "").replace(/['’].*$/u, "");
    if (/^\d/u.test(word) || /^0x/iu.test(word)) continue;
    const token = findToken("mainnet", word);
    if (token && !out.includes(token.symbol)) out.push(token.symbol);
  }
  if (/[$]\s?\d/u.test(clause) && !out.includes("USDC")) out.unshift("USDC");
  if (/€\s?\d/u.test(clause) && !out.includes("EURC")) out.unshift("EURC");
  return out;
}

function memoIn(clause: string): string | undefined {
  const match =
    w("(?:for|memo|ref|reference|note)\\s*:?\\s*((?:invoice|order|payroll|bill|inv|rent|salary)?\\s*#?[\\p{L}\\p{N}_-]{1,40}(?:\\s+[\\p{L}\\p{N}_-]{1,20}){0,3})").exec(clause) ??
    w("((?:fatura|sipariş|maaş|bordro|kira)\\s*(?:no\\s*)?#?[\\p{L}\\p{N}_-]{0,40})(?:\\s+için)").exec(clause) ??
    w("((?:fatura|sipariş|bordro)\\s*(?:no\\s*)?#?[\\p{L}\\p{N}_-]{1,40})").exec(clause) ??
    w("(?:açıklama|not)\\s*:?\\s*([^,;]{1,80})").exec(clause);
  const memo = match?.[1]?.replace(/0x[0-9a-fA-F]{40}/gu, "").replace(/\s+(?:every|each|her)\b.*$/iu, "").trim();
  return memo ? memo : undefined;
}

function destinationIn(clause: string): string | undefined {
  for (const word of words(clause)) {
    const dest = findCctpDestination(word.toLowerCase().replace(/['’].*$/u, ""));
    if (dest) return dest.key;
  }
  return undefined;
}

function venueIn(clause: string, verb: Verb): string | undefined {
  for (const raw of words(clause.toLowerCase())) {
    const word = raw.replace(/['’].*$/u, "");
    const venue = VENUE_WORDS[word];
    if (!venue) continue;
    if ((verb === "borrow" || verb === "repay") && venue.startsWith("morpho")) return "morpho-blue";
    return venue;
  }
  return undefined;
}

function riskIn(clause: string): RiskTier | undefined {
  if (w("safest|safe|low[- ]risk|conservative|güvenli|en güvenli|düşük riskli|riski düşük").test(clause)) return "low";
  if (w("highest|max(?:imum)? yield|aggressive|riskiest|any risk|en yüksek|agresif|yüksek getiri|risk(?:li)? olsa da").test(clause)) return "high";
  return undefined;
}

function reasonIn(clause: string): string | undefined {
  if (w("payroll|salar(?:y|ies)|wages|maaş|bordro").test(clause)) return "payroll";
  if (w("rent|kira").test(clause)) return "rent";
  if (w("taxes|tax|vergi").test(clause)) return "taxes";
  if (w("emergency|acil").test(clause)) return "emergency fund";
  return undefined;
}

function minHealthIn(clause: string): string | undefined {
  const m = HEALTH_EN.exec(clause) ?? HEALTH_TR.exec(clause);
  return m?.[1];
}

function collateralIn(clause: string, loan: string | undefined): { token: string; amount?: ActionAmount } | undefined {
  const en = /(?:against|using|with|backed by|secured by)\s+(?:my\s+|the\s+)?(?:(\d+(?:\.\d+)?)\s*)?\$?([\p{L}\p{N}]+)(?:\s+as\s+collateral)?/iu.exec(clause);
  const tr = /(?:(\d+(?:\.\d+)?)\s*)?([\p{L}\p{N}]+)(?:['’]\p{L}+)?\s+(?:teminat(?:ı|ını|ım|ımı)?\s*(?:olarak|göstererek|ile|vererek)?|karşılığında|karşılığı|teminatla)/iu.exec(clause);
  for (const m of [en, tr]) {
    if (!m) continue;
    const token = findToken("mainnet", (m[2] as string).replace(/['’].*$/u, ""));
    if (token && token.symbol !== loan) return { token: token.symbol, ...(m[1] ? { amount: { exact: m[1] } } : {}) };
  }
  return undefined;
}

function targetsIn(clause: string): AllocationTarget[] | null {
  const targets: AllocationTarget[] = [];
  const re = /(?:%\s*(\d{1,3})|(\d{1,3})\s*%)\s*(?:of\s+)?(?:in\s+)?\$?([\p{L}\p{N}]+)/giu;
  for (const m of clause.matchAll(re)) {
    const token = findToken("mainnet", (m[3] as string).replace(/['’].*$/u, ""));
    if (token) targets.push({ token: token.symbol, weightBps: Number(m[1] ?? m[2]) * 100 });
  }
  if (targets.length < 2) {
    const split = /(\d{1,3})\s*\/\s*(\d{1,3})/u.exec(clause);
    const tokens = tokensIn(clause);
    if (split && tokens.length === 2) return [{ token: tokens[0] as string, weightBps: Number(split[1]) * 100 }, { token: tokens[1] as string, weightBps: Number(split[2]) * 100 }];
    return null;
  }
  return targets;
}

/** Reads one clause; `previous` lets "then earn the rest" inherit a token. */
export function readClause(clause: string, previous: PlanAction | undefined, lang: "en" | "tr"): { action: PlanAction | null; clarify: string[]; choices: ClarifyChoice[] } {
  const clarify: string[] = [];
  const choices: ClarifyChoice[] = [];
  const ask = (en: string, tr: string, options?: string[]) => {
    const question = lang === "tr" ? tr : en;
    clarify.push(question);
    if (options && options.length > 0) choices.push({ question, choices: options });
  };
  let verb = verbOf(clause);
  const tokens = tokensIn(clause);
  const address = /0x[0-9a-fA-F]{40}/u.exec(clause)?.[0] as Address | undefined;
  const destination = destinationIn(clause);
  if (verb === "send" && destination && !address) verb = "bridge";
  if ((verb === "swap" || verb === "fx") && tokens.length >= 2 && tokens.every((t) => t === "USDC" || t === "EURC")) verb = "fx";
  if (verb === "earn" && tokens[0] === "cirBTC") verb = "supply";
  if (!verb) return { action: null, clarify: [], choices: [] };

  if (verb === "rebalance") {
    const targets = targetsIn(clause);
    if (!targets) {
      ask("Rebalance into what? Give target weights, e.g. 60% USDC 40% EURC.", "Hangi oranlara? Örnek: %60 USDC %40 EURC.", ["60% USDC 40% EURC", "50% USDC 50% EURC", "80% USDC 20% EURC"]);
      return { action: null, clarify, choices };
    }
    const sum = targets.reduce((s, t) => s + t.weightBps, 0);
    if (sum !== 10_000) {
      ask(`Target weights add up to ${sum / 100}%; they must add up to 100%.`, `Oranların toplamı %${sum / 100}; %100 olmalı.`);
      return { action: null, clarify, choices };
    }
    return { action: { verb: "rebalance", targets }, clarify, choices };
  }

  const { amount, problem } = readAmount(clause);
  if (problem) ask(problem, problem.replace("is ambiguous: write decimals with a dot (1.5).", "belirsiz: ondalık için nokta kullan (1.5).").replace("Write amounts without thousands separators (1500, not 1,500).", "Binlik ayırıcı kullanma (1,500 değil 1500)."));
  // "the rest" refers to what the previous step spent from; otherwise a follow-up inherits what it produced.
  const restClause = w("rest|remainder|kalan(?:ı|ını)?|geri kalan(?:ı|ını)?|artan(?:ı|ını)?").test(clause);
  const produced = previous && "token" in previous ? previous.token : previous && "to" in previous && typeof previous.to === "string" && !previous.to.startsWith("0x") ? previous.to : undefined;
  const source = previous && "token" in previous ? previous.token : previous && "from" in previous ? previous.from : undefined;
  const inherited = restClause ? source ?? produced : produced;
  const finalAmount: ActionAmount | null = amount ?? (previous && w("rest|kalan").test(clause) ? { all: true } : null);
  if (!finalAmount && verb !== "unify" && !problem) ask("How much?", "Ne kadar?", ["25%", "50%", "all"]);
  const venue = venueIn(clause, verb);

  switch (verb) {
    case "reserve": {
      const token = tokens[0] ?? inherited ?? "USDC";
      if (clarify.length > 0 || !finalAmount) return { action: null, clarify, choices };
      const reason = reasonIn(clause);
      return { action: { verb: "reserve", token, amount: finalAmount, ...(reason ? { reason } : {}) }, clarify, choices };
    }
    case "send": {
      const token = tokens[0] ?? inherited ?? "USDC";
      if (!address) ask("Send to which address (0x…)?", "Hangi adrese (0x…)?");
      if (clarify.length > 0 || !finalAmount || !address) return { action: null, clarify, choices };
      const memo = memoIn(clause);
      return { action: { verb: "send", token, amount: finalAmount, to: address, ...(memo ? { memo } : {}) }, clarify, choices };
    }
    case "fx":
    case "swap": {
      let from = tokens[0];
      let to = tokens[1];
      const toMatch = w("(?:to|into|for)\\s+\\$?([\\p{L}\\p{N}]+)").exec(clause);
      const trTo = /([\p{L}\p{N}]+)['’](?:y?[ae])\s+(?:çevir|dönüştür|takas)/iu.exec(clause);
      const target = findToken("mainnet", (toMatch?.[1] ?? trTo?.[1] ?? "").replace(/['’].*$/u, ""))?.symbol;
      if (target && tokens.length >= 2 && target === from) [from, to] = [to, from];
      if (tokens.length === 1 && target === tokens[0]) {
        to = target;
        from = inherited && inherited !== target ? inherited : target === "USDC" ? "EURC" : "USDC";
      }
      if (w("buy|satın al|al").test(clause) && tokens.length === 1 && !target) {
        to = tokens[0];
        from = "USDC";
      } else if (w("sell|sat").test(clause) && tokens.length === 1) {
        from = tokens[0];
        to = "USDC";
      }
      from = from ?? inherited;
      if (verb === "fx" && from && !to) to = from === "EURC" ? "USDC" : "EURC";
      if (!from || !to) ask("Swap which token into which?", "Hangi tokeni hangisine?", ["USDC to EURC", "EURC to USDC", "USDC to cirBTC"]);
      if (from && to && from === to) ask("Pick two different tokens.", "İki farklı token seç.");
      if (clarify.length > 0 || !finalAmount || !from || !to) return { action: null, clarify, choices };
      const isFx = (from === "USDC" && to === "EURC") || (from === "EURC" && to === "USDC");
      const slippage = /(\d+(?:\.\d+)?)\s*%\s*(?:slippage|kayma)/iu.exec(clause);
      if (isFx && verb === "fx") return { action: { verb: "fx", from, to, amount: finalAmount }, clarify, choices };
      return { action: { verb: "swap", from, to, amount: finalAmount, ...(slippage ? { slippageBps: Math.round(Number(slippage[1]) * 100) } : {}), ...(venue && !venue.startsWith("morpho") && venue !== "aave-v4" ? { venue } : {}) }, clarify, choices };
    }
    case "earn":
    case "withdraw":
    case "supply":
    case "repay": {
      const token = tokens[0] ?? inherited ?? "USDC";
      if (clarify.length > 0 || !finalAmount) return { action: null, clarify, choices };
      const risk = verb === "earn" ? riskIn(clause) : undefined;
      return { action: { verb, token, amount: finalAmount, ...(venue ? { venue } : {}), ...(risk ? { maxRisk: risk } : {}) } as PlanAction, clarify, choices };
    }
    case "borrow": {
      const collateral = collateralIn(clause, tokens.find((t) => t === "USDC" || t === "EURC"));
      const loan = tokens.find((t) => t !== collateral?.token && (t === "USDC" || t === "EURC")) ?? "USDC";
      const minHealth = minHealthIn(clause);
      if (finalAmount && !("exact" in finalAmount)) ask("Borrow how much, exactly (e.g. 1000 USDC)?", "Tam olarak ne kadar borç (ör. 1000 USDC)?", ["500 USDC", "1000 USDC", "5000 USDC"]);
      if (minHealth !== undefined && Number(minHealth) < 1) ask("A health factor floor must be at least 1.0.", "Sağlık faktörü tabanı en az 1.0 olmalı.");
      if (clarify.length > 0 || !finalAmount || !("exact" in finalAmount)) return { action: null, clarify, choices };
      return { action: { verb: "borrow", token: loan, amount: finalAmount, collateral: collateral ?? { token: "cirBTC" }, ...(minHealth ? { minHealth } : {}), ...(venue ? { venue } : {}) }, clarify, choices };
    }
    case "bridge": {
      const token = tokens[0] ?? (inherited === "USDC" || inherited === undefined || restClause ? "USDC" : inherited);
      if (token !== "USDC") ask("CCTP moves USDC only.", "CCTP sadece USDC taşır.");
      if (!destination) ask("Bridge to which chain?", "Hangi ağa?", CCTP_DESTINATIONS.filter((d) => d.vm === "evm").slice(0, 6).map((d) => `to ${d.name}`));
      if (clarify.length > 0 || !finalAmount || !destination) return { action: null, clarify, choices };
      return { action: { verb: "bridge", token: "USDC", amount: finalAmount, destination, ...(address ? { recipient: address } : {}) }, clarify, choices };
    }
    case "unify":
      return { action: { verb: "unify", amount: finalAmount ?? { all: true } }, clarify, choices };
  }
}

/* ------------------------------------------------------- standing orders */

function hhmm(hour: string | undefined, minute: string | undefined, ampm: string | undefined): string {
  let h = hour === undefined ? 9 : Number(hour);
  if (ampm?.toLowerCase() === "pm" && h < 12) h += 12;
  if (ampm?.toLowerCase() === "am" && h === 12) h = 0;
  return `${String(Math.min(h, 23)).padStart(2, "0")}:${String(Math.min(Number(minute ?? 0), 59)).padStart(2, "0")}`;
}

/** Finds a condition or a schedule in the sentence; returns the trigger and the sentence without it. */
export function extractTrigger(text: string, options: ReadOptions, lang: "en" | "tr"): { trigger: StandingTrigger; rest: string } | null {
  const timezone = options.timezone ?? (lang === "tr" ? "Europe/Istanbul" : "UTC");
  const priceEn = /(?<![\p{L}])(?:if|when|whenever|once)\s+(?:the\s+)?([\p{L}]+)(?:\s*\/\s*usd)?(?:\s+price)?\s+(?:goes|is|gets|moves|rises|climbs|drops|falls|trades|breaks)?\s*(above|over|higher than|exceeds|past|>|below|under|lower than|<)\s*\$?(\d+(?:\.\d+)?)\s*,?\s*(?:then\s+)?/iu;
  const priceTr = /([\p{L}]+)(?:\s*\/\s*usd)?(?:\s+(?:fiyatı|kuru|paritesi))?\s+(\d+(?:\.\d+)?)(?:['’]\p{L}+)?\s+(?:seviyesini\s+)?(geçerse|aşarsa|üstüne çıkarsa|üzerine çıkarsa|üstündeyse|altına (?:düşerse|inerse)|altındaysa|düşerse|inerse)\s*,?\s*/iu;
  const healthEn = /(?<![\p{L}])(?:if|when|whenever)\s+(?:my\s+)?health(?:\s+factor)?\s+(?:drops|falls|goes|gets|is)?\s*(?:below|under|<)\s*(\d+(?:\.\d+)?)\s*,?\s*(?:then\s+)?/iu;
  const healthTr = /sağlık(?:\s+faktörü(?:m)?)?\s+(\d+(?:\.\d+)?)(?:['’]\p{L}+)?\s+(?:altına\s+(?:düşerse|inerse)|altındaysa|düşerse)\s*,?\s*/iu;
  const everyEn = /(?<![\p{L}])(?:every|each)\s+(day|weekday|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?|(?<![\p{L}])(daily|weekly|monthly)(?:\s+on\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?|\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))?(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/iu;
  const everyTr = /(?<![\p{L}])(?:her\s+(gün|hafta|ay|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)|ayın\s+(\d{1,2})(?:['’]?\p{L}*)?)(?:\s+(\d{1,2})(?:['’]\p{L}*)?(?![\p{L}\p{N}]))?(?:\s+saat\s+(\d{1,2})(?:[:.](\d{2}))?)?/iu;

  const cut = (m: RegExpExecArray) => `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/gu, " ").replace(/^[,\s]+|[,\s]+$/gu, "").trim();

  let m = priceEn.exec(text);
  if (m) {
    const feed = FEED_WORDS[(m[1] as string).toLowerCase()];
    if (feed) return { trigger: { kind: "price", feed, op: /above|over|higher|exceeds|past|>/iu.test(m[2] as string) ? "above" : "below", value: m[3] as string }, rest: cut(m) };
  }
  m = priceTr.exec(text);
  if (m) {
    const feed = FEED_WORDS[(m[1] as string).toLowerCase().replace(/['’].*$/u, "")];
    if (feed) return { trigger: { kind: "price", feed, op: /altın|düş|in/iu.test(m[3] as string) && !/geç|aş|üst|üzer/iu.test(m[3] as string) ? "below" : "above", value: m[2] as string }, rest: cut(m) };
  }
  m = healthEn.exec(text) ?? healthTr.exec(text);
  if (m) return { trigger: { kind: "health", below: m[1] as string }, rest: cut(m) };
  m = everyEn.exec(text);
  if (m) {
    const unit = (m[1] ?? m[6] ?? "").toLowerCase();
    const at = hhmm(m[3] ?? m[9], m[4] ?? m[10], m[5] ?? m[11]);
    const weekdayWord = (WEEKDAY_WORDS[unit] ? unit : m[8]?.toLowerCase()) ?? "";
    if (WEEKDAY_WORDS[weekdayWord]) return { trigger: { kind: "schedule", every: "week", weekday: WEEKDAY_WORDS[weekdayWord], at, timezone }, rest: cut(m) };
    if (unit === "week" || unit === "weekly") return { trigger: { kind: "schedule", every: "week", weekday: "mon", at, timezone }, rest: cut(m) };
    if (unit === "month" || unit === "monthly") return { trigger: { kind: "schedule", every: "month", day: Math.min(Math.max(Number(m[2] ?? m[7] ?? 1), 1), 28), at, timezone }, rest: cut(m) };
    return { trigger: { kind: "schedule", every: "day", at, timezone }, rest: cut(m) };
  }
  m = everyTr.exec(text);
  if (m) {
    const unit = (m[1] ?? "").toLowerCase();
    const at = hhmm(m[4], m[5], undefined);
    if (m[2]) return { trigger: { kind: "schedule", every: "month", day: Math.min(Math.max(Number(m[2]), 1), 28), at, timezone }, rest: cut(m) };
    if (WEEKDAY_WORDS[unit]) return { trigger: { kind: "schedule", every: "week", weekday: WEEKDAY_WORDS[unit], at, timezone }, rest: cut(m) };
    if (unit === "hafta") return { trigger: { kind: "schedule", every: "week", weekday: "mon", at, timezone }, rest: cut(m) };
    if (unit === "ay") return { trigger: { kind: "schedule", every: "month", day: Math.min(Math.max(Number(m[3] ?? 1), 1), 28), at, timezone }, rest: cut(m) };
    return { trigger: { kind: "schedule", every: "day", at, timezone }, rest: cut(m) };
  }
  return null;
}

/* -------------------------------------------------------------- reading */

function readActions(text: string, lang: "en" | "tr"): { actions: PlanAction[]; clarify: string[]; choices: ClarifyChoice[] } {
  const actions: PlanAction[] = [];
  const clarify: string[] = [];
  const choices: ClarifyChoice[] = [];
  for (const clause of splitClauses(text)) {
    const result = readClause(clause, actions[actions.length - 1], lang);
    clarify.push(...result.clarify);
    choices.push(...result.choices);
    if (result.action) actions.push(result.action);
  }
  return { actions, clarify, choices };
}

/**
 * Lykia's own words for earning: "the greenest pasture", "greener pastures",
 * "the best pasture", "en yeşil mera" all mean the best yield the routing
 * finds. Rewritten to phrases the reader already knows.
 */
export function normalizePasture(text: string): string {
  return text
    .replace(/\blead (?:the|my) flock to (?:the )?(?:greenest|greener|best) pastures?\b/giu, "put all my USDC into the best vault")
    .replace(/\b(?:on|onto|to|into|in)\s+(?:the\s+)?(?:greenest|greener|best|richest)\s+pastures?\b/giu, " into the best vault")
    .replace(/\b(?:the\s+)?(?:greenest|greener|best)\s+pastures?\b/giu, " the best vault")
    .replace(/\ben\s+(?:yeşil|iyi|verimli)\s+mera(?:ya|da|yı)?\b/giu, " en iyi getiriye")
    // "hedge 20% into EURC" is a conversion.
    .replace(/\bhedge\s+(\d{1,3}(?:\.\d+)?\s*%|[\d.]+\s*(?:USDC)?)\s+(?:of it\s+)?(?:into|to|in)\s+(EURC|euros?)\b/giu, "convert $1 to EURC")
    // "keep 5000 USDC for payroll" keeps it liquid.
    .replace(/\bkeep\s+([\d.]+\s*(?:USDC|EURC))\s+(for|aside)\b/giu, "keep $1 liquid $2")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

/** English thousands separators ("5,000") read as 5000 when the sentence has no Turkish letters; Turkish commas stay refused (1,5 is one and a half there). */
function englishThousands(text: string): string {
  if (/[çğışöüÇĞİŞÖÜ]/u.test(text)) return text;
  return text.replace(/\b(\d{1,3})((?:,\d{3})+)(?![\d,])/gu, (_m, head: string, rest: string) => `${head}${rest.replace(/,/gu, "")}`);
}

export function readSentence(text: string, options: ReadOptions = {}): ParseResponse {
  const trimmed = normalizePasture(englishThousands(text.trim().slice(0, 500)));
  // A decimal comma ("1,5") is never guessed: in Turkish it is one and a half, elsewhere it can be a thousands separator.
  if (/\d,\d/u.test(trimmed)) {
    const tr = detectLang(trimmed) === "tr";
    const q = tr ? "Ondalık için nokta kullan (1.5), binlik ayırıcı koyma (1500)." : "Use a dot for decimals (1.5) and no thousands separators (1500).";
    return { actions: [], command: null, easterEgg: null, clarify: [q], reply: q, lang: tr ? "tr" : "en" };
  }
  const lang = detectLang(trimmed);
  const command = commandOf(trimmed);
  if (command) return { actions: [], command, easterEgg: null, clarify: [], reply: COMMANDS[command].meaning, lang };
  const egg = easterEggOf(trimmed);
  if (egg) return { actions: [], command: null, easterEgg: egg, clarify: [], reply: EASTER_EGGS[egg].line, lang };

  const trigger = extractTrigger(trimmed, options, lang);
  if (trigger) {
    const inner = readActions(trigger.rest, lang);
    const clarify = [...new Set(inner.clarify)];
    if (inner.actions.length === 0 && clarify.length === 0) clarify.push(lang === "tr" ? "Koşul gerçekleşince ne yapayım?" : "What should happen when it fires?");
    const standing: StandingOrderDraft[] = clarify.length === 0 ? [{ trigger: trigger.trigger, actions: inner.actions, text: trimmed }] : [];
    const reply = clarify.length > 0 ? (lang === "tr" ? "Bekleyen emri kurmadan önce bir şey soracağım." : "One question before I set the standing order.") : lang === "tr" ? "Bekleyen emir hazır: koşul gelince planı hazırlarım, imzayı sen atarsın." : "Standing order ready: when it fires I plan it, you sign it.";
    return { actions: [], command: null, easterEgg: null, clarify, ...(inner.choices.length > 0 ? { clarifyChoices: inner.choices } : {}), standing, reply, lang };
  }

  const { actions, clarify, choices } = readActions(trimmed, lang);
  let reply: string;
  if (clarify.length > 0) reply = lang === "tr" ? "Yola çıkmadan önce bir şey soracağım." : "One question before I run the outrun.";
  else if (actions.length === 0) reply = lang === "tr" ? "Bunu anlayamadım. Örnek: “20 USDC'yi 0x… adresine fatura 12 için gönder”." : "I did not catch that. Try “send 20 USDC to 0x… for invoice 12”.";
  else reply = LYKO_LINES.herding[lang];
  return { actions, command: null, easterEgg: null, clarify: [...new Set(clarify)], ...(choices.length > 0 ? { clarifyChoices: choices } : {}), standing: [], reply, lang };
}
