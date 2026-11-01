/**
 * Pixel topography (pure): seeded height fields quantised into altitude
 * bands, with the band edges drawn one shade darker as contour pixels.
 * Ported from the Pixel Survey reference.
 */
import type { PixelSurface } from "./draw";

/** Mulberry32: a tiny seeded generator returning [0, 1). */
export function rngOf(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Darkens (k < 0) or lightens (k > 0) a #RRGGBB colour by a fraction. */
export function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  const r = f(n >> 16);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

/** A height field: `field[y][x]`. */
export type HeightField = ReadonlyArray<ReadonlyArray<number>>;
/** A gaussian hill: [x, y, amplitude, sigma]. */
export type Peak = readonly [number, number, number, number];

/** A field of gaussian hills: the given peaks, or five seeded ones. */
export function topoField(w: number, h: number, seed: number, peaks?: readonly Peak[]): HeightField {
  const r = rngOf(seed);
  const pts: readonly Peak[] = peaks ?? Array.from({ length: 5 }, () => [r() * w, r() * h, 0.4 + r() * 0.8, 4 + r() * 9] as const);
  const field: number[][] = [];
  for (let y = 0; y < h; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < w; x += 1) {
      let v = 0;
      for (const [px, py, a, s] of pts) v += a * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * s * s));
      row.push(v);
    }
    field.push(row);
  }
  return field;
}

export function fieldMax(field: HeightField): number {
  let m = 0;
  for (const row of field) for (const v of row) if (v > m) m = v;
  return m;
}

/** Band index of a value, 0 .. levels-1. */
export function bandOf(value: number, max: number, levels: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(levels - 1, Math.floor((value / max) * levels)));
}

/** True when the pixel sits on a band edge (its right or lower neighbour is in another band). */
export function isContour(field: HeightField, x: number, y: number, max: number, levels: number): boolean {
  const b = bandOf(field[y]![x]!, max, levels);
  const right = field[y]![x + 1];
  const down = field[y + 1]?.[x];
  return (right !== undefined && bandOf(right, max, levels) !== b) || (down !== undefined && bandOf(down, max, levels) !== b);
}

/** Paints a field with an altitude palette (low to high); band edges 28% darker. */
export function drawTopo(ctx: PixelSurface, field: HeightField, palette: readonly string[], s = 1, ox = 0, oy = 0, max?: number): void {
  const levels = palette.length;
  const m = max ?? fieldMax(field);
  for (let y = 0; y < field.length; y += 1) {
    const row = field[y]!;
    for (let x = 0; x < row.length; x += 1) {
      const b = bandOf(row[x]!, m, levels);
      const c = palette[b]!;
      ctx.fillStyle = isContour(field, x, y, m, levels) ? shade(c, -0.28) : c;
      ctx.fillRect(ox + x * s, oy + y * s, s, s);
    }
  }
}

/** The contour pixels of a field (for the faint page backdrop): a boolean mask. */
export function contourMask(field: HeightField, levels: number): boolean[][] {
  const m = fieldMax(field);
  return field.map((row, y) => row.map((_, x) => isContour(field, x, y, m, levels)));
}
