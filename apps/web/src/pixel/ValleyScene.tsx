import { useCallback } from "react";

import { useResolvedTheme } from "../app/state/useTheme";
import { cx } from "../ui/cx";
import { PixelCanvas } from "./PixelCanvas";
import { drawValley, type ValleyOptions } from "./valley";

export interface ValleySceneProps extends ValleyOptions {
  /** Height / width (default 0.42). */
  readonly aspect?: number;
  /** Target CSS px per pixel (default 4: the kit's pixel unit). */
  readonly pixelSize?: number;
  readonly label: string;
  readonly className?: string;
  /** Force the night sky (Arcadia). Default follows the sheet. */
  readonly forceNight?: boolean;
}

/** The valley on one canvas, filling its container's width at a whole pixel scale. */
export function ValleyScene({ aspect = 0.42, pixelSize = 4, label, className, forceNight, ...options }: ValleySceneProps) {
  const theme = useResolvedTheme();
  const night = forceNight ?? (options.night ?? theme === "dark");
  const key = JSON.stringify({ ...options, night });
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => drawValley(ctx, info.w, info.h, info.seconds, info.still, { ...options, night }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return <PixelCanvas width={240} height={100} aspect={aspect} pixelSize={pixelSize} draw={draw} animate fps={12} label={label} redrawKey={key} night={night} className={cx("w-full", className)} />;
}
