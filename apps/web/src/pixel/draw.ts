/**
 * Drawing helpers (pure): paint colour grids onto anything with `fillRect`,
 * and integer-scale maths so every canvas lands on whole device pixels.
 */
import type { PixelGrid } from "./sprite";

/** The slice of CanvasRenderingContext2D the pixel engine paints with (easy to fake in tests). */
export interface PixelSurface {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/**
 * NIGHT rim for sprites: the ink outline (#1B1714) all but vanishes on the
 * NIGHT paper (#0C1417) and card (#13212A), so by NIGHT every sprite gets a
 * one pixel moonlit rim outside its outline (4.5:1 on the NIGHT card).
 */
export const NIGHT_HALO = "#6E8C7E";

let currentHalo: string | null = null;

/**
 * Runs `paint` with sprites drawn by `drawGrid` rimmed in `halo` (null: no
 * rim). PixelCanvas wraps every draw in this from the painted theme, so
 * drawing code stays pure and theme-free.
 */
export function withSpriteHalo(halo: string | null, paint: () => void): void {
  const previous = currentHalo;
  currentHalo = halo;
  try {
    paint();
  } finally {
    currentHalo = previous;
  }
}

function drawHalo(ctx: PixelSurface, grid: PixelGrid, ox: number, oy: number, s: number, halo: string): void {
  ctx.fillStyle = halo;
  const height = grid.length;
  for (let y = -1; y <= height; y += 1) {
    const width = Math.max(grid[y - 1]?.length ?? 0, grid[y]?.length ?? 0, grid[y + 1]?.length ?? 0);
    for (let x = -1; x <= width; x += 1) {
      if (grid[y]?.[x]) continue;
      if (grid[y]?.[x - 1] || grid[y]?.[x + 1] || grid[y - 1]?.[x] || grid[y + 1]?.[x]) ctx.fillRect(ox + x * s, oy + y * s, s, s);
    }
  }
}

/**
 * Paints a colour grid at (ox, oy) with `s` px per cell; null cells stay
 * transparent. Inside `withSpriteHalo` the grid is first rimmed by one cell.
 */
export function drawGrid(ctx: PixelSurface, grid: PixelGrid, ox: number, oy: number, s = 1): void {
  if (currentHalo) drawHalo(ctx, grid, ox, oy, s, currentHalo);
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x += 1) {
      const c = row[x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * s, oy + y * s, s, s);
    }
  }
}

/** Paints a grid with every coloured cell replaced by one colour (shadows, silhouettes). */
export function drawSilhouette(ctx: PixelSurface, grid: PixelGrid, ox: number, oy: number, color: string, s = 1): void {
  ctx.fillStyle = color;
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x += 1) if (row[x]) ctx.fillRect(ox + x * s, oy + y * s, s, s);
  }
}

/** A filled pixel disc (sun, moon), drawn as horizontal runs. */
export function drawDisc(ctx: PixelSurface, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y += 1) {
    const w = Math.round(Math.sqrt(r * r - y * y));
    ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 1);
  }
}

export interface FixedScale {
  /** Device pixels per logical pixel (a whole number, at least 1). */
  readonly devicePerPixel: number;
  /** CSS px per logical pixel (devicePerPixel / dpr). */
  readonly cssPerPixel: number;
}

/**
 * The integer scale for a sprite asked to be `scale` CSS px per pixel: rounded
 * so that one logical pixel is a whole number of device pixels at this DPR.
 */
export function fixedScale(scale: number, dpr: number): FixedScale {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const devicePerPixel = Math.max(1, Math.round(scale * ratio));
  return { devicePerPixel, cssPerPixel: devicePerPixel / ratio };
}

export interface FitScale extends FixedScale {
  /** Logical width that fills the container at this scale (may overhang by less than one pixel). */
  readonly width: number;
}

/**
 * The integer scale for a canvas that fills `containerCss` px and wants about
 * `targetPixels` logical pixels across: whole device pixels per pixel, and a
 * logical width that covers the container.
 */
export function fitScale(containerCss: number, targetPixels: number, dpr: number, maxScale = 12): FitScale {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const device = Math.max(1, containerCss * ratio);
  const devicePerPixel = Math.max(1, Math.min(maxScale, Math.round(device / Math.max(1, targetPixels))));
  return { devicePerPixel, cssPerPixel: devicePerPixel / ratio, width: Math.max(1, Math.ceil(device / devicePerPixel)) };
}
