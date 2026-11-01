import { useCallback, useEffect, useState, type RefCallback } from "react";

/**
 * The rendered width of an element (ResizeObserver), so drawn artifacts can
 * lay out in real pixels: text stays at its size instead of scaling with a
 * viewBox. Returns `fallback` until measured.
 */
export function useMeasuredWidth<T extends Element>(fallback: number): readonly [RefCallback<T>, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  const ref = useCallback((element: T | null) => setNode(element), []);
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box && box.width > 0) setWidth(Math.round(box.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [ref, width] as const;
}
