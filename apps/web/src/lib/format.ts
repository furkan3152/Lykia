/**
 * Display formatting for the web app. The shared helpers come from
 * @lykia/core so a number reads the same on the web, in the API and in the SDK; the few below are web-only (live chain figures).
 * Pure: node tests import this file.
 */
export {
  formatCompact,
  formatDuration,
  formatFixed,
  formatLeverage,
  formatMs,
  formatPercent,
  formatRelativeTime,
  formatTokenAmount,
  formatUsd,
  formatUsdCompact,
  shortAddress,
  shortHash,
} from "@lykia/core/format";

import { formatFixed } from "@lykia/core/format";

/** Block height with thousands separators: 18431206 -> "18,431,206". */
export function formatBlockNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isSafeInteger(value) || value < 0) return "—";
  return formatFixed(value, 0);
}

/** Gas price in gwei with two decimals (0.10007 -> "0.10 gwei"); tiny values keep significant digits. */
export function formatGwei(value: number | null | undefined, options: { readonly unit?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return "—";
  const digits = value !== 0 && value < 0.01 ? 4 : 2;
  const text = value.toFixed(digits);
  return options.unit === false ? text : `${text} gwei`;
}

/** Transactions per second: one decimal below 100 (9.14 -> "9.1"), whole numbers above. */
export function formatTps(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return "—";
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

/** Integer milliseconds for dense tables: 114.6 -> "115 ms"; at or above 10 s switches to seconds. */
export function formatAgeMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) return `${Math.round(clamped).toLocaleString("en-US")} ms`;
  if (clamped < 60_000) return `${(clamped / 1000).toFixed(1)} s`;
  return `${Math.floor(clamped / 60_000)}m ${Math.floor((clamped % 60_000) / 1000)}s`;
}

/** Gas used in compact form for block lists: "312k", "1.2M", "0". */
export function formatGas(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Signed percent from a fraction with an arrow for colour-blind readers: 0.042 -> "▲ 4.20%". */
export function formatSignedChange(fraction: number | null | undefined, digits = 2): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  const percent = Math.abs(fraction * 100).toFixed(digits);
  if (Number(percent) === 0) return `${(0).toFixed(digits)}%`;
  return `${fraction > 0 ? "▲" : "▼"} ${percent}%`;
}

/** Compact signed percent for tight labels: 0.042 -> "+4.2%", -0.023 -> "−2.3%" (true minus sign). */
export function formatChangeCompact(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  const percent = Math.abs(fraction * 100).toFixed(digits);
  if (Number(percent) === 0) return `${(0).toFixed(digits)}%`;
  return `${fraction > 0 ? "+" : "−"}${percent}%`;
}
