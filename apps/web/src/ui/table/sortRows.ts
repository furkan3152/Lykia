/** Pure sorting for DataTable. */

export type SortDirection = "asc" | "desc";
export type SortValue = number | string | bigint | null | undefined;

export interface SortState {
  readonly columnId: string;
  readonly direction: SortDirection;
}

function isMissing(value: SortValue): boolean {
  return value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
}

/** Compares two sort values ascending: numbers numerically, strings with numeric collation. */
export function compareSortValues(a: SortValue, b: SortValue): number {
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/**
 * Stable sort by `value(row)`. Missing values (null, undefined, NaN) always go
 * last, in either direction, so an unknown price never pretends to be the
 * smallest or the largest.
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, direction: SortDirection): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => {
      const missingA = isMissing(a.key);
      const missingB = isMissing(b.key);
      if (missingA || missingB) return missingA === missingB ? a.index - b.index : missingA ? 1 : -1;
      const order = compareSortValues(a.key, b.key) * sign;
      return order !== 0 ? order : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** Header click cycle: a new column starts descending (numbers people scan from the top), then flips. */
export function nextSort(current: SortState | null, columnId: string, firstDirection: SortDirection = "desc"): SortState {
  if (!current || current.columnId !== columnId) return { columnId, direction: firstDirection };
  return { columnId, direction: current.direction === "asc" ? "desc" : "asc" };
}
