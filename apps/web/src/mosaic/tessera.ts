/**
 * Tesserae: Lykia's pixels are mosaic stones. A scene is a logical grid of
 * colours; the renderer lays every cell as a stone with a grout gap and a
 * tiny, deterministic tone jitter, so the same data always looks the same.
 *
 * Pure and DOM free (node tests load it). Canvas drawing takes any context
 * with fillStyle/fillRect, so tests can pass a recorder.
 */
import { t as msg } from "../i18n";

export type Hex = `#${string}`;
export type Cell = string | null;

/** Deterministic 0..1 noise for a cell. */
export function hash(i: number, j: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Scales an "#rrggbb" colour's channels by `f` (0..2), returned as rgb(). */
export function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** Mixes two "#rrggbb" colours (t = 0 gives a, 1 gives b), returned as "#rrggbb". */
export function mix(a: string, b: string, t: number): string {
  const x = Number.parseInt(a.slice(1, 7), 16);
  const y = Number.parseInt(b.slice(1, 7), 16);
  const c = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1)}`;
}

/** A logical framebuffer scenes draw into. */
export interface Buffer {
  readonly W: number;
  readonly H: number;
  readonly g: Cell[][];
  px(c: string | null, x: number, y: number, w?: number, h?: number): void;
  art(rows: readonly string[], x: number, y: number, palette: Readonly<Record<string, string>>, flip?: boolean): void;
  get(x: number, y: number): Cell;
}

export function buffer(W: number, H: number): Buffer {
  const g: Cell[][] = Array.from({ length: H }, () => Array<Cell>(W).fill(null));
  const px = (c: string | null, x: number, y: number, w = 1, h = 1) => {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    for (let j = 0; j < h; j++) {
      const Y = y0 + j;
      if (Y < 0 || Y >= H) continue;
      const row = g[Y]!;
      for (let i = 0; i < w; i++) {
        const X = x0 + i;
        if (X >= 0 && X < W) row[X] = c;
      }
    }
  };
  const art = (rows: readonly string[], x: number, y: number, palette: Readonly<Record<string, string>>, flip = false) => {
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]!;
        if (ch === ".") continue;
        const colour = palette[ch];
        if (!colour) continue;
        px(colour, flip ? x + (w - 1 - i) : x + i, y + j);
      }
    });
  };
  const get = (x: number, y: number): Cell => (x >= 0 && y >= 0 && x < W && y < H ? g[y]![x]! : null);
  return { W, H, g, px, art, get };
}

export interface FillContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  globalAlpha: number;
}

export interface TileOptions {
  /** Tile pitch in canvas px. */
  readonly tile: number;
  /** Grout width in canvas px (0 for plain pixels). */
  readonly gap: number;
  /** Tone jitter, 0..0.2. */
  readonly jitter?: number;
  /** "auto": each stone's grout is its own colour darkened; a colour: one grout everywhere. */
  readonly grout?: "auto" | string;
  /**
   * Assemble reveal, 0..1: stones drop in by a diagonal wave. 1 (default) is
   * the finished mosaic.
   */
  readonly assemble?: number;
}

/** Wave delay of a cell for the assemble reveal (0..0.7). */
export function assembleDelay(x: number, y: number, W: number, H: number): number {
  return ((x / W) * 0.45 + (y / H) * 0.25) + hash(x + 11, y + 5) * 0.06;
}

/** Lays a buffer as tesserae. */
export function drawTesserae(ctx: FillContext, b: Pick<Buffer, "W" | "H" | "g">, options: TileOptions): void {
  const { tile, gap } = options;
  const jitter = options.jitter ?? 0.06;
  const grout = options.grout ?? "auto";
  const assemble = options.assemble ?? 1;
  ctx.clearRect(0, 0, b.W * tile, b.H * tile);
  if (grout !== "auto") {
    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, b.W * tile, b.H * tile);
  }
  for (let y = 0; y < b.H; y++) {
    const row = b.g[y]!;
    for (let x = 0; x < b.W; x++) {
      const c = row[x];
      if (!c) continue;
      let drop = 0;
      if (assemble < 1) {
        const local = (assemble - assembleDelay(x, y, b.W, b.H)) / 0.3;
        if (local <= 0) continue;
        if (local < 1) {
          ctx.globalAlpha = local;
          drop = (1 - local) * tile * 1.5;
        }
      }
      const k = 1 + (hash(x, y) - 0.5) * 2 * jitter;
      if (gap > 0 && grout === "auto") {
        ctx.fillStyle = shade(c, 0.84);
        ctx.fillRect(x * tile, y * tile - drop, tile, tile);
      }
      ctx.fillStyle = jitter > 0 ? shade(c, k) : c;
      const nudge = gap > 0 && hash(y, x) > 0.86 ? 0.5 : 0;
      ctx.fillRect(x * tile + gap / 2 + nudge, y * tile + gap / 2 - drop, tile - gap, tile - gap);
      if (drop || ctx.globalAlpha !== 1) ctx.globalAlpha = 1;
    }
  }
}

/** Text-art -> grid, validating every character against the palette. */
export function validateArt(rows: readonly string[], palette: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  rows.forEach((row, j) => {
    for (const ch of row) if (ch !== "." && !(ch in palette)) problems.push(msg("mosaic.tessera.rowHasNoColour", { j, ch }));
  });
  return problems;
}
