/**
 * The Letoon's door. Closed, Lyko keeps watch on the steps. When the server
 * confirms the admin role, the leaves slide apart stone column by stone
 * column and light spills down the steps (about 1.6 s, once). Under reduced
 * motion the door is drawn open or closed at once.
 */
import { useEffect, useRef } from "react";

import { useReducedMotion } from "../../motion/useReducedMotion";
import { drawTesserae } from "../../mosaic/tessera";
import { DOOR_H, DOOR_W, templeDoor } from "../league/art";

const TILE = 5;

export function TempleDoor({ open, label }: { readonly open: boolean; readonly label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return undefined;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = DOOR_W * TILE * dpr;
    el.height = DOOR_H * TILE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const draw = (p: number, t: number) => drawTesserae(ctx, templeDoor(p, t), { tile: TILE, gap: 0.8, jitter: 0.05 });
    if (!open || reduced) {
      draw(open ? 1 : 0, 0);
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const k = Math.min(1, (now - start - 250) / 1600);
      const eased = k <= 0 ? 0 : 1 - (1 - k) ** 3;
      draw(eased, (now - start) / 1000);
      if (k < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, reduced]);
  return <canvas ref={ref} role="img" aria-label={label} style={{ aspectRatio: `${DOOR_W} / ${DOOR_H}`, width: "100%", display: "block", imageRendering: "pixelated" }} />;
}
