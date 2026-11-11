
/** Small formatters for the desk pages. */
import { formatUsd, t } from "../../i18n";

/** Compact USD: $1.2M, $34.5K, $12.34. */
export function usd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return t("desk.format.na");
  const n = Number(value);
  if (!Number.isFinite(n)) return t("desk.format.na");
  if (Math.abs(n) >= 1e4) return formatUsd(n, { compact: true, max: 2 });
  return formatUsd(n, { min: 0, max: n < 1 ? 6 : 2 });
}
