import React, { useEffect, useLayoutEffect, useRef } from "react";

import { useInView } from "../motion/useInView";
import { usePageVisible } from "../motion/usePageVisible";
import { useReducedMotion } from "../motion/useReducedMotion";
import { useLookVersion } from "./look";
import { drawTesserae, type Buffer } from "./tessera";

export interface MosaicCanvasProps {
  /** Builds the scene for a time in seconds. Keep it pure; it runs per frame while animating. */
  readonly build: (t: number) => Buffer;
  /** Logical size (used for the aspect ratio before the first frame). */
  readonly width: number;
  readonly height: number;
  /** Tile pitch in CSS px at full width (sharpness; the canvas scales to its box). */
  readonly tile?: number;
  readonly gap?: number;
  readonly jitter?: number;
  /** Idle frames per second while visible (0 = static). */
  readonly fps?: number;
  /** Stones drop in by a wave the first time the scene is seen. */
  readonly assemble?: boolean;
  /** Re-run the assemble wave when this changes (new data). */
  readonly assembleKey?: unknown;
  /** Repaint when the data behind `build` changes (any comparable value). */
  readonly dataKey?: unknown;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly label: string;
}

/**
 * A scene laid as tesserae. Animates only while on screen, in a visible tab
 * and with motion allowed; otherwise it paints one finished frame. DPR-aware.
 */
export function MosaicCanvas({ build, width, height, tile = 6, gap = 1, jitter = 0.06, fps = 8, assemble = true, assembleKey, dataKey, className, style, label }: MosaicCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const inView = useInView(ref, "80px");
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  const look = useLookVersion();
  const buildRef = useRef(build);
  useLayoutEffect(() => {
    buildRef.current = build;
  });
  const startRef = useRef<number | null>(null);
  const assembledFor = useRef<unknown>(Symbol("never"));

  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return undefined;
    const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    el.width = Math.round(width * tile * dpr);
    el.height = Math.round(height * tile * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const animate = inView && visible && !reduced;
    const wantsAssemble = assemble && !reduced && assembledFor.current !== assembleKey;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let assembleStart = wantsAssemble ? performance.now() : -1;
    if (wantsAssemble) assembledFor.current = assembleKey;
    if (startRef.current === null) startRef.current = performance.now();
    const draw = (now: number) => {
      const t = (now - (startRef.current ?? now)) / 1000;
      const progress = assembleStart < 0 ? 1 : Math.min(1, (now - assembleStart) / 1100);
      drawTesserae(ctx, buildRef.current(animate ? t : 0), { tile, gap, jitter, assemble: progress });
      if (progress >= 1) assembleStart = -1;
      return progress < 1;
    };
    const loop = (now: number) => {
      const assembling = draw(now);
      if (assembling) raf = requestAnimationFrame(loop);
      else if (animate && fps > 0) timer = setTimeout(() => (raf = requestAnimationFrame(loop)), 1000 / fps);
    };
    if (animate || wantsAssemble) raf = requestAnimationFrame(loop);
    else draw(performance.now());
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [width, height, tile, gap, jitter, fps, assemble, assembleKey, dataKey, inView, visible, reduced, look]);

  // A whole scene (not a small sprite) is lit for dusk at night (night.css).
  return <canvas ref={ref} role="img" aria-label={label} data-scene={width >= 60 ? "" : undefined} className={className} style={{ aspectRatio: `${width} / ${height}`, width: "100%", display: "block", imageRendering: "pixelated", ...style }} />;
}
