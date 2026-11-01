/**
 * Motion tokens, mirrored by the --dur-* / --ease-*
 * custom properties in src/styles/tokens.css. Pure and Node-safe.
 */
import type { CSSProperties } from "react";

/** Durations in ms. */
export const DURATION = {
  /** Press, toggle. */
  instant: 90,
  /** Hover, colour, icon swap. */
  fast: 150,
  /** UI enter/exit (toast, sheet, card rise). */
  base: 240,
  /** Scroll reveal, stamp thump, panel open. */
  slow: 420,
  /** Contour draw-on. */
  draw: 1200,
} as const;

/** Easings (CSS syntax, valid for WAAPI too). */
export const EASE = {
  /** Draw-ons and reveals. */
  draw: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  /** Spring-like overshoot for blades and stamps. */
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  linear: "linear",
} as const;

/** Stagger step per item; long lists stop adding delay after `maxItems`. */
export const STAGGER = { step: 70, maxItems: 8 } as const;

export function staggerDelay(index: number, step: number = STAGGER.step): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(Math.floor(index), STAGGER.maxItems) * step;
}

/** Typed helper for CSS custom properties in `style` props. */
export function cssVars(vars: Readonly<Record<`--${string}`, string | number | undefined>>): CSSProperties {
  const style: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(vars)) {
    if (value !== undefined) style[name] = value;
  }
  return style as CSSProperties;
}

/** Small deterministic PRNG (mulberry32): "random" art and motion replay identically. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit hash of a string, to seed art from an id. */
export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
