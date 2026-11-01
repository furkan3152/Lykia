import React, { useId, useRef } from "react";

import { cx, FOCUS_RING } from "./cx";

export interface SegmentOption<V extends string> {
  readonly value: V;
  readonly label: React.ReactNode;
  readonly disabled?: boolean;
  /** Why it is disabled, or what it means (native tooltip + screen readers). */
  readonly hint?: string;
}

export interface SegmentedControlProps<V extends string> {
  readonly value: V;
  readonly onChange: (value: V) => void;
  readonly options: readonly SegmentOption<V>[];
  /** Accessible name of the group. */
  readonly label: string;
  readonly size?: "sm" | "md";
  readonly fullWidth?: boolean;
  /** Tint of the selected segment: violet (default), mint for long, rose for short. */
  readonly tone?: "violet" | "mint" | "rose" | "gold";
  readonly className?: string;
}

const SELECTED: Readonly<Record<NonNullable<SegmentedControlProps<string>["tone"]>, string>> = {
  violet: "px-btn px-btn-thin px-btn-accent text-accent-ink",
  mint: "px-btn px-btn-thin px-btn-up text-card",
  rose: "px-btn px-btn-thin px-btn-down text-card",
  gold: "px-btn px-btn-thin px-btn-signal text-signal-ink",
};

/** One choice out of a few (radiogroup with arrow-key navigation). */
export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  fullWidth = false,
  tone = "violet",
  className,
}: SegmentedControlProps<V>) {
  const name = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);

  const move = (from: number, delta: number) => {
    if (enabled.length === 0) return;
    const position = enabled.indexOf(from);
    const next = enabled[(position + delta + enabled.length) % enabled.length];
    if (next === undefined) return;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("inline-flex gap-[2px] bg-paper-2 p-[2px] px-frame-thin", fullWidth && "flex w-full", className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            disabled={option.disabled}
            title={option.hint}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(index, -1);
              }
            }}
            className={cx(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-tag text-ink transition-[background-color,color] duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-45",
              size === "sm" ? "h-7 px-2.5 text-[11px]" : "h-9 px-3.5 text-[13px]",
              fullWidth && "flex-1",
              selected ? SELECTED[tone] : "bg-card text-ink-2 hover:bg-paper-2 hover:text-ink",
              FOCUS_RING,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
