import React, { useId } from "react";

import { Blaze } from "../topo/Blaze";
import type { Grade } from "../topo/geometry/conditions";
import { cx, FOCUS_RING } from "./cx";

export interface SliderProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Tick values shown under the track (and clickable), e.g. leverage [1, 2, 5, 10, 20, 40]. */
  readonly ticks?: readonly number[];
  /** Formats the value and the ticks ("5x"). */
  readonly format?: (value: number) => string;
  readonly label?: React.ReactNode;
  /** Right side of the label row; defaults to the formatted value. */
  readonly aside?: React.ReactNode;
  /** Values at or above this render the value in rose (risky leverage). */
  readonly dangerFrom?: number;
  readonly disabled?: boolean;
  /**
   * The grade slider: maps a value to its route grade (T1-T6). Ticks and the
   * value carry the matching trail blaze, so risk reads before the number.
   */
  readonly gradeOf?: (value: number) => Grade;
  readonly id?: string;
  readonly className?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Leverage-style slider: a native range input (keyboard, screen readers and
 * touch for free) with Lykia's skin, tick marks and clickable tick labels.
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  ticks,
  format = (v) => String(v),
  label,
  aside,
  dangerFrom,
  disabled,
  gradeOf,
  id,
  className,
}: SliderProps) {
  const autoId = useId();
  const inputId = id ?? `sl-${autoId}`;
  const span = max - min || 1;
  const fill = ((clamp(value, min, max) - min) / span) * 100;
  const risky = dangerFrom !== undefined && value >= dangerFrom;
  const labelledAt: number[] = [];
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
          {label ? (
            <label htmlFor={inputId} className="caption !text-ink-2">
              {label}
            </label>
          ) : (
            <span />
          )}
          <span className={cx("tnum inline-flex items-center gap-1.5 font-display text-base font-bold", risky ? "text-down" : "text-ink")}>
            {gradeOf ? <Blaze grade={gradeOf(value)} size={13} /> : null}
            {aside ?? format(value)}
          </span>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="el-range"
        style={{ "--el-range-fill": `${fill}%` } as React.CSSProperties}
      />
      {ticks && ticks.length > 0 ? (
        <div className={cx("relative", gradeOf ? "h-9" : "h-6")} aria-hidden="true">
          {ticks.map((tick, index) => {
            const left = ((clamp(tick, min, max) - min) / span) * 100;
            const active = value >= tick;
            // Ticks too close to the previous labelled one keep their mark but drop the label.
            const labelled = index === 0 || left - labelledAt[index - 1]! >= 6;
            labelledAt[index] = labelled ? left : labelledAt[index - 1]!;
            return (
              <button
                key={tick}
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onClick={() => onChange(tick)}
                className={cx(
                  "absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1 whitespace-nowrap font-tag text-[11px] transition-colors duration-fast",
                  active ? "text-ink" : "text-ink-3",
                  FOCUS_RING,
                )}
                style={{ left: `calc(${left}% + ${(0.5 - left / 100) * 20}px)` }}
              >
                <span className={cx("h-2 w-1", active ? "bg-ink" : "bg-ink/30")} />
                {labelled ? format(tick) : <span className="sr-only">{format(tick)}</span>}
                {gradeOf && labelled ? <Blaze grade={gradeOf(tick)} size={10} label={null} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
