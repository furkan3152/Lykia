import React from "react";

import { openOracle } from "../oracle/oracleStore";
import { LykoEmpty } from "../pixel/LykoEmpty";
import { Chip } from "./Badge";
import { cx } from "./cx";

export interface EmptyStateProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Replaces the pasture with your own small glyph. */
  readonly icon?: React.ReactNode;
  /** Kept for compatibility: every scene is now Lyko resting by the gate. */
  readonly scene?: "summit" | "trail" | "map";
  /** An example sentence that teaches what to do; clicking it opens "Where to?" with it. */
  readonly example?: string;
  /** The one action (a Button or ButtonLink). */
  readonly action?: React.ReactNode;
  readonly compact?: boolean;
  readonly className?: string;
}

/** Empty states teach: Lyko resting by the gate, what is missing in plain words, an example, one next step. */
export function EmptyState({ title, description, icon, example, action, compact = false, className }: EmptyStateProps) {
  const exampleChip = example ? (
    <Chip mono className="mt-1" onClick={() => openOracle(example)} aria-label={`Try: ${example}`}>
      <span aria-hidden="true" className="font-semibold text-summit-ink">
        →
      </span>
      “{example}”
    </Chip>
  ) : null;
  const actions =
    exampleChip || action ? (
      <>
        {exampleChip}
        {action}
      </>
    ) : undefined;
  if (!icon) return <LykoEmpty title={title} description={description} action={actions} compact={compact} className={className} />;
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "gap-2 py-6" : "gap-3 px-4 py-10", className)}>
      <span aria-hidden="true" className="mb-2 flex h-11 w-11 items-center justify-center bg-card text-ink px-frame px-drop">
        {icon}
      </span>
      <p className={cx("font-display font-bold text-ink", compact ? "text-xl" : "text-2xl")}>{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-2 text-pretty">{description}</p> : null}
      {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
    </div>
  );
}
