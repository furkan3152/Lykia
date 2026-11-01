import { useId } from "react";

import { cx } from "./cx";
import { sparkBars, sparkGeometry } from "./sparkline";
import type { Tone } from "./tones";

export interface SparklineProps {
  readonly values: readonly number[];
  readonly width?: number;
  readonly height?: number;
  /** "line" (with a soft area) or "bars". */
  readonly variant?: "line" | "bars";
  /** Line colour; "auto" picks mint when the series ends above its start, rose below. */
  readonly tone?: Tone | "auto";
  /** Bars at or above this value use `highlightTone` (e.g. slow blocks in gold). */
  readonly highlightFrom?: number;
  readonly highlightTone?: Tone;
  /** Dashed reference line at this value (a target block time, a zero line). */
  readonly reference?: number;
  /** Bars only: fixed slot count, so bars keep their width and fill from the right. */
  readonly slots?: number;
  /** Bars only: top of the scale (default: the series max). */
  readonly domainMax?: number;
  /** Accessible summary ("Block interval, last 60 blocks, 109 to 121 ms"). Without it the chart is decorative. */
  readonly label?: string;
  /** Stretch to the container width (viewBox scaling). */
  readonly fluid?: boolean;
  readonly className?: string;
}

const STROKE: Readonly<Record<Tone, string>> = {
  violet: "rgb(var(--summit))",
  accent: "rgb(var(--summit))",
  gold: "rgb(var(--warn))",
  signal: "rgb(var(--signal))",
  mint: "rgb(var(--up))",
  up: "rgb(var(--up))",
  rose: "rgb(var(--down))",
  down: "rgb(var(--down))",
  sky: "rgb(var(--water))",
  water: "rgb(var(--water))",
  warn: "rgb(var(--warn))",
  neutral: "rgb(var(--ink-3))",
  floor: "rgb(var(--floor))",
  ridge: "rgb(var(--ridge))",
  summit: "rgb(var(--summit))",
};

/** Small SVG chart for a series: trend lines in tables, block intervals. */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  variant = "line",
  tone = "auto",
  highlightFrom,
  highlightTone = "gold",
  reference,
  label,
  fluid = false,
  slots,
  domainMax,
  className,
}: SparklineProps) {
  const gradientId = useId();
  const first = values[0];
  const last = values[values.length - 1];
  const resolved: Tone = tone === "auto" ? (first !== undefined && last !== undefined && last < first ? "rose" : "mint") : tone;
  const color = STROKE[resolved];
  const geometry = variant === "line" ? sparkGeometry(values, width, height, 2) : null;
  const bars = variant === "bars" ? sparkBars(values, width, height, { gap: (slots ?? values.length) > 80 ? 1 : 2, slots, domainMax }) : [];
  const max = variant === "bars" ? (domainMax ?? Math.max(0, ...values.filter(Number.isFinite))) : (geometry?.max ?? 0);
  const min = geometry?.min ?? 0;
  const referenceY =
    reference === undefined
      ? null
      : variant === "bars"
        ? max > 0
          ? height - Math.min(1, reference / max) * height
          : null
        : max === min
          ? null
          : 2 + (height - 4) - ((reference - min) / (max - min)) * (height - 4);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={fluid ? "100%" : width}
      height={height}
      preserveAspectRatio={fluid ? "none" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("block overflow-visible", className)}
    >
      {geometry && geometry.line ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.16" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={geometry.area} fill={`url(#${gradientId})`} />
          <path d={geometry.line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
      {bars.map((bar, index) => (
        <rect
          key={index}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          fill={highlightFrom !== undefined && bar.value >= highlightFrom ? STROKE[highlightTone] : color}
          opacity={highlightFrom !== undefined && bar.value >= highlightFrom ? 1 : 0.85}
        />
      ))}
      {referenceY !== null ? (
        <line x1="0" x2={width} y1={referenceY} y2={referenceY} stroke="rgb(var(--ink))" strokeOpacity="0.5" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}
