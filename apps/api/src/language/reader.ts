/**
 * The language reader: English and Turkish sentences to plan actions. It is
 * deterministic (same text, same actions), refuses to guess amounts
 * ("1,5" is ambiguous, so it asks), and answers in Lyko's voice. Sheepdog
 * commands and the hidden words are recognised before anything else.
 *
 *   "send 20 USDC to 0x… for invoice 4411"      -> send + memo
 *   "yarısını Morpho'ya yatır"                   -> earn 50%
 *   "convert 100 USDC to EURC"                   -> fx
 *   "bridge 50 usdc to base, then earn the rest" -> bridge + earn(all)
 */
import {
  commandOf,
  COMMANDS,
  easterEggOf,
  EASTER_EGGS,
  findCctpDestination,
  findToken,
  LYKO_LINES,
  type ActionAmount,
  type Address,
  type PlanAction,
} from "@lykia/core";
import type { ParseResponse } from "@lykia/core/api/language";

const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/u;
const TR_WORDS = /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(gönder|yolla|öde|çevir|dönüştür|yatır|faize|getiri|kazan|çek|borç|köprü|taşı|aktar|hepsi|hepsini|tümünü|tamamını|yarısı|yarısını|çeyreği|yüzde|fatura|için|sonra|ardından|birleştir|al|sat|takas)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu;

/** Turkish case suffixes after an apostrophe or glued to a known word. */
const TR_SUFFIX = /['’](?:y?[ıiuü]|y?[ae]|n[ıiuü]n|d[ae]n|t[ae]n|d[ae]|t[ae]|y?l[ae]|[ıiuü]n|s[ıiuü])$/iu;

export function stripSuffix(word: string): string {
  return word.replace(TR_SUFFIX, "");
}

export function detectLang(text: string): "en" | "tr" {
  return TR_CHARS.test(text) || TR_WORDS.test(text) ? "tr" : "en";
}

type Verb = PlanAction["verb"];

const VERB_PATTERNS: readonly { readonly verb: Verb; readonly en: RegExp; readonly tr: RegExp }[] = [
  { verb: "repay", en: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(repay|pay back|pay off)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu, tr: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(borcu(?:mu|nu)? öde|geri öde|borç öde|borcumu kapat)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu },
  { verb: "borrow", en: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))borrow(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu, tr: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(borç al|ödünç al)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu },
  { verb: "bridge", en: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(bridge|move .* to (?:base|ethereum|arbitrum|optimism|op|polygon|avalanche|solana|unichain|linea)|send .* to (?:base|ethereum|arbitrum|optimism|polygon|avalanche|solana|unichain|linea)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_])))/iu, tr: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(köprüle|köprü|taşı|aktar)[\p{L}\p{N}_]*/iu },
  { verb: "unify", en: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(unify|consolidate|gateway|unified balance)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu, tr: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(birleştir|gateway|tek bakiye)[\p{L}\p{N}_]*/iu },
  { verb: "withdraw", en: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(withdraw|take out|pull out|redeem|unstake)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu, tr: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(çek|geri al)[\p{L}\p{N}_]*/iu },
  { verb: "earn", en: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(earn|deposit|put .* to work|invest|stake|yield|save|park)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu, tr: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(yatır|faize|getiri|kazan|biriktir|değerlendir|çalıştır)[\p{L}\p{N}_]*/iu },
  { verb: "fx", en: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(convert|exchange|fx)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu, tr: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(çevir|dönüştür|bozdur)[\p{L}\p{N}_]*/iu },
  { verb: "swap", en: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(swap|buy|sell|trade)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu, tr: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(takas|swap|satın al|al|sat)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu },
  { verb: "send", en: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(send|pay|transfer|tip)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu, tr: /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(gönder|yolla|öde|transfer)[\p{L}\p{N}_]*/iu },
];

const VENUE_WORDS: Readonly<Record<string, string>> = {
  morpho: "morpho-vaults",
  galaxy: "morpho-vaults:galaxyUsdc",
  keyrock: "morpho-vaults:keyrockPrimeUsdc",
  steakhouse: "morpho-vaults:steakhousePrimeUsdc",
  gauntlet: "morpho-vaults:gauntletUsdcPrime",
  uniswap: "uniswap-v3",
  stablefx: "stablefx",
  gateway: "gateway",
  cctp: "cctp",
};

export interface ReadResult {
  readonly actions: PlanAction[];
  readonly clarify: string[];
}

function splitClauses(text: string): string[] {
  return text
    .split(/\s*(?:,?\s+(?:and then|then|after that|sonra|ardından|ve sonra|daha sonra)\s+|;\s*|\.\s+)/iu)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** The amount in a clause: exact decimal, a share, or everything; or a problem to ask about. */
export function readAmount(clause: string): { amount: ActionAmount | null; problem: string | null } {
  const text = clause.toLowerCase().replace(/(?:with|max|en fazla)?\s*%?\s*\d+(?:\.\d+)?\s*%?\s*(?:slippage|kayma)/giu, " ");
  if (/(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))\d+,\d+(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/u.test(text) && !/(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))\d{1,3}(?:,\d{3})+(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/u.test(text)) return { amount: null, problem: `“${/\d+,\d+/u.exec(text)?.[0]}” is ambiguous: write decimals with a dot (1.5).` };
  if (/(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))\d{1,3}(?:,\d{3})+(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/u.test(text)) return { amount: null, problem: "Write amounts without thousands separators (1500, not 1,500)." };
  const percent = /(?:%\s*(\d{1,3})|(\d{1,3})\s*%|yüzde\s*(\d{1,3})|(\d{1,3})\s*percent)/iu.exec(text);
  if (percent) {
    const value = Number(percent[1] ?? percent[2] ?? percent[3] ?? percent[4]);
    if (value >= 1 && value <= 100) return { amount: value === 100 ? { all: true } : { percent: value }, problem: null };
    return { amount: null, problem: "A share must be between 1% and 100%." };
  }
  if (/(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(half|yarı(?:sı|sını|m)?)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu.test(text)) return { amount: { percent: 50 }, problem: null };
  if (/(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(quarter|çeyre(?:k|ği|ğini))(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu.test(text)) return { amount: { percent: 25 }, problem: null };
  if (/(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(all|everything|the rest|rest|max|hepsi(?:ni)?|tümü(?:nü)?|tamamı(?:nı)?|kalanı(?:nı)?|geri kalanı(?:nı)?)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu.test(text)) return { amount: { all: true }, problem: null };
  const exact = /(?:^|[\s$€])(\d+(?:\.\d+)?)(?:k(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_])))?/u.exec(text.replace(/0x[0-9a-f]{40}/giu, " "));
  if (exact) {
    let value = exact[1] as string;
    if (/\d(?:\.\d+)?k(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/u.test(exact[0])) {
      const [w = "0", f = ""] = value.split(".");
      value = (BigInt(w) * 1000n + BigInt(f.padEnd(3, "0").slice(0, 3) || "0")).toString();
    }
    if (/^0(?:\.0+)?$/u.test(value)) return { amount: null, problem: "The amount must be more than zero." };
    return { amount: { exact: value }, problem: null };
  }
  return { amount: null, problem: null };
}

function words(clause: string): string[] {
  return clause
    .split(/[\s,]+/u)
    .map((w) => stripSuffix(w.replace(/[.!?:]+$/u, "")))
    .filter(Boolean);
}

function tokensIn(clause: string): string[] {
  const out: string[] = [];
  for (const raw of words(clause)) {
    const word = raw.replace(/^[$€]/u, "");
    if (/^\d/u.test(word)) continue;
    const token = findToken("mainnet", word);
    if (token && !out.includes(token.symbol)) out.push(token.symbol);
  }
  if (/[$]\s?\d/u.test(clause) && !out.includes("USDC")) out.unshift("USDC");
  if (/€\s?\d/u.test(clause) && !out.includes("EURC")) out.unshift("EURC");
  return out;
}

function memoIn(clause: string): string | undefined {
  const match =
    /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(?:for|memo|ref|reference|note)\s*:?\s*((?:invoice|order|payroll|bill|inv)?\s*#?[\p{L}\p{N}_-]{1,40}(?:\s+[\p{L}\p{N}_-]{1,20}){0,3})/iu.exec(clause) ??
    /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))((?:fatura|sipariş|maaş|bordro)\s*(?:no\s*)?#?[\p{L}\p{N}_-]{1,40})(?:\s+için)?/iu.exec(clause) ??
    /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(?:açıklama|not)\s*:?\s*([^,;]{1,80})/iu.exec(clause);
  const memo = match?.[1]?.replace(/0x[0-9a-fA-F]{40}/gu, "").trim();
  return memo ? memo : undefined;
}

function destinationIn(clause: string): string | undefined {
  for (const word of words(clause)) {
    const dest = findCctpDestination(word.toLowerCase());
    if (dest) return dest.key;
  }
  return undefined;
}

function venueIn(clause: string): string | undefined {
  for (const word of words(clause.toLowerCase())) if (VENUE_WORDS[word]) return VENUE_WORDS[word];
  return undefined;
}

function verbOf(clause: string): Verb | null {
  for (const p of VERB_PATTERNS) if (p.en.test(clause) || p.tr.test(clause)) return p.verb;
  return null;
}

/** Reads one clause; `previous` lets "then earn the rest" inherit a token. */
export function readClause(clause: string, previous: PlanAction | undefined, lang: "en" | "tr"): { action: PlanAction | null; clarify: string[] } {
  const clarify: string[] = [];
  let verb = verbOf(clause);
  const tokens = tokensIn(clause);
  const address = /0x[0-9a-fA-F]{40}/u.exec(clause)?.[0] as Address | undefined;
  const destination = destinationIn(clause);
  if (verb === "send" && destination && !address) verb = "bridge";
  if ((verb === "swap" || verb === "fx") && tokens.length >= 2 && tokens.every((t) => t === "USDC" || t === "EURC")) verb = "fx";
  if (!verb) return { action: null, clarify: [] };
  const { amount, problem } = readAmount(clause);
  if (problem) clarify.push(problem);
  const inherited = previous && "token" in previous ? previous.token : previous && "to" in previous && typeof previous.to === "string" && !previous.to.startsWith("0x") ? previous.to : undefined;
  const ask = (en: string, tr: string) => clarify.push(lang === "tr" ? tr : en);
  const finalAmount: ActionAmount | null = amount ?? (previous && /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(rest|kalan)/iu.test(clause) ? { all: true } : null);
  if (!finalAmount && verb !== "unify") ask("How much?", "Ne kadar?");
  const venue = venueIn(clause);

  switch (verb) {
    case "send": {
      const token = tokens[0] ?? inherited ?? "USDC";
      if (!address) ask("Send to which address (0x…)?", "Hangi adrese (0x…)?");
      if (clarify.length > 0 || !finalAmount || !address) return { action: null, clarify };
      const memo = memoIn(clause);
      return { action: { verb: "send", token, amount: finalAmount, to: address, ...(memo ? { memo } : {}) }, clarify };
    }
    case "fx":
    case "swap": {
      let from = tokens[0];
      let to = tokens[1];
      const toMatch = /(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(?:to|into|for)\s+\$?([a-z]+)/iu.exec(clause);
      if (toMatch && tokens.length >= 2) {
        const target = findToken("mainnet", toMatch[1] as string)?.symbol;
        if (target && target === from) [from, to] = [to, from];
      }
      if (/(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(buy|satın al|(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))al(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_])))/iu.test(clause) && tokens.length === 1) {
        to = tokens[0];
        from = "USDC";
      } else if (/(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))(sell|sat)(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))/iu.test(clause) && tokens.length === 1) {
        from = tokens[0];
        to = "USDC";
      }
      from = from ?? inherited;
      if (verb === "fx" && from && !to) to = from === "EURC" ? "USDC" : "EURC";
      if (!from || !to) ask("Swap which token into which?", "Hangi tokeni hangisine?");
      if (from && to && from === to) ask("Pick two different tokens.", "İki farklı token seç.");
      if (clarify.length > 0 || !finalAmount || !from || !to) return { action: null, clarify };
      const isFx = (from === "USDC" && to === "EURC") || (from === "EURC" && to === "USDC");
      const slippage = /(\d+(?:\.\d+)?)\s*%\s*(?:slippage|kayma)/iu.exec(clause);
      if (isFx && verb === "fx") return { action: { verb: "fx", from, to, amount: finalAmount }, clarify };
      return {
        action: { verb: "swap", from, to, amount: finalAmount, ...(slippage ? { slippageBps: Math.round(Number(slippage[1]) * 100) } : {}), ...(venue && !venue.startsWith("morpho") ? { venue } : {}) },
        clarify,
      };
    }
    case "earn":
    case "withdraw":
    case "borrow":
    case "repay": {
      const token = tokens[0] ?? inherited ?? "USDC";
      if (clarify.length > 0 || !finalAmount) return { action: null, clarify };
      return { action: { verb, token, amount: finalAmount, ...(venue ? { venue } : {}) }, clarify };
    }
    case "bridge": {
      const token = tokens[0] ?? inherited ?? "USDC";
      if (token !== "USDC") ask("CCTP moves USDC only.", "CCTP sadece USDC taşır.");
      if (!destination) ask("Bridge to which chain (Base, Ethereum, Arbitrum…)?", "Hangi ağa (Base, Ethereum, Arbitrum…)?");
      if (clarify.length > 0 || !finalAmount || !destination) return { action: null, clarify };
      return { action: { verb: "bridge", token: "USDC", amount: finalAmount, destination, ...(address ? { recipient: address } : {}) }, clarify };
    }
    case "unify":
      return { action: { verb: "unify", amount: finalAmount ?? { all: true } }, clarify };
  }
}

export function readSentence(text: string): ParseResponse {
  const trimmed = text.trim().slice(0, 500);
  const lang = detectLang(trimmed);
  const command = commandOf(trimmed);
  if (command) return { actions: [], command, easterEgg: null, clarify: [], reply: COMMANDS[command].meaning, lang };
  const egg = easterEggOf(trimmed);
  if (egg) return { actions: [], command: null, easterEgg: egg, clarify: [], reply: EASTER_EGGS[egg].line, lang };

  const actions: PlanAction[] = [];
  const clarify: string[] = [];
  for (const clause of splitClauses(trimmed)) {
    const result = readClause(clause, actions[actions.length - 1], lang);
    clarify.push(...result.clarify);
    if (result.action) actions.push(result.action);
  }
  let reply: string;
  if (clarify.length > 0) reply = lang === "tr" ? "Yola çıkmadan önce bir şey soracağım." : "One question before I run the outrun.";
  else if (actions.length === 0) reply = lang === "tr" ? "Bunu anlayamadım. Örnek: “20 USDC'yi 0x… adresine fatura 12 için gönder”." : "I did not catch that. Try “send 20 USDC to 0x… for invoice 12”.";
  else reply = LYKO_LINES.herding[lang];
  return { actions, command: null, easterEgg: null, clarify: [...new Set(clarify)], reply, lang };
}
