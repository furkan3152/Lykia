/**
 * Figures in the request's language through Intl: the values never change,
 * only separators, grouping and the currency's place.
 */
import { INTL_TAGS } from "@lykia/core";
import { currentLocale } from "./context.js";

export function intlTag(): string {
  return INTL_TAGS[currentLocale()];
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlTag(), options).format(value);
}

export function formatUsd(value: number, options: { readonly min?: number; readonly max?: number } = {}): string {
  return new Intl.NumberFormat(intlTag(), { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: options.min ?? 2, maximumFractionDigits: options.max ?? 2 }).format(value);
}

export function formatPercent(percent: number, max = 2): string {
  return new Intl.NumberFormat(intlTag(), { style: "percent", maximumFractionDigits: max }).format(percent / 100);
}

export function formatList(items: readonly string[], type: "conjunction" | "disjunction" = "conjunction"): string {
  return new Intl.ListFormat(intlTag(), { style: "long", type }).format(items);
}
