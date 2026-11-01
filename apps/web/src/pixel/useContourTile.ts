import { useMemo } from "react";

import { useResolvedTheme } from "../app/state/useTheme";
import { rngOf, contourMask, topoField, type Peak } from "./topo";

export const TILE = 96;

const masks = new Map<number, boolean[][]>();

/** The contour pixels of a 96 x 96 seeded tile (seven bands). Seed 4242 is the page backdrop. */
export function tileMask(seed: number): boolean[][] {
  const hit = masks.get(seed);
  if (hit) return hit;
  let peaks: Peak[];
  if (seed === 4242) {
    peaks = [
      [20, 30, 1, 18],
      [70, 60, 0.9, 20],
      [55, 10, 0.6, 12],
      [10, 85, 0.7, 14],
      [96, 96, 0.6, 16],
      [0, 0, 0.5, 14],
      [96, 0, 0.45, 12],
      [0, 96, 0.45, 12],
    ];
  } else {
    const random = rngOf(seed);
    peaks = Array.from({ length: 6 }, () => [random() * TILE, random() * TILE, 0.5 + random() * 0.6, 10 + random() * 12] as const);
  }
  const mask = contourMask(topoField(TILE, TILE, seed, peaks), 7);
  masks.set(seed, mask);
  return mask;
}

/**
 * A data URL of the contour tile in a sheet token (`--ink`, `--contour`) at
 * `alpha`, redrawn when the sheet changes. Null until mounted.
 */
export function useContourTile(seed: number, token: string, alpha: number): string | null {
  const theme = useResolvedTheme();
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    void theme;
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim().split(/\s+/u).join(",");
    const canvas = document.createElement("canvas");
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = `rgb(${value})`;
    ctx.globalAlpha = alpha;
    const mask = tileMask(seed);
    for (let y = 0; y < TILE; y += 1) for (let x = 0; x < TILE; x += 1) if (mask[y]![x]) ctx.fillRect(x, y, 1, 1);
    return canvas.toDataURL();
  }, [theme, seed, token, alpha]);
}
