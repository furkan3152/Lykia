import { useSyncExternalStore } from "react";

import { mediaMatches, subscribeMedia } from "../app/state/media";
import { useUiStore } from "../app/state/uiStore";
import { isReducedMotion, motionToggleView, REDUCED_MOTION_QUERY, type MotionToggleView } from "./preference";

function systemReduced(): boolean {
  return mediaMatches(REDUCED_MOTION_QUERY) ?? false;
}

/** Non-hook form for event handlers and imperative code (view transitions, canvas setup). */
export function prefersReducedMotion(): boolean {
  return isReducedMotion(useUiStore.getState().motion, systemReduced());
}

function subscribe(onChange: () => void): () => void {
  const offMedia = subscribeMedia(REDUCED_MOTION_QUERY, onChange);
  const offStore = useUiStore.subscribe(onChange);
  return () => {
    offMedia();
    offStore();
  };
}

const serverFalse = () => false;

/** Live reduced-motion flag: the OS setting or Lykia's Motion switch. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, serverFalse);
}

/** Live OS reduced-motion flag only. */
export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, systemReduced, serverFalse);
}

/** State for a Motion switch: what it shows and how it changes the setting. */
export function useMotionToggle(): MotionToggleView & { readonly setOn: (on: boolean) => void } {
  const setting = useUiStore((state) => state.motion);
  const setMotion = useUiStore((state) => state.setMotion);
  const system = useSystemReducedMotion();
  return { ...motionToggleView(setting, system), setOn: (on: boolean) => setMotion(on ? "on" : "off") };
}
