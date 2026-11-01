/** Pure geometry for Sparkline (SVG coordinates, y grows downward). */

export interface SparkGeometry {
  /** Polyline path ("M x y L x y ..."), empty when fewer than 2 points. */
  readonly line: string;
  /** Closed area under the line down to the bottom edge. */
  readonly area: string;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly min: number;
  readonly max: number;
}

function finite(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Maps values onto a `width` x `height` box with `pad` px of breathing room.
 * A flat series draws a centred line. Non-finite values are skipped.
 */
export function sparkGeometry(values: readonly number[], width: number, height: number, pad = 2, domain?: { readonly min?: number; readonly max?: number }): SparkGeometry {
  const data = finite(values);
  if (data.length === 0) return { line: "", area: "", points: [], min: 0, max: 0 };
  const min = domain?.min ?? Math.min(...data);
  const max = domain?.max ?? Math.max(...data);
  const span = max - min;
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = data.map((value, index) => ({
    x: round(pad + step * index),
    y: round(span === 0 ? pad + innerH / 2 : pad + innerH - ((Math.min(max, Math.max(min, value)) - min) / span) * innerH),
  }));
  if (points.length < 2) return { line: "", area: "", points, min, max };
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const area = `${line} L${last.x} ${round(height - pad)} L${first.x} ${round(height - pad)} Z`;
  return { line, area, points, min, max };
}

export interface SparkBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value: number;
}

export interface SparkBarOptions {
  readonly gap?: number;
  readonly domainMax?: number;
  readonly minBarHeight?: number;
  /** Fixed number of slots: bars keep one width and fill from the right as data arrives. */
  readonly slots?: number;
}

/** Bars from the bottom edge, scaled to the series max (or `domainMax`), `gap` px apart. */
export function sparkBars(values: readonly number[], width: number, height: number, options: SparkBarOptions = {}): SparkBar[] {
  const data = finite(values);
  if (data.length === 0 || width <= 0 || height <= 0) return [];
  const gap = options.gap ?? 2;
  const slots = Math.max(1, Math.floor(options.slots ?? data.length));
  const shown = data.slice(-slots);
  const max = options.domainMax ?? Math.max(...shown);
  const barWidth = Math.max(1, (width - gap * (slots - 1)) / slots);
  const firstSlot = slots - shown.length;
  return shown.map((value, index) => {
    const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    const barHeight = Math.max(options.minBarHeight ?? 1, ratio * height);
    return { x: round((firstSlot + index) * (barWidth + gap)), y: round(height - barHeight), width: round(barWidth), height: round(barHeight), value };
  });
}
