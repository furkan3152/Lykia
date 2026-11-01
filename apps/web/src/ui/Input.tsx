import React, { useId } from "react";

import { cx } from "./cx";
import { Field } from "./Field";
import { fieldBoxClasses } from "./fieldStyles";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly label?: React.ReactNode;
  readonly hint?: React.ReactNode;
  readonly error?: React.ReactNode;
  readonly aside?: React.ReactNode;
  readonly leftSlot?: React.ReactNode;
  readonly rightSlot?: React.ReactNode;
  readonly size?: "sm" | "md" | "lg";
  /** Monospace + tabular figures (addresses, amounts). */
  readonly mono?: boolean;
  readonly containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, aside, leftSlot, rightSlot, size = "md", mono = false, id, className, containerClassName, disabled, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `in-${autoId}`;
  const described = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} aside={aside} className={containerClassName}>
      <div className={fieldBoxClasses({ invalid: Boolean(error), size, disabled })}>
        {leftSlot ? <span className="flex shrink-0 items-center text-ink-3">{leftSlot}</span> : null}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          className={cx(
            "h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed",
            mono && "tnum font-mono",
            className,
          )}
          {...rest}
        />
        {rightSlot ? <span className="flex shrink-0 items-center text-ink-3">{rightSlot}</span> : null}
      </div>
    </Field>
  );
});
