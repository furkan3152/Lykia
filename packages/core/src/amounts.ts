/**
 * Exact decimal <-> base-unit conversion. Amounts cross every boundary as
 * decimal strings or bigints, never floats, so no layer silently rounds.
 *
 * Parsing is strict on purpose: "1,5" (a decimal comma), "1e3", "+1", ".5",
 * "5." and padded whitespace are refused with a reason a UI can show, rather
 * than read as something the user did not mean.
 */

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const BASE_UNIT_PATTERN = /^(?:0|[1-9]\d*)$/u;
const MAX_DECIMALS = 36;

export type AmountErrorCode =
  | "AMOUNT_EMPTY"
  | "AMOUNT_DECIMAL_COMMA"
  | "AMOUNT_EXPONENT"
  | "AMOUNT_SIGNED"
  | "AMOUNT_WHITESPACE"
  | "AMOUNT_MALFORMED"
  | "AMOUNT_TOO_PRECISE"
  | "AMOUNT_NOT_DIVISIBLE"
  | "DECIMALS_INVALID";

export class AmountError extends Error {
  readonly code: AmountErrorCode;
  constructor(code: AmountErrorCode, message: string) {
    super(message);
    this.name = "AmountError";
    this.code = code;
  }
}

export function isDecimalAmount(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

export function isBaseUnitAmount(value: unknown): value is string {
  return typeof value === "string" && BASE_UNIT_PATTERN.test(value);
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new AmountError("DECIMALS_INVALID", `decimals must be an integer between 0 and ${MAX_DECIMALS}.`);
  }
}

/** Why `text` is not a plain non-negative decimal, or null when it is one. */
export function decimalProblem(text: string): { readonly code: AmountErrorCode; readonly message: string } | null {
  if (text.length === 0) return { code: "AMOUNT_EMPTY", message: "Enter an amount." };
  if (text !== text.trim()) return { code: "AMOUNT_WHITESPACE", message: "Remove the spaces around the amount." };
  if (/^[+-]/u.test(text)) return { code: "AMOUNT_SIGNED", message: "Amounts are positive numbers without a sign." };
  if (/[eE]/u.test(text)) return { code: "AMOUNT_EXPONENT", message: `Write ${text} as a plain number, without an exponent.` };
  if (text.includes(",")) {
    // "1,500" is 1.5 in some locales and 1500 in others: refuse rather than guess.
    return { code: "AMOUNT_DECIMAL_COMMA", message: "Commas are not accepted. Use a dot for decimals (1.5) and no thousands separators (1500)." };
  }
  if (!DECIMAL_PATTERN.test(text)) return { code: "AMOUNT_MALFORMED", message: `${text} is not a valid amount.` };
  return null;
}

/** Throws an AmountError unless `text` is a plain non-negative decimal. */
export function parseDecimal(text: string): string {
  const problem = decimalProblem(text);
  if (problem) throw new AmountError(problem.code, problem.message);
  return text;
}

/** "1.5" with 6 decimals -> 1500000n. Throws on excess precision (never rounds). */
export function toBaseUnitsBig(amount: string, decimals: number): bigint {
  assertDecimals(decimals);
  parseDecimal(amount);
  const [whole = "0", fraction = ""] = amount.split(".");
  const significant = fraction.replace(/0+$/u, "");
  if (significant.length > decimals) {
    throw new AmountError("AMOUNT_TOO_PRECISE", `${amount} has more than ${decimals} decimal places.`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(significant.padEnd(decimals, "0") || "0");
}

/** "1.5" with 6 decimals -> "1500000". */
export function toBaseUnits(amount: string, decimals: number): string {
  return toBaseUnitsBig(amount, decimals).toString();
}

/** 1500000 with 6 decimals -> "1.5" (exact, trailing zeros trimmed, sign kept). */
export function fromBaseUnits(units: string | bigint, decimals: number): string {
  assertDecimals(decimals);
  const value = typeof units === "bigint" ? units : BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export type RoundingMode = "exact" | "floor" | "ceil";

/**
 * Re-expresses base units of `fromDecimals` in `toDecimals`. Scaling up is
 * always exact; scaling down must divide exactly in `exact` mode (throws
 * AMOUNT_NOT_DIVISIBLE), else rounds toward zero (`floor`) or away (`ceil`).
 */
export function scaleUnits(units: bigint, fromDecimals: number, toDecimals: number, mode: RoundingMode = "exact"): bigint {
  assertDecimals(fromDecimals);
  assertDecimals(toDecimals);
  if (toDecimals >= fromDecimals) return units * 10n ** BigInt(toDecimals - fromDecimals);
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  const quotient = units / divisor;
  const remainder = units % divisor;
  if (remainder === 0n) return quotient;
  if (mode === "exact") {
    throw new AmountError("AMOUNT_NOT_DIVISIBLE", `${units} does not convert exactly from ${fromDecimals} to ${toDecimals} decimals.`);
  }
  if (mode === "floor") return quotient;
  return units > 0n ? quotient + 1n : quotient - 1n;
}

/**
 * Arc pays gas in USDC and USDC has two faces on Arc: the native balance
 * (what `eth_getBalance` returns and `msg.value` carries) uses 18 decimals,
 * the ERC-20 interface at 0x3600…0000 uses 6. Both read the same balance.
 * Mixing them is the classic Arc bug (a 10^12 error), so conversions live
 * here and refuse to drop precision silently.
 */
export const ARC_NATIVE_USDC_DECIMALS = 18;
export const ARC_ERC20_USDC_DECIMALS = 6;

/** Native USDC (18 decimals) -> ERC-20 USDC units (6). `exact` refuses sub-micro-dollar dust. */
export function nativeUsdcToErc20(native: bigint, mode: RoundingMode = "exact"): bigint {
  return scaleUnits(native, ARC_NATIVE_USDC_DECIMALS, ARC_ERC20_USDC_DECIMALS, mode);
}

/** ERC-20 USDC units (6 decimals) -> native USDC (18). Always exact. */
export function erc20UsdcToNative(units: bigint): bigint {
  return scaleUnits(units, ARC_ERC20_USDC_DECIMALS, ARC_NATIVE_USDC_DECIMALS);
}

/** Applies a basis-point haircut, rounding down (a floor never rises). */
export function applySlippage(units: bigint, slippageBps: number): bigint {
  assertBps(slippageBps);
  return (units * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Adds a basis-point allowance, rounding up (a ceiling never falls). */
export function addSlippage(units: bigint, slippageBps: number): bigint {
  assertBps(slippageBps);
  return (units * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
}

/** `portionBps` of `units`, rounded down (shares of a split never exceed the whole). */
export function portionOf(units: bigint, portionBps: number): bigint {
  assertBps(portionBps);
  return (units * BigInt(portionBps)) / 10_000n;
}

function assertBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError("basis points must be an integer between 0 and 10000.");
}

/** Compares two non-negative decimal strings exactly: -1, 0 or 1. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const scale = Math.max(fractionLength(parseDecimal(a)), fractionLength(parseDecimal(b)));
  const left = toBaseUnitsBig(a, scale);
  const right = toBaseUnitsBig(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

function fractionLength(value: string): number {
  const dot = value.indexOf(".");
  return dot < 0 ? 0 : Math.min(value.length - dot - 1, MAX_DECIMALS);
}

/**
 * Base units as a plain decimal string truncated (toward zero) to at most
 * `maxFractionDigits`, trailing zeros removed: (1234567n, 6, 2) -> "1.23".
 * No grouping; see format.ts for display strings.
 */
export function formatUnitsTrim(units: string | bigint, decimals: number, maxFractionDigits = decimals): string {
  const exact = fromBaseUnits(units, decimals);
  return truncateDecimal(exact, maxFractionDigits);
}

/** Truncates a decimal string (toward zero) to `maxFractionDigits`, trimming trailing zeros. */
export function truncateDecimal(value: string, maxFractionDigits: number): string {
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = body.split(".");
  const clipped = fraction.slice(0, Math.max(0, maxFractionDigits)).replace(/0+$/u, "");
  const text = clipped ? `${whole}.${clipped}` : whole;
  return negative && /[1-9]/u.test(text) ? `-${text}` : text;
}

const COMPACT_UNITS: readonly { readonly exponent: number; readonly suffix: string }[] = [
  { exponent: 12, suffix: "T" },
  { exponent: 9, suffix: "B" },
  { exponent: 6, suffix: "M" },
  { exponent: 3, suffix: "K" },
];

/**
 * Compact form of a decimal string with `fractionDigits` kept after the unit,
 * truncated toward zero so a balance is never shown larger than it is:
 * "1234567.8" -> "1.23M", "999.99" -> "999.99", "-15300" -> "-15.3K".
 */
export function compact(value: string, fractionDigits = 2): string {
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  parseDecimal(body);
  const whole = body.split(".")[0] ?? "0";
  for (const unit of COMPACT_UNITS) {
    if (whole.length > unit.exponent) {
      const head = whole.slice(0, whole.length - unit.exponent);
      const tail = whole.slice(whole.length - unit.exponent);
      const text = truncateDecimal(`${head}.${tail}`, fractionDigits);
      return `${negative ? "-" : ""}${text}${unit.suffix}`;
    }
  }
  const text = truncateDecimal(body, fractionDigits);
  return negative && text !== "0" ? `-${text}` : text;
}
