/**
 * The Forge's anvil. When a city is struck (a project created), the hammer
 * comes down on the hot blank and lifts off a new gold coin. Runs for about a
 * second and a half, only on a new `strikeKey`; under reduced motion it shows
 * the struck coin at once.
 */
import { useEffect, useRef } from "react";

import { useReducedMotion } from "../../motion/useReducedMotion";
import { drawTesserae } from "../../mosaic/tessera";
import { forgeStrike, FORGE_H, FORGE_W } from "./art";

const TILE = 4;

export function ForgeStrike({ strikeKey, label = "The Forge's anvil" }: { readonly strikeKey: unknown; readonly label?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  const first = useRef(true);
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return undefined;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = FORGE_W * TILE * dpr;
    el.height = FORGE_H * TILE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const draw = (p: number) => drawTesserae(ctx, forgeStrike(p), { tile: TILE, gap: 0.7, jitter: 0.05 });
    // The first paint shows a hot blank waiting under the raised hammer.
    if (first.current || reduced) {
      draw(first.current ? 0 : 1);
      first.current = false;
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const p = Math.min(1, (now - start) / 1500);
      draw(p);
      if (p < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [strikeKey, reduced]);
  return <canvas ref={ref} role="img" aria-label={label} className="forge-anvil" style={{ aspectRatio: `${FORGE_W} / ${FORGE_H}`, width: "100%", display: "block", imageRendering: "pixelated" }} />;
}
