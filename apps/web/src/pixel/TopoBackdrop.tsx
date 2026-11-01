import { cx } from "../ui/cx";
import { TILE, useContourTile } from "./useContourTile";

const SCALE = 4;

export interface TopoBackdropProps {
  readonly className?: string;
}

/**
 * The faint pixel contour pattern behind every page: a 96 x 96 height-map
 * tile at 4 px per pixel, in ink at a few percent (--backdrop-alpha).
 * Mount it once per layout; it is fixed, decorative and static.
 */
export function TopoBackdrop({ className }: TopoBackdropProps) {
  const alpha = typeof document === "undefined" ? 0.07 : Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--backdrop-alpha")) || 0.07;
  const url = useContourTile(4242, "--ink", alpha);
  return (
    <div
      aria-hidden="true"
      className={cx("pixelated pointer-events-none fixed inset-0 -z-10", className)}
      style={url ? { backgroundImage: `url(${url})`, backgroundSize: `${TILE * SCALE}px ${TILE * SCALE}px` } : undefined}
    />
  );
}
