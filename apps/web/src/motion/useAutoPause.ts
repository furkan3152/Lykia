import React, { useCallback, useEffect, useState } from "react";

import { usePageVisible } from "./usePageVisible";
import { useReducedMotion } from "./useReducedMotion";

export interface AutoPauseOptions {
  /** Extra manual pause (a Pause button, a closed panel). */
  readonly paused?: boolean;
  /** How far outside the viewport the element still counts as visible (default "200px"). */
  readonly rootMargin?: string;
}

export interface AutoPause<T extends Element> {
  readonly ref: React.RefCallback<T>;
  /** On screen, page visible, motion allowed and not paused: JS loops may run. */
  readonly active: boolean;
  /** Has been on screen at least once (for draw-on that waits for the reader). */
  readonly seen: boolean;
}

/**
 * Pauses looping motion in a section that is off screen or in a hidden tab
 * (ported from Kletia). It toggles `data-el-paused` on the element, which
 * pauses every CSS `.el-loop` inside it (global.css), and returns `active`
 * for JavaScript loops (rAF, WAAPI, timers).
 */
export function useAutoPause<T extends Element = HTMLElement>(options: AutoPauseOptions = {}): AutoPause<T> {
  const { paused = false, rootMargin = "200px" } = options;
  const [element, setElement] = useState<T | null>(null);
  // Optimistic until the first observer callback: on-screen content never starts paused.
  const [inView, setInView] = useState(true);
  const [seen, setSeen] = useState(false);
  const visible = usePageVisible();
  const reduced = useReducedMotion();

  const ref = useCallback((node: T | null) => setElement(node), []);

  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        setInView(entry.isIntersecting);
        if (entry.isIntersecting) setSeen(true);
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, rootMargin]);

  const halted = paused || !inView || !visible;

  useEffect(() => {
    if (!element) return;
    if (halted) element.setAttribute("data-el-paused", "");
    else element.removeAttribute("data-el-paused");
  }, [element, halted]);

  return { ref, active: !halted && !reduced, seen: seen || typeof IntersectionObserver === "undefined" };
}
