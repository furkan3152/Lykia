/**
 * The number guard on Lyko's prose. Every figure in the model's final text
 * (an amount, a percentage, a price, a health factor) must match a value
 * this turn's tools returned, a card carries, or the owner wrote. Formatting
 * may differ ("1,950.00 USDC" for 1950, "6.1%" for 0.061); arithmetic may
 * not: a total or a blended rate the code did not compute is not in the
 * evidence, so it is taken out and the sentence points at the card instead.
 * Small bare counts ("2 steps", "3 venues") are not money and pass.
 */
import type { AnswerBlock } from "@lykia/core/api/agents";
import { normalizeNumber, type Ground } from "./grounding.js";

export interface GuardResult {
  readonly text: string;
  /** The figures that had no source and were taken out. */
  readonly removed: readonly string[];
}

const SYMBOLS = "USDC|EURC|cirBTC|BTC|WETH|ETH|USYC|JPYC|USD|EUR|USDT|bps";
/**
 * A figure: an optional currency sign, the number (thousands separators, decimals), an optional k/m suffix, then
 * an optional percent sign or token symbol. Hex, addresses and words around it are left alone.
 */
const FIGURE = new RegExp(`(?<![\\p{L}\\p{N}_.\\-/#])((?:about|around|roughly|approximately|nearly|almost|some|~)\\s+)?([$€]\\s?)?(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?(?:\\s?(k|m|bn)\\b)?(\\s?%|\\s?(?:${SYMBOLS})\\b)?(?![\\p{L}\\p{N}_]|\\.\\d)`, "giu");

/** The values a block puts on screen: every number in it, as evidence. */
export function blockNumbers(blocks: readonly AnswerBlock[]): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 8 || v === null || v === undefined) return;
    if (typeof v === "number" && Number.isFinite(v)) out.add(String(Number(v.toPrecision(15))));
    else if (typeof v === "string") {
      const n = /^-?\d+(?:\.\d+)?$/u.test(v.trim()) ? normalizeNumber(v.trim().replace(/^-/u, "")) : null;
      if (n !== null) out.add(n);
      for (const m of v.matchAll(/\d[\d,]*(?:\.\d+)?/gu)) {
        const x = normalizeNumber(m[0]);
        if (x !== null) out.add(x);
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

/**
 * Removes figures with no source from the model's final text. With a card on the answer, the sentence points at it;
 * without one, the figure is called unavailable rather than guessed.
 */
export function guardNumbers(text: string, ground: Ground | undefined, blocks: readonly AnswerBlock[]): GuardResult {
  if (!text) return { text, removed: [] };
  const evidence = [...new Set([...(ground?.toolNumbers ?? []), ...(ground?.ownerNumbers ?? []), ...blockNumbers(blocks)])].map(Number).filter((n) => Number.isFinite(n));
  const removed: string[] = [];
  const hasCard = blocks.length > 0;
  // Code spans and addresses are data, not figures.
  const protectedSpans: [number, number][] = [];
  for (const m of text.matchAll(/`[^`]*`|0x[0-9a-fA-F]{6,}|\b\d{1,2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/gu)) protectedSpans.push([m.index!, m.index! + m[0].length]);
  const out = text.replace(FIGURE, (whole: string, hedge: string | undefined, sign: string | undefined, int: string, frac: string | undefined, suffix: string | undefined, unitRaw: string | undefined, offset: number) => {
    if (protectedSpans.some(([a, b]) => offset >= a && offset < b)) return whole;
    const unit = unitRaw ? unitRaw.trim() : null;
    const decimals = frac ? frac.length - 1 : 0;
    const base = Number(`${int.replace(/,/gu, "")}${frac ?? ""}`);
    const scale = suffix ? ({ k: 1e3, m: 1e6, bn: 1e9 } as const)[suffix.toLowerCase() as "k" | "m" | "bn"] : 1;
    const value = base * scale;
    if (!moneyish({ sign: Boolean(sign), unit, decimals, value, suffix: Boolean(suffix) })) return whole;
    const percent = unit === "%";
    // A k/m figure was rounded for reading: compare it at the precision it was written with.
    if (suffix ? evidence.some((e) => Math.abs(Math.abs(e) - value) <= (scale * 10 ** -decimals) / 2) : matches(base, decimals, percent, evidence)) return whole;
    removed.push(whole.trim());
    const lead = whole.match(/^\s*/u)?.[0] ?? "";
    const what = percent ? "a rate" : "an amount";
    return `${lead}${hasCard ? `${what} (see the card)` : `${what} that is unavailable right now`}`;
  });
  return { text: out, removed };
}
