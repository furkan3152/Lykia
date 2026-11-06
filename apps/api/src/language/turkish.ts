/**
 * Common Turkish money requests, rewritten into the English the reader
 * parses. Deterministic and conservative: it only runs when the text looks
 * Turkish, maps a short list of verbs, conjunctions and quantities, and
 * leaves tokens, amounts and addresses exactly as written. Replies stay in
 * English whatever the input language (language/english.ts).
 *
 * The repository is English only, so every Turkish letter below is written
 * as a Unicode escape. Examples (escaped the same way) live in the tests:
 * "100 USDC'yi EURC'ye \u00e7evir" reads as "100 USDC'yi EURC'ye convert";
 * "1 USDC ile EURC al ve en iyi getiriyle bor\u00e7 ver" reads as
 * "buy EURC with 1 USDC and at the best yield lend it".
 */
import { findToken } from "@lykia/core";

const L = "[\\p{L}\\p{N}_]";
function w(body: string): RegExp {
  return new RegExp(`(?<!${L})(?:${body})(?!${L})`, "giu");
}

const TURKISH_LETTERS = /[\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/u;
const TURKISH_WORDS = w("ve|ile|al|al\u0131n|sat|g\u00f6nder|yolla|\u00f6de|yat\u0131r|\u00e7evir|d\u00f6n\u00fc\u015ft\u00fcr|takas|getiri\\p{L}*|faiz\\p{L}*|heps\u0069ni|t\u00fcm\u00fcn\u00fc|tamam\u0131n\u0131|yar\u0131s\u0131n\u0131|sonra|ard\u0131ndan|bor\u00e7|k\u00f6pr\u00fcle|\u00e7ek|onu|bunu");

export function looksTurkish(text: string): boolean {
  return TURKISH_LETTERS.test(text) || (text.match(TURKISH_WORDS)?.length ?? 0) >= 1;
}

/** Ordered rewrites; multi-word phrases first. */
const REWRITES: readonly (readonly [RegExp, string])[] = [
  // "1 USDC ile EURC al" -> "buy EURC with 1 USDC"
  [new RegExp(`((?:\\d+(?:\\.\\d+)?\\s*)?[$\u20ac]?${L}+(?:['\u2019]\\p{L}+)?)\\s+ile\\s+(${L}+(?:['\u2019]\\p{L}+)?)\\s+al(?:\u0131n|\u0131r m\u0131s\u0131n)?(?!${L})`, "giu"), "buy $2 with $1"],
  [w("en iyi getiri(?:yle|ye|li|de)?|en y\u00fcksek getiri(?:yle|ye|li|de)?"), "at the best yield"],
  [w("bor\u00e7 ver(?:in|ir misin)?"), "lend"],
  [w("bor\u00e7 al(?:\u0131n|\u0131r m\u0131s\u0131n)?"), "borrow"],
  [w("geri \u00f6de(?:yin)?|borcu(?:mu)? \u00f6de"), "repay"],
  [w("takas et(?:in)?|takasla"), "swap"],
  [w("getiri(?:ye|yle)?|faiz(?:e|le)?"), "for yield"],
  [w("\u00e7evir(?:in|ir misin)?|d\u00f6n\u00fc\u015ft\u00fcr(?:\u00fcn)?|de\u011fi\u015ftir(?:in)?"), "convert"],
  [w("sat(?:\u0131n)?"), "sell"],
  [w("al(?:\u0131n)?"), "buy"],
  [w("g\u00f6nder(?:in)?|yolla(?:y\u0131n)?|transfer et"), "send"],
  [w("\u00f6de(?:yin)?"), "pay"],
  [w("yat\u0131r(?:\u0131n)?|biriktir"), "deposit"],
  [w("\u00e7ek(?:in)?"), "withdraw"],
  [w("k\u00f6pr\u00fcle(?:yin)?"), "bridge"],
  [w("ve"), "and"],
  [w("sonra|ard\u0131ndan"), "then"],
  [w("heps\u0069ni|t\u00fcm\u00fcn\u00fc|tamam\u0131n\u0131|heps\u0069"), "all"],
  [w("yar\u0131s\u0131n\u0131|yar\u0131s\u0131"), "50%"],
  [w("onu|bunu"), "it"],
];

function hasObject(clause: string): boolean {
  if (/\d|%|\ball\b|\bit\b|0x[0-9a-f]{40}/iu.test(clause)) return true;
  return clause.split(/[\s,]+/u).some((word) => findToken("mainnet", word.replace(/['\u2019].*$/u, "")) !== null);
}

/** The text in reader English when it looks Turkish; otherwise unchanged. */
export function turkishToEnglish(text: string): string {
  if (!looksTurkish(text)) return text;
  let out = text;
  for (const [re, to] of REWRITES) out = out.replace(re, to);
  // A Turkish verb with no object after "and"/"then" acts on what came before: "\u2026 al ve bor\u00e7 ver" = "\u2026 and lend it".
  const parts = out.split(/(\s+(?:and|then)\s+)/u);
  for (let i = 2; i < parts.length; i += 2) {
    const clause = parts[i] as string;
    if (!hasObject(clause)) parts[i] = `${clause.trimEnd()} it`;
  }
  return parts.join("").replace(/\s+/gu, " ").trim();
}
