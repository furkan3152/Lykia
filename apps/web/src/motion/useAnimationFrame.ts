import { useEffect, useLayoutEffect, useRef } from "react";

import { loopAllowed } from "./preference";
import { usePageVisible } from "./usePageVisible";
import { useReducedMotion } from "./useReducedMotion";

export interface FrameInfo {
  /** rAF timestamp (ms). */
  readonly time: number;
  /** ms since the previous frame, clamped to 64 so a resumed loop never jumps. */
  readonly delta: number;
}

export interface AnimationFrameOptions {
  /** Extra gate (e.g. "there is energy left", "the surface is on screen"). */
  readonly enabled?: boolean;
}

/**
 * Runs `callback` on every animation frame while allowed: motion not reduced
 * (OS setting or Lykia's switch), the page visible, and `enabled`. Returns
 * whether the loop is running so callers can draw a static frame otherwise.
 * The latest callback is always used without restarting the loop.
 */
export function useAnimationFrame(callback: (frame: FrameInfo) => void, options: AnimationFrameOptions = {}): boolean {
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const running = loopAllowed({ reduced, visible, enabled: options.enabled });
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!running) return undefined;
    let handle = 0;
    let previous: number | null = null;
    const tick = (time: number) => {
      const delta = previous === null ? 16 : Math.min(64, Math.max(0, time - previous));
      previous = time;
      callbackRef.current({ time, delta });
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [running]);

  return running;
}
