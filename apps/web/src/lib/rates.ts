/** Display rates from /v1/oracles (pure parsing): USD per unit, with where each came from. */
import { t } from "../i18n";
export interface DisplayRate {
  readonly usd: number;
  readonly source: string | null;
}

export function displayRate(raw: unknown, currency: "EUR" | "TRY"): DisplayRate | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const display = o.display && typeof o.display === "object" ? (o.display as Record<string, unknown>) : {};
  const sources = o.displaySources && typeof o.displaySources === "object" ? (o.displaySources as Record<string, unknown>) : {};
  const v = Number(display[currency]);
  if (!Number.isFinite(v) || v <= 0) return null;
  return { usd: v, source: typeof sources[currency] === "string" ? (sources[currency] as string) : null };
}

/** How a rate is labelled: an ECB figure is a reference rate, never a tradable price. */
export function rateLabel(rate: DisplayRate): string {
  if (rate.source === "ecb-reference") return t("lib.rates.referenceRateEcbDisplayOnly");
  if (rate.source === "pyth") return t("lib.rates.pythOnArc");
  if (rate.source === "chainlink") return t("lib.rates.chainlinkOnArc");
  return t("lib.rates.rateSourceUnknown");
}
