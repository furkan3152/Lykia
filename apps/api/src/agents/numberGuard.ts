/**
 * The number guard on Lyko's prose. Every figure in the model's final text
 * (an amount, a percentage, a price, a health factor) must match a value
 * this turn's tools returned, a card carries, or the owner wrote. Formatting
 * may differ ("1,950.00 USDC" for 1950, "6.1%" for 0.061); arithmetic may
 * not: a total or a blended rate the code did not compute is not in the
 * evidence. A figure is never swapped for a placeholder inside a sentence:
 * the sentence (or the bullet) that carries it is dropped whole, so what is
 * left stays grammatical. When nothing is left the caller rebuilds the
 * answer (one retry with the allowed figures, or a summary written by code).
 * Small bare counts ("2 steps", "3 venues") are not money and pass.
 */
import type { AnswerBlock } from "@lykia/core/api/agents";
import type { Locale } from "@lykia/core";
import { currentLocale } from "../i18n/context.js";
import { numberPattern, readNumber } from "../language/numbers.js";
import { normalizeNumber, type Ground } from "./grounding.js";

export interface GuardResult {
  readonly text: string;
  /** The figures that had no source and were taken out. */
  readonly removed: readonly string[];
}

const SYMBOLS = "USDC|EURC|cirBTC|BTC|WETH|ETH|USYC|JPYC|USD|EUR|USDT|bps";
/** Hedges before a figure ("about $5"), in every interface language. */
const HEDGES = "about|around|roughly|approximately|nearly|almost|some|~|yakla\u015f\u0131k|a\u015fa\u011f\u0131 yukar\u0131|alrededor de|aproximadamente|cerca de|unos|unas|environ|pr\u00e8s de|\u7ea6|\u5927\u7ea6";
const FIGURES = new Map<Locale, RegExp>();
/**
 * A figure: an optional currency sign or leading percent ("%4,5" in Turkish), the number (thousands separators and
 * decimals as the language writes them), an optional k/m suffix, then an optional percent sign, currency sign or token
 * symbol. Hex, addresses and words around it are left alone.
 */
function figureRe(locale: Locale): RegExp {
  let re = FIGURES.get(locale);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}_.,\\-/#])((?:${HEDGES})\\s+)?((?:US)?[$\u20ac]\\s?|%\\s?)?(${numberPattern(locale)})(?:\\s?(k|m|bn)\\b)?(\\s?%|[\\s\u00a0\u202f]?[$\u20ac]|\\s?(?:${SYMBOLS})\\b)?(?![\\p{L}\\p{N}_]|[.,]\\d)`, "giu");
    FIGURES.set(locale, re);
  }
  return re;
}

/** The values a block puts on screen: every number in it, as evidence. */
export function blockNumbers(blocks: readonly AnswerBlock[], locale: Locale = currentLocale()): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 8 || v === null || v === undefined) return;
    if (typeof v === "number" && Number.isFinite(v)) out.add(String(Number(v.toPrecision(15))));
    else if (typeof v === "string") {
      const n = /^-?\d+(?:\.\d+)?$/u.test(v.trim()) ? normalizeNumber(v.trim().replace(/^-/u, "")) : null;
      if (n !== null) out.add(n);
      // Cards are written in the interface language; English digits are read too.
      for (const l of locale === "en" ? (["en"] as const) : (["en", locale] as const)) {
        for (const m of v.matchAll(new RegExp(`(${numberPattern(l)})(?:\\s?(k|m|bn)\\b)?`, "giu"))) {
          const x = normalizeNumber(m[1]!, null, l);
          if (x !== null) out.add(x);
          // "$124.6M" on a card stands for 124,600,000: both readings are evidence.
          const scaled = m[2] ? normalizeNumber(m[1]!, m[2], l) : null;
          if (scaled !== null) out.add(scaled);
        }
      }
    } else if (Array.isArray(v)) for (const x of v) visit(x, depth + 1);
    else if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) visit(x, depth + 1);
  };
  visit(blocks, 0);
  return out;
}

/** True when the shown figure is one of the evidence values, at the precision it is shown with. */
function matches(shown: number, decimals: number, percent: boolean, evidence: readonly number[]): boolean {
  const candidates = percent ? [shown, shown / 100] : [shown];
  if (percent && decimals <= 2 && evidence.some((e) => Number.isInteger(e) && e > 0 && e <= 10_000 && Math.abs(e / 100 - shown) < 1e-9)) return true;
  for (const want of candidates) {
    const places = percent && want !== shown ? decimals + 2 : decimals;
    const step = 10 ** -places;
    for (const e of evidence) {
      const a = Math.abs(e);
      if (Math.abs(a - want) < 1e-9) return true;
      // The evidence rounded (or cut) to the shown precision.
      const rounded = Math.round(a / step) * step;
      const floored = Math.floor(a / step) * step;
      if (Math.abs(rounded - want) < step / 1000 || Math.abs(floored - want) < step / 1000) return true;
    }
  }
  return false;
}

/** A figure that carries money meaning: a sign, a unit, a decimal, or a large number. Small bare integers are counts. */
function moneyish(raw: { sign: boolean; unit: string | null; decimals: number; value: number; suffix: boolean }): boolean {
  if (!raw.sign && raw.unit === null && raw.decimals === 0 && !raw.suffix && raw.value >= 1900 && raw.value <= 2100) return false; // a year
  return raw.sign || raw.unit !== null || raw.decimals > 0 || raw.suffix || raw.value >= 100;
}

/** One figure found in prose, and whether the evidence carries it. */
interface Found {
  readonly raw: string;
  readonly sourced: boolean;
}

function scan(text: string, evidence: readonly number[], locale: Locale = currentLocale()): Found[] {
  const out: Found[] = [];
  // Code spans, addresses, clock times and dates are data, not figures.
  const protectedSpans: [number, number][] = [];
  for (const m of text.matchAll(/`[^`]*`|0x[0-9a-fA-F]{6,}|\b\d{1,2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/gu)) protectedSpans.push([m.index!, m.index! + m[0].length]);
  for (const m of text.matchAll(figureRe(locale))) {
    const offset = m.index!;
    if (protectedSpans.some(([a, b]) => offset >= a && offset < b)) continue;
    const [whole, , lead, digits, suffix, unitRaw] = m as unknown as [string, string | undefined, string | undefined, string, string | undefined, string | undefined];
    const sign = lead && lead.trim() !== "%" ? lead : unitRaw && /[$\u20ac]/u.test(unitRaw) ? unitRaw : undefined;
    const read = readNumber(digits, locale);
    if (!read) continue;
    const unit = unitRaw ? unitRaw.trim() : lead?.trim() === "%" ? "%" : null;
    const decimals = read.decimals;
    const base = read.value;
    const scale = suffix ? ({ k: 1e3, m: 1e6, bn: 1e9 } as const)[suffix.toLowerCase() as "k" | "m" | "bn"] : 1;
    const value = base * scale;
    if (!moneyish({ sign: Boolean(sign), unit, decimals, value, suffix: Boolean(suffix) })) continue;
    const percent = unit === "%";
    // A k/m figure was rounded for reading: compare it at the precision it was written with.
    const sourced = suffix ? evidence.some((e) => Math.abs(Math.abs(e) - value) <= (scale * 10 ** -decimals) / 2) : matches(base, decimals, percent, evidence);
    out.push({ raw: whole.trim(), sourced });
  }
  return out;
}

/** What the owner sees besides the cards: a plan's title, steps, warnings, refusals and checks, the options offered, and the work steps. */
export interface Visible {
  readonly proposals?: readonly { readonly title?: string; readonly steps?: readonly string[]; readonly warnings?: readonly string[]; readonly reasons?: readonly string[]; readonly preflight?: readonly unknown[] }[];
  readonly options?: readonly string[];
  /** Anything else drawn on screen: compiled programs, draft links, work-step results. */
  readonly other?: readonly unknown[];
}

/** Every number the owner can see on screen, outside the cards. */
export function visibleNumbers(v: Visible): Set<string> {
  const shown = [...(v.proposals ?? []).map((p) => ({ title: p.title, steps: p.steps, warnings: p.warnings, reasons: p.reasons, preflight: p.preflight })), v.options ?? [], v.other ?? []];
  return blockNumbers(shown as unknown as AnswerBlock[]);
}

/**
 * The evidence prose may cite, by rule: what the owner wrote, and what the owner can see (cards, plans, options).
 * A figure a tool returned but no card shows is not evidence: the owner could not check it.
 */
export function visibleGround(ground: Ground | undefined, v: Visible): Ground {
  return { ownerText: ground?.ownerText ?? "", ownerNumbers: ground?.ownerNumbers ?? new Set(), toolNumbers: visibleNumbers(v), toolAddresses: new Set(), question: null };
}

/** The evidence for a turn: what tools returned, what the owner wrote, and every number on a card. */
export function evidenceOf(ground: Ground | undefined, blocks: readonly AnswerBlock[]): number[] {
  return [...new Set([...(ground?.toolNumbers ?? []), ...(ground?.ownerNumbers ?? []), ...blockNumbers(blocks)])].map(Number).filter((n) => Number.isFinite(n));
}

/** Splits a paragraph into sentences without breaking decimals ("1.38") or abbreviations inside a figure. */
export function sentencesOf(line: string): string[] {
  // Latin scripts end a sentence with a mark and a space before a capital ("¿" and "¡" open Spanish ones); Chinese ends it with 。！？ and no space.
  return line.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}$€*"“([¿¡«])|(?<=[。！？])\s*(?=\S)/u).filter((s) => s.length > 0);
}

/**
 * Drops every sentence or bullet that `bad` flags, and returns what is left as tidy markdown. A "**Next:**" line or a
 * bullet goes whole; a paragraph loses only its offending sentences.
 */
export function dropSentences(text: string, bad: (sentence: string) => boolean): string {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      lines.push("");
      continue;
    }
    if (/^\s*(?:[-*•]\s|\d+\.\s|\*\*Next:?\*\*)/u.test(line)) {
      if (!bad(line)) lines.push(line);
      continue;
    }
    const kept = sentencesOf(line).filter((s) => !bad(s));
    if (kept.length > 0) lines.push(kept.join(" "));
  }
  return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

/**
 * Checks the model's prose against the turn's evidence. Sentences that state a figure with no source are dropped
 * whole; `removed` lists the figures that caused it. The text never contains a placeholder.
 */
export function guardNumbers(text: string, ground: Ground | undefined, blocks: readonly AnswerBlock[]): GuardResult {
  if (!text) return { text, removed: [] };
  const evidence = evidenceOf(ground, blocks);
  const removed = scan(text, evidence).filter((f) => !f.sourced).map((f) => f.raw);
  if (removed.length === 0) return { text, removed };
  return { text: dropSentences(text, (sentence) => scan(sentence, evidence).some((f) => !f.sourced)), removed };
}

/** The figures a rewrite may use, formatted for the model: the turn's evidence, largest first, at most `limit`. */
export function allowedFigures(ground: Ground | undefined, blocks: readonly AnswerBlock[], limit = 60): string[] {
  return evidenceOf(ground, blocks).filter((n) => n !== 0).sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, limit).map((n) => String(n));
}
