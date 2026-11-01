import React from "react";

import { Tag } from "../ui/Badge";
import { cx } from "../ui/cx";

/*
 * Layout primitives that enforce the Pixel Survey's symmetry: one centre
 * axis, a 12-column grid at most 1200 px wide with 24 px gutters, centred
 * section heads, equal cards, and splits only into two equal halves.
 * Page engineers build every page from these.
 */

export interface PageProps {
  /** "wide" (default): the 1200 px sheet. "narrow": 800 px (forms, settings). "full": edge to edge (the terminal). */
  readonly width?: "wide" | "full" | "narrow";
  readonly className?: string;
  readonly children: React.ReactNode;
}

const PAGE_WIDTH = { wide: "max-w-[1248px]", narrow: "max-w-[848px]", full: "max-w-none" } as const;

/** The page sheet: centred on the axis, 24 px gutters, max 1200 px of content. */
export function Page({ width = "wide", className, children }: PageProps) {
  return <div className={cx("mx-auto w-full px-6 pb-16 pt-8 sm:pt-12", PAGE_WIDTH[width], className)}>{children}</div>;
}

export interface SectionProps {
  readonly id?: string;
  /** The tag chip above the headline ("PORTFOLIO · PIXEL ELEVATION MAP"). */
  readonly tag?: React.ReactNode;
  readonly title?: React.ReactNode;
  /** One or two sentences under the headline, centred, at most 640 px. */
  readonly lede?: React.ReactNode;
  /** Something centred under the lede (a switch, a call to action). */
  readonly actions?: React.ReactNode;
  /** h1 for the page's first section, h2 otherwise (default). */
  readonly level?: 1 | 2;
  /** Dashed pixel seam above this section (default: on for every section after the first). */
  readonly seam?: boolean;
  readonly className?: string;
  readonly children?: React.ReactNode;
}

/** A section: the centred head (tag, headline, lede) on the axis, then its content. Sections are separated by a dashed pixel seam. */
export function Section({ id, tag, title, lede, actions, level = 2, seam, className, children }: SectionProps) {
  const Heading = level === 1 ? "h1" : "h2";
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className={cx("px-section relative scroll-mt-28 py-16 sm:py-20", seam === true && "px-section-seam", seam === false && "px-section-noseam", className)}>
      {tag || title || lede ? (
        <header className={cx("mx-auto mb-10 flex flex-col items-center text-center sm:mb-12", level === 1 ? "max-w-[1200px]" : "max-w-[860px]")}>
          {tag ? <Tag>{tag}</Tag> : null}
          {title ? (
            <Heading id={headingId} className={cx("font-display font-bold text-ink", tag && "mt-5", level === 1 ? "text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.05]" : "text-display-lg")}>
              {title}
            </Heading>
          ) : null}
          {lede ? <p className="mt-4 max-w-[640px] text-[17px] leading-relaxed text-ink-2 text-pretty">{lede}</p> : null}
          {actions ? <div className="mt-7 flex flex-wrap items-center justify-center gap-4">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export interface GridProps {
  /** Equal columns on the 12-column grid: 1, 2, 3, 4, 6 or 12. Collapses to one column on phones. */
  readonly cols?: 1 | 2 | 3 | 4 | 6 | 12;
  /** Keep the columns on phones too. */
  readonly keep?: boolean;
  readonly as?: "div" | "ul" | "ol";
  readonly className?: string;
  readonly children: React.ReactNode;
}

const GRID_COLS: Readonly<Record<NonNullable<GridProps["cols"]>, string>> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-4",
  6: "md:grid-cols-3 lg:grid-cols-6",
  12: "md:grid-cols-6 lg:grid-cols-12",
};
const GRID_KEEP: Readonly<Record<NonNullable<GridProps["cols"]>, string>> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  6: "grid-cols-6",
  12: "grid-cols-12",
};

/** The 12-column grid with equal spans (24 px gutters, 28 px between rows so frames clear). */
export function Grid({ cols = 12, keep = false, as = "div", className, children }: GridProps) {
  const Element = as;
  return <Element className={cx("grid gap-x-6 gap-y-7", keep ? GRID_KEEP[cols] : cx("grid-cols-1", GRID_COLS[cols]), as !== "div" && "m-0 list-none p-0", className)}>{children}</Element>;
}

export interface CardsProps {
  /** Cards per row on wide screens (1-6). Narrower screens use the largest divisor that fits (4: 4/2/2, 3: 3/1/1, 6: 6/3/2/2), so rows stay full. */
  readonly n?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly as?: "div" | "ul" | "ol";
  /** Cards per row on phones (default: 2 for sets of 4 and 6, else 1). Pass 1 for text-heavy cards. */
  readonly phone?: 1 | 2;
  readonly className?: string;
  readonly children: React.ReactNode;
}

function largestDivisorAtMost(n: number, max: number): number {
  for (let d = Math.min(n, max); d > 1; d -= 1) if (n % d === 0) return d;
  return 1;
}

/** Equal cards in centred rows: same widths, rows stretch to equal heights, a short last row stays on the axis. */
export function Cards({ n = 3, as = "div", phone, className, children }: CardsProps) {
  const Element = as;
  const style = {
    "--cards-lg": n,
    "--cards-md": largestDivisorAtMost(n, 3),
    "--cards-sm": largestDivisorAtMost(n, 2),
    // phones keep two small cards per row only for wide sets (4 and 6)
    "--cards-xs": phone ?? (n >= 4 ? largestDivisorAtMost(n, 2) : 1),
  } as React.CSSProperties;
  return (
    <Element className={cx("px-cards", as !== "div" && "m-0 list-none p-0", className)} style={style}>
      {children}
    </Element>
  );
}

export interface SplitProps {
  /** The two halves mirror on the axis: the left half aligns to its right edge, the right half to its left. */
  readonly mirrored?: boolean;
  /** Vertical alignment of the halves (default stretch: equal heights). */
  readonly align?: "stretch" | "center";
  readonly className?: string;
  readonly children: readonly [React.ReactNode, React.ReactNode];
}

/** Two equal halves, never 2/3 + 1/3. Stacks on phones. */
export function Split({ mirrored = false, align = "stretch", className, children }: SplitProps) {
  return (
    <div className={cx("grid grid-cols-1 gap-x-6 gap-y-7 md:grid-cols-2", align === "center" ? "items-center" : "items-stretch", className)}>
      <div className={cx("flex min-w-0 flex-col [&>*]:flex-1", mirrored && "md:items-end md:text-right")}>{children[0]}</div>
      <div className={cx("flex min-w-0 flex-col [&>*]:flex-1", mirrored && "md:items-start md:text-left")}>{children[1]}</div>
    </div>
  );
}
