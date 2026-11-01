/**
 * Decimal-string rules for amount inputs (pure). Amounts stay strings end to
 * end so no float ever rounds a balance; presets compute exact fractions of
 * the max with BigInt.
 */

const PARTIAL_DECIMAL = /^\d*(?:\.\d*)?$/u;

/**
 * Cleans what a person typed or pasted into an amount field: commas become
 * dots, spaces and thousands separators are dropped, leading zeros collapse,
 * and the fraction is cut at `maxDecimals`. Returns null when the text cannot
 * become a non-negative decimal (the field then keeps its previous value).
 */
export function sanitizeDecimalInput(raw: string, maxDecimals = 18): string | null {
  let text = raw.trim().replace(/[\s_]/gu, "");
  if (text === "") return "";
  // "1,234.5" (grouping) vs "1,5" (decimal comma): a single comma with no dot is a decimal separator.
  if (text.includes(",") && !text.includes(".") && (text.match(/,/gu) ?? []).length === 1 && !/,\d{3}$/u.test(text)) text = text.replace(",", ".");
  else text = text.replace(/,/gu, "");
  if (text.startsWith(".")) text = `0${text}`;
  if (!PARTIAL_DECIMAL.test(text)) return null;
  const [whole = "", fraction] = text.split(".");
  const cleanWhole = whole.replace(/^0+(?=\d)/u, "") || "0";
  if (fraction === undefined) return cleanWhole;
  return `${cleanWhole}.${fraction.slice(0, Math.max(0, maxDecimals))}`;
}

/** Scaled integer of a decimal string at `decimals` (truncated), or null when not a decimal. */
export function toScaled(value: string, decimals: number): bigint | null {
  if (!/^\d+(?:\.\d*)?$/u.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
}

/** Decimal string of a scaled integer, trailing zeros trimmed. */
export function fromScaled(scaled: bigint, decimals: number): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/u, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** `percent`% of `max` (decimal string), truncated to `decimals`: (50, "1.5", 6) -> "0.75". */
export function percentOf(max: string, percent: number, decimals: number): string | null {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return null;
  const scaled = toScaled(max, decimals);
  if (scaled === null) return null;
  return fromScaled((scaled * BigInt(percent)) / 100n, decimals);
}

/** True when `value` is greater than `max` (both decimal strings); false when either is not a decimal. */
export function exceedsMax(value: string, max: string, decimals: number): boolean {
  const a = toScaled(value, decimals);
  const b = toScaled(max, decimals);
  return a !== null && b !== null && a > b;
}
