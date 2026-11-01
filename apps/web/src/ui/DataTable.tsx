import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import React, { useMemo, useState } from "react";

import { cx, FOCUS_RING } from "./cx";
import { Skeleton } from "./Skeleton";
import { nextSort, sortRows, type SortDirection, type SortState, type SortValue } from "./table/sortRows";

export interface DataColumn<T> {
  readonly id: string;
  readonly header: React.ReactNode;
  readonly cell: (row: T) => React.ReactNode;
  /** Makes the column sortable. Return null for unknown values (they sort last). */
  readonly sortValue?: (row: T) => SortValue;
  /** First direction when this column is clicked (default "desc"). */
  readonly firstSort?: SortDirection;
  readonly align?: "left" | "right" | "center";
  /** CSS width ("8rem", "20%"). */
  readonly width?: string;
  /** Numeric columns render mono + tabular (default: true when align is right). */
  readonly numeric?: boolean;
  readonly className?: string;
}

export interface DataTableProps<T> {
  readonly columns: readonly DataColumn<T>[];
  readonly rows: readonly T[];
  readonly getRowId: (row: T) => string;
  /** Visually hidden caption: what the table is. */
  readonly caption: string;
  readonly dense?: boolean;
  readonly stickyHeader?: boolean;
  /** Scroll container max height (sticky header needs one), e.g. "420px". */
  readonly maxHeight?: string;
  readonly defaultSort?: SortState;
  readonly onRowClick?: (row: T) => void;
  /** Highlight a row (the newest block, the selected market). */
  readonly isRowHighlighted?: (row: T) => boolean;
  /** Dim a row (stale, settled, closed). */
  readonly isRowMuted?: (row: T) => boolean;
  readonly loading?: boolean;
  readonly loadingRows?: number;
  readonly empty?: React.ReactNode;
  readonly className?: string;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * Dense, sortable table with an optional sticky header. Rows are clickable
 * (Enter/Space too) when `onRowClick` is set. No virtualization: keep row
 * counts in the hundreds and page beyond that.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  dense = true,
  stickyHeader = true,
  maxHeight,
  defaultSort,
  onRowClick,
  isRowHighlighted,
  isRowMuted,
  loading = false,
  loadingRows = 6,
  empty,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => candidate.id === sort.columnId);
    if (!column?.sortValue) return rows;
    return sortRows(rows, column.sortValue, sort.direction);
  }, [rows, columns, sort]);

  const cellPad = dense ? "px-3 py-2" : "px-4 py-3";

  return (
    <div className={cx("el-logbook relative min-w-0 overflow-auto", className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const align = column.align ?? "left";
              const active = sort?.columnId === column.id;
              const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : column.sortValue ? "none" : undefined;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={ariaSort}
                  style={column.width ? { width: column.width } : undefined}
                  className={cx(
                    "whitespace-nowrap border-b-2 border-rule font-tag text-[11px] uppercase tracking-[0.04em] text-ink-2",
                    cellPad,
                    ALIGN[align],
                    stickyHeader && "sticky top-0 z-[1] bg-card",
                  )}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => setSort((current) => nextSort(current, column.id, column.firstSort))}
                      className={cx(
                        "inline-flex items-center gap-1 uppercase tracking-[inherit] transition-colors hover:text-ink",
                        active && "text-ink",
                        align === "right" && "flex-row-reverse",
                        FOCUS_RING,
                      )}
                    >
                      {column.header}
                      {active ? (
                        sort.direction === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: loadingRows }, (_, index) => (
                <tr key={`loading-${index}`}>
                  {columns.map((column) => (
                    <td key={column.id} className={cx("border-b border-rule", cellPad)}>
                      <Skeleton className={cx("h-3", column.align === "right" ? "ml-auto w-14" : "w-20")} />
                    </td>
                  ))}
                </tr>
              ))
            : sorted.map((row) => {
                const highlighted = isRowHighlighted?.(row) ?? false;
                const muted = isRowMuted?.(row) ?? false;
                return (
                  <tr
                    key={getRowId(row)}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    className={cx(
                      "transition-colors duration-fast",
                      onRowClick && "cursor-pointer hover:bg-paper-2/70 focus-visible:bg-paper-2 focus-visible:outline-none",
                      highlighted && "bg-signal/30",
                      muted && "opacity-55",
                    )}
                  >
                    {columns.map((column) => {
                      const align = column.align ?? "left";
                      const numeric = column.numeric ?? align === "right";
                      return (
                        <td
                          key={column.id}
                          className={cx(
                            "whitespace-nowrap border-b border-rule text-ink",
                            cellPad,
                            ALIGN[align],
                            numeric && "tnum font-mono",
                            highlighted && "first:font-semibold",
                            column.className,
                          )}
                        >
                          {column.cell(row)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {!loading && sorted.length === 0 && empty ? <div className="py-2">{empty}</div> : null}
    </div>
  );
}
