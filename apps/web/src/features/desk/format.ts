/** Small formatters for the desk pages. */
/** "0x12ab…cd34" */
export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Compact USD: $1.2M, $34.5K, $12.34. */
export function usd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "n/a";
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 })}`;
}
