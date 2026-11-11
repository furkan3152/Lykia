/**
 * Thread memory for short follow-ups. "Do it", "half of that", "same but to
 * Base", "the second one" mean nothing alone: code resolves them against the
 * previous turns of the thread (what the owner last asked for, the choices
 * the last answer offered, the next step it named, the rows on its cards) and
 * hands the planner a full sentence. Amounts are scaled by arithmetic here,
 * never by a model. When nothing can be resolved the turn asks what "it" is.
 *
 * Pure: the caller passes the stored thread.
 */
import { CCTP_DESTINATIONS } from "@lykia/core";
import type { AnswerBlock } from "@lykia/core/api/answer";
import type { AgentProposal } from "@lykia/core/api/agents";

import { tx } from "@lykia/core";
export interface ThreadTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly options?: readonly string[];
  readonly meant?: string;
  /** The answer in English when the owner read it in another language. */
  readonly english?: string;
  readonly blocks?: readonly AnswerBlock[];
  readonly proposals?: readonly AgentProposal[];
}

export type FollowUp =
  /** The message stands on its own. */
  | { readonly kind: "none" }
  /** Resolved: plan or answer this sentence instead. `how` says what it was resolved against, for the work trail. */
  | { readonly kind: "resolved"; readonly sentence: string; readonly how: string }
  /** The plan the owner agreed to is already on a card: show it again. */
  | { readonly kind: "ready"; readonly proposals: readonly AgentProposal[] }
  /** It refers to something, but the thread does not say what. */
  | { readonly kind: "ask"; readonly question: string; readonly options: readonly string[] };

const YES = /^(?:(?:ok(?:ay)?|yes|yep|yeah|sure|please|alright|fine|great|good|perfect)[,.! ]*)*(?:do it|do that|do this|go ahead|go for it|go on|proceed|let'?s do it|let'?s go|make it happen|sounds good|looks good|confirm(?:ed)?|approve[d]?|plan it|plan that|yes|yep|yeah|sure|ok(?:ay)?|evet|tamam|yap|onayl[\u0131i]yorum|devam(?: et)?|olur|hadi)(?: (?:please|now|then|l\u00fctfen))?[.! ]*$/iu;
/** A word pattern with boundaries that hold for any Unicode letter (\b only knows ASCII). */
const u = (body: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "iu");
const ORDINALS: readonly (readonly [RegExp, number])[] = [
  [u("first|1st|option 1|number 1|birinci(?:si)?|ilki?"), 0],
  [u("second|2nd|option 2|number 2|ikinci(?:si)?"), 1],
  [u("third|3rd|option 3|number 3|\u00fc\u00e7\u00fcnc\u00fc(?:s\u00fc)?"), 2],
  [u("fourth|4th|option 4|number 4|d\u00f6rd\u00fcnc\u00fc(?:s\u00fc)?"), 3],
  [u("last|sonuncu(?:su)?"), -1],
];
const SCALES: readonly (readonly [RegExp, number])[] = [
  [u("half|yar[\u0131i]s[\u0131i](?:n[\u0131i])?"), 0.5],
  [u("(?:a |one )?quarter|\u00e7eyre\u011fi(?:ni)?"), 0.25],
  [u("(?:a |one )?third"), 1 / 3],
  [u("double|twice|2x|iki kat[\u0131i](?:n[\u0131i])?"), 2],
  [u("triple|3x"), 3],
];
const AMOUNT = /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?=\s*(?:USDC|EURC|cirBTC|WETH|USD|dollars?|\$|%)?)/u;
const TOKEN = /\b(USDC|EURC|cirBTC|WETH)\b/iu;

const chainNames = (): { name: string; words: string[] }[] => CCTP_DESTINATIONS.map((d) => ({ name: d.name, words: [d.key, d.name.toLowerCase(), ...d.aliases.map((a) => a.toLowerCase())] }));

function chainIn(text: string): { name: string; match: string } | null {
  const t = text.toLowerCase();
  for (const c of chainNames()) {
    for (const word of c.words.slice().sort((a, b) => b.length - a.length)) {
      const m = new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:['\u2019]?(?:e|a|ye|ya))?(?![\\p{L}\\p{N}])`, "iu").exec(t);
      if (m) return { name: c.name, match: text.slice(m.index, m.index + m[0].length) };
    }
  }
  return null;
}

/** Trims a scaled amount: cents for money, six decimals for the rest, no trailing zeros. */
function fmt(n: number, token: string | null): string {
  const places = token && !/^(?:USDC|EURC|USD)$/iu.test(token) ? 6 : 2;
  const s = (Math.floor(n * 10 ** places + 1e-9) / 10 ** places).toFixed(places);
  return s.includes(".") ? s.replace(/0+$/u, "").replace(/\.$/u, "") : s;
}

/** Every exact amount in a sentence multiplied by `factor` (addresses and invoice numbers untouched). */
export function scaleSentence(sentence: string, factor: number): string | null {
  let changed = false;
  const out = sentence.replace(/(?<![\p{L}\p{N}_#x.])(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s*)(USDC|EURC|cirBTC|WETH|USD|dollars?)(?![\p{L}\p{N}_])|(\$\s?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/giu, (whole: string, sign: string | undefined, int: string | undefined, frac: string | undefined, gap: string | undefined, unit: string | undefined, sign2: string | undefined, int2: string | undefined, frac2: string | undefined) => {
    const value = Number(`${(int ?? int2 ?? "").replace(/,/gu, "")}${frac ?? frac2 ?? ""}`);
    if (!Number.isFinite(value) || value <= 0) return whole;
    changed = true;
    return `${sign ?? sign2 ?? ""}${fmt(value * factor, unit ?? "USD")}${gap ?? ""}${unit ?? ""}`;
  });
  return changed ? out : null;
}

/** The last thing the owner asked for that carried an amount or named a move (their words, or what a follow-up meant). */
function lastRequest(thread: readonly ThreadTurn[]): string | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i]!;
    if (m.role !== "user") continue;
    const said = m.meant ?? m.text;
    if (said.length <= 400 && /\d/u.test(said) && /\b(?:send|pay|swap|convert|bridge|deposit|withdraw|earn|put|buy|sell|borrow|repay|lend|supply|move|invest|save)\b/iu.test(said)) return said;
  }
  return null;
}

function lastAssistant(thread: readonly ThreadTurn[]): ThreadTurn | null {
  for (let i = thread.length - 1; i >= 0; i--) if (thread[i]!.role === "assistant") return thread[i]!;
  return null;
}

/** The sentence a "**Next:** say “...”" line offered. */
function nextStepOf(text: string): string | null {
  const m = /\*\*Next:?\*\*[^\n]*?\bsay\s+[“"]([^”"\n]{3,300})[”"]/iu.exec(text);
  return m ? m[1]!.trim() : null;
}

/** The moves a card's rows suggest, in order (a yields card: one sentence per venue). */
function rowSentences(blocks: readonly AnswerBlock[] | undefined): string[] {
  for (const b of blocks ?? []) {
    if (b.kind === "yields") return b.rows.slice(0, 6).map((r) => tx("Put my idle {token} to work in {venue}", { token: b.token, venue: r.venue }));
  }
  return [];
}

/** Resolves a short follow-up against the thread. `message` is the owner's words (English or Turkish). */
export function resolveFollowUp(message: string, thread: readonly ThreadTurn[]): FollowUp {
  const text = message.trim();
  if (text.length === 0 || text.length > 90) return { kind: "none" };
  const t = text.toLowerCase().replace(/[’]/gu, "'");
  if (thread.length === 0) return YES.test(t) ? { kind: "ask", question: tx("Do what? Tell me the move and the amount."), options: [] } : { kind: "none" };
  const prev = lastAssistant(thread);
  const options = prev?.options ?? [];
  const request = lastRequest(thread);

  // A choice by position: "the second one", "option 2", "the last one".
  const words = t.replace(/[.!?]+$/u, "").split(/\s+/u).length;
  if (words <= 6) {
    const ord = ORDINALS.find(([re]) => re.test(t));
    const list = options.length > 0 ? options : rowSentences(prev?.blocks);
    if (ord && u("one|option|number|choice|birinci(?:si)?|ikinci(?:si)?|ilki|sonuncu(?:su)?|\u00fc\u00e7\u00fcnc\u00fc(?:s\u00fc)?|\\d(?:st|nd|rd|th)").test(t)) {
      if (list.length === 0) return { kind: "ask", question: tx("Which one do you mean? I have no list of choices in this thread."), options: [] };
      const picked = ord[1] < 0 ? list[list.length - 1] : list[ord[1]];
      if (!picked) return { kind: "ask", question: tx("There {value}. Which one?", { value: list.length === 1 ? tx("is only one choice") : tx("are {length} choices", { length: list.length }) }), options: [...list].slice(0, 4) };
      return { kind: "resolved", sentence: picked, how: tx("a choice from the previous answer") };
    }
  }

  // "Do it", "yes", "go ahead".
  if (YES.test(t)) {
    if (options.length === 1) return { kind: "resolved", sentence: options[0]!, how: tx("the choice the previous answer offered") };
    if (options.length > 1) return { kind: "ask", question: tx("Which one should I do?"), options: [...options].slice(0, 4) };
    if (prev?.proposals && prev.proposals.length > 0) return { kind: "ready", proposals: prev.proposals };
    const next = prev ? nextStepOf(prev.english ?? prev.text) : null;
    if (next) return { kind: "resolved", sentence: next, how: tx("the next step the previous answer named") };
    if (request) return { kind: "resolved", sentence: request, how: tx("your last request") };
    return { kind: "ask", question: tx("Do what? Tell me the move and the amount."), options: [] };
  }

  // "Half of that", "double it", "a quarter".
  const scale = SCALES.find(([re]) => re.test(t));
  if (scale && words <= 7 && (u("that|it|this|of|the same|amount|instead|bunun|onun|only|just|make it").test(t) || /^(?:half|double|twice|a quarter|a third|yar[\u0131i]s[\u0131i](?:n[\u0131i])?)[.! ]*$/iu.test(t)) && !TOKEN.test(text)) {
    if (!request) return { kind: "ask", question: tx("Half of what? Tell me the move and the amount."), options: [] };
    const scaled = scaleSentence(request, scale[1]);
    if (!scaled) return { kind: "ask", question: tx("I could not find the amount to change. What amount should I use?"), options: [] };
    return { kind: "resolved", sentence: scaled, how: tx("your last request, with the amount recomputed") };
  }

  // "Same but to Base", "same again", "make it 200", "same but in EURC".
  const same = /\b(?:same|again|ayn[\u0131i]s[\u0131i](?:n[\u0131i])?|tekr\u0061r|make it|change it to|instead|but)\b/iu.test(t);
  if (same && words <= 9) {
    if (!request) return /\b(?:same|again|ayn[\u0131i]s[\u0131i]|tekr\u0061r)\b/iu.test(t) ? { kind: "ask", question: tx("The same as what? I have no earlier request in this thread."), options: [] } : { kind: "none" };
    let sentence = request;
    let touched = false;
    const chain = chainIn(text);
    if (chain) {
      const old = chainIn(request);
      if (old) sentence = sentence.replace(old.match, chain.name);
      else {
        const amount = AMOUNT.exec(request);
        const token = TOKEN.exec(request)?.[1] ?? "USDC";
        sentence = amount ? tx("Bridge {value} {token} to {name}", { value: amount[0].replace(/^\$\s?/u, ""), token, name: chain.name }) : tx("{value}, then bridge it to {name}", { value: request.replace(/[.?!]+$/u, ""), name: chain.name });
      }
      touched = true;
    }
    const rest = chain ? text.replace(new RegExp(chain.match.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"), " ") : text;
    const amount = AMOUNT.exec(rest);
    if (amount && Number(amount[0].replace(/[$,\s]/gu, "")) > 0) {
      const old = AMOUNT.exec(sentence);
      if (old) {
        sentence = sentence.replace(old[0], `${old[1] ?? ""}${amount[0].replace(/^\$\s?/u, "")}`);
        touched = true;
      }
    }
    const token = TOKEN.exec(rest)?.[1];
    if (token && !amount) {
      const old = TOKEN.exec(sentence);
      if (old && old[1]!.toUpperCase() !== token.toUpperCase()) {
        sentence = sentence.replace(old[0], token.toUpperCase() === "CIRBTC" ? "cirBTC" : token.toUpperCase());
        touched = true;
      }
    }
    if (touched) return { kind: "resolved", sentence, how: tx("your last request, with that one change") };
    if (/^(?:the )?same(?: again| thing| as before)?[.! ]*$|^(?:do (?:it|that) )?again[.! ]*$|^ayn[\u0131i]s[\u0131i](?:n[\u0131i])?(?: yap)?[.! ]*$|^tekr\u0061r(?: yap)?[.! ]*$/iu.test(t)) return { kind: "resolved", sentence: request, how: tx("your last request") };
  }
  return { kind: "none" };
}
