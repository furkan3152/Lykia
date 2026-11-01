/**
 * Sprite primitives (pure, DOM free): colour grids, outlines, mirroring,
 * down-sampling and a tiny "pixel art as text" reader used by every sprite
 * in Lykia (Lyko, the flock, the wolves).
 */

/** A colour grid: `grid[y][x]` is a CSS hex colour or null (transparent). */
export type PixelGrid = ReadonlyArray<ReadonlyArray<string | null>>;
export type MutableGrid = Array<Array<string | null>>;

/** Ink used for outlines and line work. */
export const INK = "#1B1714";
export const WHITE = "#FFFFFF";
/** Sun / warm light. */
export const SUN = "#F2B33D";
/** Terracotta (Lycian rock tombs at sunset). */
export const TERRACOTTA = "#C4572E";
/** Turquoise sea. */
export const SEA = "#1F9AA5";
export const SEA_LIGHT = "#7FD6DA";
/** Pine. */
export const PINE = "#2F6B47";
export const PINE_DARK = "#1F4A31";
/** Limestone. */
export const STONE = "#E8DFCB";
export const STONE_DARK = "#BFB29A";

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function emptyGrid(width: number, height: number): MutableGrid {
  return Array.from({ length: height }, () => Array<string | null>(width).fill(null));
}

/** Adds a one pixel outline around every coloured shape (4-neighbourhood). */
export function outline(grid: PixelGrid, ink = INK): PixelGrid {
  const out: MutableGrid = grid.map((row) => row.slice());
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x]) continue;
      if (NEIGHBOURS.some(([dx, dy]) => Boolean(grid[y + dy]?.[x + dx]))) out[y]![x] = ink;
    }
  }
  return out;
}

/** Mirrors a grid left to right. */
export function mirror(grid: PixelGrid): PixelGrid {
  return grid.map((row) => row.slice().reverse());
}

/** Half-size grid: each 2 x 2 block keeps its first coloured pixel. */
export function mini(grid: PixelGrid): PixelGrid {
  const out: MutableGrid = [];
  for (let y = 0; y < grid.length; y += 2) {
    const row: Array<string | null> = [];
    const width = grid[y]?.length ?? 0;
    for (let x = 0; x < width; x += 2) row.push(grid[y]?.[x] ?? grid[y + 1]?.[x] ?? grid[y]?.[x + 1] ?? null);
    out.push(row);
  }
  return out;
}

/**
 * Reads pixel art written as text: one string per row, one character per
 * pixel, `.` or space transparent, every other character looked up in
 * `palette`. Rows are padded to the widest one. Unknown characters throw,
 * so a typo in a sprite fails its test instead of drawing a hole.
 */
export function fromArt(rows: readonly string[], palette: Readonly<Record<string, string>>): PixelGrid {
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((row, y) =>
    Array.from({ length: width }, (_, x) => {
      const ch = row[x] ?? ".";
      if (ch === "." || ch === " ") return null;
      const color = palette[ch];
      if (!color) throw new Error(`Unknown pixel "${ch}" at ${x},${y}`);
      return color;
    }),
  );
}

/** Replaces colours (a recolour map) without touching transparency. */
export function recolor(grid: PixelGrid, map: Readonly<Record<string, string>>): PixelGrid {
  return grid.map((row) => row.map((c) => (c ? (map[c] ?? c) : null)));
}

export function gridSize(grid: PixelGrid): { readonly width: number; readonly height: number } {
  return { width: Math.max(0, ...grid.map((r) => r.length)), height: grid.length };
}
