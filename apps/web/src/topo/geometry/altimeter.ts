/**
 * Altimeter (pure): which characters of a figure changed. The altimeter rolls
 * only the digits that differ (right-aligned, like an odometer) and never
 * animates money through invented in-between values.
 */

export interface AltimeterCell {
  readonly char: string;
  readonly digit: boolean;
  /** Rolled since the previous value. */
  readonly changed: boolean;
  /** Roll direction for changed digits: the whole value went up or down. */
  readonly direction: "up" | "down" | null;
  /** Stable key from the right edge, so unchanged cells keep their DOM node. */
  readonly key: string;
}

function numericValue(text: string): number | null {
  const cleaned = text.replace(/[^0-9.-]/gu, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function digitDiff(previous: string | null, next: string): AltimeterCell[] {
  const before = previous ?? "";
  const a = numericValue(before);
  const b = numericValue(next);
  const direction = a === null || b === null || a === b ? null : b > a ? "up" : "down";
  const cells: AltimeterCell[] = [];
  const offset = before.length - next.length;
  for (let index = 0; index < next.length; index += 1) {
    const char = next[index]!;
    const old = before[index + offset];
    const digit = /\d/u.test(char);
    const changed = previous !== null && old !== char;
    cells.push({ char, digit, changed, direction: changed && digit ? direction : null, key: `r${next.length - index}` });
  }
  return cells;
}

/** Count of digits that roll for a change (for tests and for staggering). */
export function rolledDigits(previous: string | null, next: string): number {
  return digitDiff(previous, next).filter((cell) => cell.changed && cell.digit).length;
}
