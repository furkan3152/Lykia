import { useState } from "react";

import { cssVars } from "../motion/tokens";
import { digitDiff } from "../topo/geometry/altimeter";
import { cx } from "../ui/cx";

export interface PixelAltimeterProps {
  /** The formatted figure ("$48,213", "18,514,484"). Exact; never tweened. */
  readonly value: string;
  /** Accessible name ("Net worth"); read with the value. */
  readonly label: string;
  /** "boxed": a framed block per digit (hero figures); "inline": pixel digits in running text. */
  readonly variant?: "boxed" | "inline";
  readonly size?: "sm" | "md" | "lg";
  /** Paint the digits that just rolled in sun yellow ("you are here"). */
  readonly markLatest?: boolean;
  readonly className?: string;
}

const BOX = {
  sm: "h-8 w-6 text-lg",
  md: "h-11 w-8 text-[26px]",
  lg: "h-14 w-10 text-[34px]",
} as const;
const SEP = { sm: "h-8 w-2 text-lg", md: "h-11 w-2.5 text-[26px]", lg: "h-14 w-3 text-[34px]" } as const;
const INLINE = { sm: "text-lg", md: "text-2xl", lg: "text-[34px]" } as const;

interface Reading {
  readonly previous: string | null;
  readonly current: string;
  readonly tick: number;
}

/**
 * The altimeter: Pixelify digits in pixel blocks. Only the digits that
 * changed roll (four steps, up when the value rose, down when it fell), and
 * with `markLatest` they light up in sun yellow. Money is never tweened
 * through invented values. Reduced motion: the new digits are simply there.
 */
export function PixelAltimeter({ value, label, variant = "boxed", size = "md", markLatest = false, className }: PixelAltimeterProps) {
  const [reading, setReading] = useState<Reading>({ previous: null, current: value, tick: 0 });
  if (reading.current !== value) setReading({ previous: reading.current, current: value, tick: reading.tick + 1 });
  const cells = digitDiff(reading.previous, value);
  const boxed = variant === "boxed";
  let rolled = 0;
  return (
    <span className={cx("inline-flex items-end", boxed ? "gap-1.5" : "gap-0", className)}>
      <span className="sr-only">
        {label}: {value}
      </span>
      {cells.map((cell) => {
        const roll = cell.changed && cell.digit;
        const delay = roll ? rolled++ * 50 : 0;
        const framed = boxed && (cell.digit || cell.char === "$");
        return (
          <span
            key={cell.key}
            aria-hidden="true"
            className={cx(
              "relative inline-flex items-center justify-center overflow-hidden font-display font-bold leading-none tnum",
              framed ? cx(BOX[size], "px-frame-thin", markLatest && roll ? "bg-signal text-[#1B1714]" : "bg-card text-ink") : boxed ? cx(SEP[size], "text-ink-2") : cx(INLINE[size], "text-ink"),
            )}
          >
            <span
              key={roll ? `${cell.key}-${reading.tick}` : cell.key}
              className={cx("inline-block", roll && (cell.direction === "down" ? "px-digit-roll-down" : "px-digit-roll-up"))}
              style={roll ? cssVars({ "--el-delay": `${delay}ms` }) : undefined}
            >
              {cell.char}
            </span>
          </span>
        );
      })}
    </span>
  );
}
