import type { ReactNode } from "react";

import { cx } from "./cx";
import { isApplePlatform } from "./platform";

export interface KbdProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/** One key cap: a small tone-outlined cap with a depth band. */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center bg-card px-1 font-tag text-[11px] leading-none text-ink px-frame-thin px-drop",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export interface KbdComboProps {
  /** Keys in order; "mod" renders ⌘ on Apple platforms and Ctrl elsewhere. */
  readonly keys: readonly string[];
  /** "then" for sequences ("g" then "t"), "plus" for chords (⌘ + K). */
  readonly joiner?: "plus" | "then";
  readonly className?: string;
}

export function KbdCombo({ keys, joiner = "plus", className }: KbdComboProps) {
  const apple = isApplePlatform();
  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 && joiner === "then" ? <span className="font-tag text-[11px] text-ink-3">then</span> : null}
          <Kbd>{key === "mod" ? (apple ? "⌘" : "Ctrl") : key}</Kbd>
        </span>
      ))}
    </span>
  );
}
