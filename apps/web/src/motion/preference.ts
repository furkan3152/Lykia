/**
 * Motion preference rules (pure). Reduced motion is the operating system
 * setting OR Lykia's own Motion switch: the switch can turn motion off, never
 * on against the system. Canvas loops, CSS (html[data-motion="off"]) and the
 * view transitions all follow `isReducedMotion`.
 */
import type { MotionSetting } from "../app/state/uiPrefs";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function isReducedMotion(setting: MotionSetting, systemReduced: boolean): boolean {
  return setting === "off" || systemReduced;
}

export interface MotionToggleView {
  /** The switch shows "on" only when motion actually plays. */
  readonly checked: boolean;
  /** Disabled when the system asks for reduced motion: Lykia never overrides it. */
  readonly disabled: boolean;
  readonly description: string;
}

export function motionToggleView(setting: MotionSetting, systemReduced: boolean): MotionToggleView {
  if (systemReduced) return { checked: false, disabled: true, description: "Off: your device asks for reduced motion" };
  return setting === "on"
    ? { checked: true, disabled: false, description: "On: Lyko runs, the sea moves, the pulse ticks" }
    : { checked: false, disabled: false, description: "Off: Lykia stays still" };
}

/**
 * Whether a frame loop may run right now. Loops stop when motion is reduced,
 * when the page is hidden, and when their surface is off screen.
 */
export function loopAllowed(input: { readonly reduced: boolean; readonly visible: boolean; readonly onScreen?: boolean; readonly enabled?: boolean }): boolean {
  return (input.enabled ?? true) && !input.reduced && input.visible && (input.onScreen ?? true);
}
