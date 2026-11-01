/**
 * Pure display helpers shared by the web app, Telegram and the Mini App, so a
 * number reads the same everywhere. Inputs are decimal strings (preferred,
 * exact) or numbers; outputs are plain strings with no locale surprises
 * (always "." for decimals and "," for thousands).
 *
 * Rounding for display truncates toward zero: a balance is never shown
 * larger than it is.
 */
import { isAddress as isEvmAddress } from "./contracts.js";

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

/** Plain decimal text for a number or string, or null when it is not a finite number. */
function decimalText(value: string | number | bigint): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const text = Object.is(value, -0) ? "0" : String(value);
    if (!/e/iu.test(text)) return text;
    // Expand exponent forms (1.5e-7, 1e21) without going through toFixed rounding.
    const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/iu.exec(text);
    if (!match) return null;
    const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
    const digits = `${whole}${fraction}`;
    const point = whole.length + Number(exponent);
    const body = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? `${digits}${"0".repeat(point - digits.length)}` : `${digits.slice(0, point)}.${digits.slice(point)}`;
    return `${sign}${body}`;
  }
  const trimmed = value.trim();
  return DECIMAL.test(trimmed) ? trimmed : null;
}

function splitDecimal(text: string): { negative: boolean; whole: string; fraction: string } {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = body.split(".");
  return { negative, whole: whole.replace(/^0+(?=\d)/u, ""), fraction };
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

function isZero(whole: string, fraction: string): boolean {
  return /^0*$/u.test(whole) && /^0*$/u.test(fraction);
}

/** Fixed fraction digits, truncated toward zero, grouped: (1234.5678, 2) -> "1,234.56". */
export function formatFixed(value: string | number | bigint, fractionDigits: number, options: { readonly trim?: boolean; readonly grouping?: boolean } = {}): string {
  const text = decimalText(value);
  if (text === null) return "—";
  const { negative, whole, fraction } = splitDecimal(text);
  let clipped = fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0");
  if (options.trim) clipped = clipped.replace(/0+$/u, "");
  const sign = negative && !isZero(whole, clipped) ? "-" : "";
  const wholeText = options.grouping === false ? whole : group(whole);
  return `${sign}${wholeText}${clipped ? `.${clipped}` : ""}`;
}

/** "$1,234.56"; under one cent shows "<$0.01"; unknown shows "—". */
export function formatUsd(value: string | number | null | undefined, options: { readonly cents?: boolean } = {}): string {
  if (value === null || value === undefined) return "—";
  const text = decimalText(value);
  if (text === null) return "—";
  const { negative, whole, fraction } = splitDecimal(text);
  const digits = options.cents === false ? 0 : 2;
  if (digits > 0 && whole === "0" && !isZero(whole, fraction) && isZero("0", fraction.slice(0, 2))) return negative ? "-<$0.01" : "<$0.01";
  const body = formatFixed(`${whole}.${fraction || "0"}`, digits);
  return `${negative && body !== "0.00" && body !== "0" ? "-" : ""}$${body}`;
}

const UNITS: readonly { readonly digits: number; readonly suffix: string }[] = [
  { digits: 12, suffix: "T" },
  { digits: 9, suffix: "B" },
  { digits: 6, suffix: "M" },
  { digits: 3, suffix: "K" },
];

/** Compact number: 1234567 -> "1.23M", 999.5 -> "999.5" (truncated toward zero). */
export function formatCompact(value: string | number | bigint, fractionDigits = 2): string {
  const text = decimalText(value);
  if (text === null) return "—";
  const { negative, whole, fraction } = splitDecimal(text);
  const sign = negative && !isZero(whole, fraction) ? "-" : "";
  for (const unit of UNITS) {
    if (whole.length > unit.digits) {
      const head = whole.slice(0, whole.length - unit.digits);
      const tail = whole.slice(whole.length - unit.digits).slice(0, fractionDigits).replace(/0+$/u, "");
      return `${sign}${head}${tail ? `.${tail}` : ""}${unit.suffix}`;
    }
  }
  const clipped = fraction.slice(0, fractionDigits).replace(/0+$/u, "");
  return `${sign}${whole}${clipped ? `.${clipped}` : ""}`;
}

/** "$1.23M", "$950", "—". */
export function formatUsdCompact(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const text = decimalText(value);
  if (text === null) return "—";
  const negative = text.startsWith("-");
  const body = formatCompact(negative ? text.slice(1) : text);
  return `${negative && body !== "0" ? "-" : ""}$${body}`;
}

/**
 * Percent with an explicit sign, from a fraction (0.0123 -> "+1.23%") or,
 * with `{ from: "percent" }`, from a percent value (1.23 -> "+1.23%").
 */
export function formatPercent(value: string | number | null | undefined, options: { readonly digits?: number; readonly from?: "fraction" | "percent"; readonly sign?: boolean } = {}): string {
  if (value === null || value === undefined) return "—";
  const text = decimalText(value);
  if (text === null) return "—";
  const { negative, whole, fraction } = splitDecimal(text);
  // Multiply a fraction by 100 exactly by moving the decimal point.
  let shifted = `${whole}.${fraction || "0"}`;
  if (options.from !== "percent") {
    const padded = fraction.padEnd(2, "0");
    shifted = `${`${whole}${padded.slice(0, 2)}`.replace(/^0+(?=\d)/u, "")}.${padded.slice(2) || "0"}`;
  }
  const body = formatFixed(shifted, options.digits ?? 2);
  const zero = /^[0.,]*$/u.test(body);
  const sign = zero ? "" : negative ? "-" : options.sign === false ? "" : "+";
  return `${sign}${body}%`;
}

/**
 * Token amount with `significant` significant digits for small values and
 * at most `maxFractionDigits` decimals, truncated: ("0.000012345", ...) ->
 * "0.00001234", ("1234.56789") -> "1,234.5678".
 */
export function formatTokenAmount(value: string | number | bigint, options: { readonly significant?: number; readonly maxFractionDigits?: number; readonly symbol?: string } = {}): string {
  const text = decimalText(value);
  if (text === null) return "—";
  const significant = options.significant ?? 4;
  const maxFraction = options.maxFractionDigits ?? 8;
  const { negative, whole, fraction } = splitDecimal(text);
  let digits: number;
  if (whole !== "0") digits = Math.max(0, Math.min(maxFraction, significant - whole.length));
  else {
    const leading = fraction.length - fraction.replace(/^0+/u, "").length;
    digits = Math.min(maxFraction, leading + significant);
  }
  const clipped = fraction.slice(0, digits).replace(/0+$/u, "");
  const zero = isZero(whole, clipped);
  const shown = zero && !isZero(whole, fraction) ? `<0.${"0".repeat(Math.max(0, maxFraction - 1))}1` : `${group(whole)}${clipped ? `.${clipped}` : ""}`;
  const sign = negative && !zero ? "-" : "";
  return `${sign}${shown}${options.symbol ? ` ${options.symbol}` : ""}`;
}

/** "0x1234…abcd" (checksum case kept); non-addresses are returned unchanged. */
export function shortAddress(address: string, head = 4, tail = 4): string {
  if (!isEvmAddress(address)) return address;
  return `${address.slice(0, 2 + head)}…${address.slice(-tail)}`;
}

/** "0x1234…abcd" for 32-byte hashes too. */
export function shortHash(hash: string, head = 6, tail = 4): string {
  if (!/^0x[0-9a-fA-F]{16,}$/u.test(hash)) return hash;
  return `${hash.slice(0, 2 + head)}…${hash.slice(-tail)}`;
}

/** Compact duration: 45 -> "45s", 125 -> "2m 5s", 3720 -> "1h 2m", 475200 -> "5d 12h". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  if (total < 60) return `${total}s`;
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const rest = total % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** Milliseconds, for block times and latency: 114.6 -> "115 ms", 1450 -> "1.45 s". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${formatFixed((Math.round(ms) / 1_000).toFixed(3), 2, { trim: true })} s`;
}

/** "in 5m", "3h ago", "now": relative time between two instants (ms). */
export function formatRelativeTime(target: number, now: number = Date.now()): string {
  const delta = Math.round((target - now) / 1_000);
  if (Math.abs(delta) < 5) return "now";
  const text = formatDuration(Math.abs(delta)).split(" ")[0] ?? "";
  return delta > 0 ? `in ${text}` : `${text} ago`;
}

/** Leverage: 5 -> "5x", 2.5 -> "2.5x". */
export function formatLeverage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}x`;
}
