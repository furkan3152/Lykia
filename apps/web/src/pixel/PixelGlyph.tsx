import { useCallback } from "react";

import { useResolvedTheme } from "../app/state/useTheme";
import { GLYPH_PALETTE, type GlyphRows } from "./glyphs";
import { PixelCanvas } from "./PixelCanvas";

export interface PixelGlyphProps {
  /** Rows of palette keys ("." is transparent); or several frames to cycle. */
  readonly rows: GlyphRows;
  readonly frames?: readonly GlyphRows[];
  /** Frames per second when `frames` is given (default 2). */
  readonly fps?: number;
  /** CSS px per pixel (default 2). */
  readonly scale?: number;
  /** Key -> colour: a hex value or a token name ("--ink"). Defaults to GLYPH_PALETTE. */
  readonly palette?: Readonly<Record<string, string>>;
  /** Accessible name; null hides it (the text beside says it). */
  readonly label: string | null;
  readonly className?: string;
}

/** A small pixel icon on the shared canvas path: token colours follow the sheet, frames step at `fps`. */
export function PixelGlyph({ rows, frames, fps = 2, scale = 2, palette = GLYPH_PALETTE, label, className }: PixelGlyphProps) {
  const theme = useResolvedTheme();
  const w = Math.max(...rows.map((row) => row.length));
  const h = rows.length;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => {
      const styles = getComputedStyle(ctx.canvas);
      const colour = (key: string) => {
        const value = palette[key];
        if (!value) return null;
        if (value.startsWith("--")) return `rgb(${styles.getPropertyValue(value).trim().split(/\s+/u).join(",")})`;
        return value;
      };
      const sheet = frames && frames.length && !info.still ? frames[Math.floor(info.seconds * fps) % frames.length]! : rows;
      ctx.clearRect(0, 0, w, h);
      sheet.forEach((row, y) => {
        [...row].forEach((key, x) => {
          if (key === ".") return;
          const c = colour(key);
          if (!c) return;
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 1, 1);
        });
      });
    },
    [rows, frames, fps, palette, w, h],
  );
  return (
    <PixelCanvas
      width={w}
      height={h}
      scale={scale}
      draw={draw}
      animate={Boolean(frames && frames.length > 1)}
      fps={Math.max(1, fps)}
      label={label ?? undefined}
      decorative={label === null}
      redrawKey={`${theme}|${rows.join("/")}`}
      className={className}
    />
  );
}
