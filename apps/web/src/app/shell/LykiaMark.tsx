import { useCallback } from "react";

import { drawGrid } from "../../pixel/draw";
import { LYKO_H, LYKO_W, lykoHead } from "../../pixel/lyko";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { cx } from "../../ui/cx";

export interface LykiaMarkProps {
  /** Height in CSS px (rounded to whole device pixels per sprite pixel). */
  readonly size?: number;
  /** Kept for compatibility: the mark is always the pixel Lyko. */
  readonly mono?: boolean;
  /** Accessible name; omit when a visible wordmark sits next to it. */
  readonly title?: string;
  readonly className?: string;
}

/** The Lykia mark (Pixel Valley): Lyko, the pixel shepherd dog, with his Künye shining. */
export function LykiaMark({ size = 34, title, className }: LykiaMarkProps) {
  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, LYKO_W, LYKO_H);
    drawGrid(ctx, lykoHead({ shine: true }), 0, 0, 1);
  }, []);
  return <PixelCanvas width={LYKO_W} height={LYKO_H} scale={size / LYKO_H} draw={draw} label={title} decorative={!title} className={cx("shrink-0", className)} />;
}

export interface LykiaLogoProps {
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

/** Pixel Lyko + the LYKIA wordmark in Pixelify Sans. */
export function LykiaLogo({ size = "md", className }: LykiaLogoProps) {
  const mark = size === "sm" ? 34 : size === "lg" ? 51 : 42;
  const text = size === "sm" ? "text-[22px]" : size === "lg" ? "text-[32px]" : "text-[26px]";
  return (
    <span className={cx("inline-flex items-center gap-3 text-ink", className)}>
      <LykiaMark size={mark} />
      <span className={cx("font-display font-bold leading-none tracking-[0.04em]", text)}>LYKIA</span>
    </span>
  );
}
