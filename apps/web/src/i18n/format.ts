/**
 * Numbers, money, percentages and dates in the interface language, through
 * Intl. Values never change: only the separators, grouping and date order
 * follow the locale ("1,234.56", "1.234,56", "1 234,56").
 */
import { currentLocale } from "./runtime";
import { INTL_TAG } from "./locales";

/** The BCP 47 tag of the current interface language, for Intl and toLocaleString. */
export function intlLocale(): string {
  return INTL_TAG[currentLocale()];
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlLocale(), options).format(value);
}

/** US dollars: "$1,234.56" in English, "1.234,56 US$" in Spanish, "1 234,56 $US" in French. */
export function formatUsd(value: number, options: { readonly min?: number; readonly max?: number; readonly compact?: boolean; readonly sign?: boolean } = {}): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: options.min ?? (options.compact ? 0 : 2),
    maximumFractionDigits: options.max ?? (options.compact ? 1 : 2),
    ...(options.compact ? { notation: "compact" as const } : {}),
    ...(options.sign ? { signDisplay: "exceptZero" as const } : {}),
  }).format(value);
}

/** A percentage already in percent units (4.05 → "4.05%", "4,05 %", "%4,05"). */
export function formatPercent(percent: number, max = 2, min = 0): string {
  return new Intl.NumberFormat(intlLocale(), { style: "percent", minimumFractionDigits: min, maximumFractionDigits: max }).format(percent / 100);
}

export function formatDate(at: Date | number | string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(intlLocale(), options).format(new Date(at));
}

export function formatDateTime(at: Date | number | string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  return new Intl.DateTimeFormat(intlLocale(), options).format(new Date(at));
}

/** "and"-joined lists in the interface language ("a, b and c", "a, b y c", "a、b和c"). */
export function formatList(items: readonly string[], type: "conjunction" | "disjunction" = "conjunction"): string {
  return new Intl.ListFormat(intlLocale(), { style: "long", type }).format(items);
}
