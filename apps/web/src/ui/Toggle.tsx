import React, { useId } from "react";

import { cx, FOCUS_RING } from "./cx";

export interface ToggleProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  /** Hide the visible label (it stays the accessible name). */
  readonly hideLabel?: boolean;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

/** On/off switch (role="switch"): a pixel slot with a block nub that steps across; ON fills the slot with glacier and the nub turns sun. */
export function Toggle({ checked, onChange, label, description, disabled, hideLabel = false, size = "md", className }: ToggleProps) {
  const id = useId();
  const small = size === "sm";
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex shrink-0 items-center px-frame-thin transition-[background-color] duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-50",
          small ? "h-4 w-8" : "h-5 w-10",
          checked ? "bg-accent" : "bg-paper-3",
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "px-bevel px-bevel-thin inline-block transition-transform duration-fast ease-spring",
            small ? "h-4 w-4" : "h-5 w-5",
            checked ? cx("px-btn-signal", small ? "translate-x-4" : "translate-x-5") : "px-btn-paper translate-x-0",
          )}
        />
      </button>
      <span className={cx("flex min-w-0 flex-col", hideLabel && "sr-only")}>
        <span id={`${id}-label`} className="font-tag text-xs uppercase text-ink">
          {label}
        </span>
        {description ? (
          <span id={`${id}-desc`} className="text-xs text-ink-3">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
