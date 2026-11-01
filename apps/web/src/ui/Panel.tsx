import React from "react";

import { cx } from "./cx";

/**
 * Pixel Survey panels are card stock in a 2 px stepped tone line (never
 * ink, never a block shadow). `flat` is the line alone (dense app grids);
 * `raised` (default) adds a depth band inside the bottom edge; `sheet` a
 * stronger tone line and deeper band for the one thing that matters on a view;
 * `well` is a sunk paper area without a frame. Frames are drawn outside the
 * box: keep at least 12 px between panels (the layout primitives do).
 * Legacy names: glass -> raised, glow -> sheet.
 */
export type PanelVariant = "flat" | "raised" | "sheet" | "well" | "glass" | "glow";
export type PanelPadding = "none" | "sm" | "md" | "lg";

export interface PanelProps extends React.HTMLAttributes<HTMLElement> {
  readonly variant?: PanelVariant;
  readonly padding?: PanelPadding;
  /** Element to render (section for landmarks, article for feed items). */
  readonly as?: "div" | "section" | "article" | "aside" | "li";
  /** Lifts toward the reader on hover (clickable cards). */
  readonly interactive?: boolean;
  /** A folded-map corner crease (top right). */
  readonly fold?: boolean;
}

const VARIANTS: Readonly<Record<PanelVariant, string>> = {
  flat: "bg-card px-frame",
  raised: "bg-card px-frame px-drop",
  glass: "bg-card px-frame px-drop",
  sheet: "bg-card px-frame px-drop-lg",
  glow: "bg-card px-frame px-drop-lg",
  well: "bg-paper-2/70",
};

const PADDING: Readonly<Record<PanelPadding, string>> = {
  none: "",
  sm: "p-3",
  md: "p-4 sm:p-6",
  lg: "p-6 sm:p-8",
};

export const Panel = React.forwardRef<HTMLElement, PanelProps>(function Panel(
  { variant = "raised", padding = "md", as = "div", interactive = false, fold = false, className, children, ...rest },
  ref,
) {
  const Element = as as React.ElementType;
  return (
    <Element
      ref={ref}
      className={cx(
        "relative",
        VARIANTS[variant],
        PADDING[padding],
        interactive && "px-press",
        fold && "el-fold",
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
});

export const Card = Panel;

export interface PanelHeaderProps {
  /** Mono caps title ("NET WORTH · 3 LAYERS"). */
  readonly title: React.ReactNode;
  /** Right side: a status, a link, a small control. */
  readonly aside?: React.ReactNode;
  readonly id?: string;
  readonly className?: string;
  /** Rule under the header that runs to the panel edges (for padding="none" panels). */
  readonly ruled?: boolean;
}

/** The mono caps header row used by every panel. */
export function PanelHeader({ title, aside, id, className, ruled = false }: PanelHeaderProps) {
  return (
    <div className={cx("flex min-h-6 items-center justify-between gap-3", ruled ? "border-b-2 border-rule px-4 py-2.5" : "mb-4", className)}>
      <h2 id={id} className="caption truncate !font-tag !text-ink">
        {title}
      </h2>
      {aside ? <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-ink-2">{aside}</div> : null}
    </div>
  );
}

export interface SectionHeaderProps {
  /** Parts of the caption; joined with " · " ("ROPE", "3 POSITIONS"). */
  readonly parts: readonly React.ReactNode[];
  /** Big headline under the caption. */
  readonly title?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly aside?: React.ReactNode;
  readonly id?: string;
  /** Headline level (default h2). */
  readonly level?: 2 | 3;
  readonly className?: string;
}

/** Section header: the mono micro-caps caption (" · " separated), an optional headline, one line of copy. */
export function SectionHeader({ parts, title, description, aside, id, level = 2, className }: SectionHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  const caption = (
    <span className="caption">
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          {part}
        </React.Fragment>
      ))}
    </span>
  );
  return (
    <div className={cx("mb-5 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {title ? (
          <>
            <p>{caption}</p>
            <Heading id={id} className={cx("mt-2 font-display font-bold text-ink", level === 2 ? "text-[28px] leading-tight sm:text-[32px]" : "text-[22px]")}>
              {title}
            </Heading>
          </>
        ) : (
          <Heading id={id}>{caption}</Heading>
        )}
        {description ? <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-2 text-pretty">{description}</p> : null}
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </div>
  );
}
