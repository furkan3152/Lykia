import React, { useCallback } from "react";

import { cx } from "../ui/cx";
import { drawGrid } from "./draw";
import { lykoSide } from "./lyko";
import { PixelCanvas } from "./PixelCanvas";
import { INK, PINE, PINE_DARK, SEA, SEA_LIGHT, STONE, STONE_DARK } from "./sprite";

export interface LykoEmptyProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly compact?: boolean;
  readonly className?: string;
}

const W = 80;
const H = 44;

/** The empty pasture (pure canvas painting): sea, a pine, a fence and Lyko lying by the gate. */
function drawPasture(ctx: CanvasRenderingContext2D, seconds: number, still: boolean): void {
  ctx.clearRect(0, 0, W, H);
  const T = still ? 0 : seconds;
  // the sea at the back
  ctx.fillStyle = SEA;
  ctx.fillRect(2, 14, W - 4, 6);
  ctx.fillStyle = SEA_LIGHT;
  const wave = Math.floor(T * 1.5) % 4;
  for (let x = 4 + wave; x < W - 4; x += 8) ctx.fillRect(x, 16, 3, 1);
  // the meadow
  ctx.fillStyle = "#8DB36B";
  ctx.fillRect(2, 20, W - 4, 22);
  ctx.fillStyle = "#6E9A52";
  for (let x = 5; x < W - 4; x += 7) ctx.fillRect(x, 26 + (x % 3) * 4, 1, 2);
  // a pine
  ctx.fillStyle = "#6B4A2E";
  ctx.fillRect(12, 24, 2, 8);
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = i % 2 ? PINE : PINE_DARK;
    ctx.fillRect(13 - (i + 2), 8 + i * 4, (i + 2) * 2 + 2, 4);
  }
  // the fence: posts and two rails
  ctx.fillStyle = STONE_DARK;
  for (let x = 24; x <= 72; x += 8) ctx.fillRect(x, 22, 2, 14);
  ctx.fillStyle = STONE;
  ctx.fillRect(24, 25, 50, 1);
  ctx.fillRect(24, 30, 50, 1);
  ctx.fillStyle = INK;
  ctx.fillRect(2, 42, W - 4, 1);
  // Lyko lying by the gate, breathing
  const breathe = still ? 0 : Math.floor(T * 1.2) % 2;
  drawGrid(ctx, lykoSide("lie"), 30, 27 + breathe, 1);
}

/** Empty state: the pasture is quiet, Lyko rests by the gate; the title, a line of help and one action. */
export function LykoEmpty({ title, description, action, compact = false, className }: LykoEmptyProps) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => drawPasture(ctx, info.seconds, info.still), []);
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "gap-2 py-6" : "gap-3 px-4 py-10", className)}>
      <PixelCanvas width={W} height={H} scale={compact ? 2 : 3} draw={draw} animate fps={8} decorative />
      <p className={cx("font-display font-bold text-ink", compact ? "text-xl" : "text-2xl")}>{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-2 text-pretty">{description}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
