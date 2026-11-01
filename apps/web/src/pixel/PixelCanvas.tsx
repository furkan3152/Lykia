import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { cx } from "../ui/cx";
import { useResolvedTheme } from "../app/state/useTheme";
import { fitScale, fixedScale, NIGHT_HALO, withSpriteHalo } from "./draw";
import { usePixelLoop } from "./useTicker";

export interface PixelDrawInfo {
  /** Logical width and height (canvas pixels). */
  readonly w: number;
  readonly h: number;
  /** Shared clock in seconds (the end time when still). */
  readonly seconds: number;
  /** True when drawing the still end state (reduced motion, or `animate` off). */
  readonly still: boolean;
}

export interface PixelCanvasProps {
  /** Fixed mode: logical width. Fit mode: about how many pixels across the canvas should have. */
  readonly width: number;
  /** Logical height (pixels). In fit mode with `aspect`, the height follows the width instead. */
  readonly height: number;
  /** Fit mode: logical height = round(width x aspect). */
  readonly aspect?: number;
  /** Fit mode for fixed art: keep `width` x `height` pixels at the largest whole scale that fits, centred. */
  readonly contain?: boolean;
  /**
   * CSS px per pixel. Given: a fixed-size sprite, rounded so a pixel is a
   * whole number of device pixels. Omitted: the canvas fills its container's
   * width with an integer scale and grows its logical width to cover it.
   */
  readonly scale?: number;
  /** Fit mode: the CSS size of one pixel to aim for (overrides `width` as the target count). */
  readonly pixelSize?: number;
  readonly draw: (ctx: CanvasRenderingContext2D, info: PixelDrawInfo) => void;
  /** Loop on the shared ticker (default false: draw once). */
  readonly animate?: boolean;
  /** Frame cap for the loop (default 24). */
  readonly fps?: number;
  /** Clock value drawn as the end state (reduced motion). */
  readonly endTime?: number;
  /** Accessible name. Required unless `decorative`. */
  readonly label?: string;
  /** Hidden from assistive tech (the text next to it already says it). */
  readonly decorative?: boolean;
  /** Redraws when this changes (inputs of `draw` for still canvases). */
  readonly redrawKey?: unknown;
  /** Draws as NIGHT (sprite rim on) regardless of the sheet: previews and forced-night scenes. Default: the painted sheet. */
  readonly night?: boolean;
  /** NIGHT rim on sprites drawn with `drawGrid` (see `withSpriteHalo`). false for art with its own fixed background (Herd portraits). Default true. */
  readonly halo?: boolean;
  readonly className?: string;
  readonly canvasClassName?: string;
  readonly style?: React.CSSProperties;
}

function devicePixelRatioNow(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

/**
 * The one canvas every pixel drawing uses: `image-rendering: pixelated`, an
 * integer device-pixel scale at any DPR (crisp edges, no blur), and a draw
 * callback driven by the shared ticker (paused off screen, in hidden tabs and
 * under reduced motion, where it draws the end state).
 */
export function PixelCanvas({
  width,
  height,
  scale,
  pixelSize,
  aspect,
  contain = false,
  draw,
  animate = false,
  fps,
  endTime = 0,
  label,
  decorative = false,
  redrawKey,
  night,
  halo = true,
  className,
  canvasClassName,
  style,
}: PixelCanvasProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [dpr, setDpr] = useState(devicePixelRatioNow);
  const [fontsReady, setFontsReady] = useState(0);
  const fit = scale === undefined;
  const theme = useResolvedTheme();
  const isNight = night ?? theme === "dark";

  useLayoutEffect(() => {
    if (!fit || !box) return undefined;
    const measure = () => {
      setContainerWidth(box.clientWidth);
      setDpr(devicePixelRatioNow());
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [fit, box]);

  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontsReady((n) => n + 1)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  let logicalW = width;
  let cssPerPixel: number;
  if (fit && contain) {
    const device = (containerWidth ?? width * 4) * dpr;
    cssPerPixel = Math.max(1, Math.floor(device / width)) / dpr;
  } else if (fit) {
    const container = containerWidth ?? width * (pixelSize ?? 2);
    const target = pixelSize ? Math.max(8, container / pixelSize) : width;
    const scaleFit = fitScale(container, target, dpr);
    logicalW = scaleFit.width;
    cssPerPixel = scaleFit.cssPerPixel;
  } else {
    cssPerPixel = fixedScale(scale, dpr).cssPerPixel;
  }
  const logicalH = fit && aspect && !contain ? Math.max(1, Math.round(logicalW * aspect)) : height;
  const cssW = logicalW * cssPerPixel;
  const cssH = logicalH * cssPerPixel;
  // Fit mode overhangs by less than a pixel: centre it on whole device pixels.
  const offset = fit && containerWidth !== null ? Math.round(((containerWidth - cssW) / 2) * dpr) / dpr : 0;

  const paint = useCallback(
    (seconds: number, still: boolean) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      withSpriteHalo(halo && isNight ? NIGHT_HALO : null, () => draw(ctx, { w: logicalW, h: logicalH, seconds, still }));
    },
    [canvas, draw, logicalW, logicalH, halo, isNight],
  );

  const stillKey = useMemo(() => [redrawKey, fontsReady], [redrawKey, fontsReady]);
  // Live: the shared ticker paints moving frames. Still (reduced motion, the
  // Motion switch, or animate off): the end state, flagged still, repainted
  // only when the inputs, the size, the redraw key or the fonts change.
  usePixelLoop(canvas, paint, { fps, endTime, enabled: animate, redrawKey: stillKey });

  const canvasEl = (
    <canvas
      ref={setCanvas}
      width={logicalW}
      height={logicalH}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={cx("pixelated block max-w-none", canvasClassName)}
      style={{ width: `${cssW}px`, height: `${cssH}px`, marginLeft: offset ? `${offset}px` : undefined }}
    />
  );

  if (!fit) {
    return (
      <span className={cx("inline-block shrink-0 align-middle", className)} style={{ width: `${cssW}px`, height: `${cssH}px`, ...style }}>
        {canvasEl}
      </span>
    );
  }
  return (
    <div ref={setBox} className={cx("relative w-full overflow-hidden", className)} style={{ height: `${cssH}px`, ...style }}>
      {canvasEl}
    </div>
  );
}
