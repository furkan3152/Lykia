import { useCallback } from "react";

import { cx } from "../ui/cx";
import { drawGrid } from "./draw";
import { LYKO_SIDE_W, lykoSide } from "./lyko";
import { PixelCanvas } from "./PixelCanvas";
import { SEA, STONE_DARK } from "./sprite";

export interface LykoLoaderProps {
  /** What is loading, said to screen readers and printed under Lyko ("Reading the flock"). */
  readonly label: string;
  readonly size?: "sm" | "md" | "lg";
  readonly hideLabel?: boolean;
  readonly className?: string;
}

const W = 64;
const H = 30;
const SCALE = { sm: 1, md: 2, lg: 3 } as const;

/**
 * Lykia's loading state: Lyko running the outrun, a dashed arc drawn
 * behind him. No spinners. It loops slowly on the shared ticker and holds a
 * still pose under reduced motion; the label is a polite status.
 */
export function LykoLoader({ label, size = "md", hideLabel = false, className }: LykoLoaderProps) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => {
    const T = info.still ? 0 : info.seconds;
    ctx.clearRect(0, 0, W, H);
    // ground and the dashed arc scrolling under his paws
    ctx.fillStyle = STONE_DARK;
    ctx.fillRect(0, H - 3, W, 1);
    const scroll = Math.floor(T * 10) % 6;
    ctx.fillStyle = SEA;
    for (let x = -6 + scroll; x < W; x += 6) {
      const y = Math.round(6 + ((x - W / 2) / (W / 2)) ** 2 * 6);
      ctx.fillRect(x, y, 3, 1);
    }
    const frame = info.still ? "runA" : Math.floor(T * 5) % 2 === 0 ? "runA" : "runB";
    const bob = info.still ? 0 : Math.floor(T * 5) % 2;
    drawGrid(ctx, lykoSide(frame), Math.round((W - LYKO_SIDE_W) / 2), H - 17 + bob, 1);
  }, []);
  return (
    <div role="status" aria-live="polite" className={cx("inline-flex flex-col items-center gap-2", className)}>
      <PixelCanvas width={W} height={H} scale={SCALE[size]} draw={draw} animate fps={10} decorative />
      <span className={cx("font-tag text-[11px] uppercase tracking-[0.08em] text-ink-2", hideLabel && "sr-only")}>{label}</span>
    </div>
  );
}
