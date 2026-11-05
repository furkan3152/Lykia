/**
 * Reference FX for display only: ECB euro foreign exchange reference rates
 * (published once per working day around 16:00 CET), read keyless through
 * api.frankfurter.dev. Not tradable and never used by the Fence: a display
 * currency such as TRY only changes how amounts are shown. Cached for six
 * hours; unavailable means "unpriced", never a guess.
 */
import type { FetchLike } from "../health/dependencies.js";

const REFERENCE_FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,TRY";
const REFERENCE_FX_TTL_MS = 6 * 60 * 60_000;

export interface ReferenceFx {
  /** Units of each currency per 1 USD, as decimal strings. */
  readonly perUsd: Readonly<Record<string, string>>;
  /** ECB publication date (YYYY-MM-DD). */
  readonly date: string;
  readonly source: "ECB reference rates via frankfurter.dev";
  readonly tradable: false;
}

let cache: { at: number; value: ReferenceFx } | null = null;

export async function referenceFx(fetchImpl: FetchLike, now: number): Promise<ReferenceFx | null> {
  if (cache && now - cache.at < REFERENCE_FX_TTL_MS) return cache.value;
  try {
    const response = await fetchImpl(REFERENCE_FX_URL, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return cache?.value ?? null;
    const body = (await response.json()) as { date?: unknown; rates?: Record<string, unknown> };
    const rates = body.rates ?? {};
    const perUsd: Record<string, string> = {};
    for (const [k, v] of Object.entries(rates)) if (typeof v === "number" && Number.isFinite(v) && v > 0) perUsd[k] = String(v);
    if (typeof body.date !== "string" || Object.keys(perUsd).length === 0) return cache?.value ?? null;
    const value: ReferenceFx = { perUsd, date: body.date, source: "ECB reference rates via frankfurter.dev", tradable: false };
    cache = { at: now, value };
    return value;
  } catch {
    return cache?.value ?? null;
  }
}
