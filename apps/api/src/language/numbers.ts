/**
 * Numbers as people write them in each interface language: "1,234.56"
 * (English, Chinese), "1.234,56" (Turkish, Spanish, Portuguese) and
 * "1 234,56" (French, with a space or a narrow no-break space). The figure
 * checks read every number through here, so a Turkish answer's "2.500,75"
 * is matched against the same evidence as an English "2,500.75".
 */
import type { Locale } from "@lykia/core";

/** Languages that write the decimal part after a comma. */
const COMMA_DECIMAL: ReadonlySet<Locale> = new Set<Locale>(["tr", "es", "pt-BR", "fr"]);

/** The digits of one number: grouped thousands (comma, dot, or a space kind) with an optional decimal part, or plain digits. */
export function numberPattern(locale: Locale): string {
  const space = locale === "en" || locale === "zh-CN" ? "\\u00a0\\u202f" : " \\u00a0\\u202f";
  return `\\d{1,3}(?:[,.${space}]\\d{3})+(?!\\d)(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?`;
}

export interface ReadNumber {
  readonly value: number;
  /** Digits after the decimal mark, as written. */
  readonly decimals: number;
}

/** Reads a written number ("1.234,56", "1 234,56", "1,234.56", "4,5") in the given language; null when it is not one. */
export function readNumber(raw: string, locale: Locale): ReadNumber | null {
  const s = raw.replace(/[\s\u00a0\u202f]/gu, "");
  if (!/^\d[\d.,]*$/u.test(s)) return null;
  const commas = (s.match(/,/gu) ?? []).length;
  const dots = (s.match(/\./gu) ?? []).length;
  let int = s;
  let frac = "";
  const split = (mark: "," | "."): void => {
    const at = s.lastIndexOf(mark);
    int = s.slice(0, at);
    frac = s.slice(at + 1);
  };
  if (commas && dots) split(s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".");
  else if (commas === 1 || dots === 1) {
    const mark = commas ? "," : ".";
    const after = s.length - s.indexOf(mark) - 1;
    const before = s.indexOf(mark);
    const groupsThousands = after === 3 && before <= 3;
    // In comma-decimal languages a lone comma is the decimal mark and a lone dot before three digits groups thousands; the other way round elsewhere.
    const decimal = COMMA_DECIMAL.has(locale) ? (mark === "," ? true : !groupsThousands) : mark === "." ? true : !groupsThousands;
    if (decimal) split(mark);
  }
  int = int.replace(/[.,]/gu, "");
  if (!/^\d+$/u.test(int) || (frac && !/^\d+$/u.test(frac))) return null;
  const value = Number(frac ? `${int}.${frac}` : int);
  return Number.isFinite(value) ? { value, decimals: frac.length } : null;
}
