/**
 * Motion infrastructure. Every loop honours reduced motion (OS setting or the
 * Motion switch, html[data-motion=off]), pauses in hidden tabs and off screen,
 * and nothing flashes as a whole above 3 Hz.
 */
export { Reveal, type RevealProps } from "./Reveal";
export { useAnimationFrame, type AnimationFrameOptions, type FrameInfo } from "./useAnimationFrame";
export { useAutoPause, type AutoPause, type AutoPauseOptions } from "./useAutoPause";
export { useChangeKey } from "./useChangeKey";
export { useInView } from "./useInView";
export { isPageVisible, usePageVisible } from "./usePageVisible";
export { prefersReducedMotion, useMotionToggle, useReducedMotion, useSystemReducedMotion } from "./useReducedMotion";
export { runViewTransition, supportsViewTransitions, type ViewTransitionKind } from "./viewTransition";
export { cssVars, DURATION, EASE, hashSeed, seededRandom, STAGGER, staggerDelay } from "./tokens";
