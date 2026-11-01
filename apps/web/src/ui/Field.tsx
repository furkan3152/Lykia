import React from "react";

import { cx } from "./cx";

export interface FieldProps {
  readonly id: string;
  readonly label?: React.ReactNode;
  /** Shown under the control; replaced by `error` when present. */
  readonly hint?: React.ReactNode;
  /** Plain words with the fix ("Enter at most 6 decimals"). */
  readonly error?: React.ReactNode;
  /** Right side of the label row (a balance, a "Max" link). */
  readonly aside?: React.ReactNode;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/** Label, control, hint/error: the layout every form control shares. */
export function Field({ id, label, hint, error, aside, className, children }: FieldProps) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      {label || aside ? (
        <div className="flex items-baseline justify-between gap-3">
          {label ? (
            <label htmlFor={id} className="caption !text-ink-2">
              {label}
            </label>
          ) : (
            <span />
          )}
          {aside ? <span className="tnum font-mono text-[11px] text-ink-3">{aside}</span> : null}
        </div>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] font-medium text-down">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
