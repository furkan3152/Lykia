import { useState } from "react";

import { cx } from "./cx";

export interface NumberTickerProps {
  /** Numeric value (or decimal string) used to detect up/down moves. */
  readonly value: number | string | null | undefined;
  /** Display text; defaults to String(value). Money stays exact: pass your formatter. */
  readonly format?: (value: number | string) => string;
  /** Flash mint when the value rises and rose when it falls (default true). */
  readonly flash?: boolean;
  /** Shown while the value is unknown. */
  readonly placeholder?: string;
  readonly className?: string;
}

function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

interface TickState {
  readonly previous: number | null;
  readonly direction: "up" | "down" | null;
  readonly tick: number;
}

/**
 * A live figure whose digits tint once on change: up green, down red. It never
 * tweens through intermediate values (an invented in-between price is false
 * data), and the flash is a single colour fade on the digits only, so it can
 * update at block rate without flashing the screen.
 */
export function NumberTicker({ value, format, flash = true, placeholder = "—", className }: NumberTickerProps) {
  const current = numeric(value);
  const [state, setState] = useState<TickState>({ previous: current, direction: null, tick: 0 });
  if (current !== state.previous) {
    const direction = current !== null && state.previous !== null ? (current > state.previous ? "up" : "down") : null;
    setState({ previous: current, direction, tick: state.tick + 1 });
  }
  const text = value === null || value === undefined ? placeholder : format ? format(value) : String(value);
  const animation = flash && state.direction === "up" ? "animate-flash-up" : flash && state.direction === "down" ? "animate-flash-down" : undefined;
  return (
    <span className={cx("tnum", className)}>
      <span key={state.tick} className={animation}>
        {text}
      </span>
    </span>
  );
}
