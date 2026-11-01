import React, { useId } from "react";

import { cx, FOCUS_RING } from "./cx";
import { Field } from "./Field";
import { fieldBoxClasses } from "./fieldStyles";
import { exceedsMax, percentOf, sanitizeDecimalInput } from "./numberInput";

export interface NumberInputProps {
  /** Decimal string ("" when empty). Amounts never pass through floats. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label?: React.ReactNode;
  readonly hint?: React.ReactNode;
  /** An external error; "exceeds max" is reported automatically. */
  readonly error?: React.ReactNode;
  /** Decimal string; enables the presets and the "Max" button. */
  readonly max?: string;
  /** Fraction digits accepted (token decimals, or the market's size decimals). */
  readonly decimals?: number;
  /** Percent presets of `max`; [] hides them. */
  readonly presets?: readonly number[];
  /** Unit shown inside the field ("USDC", "HYPE"). */
  readonly unit?: React.ReactNode;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly size?: "sm" | "md" | "lg";
  readonly id?: string;
  readonly name?: string;
  readonly className?: string;
  readonly autoFocus?: boolean;
}

const DEFAULT_PRESETS: readonly number[] = [25, 50, 75, 100];

/**
 * Amount input: decimal-safe typing and pasting (commas, grouping, leading
 * zeros), a decimals cap, percent presets and Max computed exactly from
 * `max`, and a plain-words error when the amount is above it.
 */
export function NumberInput({
  value,
  onChange,
  label,
  hint,
  error,
  max,
  decimals = 18,
  presets = DEFAULT_PRESETS,
  unit,
  placeholder = "0.00",
  disabled,
  size = "lg",
  id,
  name,
  className,
  autoFocus,
}: NumberInputProps) {
  const autoId = useId();
  const inputId = id ?? `num-${autoId}`;
  const over = max !== undefined && value !== "" && exceedsMax(value, max, decimals);
  const shownError = error ?? (over ? "More than you have. Lower the amount or press Max." : undefined);
  const described = shownError ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  const apply = (raw: string) => {
    const next = sanitizeDecimalInput(raw, decimals);
    if (next !== null) onChange(next);
  };

  return (
    <Field
      id={inputId}
      label={label}
      hint={hint}
      error={shownError}
      aside={max !== undefined ? <span>Max {max}</span> : undefined}
      className={className}
    >
      <div className={fieldBoxClasses({ invalid: Boolean(shownError), size, disabled })}>
        <input
          id={inputId}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={described}
          onChange={(event) => apply(event.target.value)}
          className="tnum h-full min-w-0 flex-1 bg-transparent font-mono text-ink outline-none placeholder:text-ink-3"
        />
        {unit ? <span className="-mr-3 flex h-full shrink-0 items-center border-l-2 border-rule bg-paper-2 px-3 font-tag text-xs uppercase text-ink">{unit}</span> : null}
      </div>
      {max !== undefined && presets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Amount presets">
          {presets.map((percent) => (
            <button
              key={percent}
              type="button"
              disabled={disabled}
              onClick={() => {
                const next = percentOf(max, percent, decimals);
                if (next !== null) onChange(next);
              }}
              className={cx(
                "h-7 bg-card px-2.5 font-tag text-[11px] text-ink-2 px-frame-thin transition-colors duration-fast hover:bg-paper-2 hover:text-ink disabled:opacity-45",
                FOCUS_RING,
              )}
            >
              {percent === 100 ? "Max" : `${percent}%`}
            </button>
          ))}
        </div>
      ) : null}
    </Field>
  );
}

/** Survey name for the amount field with a unit. */
export const NumberField = NumberInput;
export type NumberFieldProps = NumberInputProps;
