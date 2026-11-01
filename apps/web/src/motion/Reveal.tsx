import React, { useLayoutEffect, useRef } from "react";

import { cx } from "../ui/cx";
import { prefersReducedMotion } from "./useReducedMotion";

export interface RevealProps {
  readonly children: React.ReactNode;
  /** Stagger delay in ms. */
  readonly delay?: number;
  readonly as?: "div" | "section" | "li" | "article";
  readonly className?: string;
  readonly id?: string;
}

/**
 * Rises content in when it first scrolls into view. Progressive: content that
 * is already on screen at mount, reduced motion, or a browser without
 * IntersectionObserver all render immediately; nothing is ever left hidden.
 * Driven by a data attribute (see global.css), not React state.
 */
export function Reveal({ children, delay = 0, as = "div", className, id }: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return undefined;
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) return undefined;
    element.dataset.reveal = "waiting";
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          element.dataset.reveal = "shown";
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      delete element.dataset.reveal;
    };
  }, []);

  const Element = as as React.ElementType;
  return (
    <Element ref={ref} id={id} className={cx("el-reveal", className)} style={delay ? ({ "--el-reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}>
      {children}
    </Element>
  );
}
