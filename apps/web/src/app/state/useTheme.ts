import { useCallback, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

import { runViewTransition } from "../../motion/viewTransition";
import { applyTheme, getThemeSurface } from "./documentSync";
import { LIGHT_SCHEME_QUERY, mediaMatches, subscribeMedia } from "./media";
import { nextTheme, resolveTheme, type ResolvedTheme } from "./uiPrefs";
import { useUiStore } from "./uiStore";

function systemLight(): boolean | null {
  return mediaMatches(LIGHT_SCHEME_QUERY);
}

function subscribeSystem(onChange: () => void) {
  return subscribeMedia(LIGHT_SCHEME_QUERY, onChange);
}

const serverNull = () => null;

/** The theme currently painted ("dark" or "light"), following the system while the preference is "system". */
export function useResolvedTheme(): ResolvedTheme {
  const preference = useUiStore((state) => state.theme);
  const light = useSyncExternalStore(subscribeSystem, systemLight, serverNull);
  return resolveTheme(preference, light, getThemeSurface());
}

/**
 * Flips between dark and light. With View Transitions (and motion allowed) the
 * new theme is revealed as a circle growing from `origin` (the toggle button).
 */
export function useThemeToggle(): { readonly theme: ResolvedTheme; readonly toggle: (origin?: { x: number; y: number }) => void } {
  const theme = useResolvedTheme();
  const setTheme = useUiStore((state) => state.setTheme);
  const toggle = useCallback(
    (origin?: { x: number; y: number }) => {
      const next = nextTheme(useUiStore.getState().theme, systemLight(), getThemeSurface());
      void runViewTransition(
        "theme",
        () => {
          flushSync(() => setTheme(next));
          applyTheme(next);
        },
        origin ? { origin } : {},
      );
    },
    [setTheme],
  );
  return { theme, toggle };
}
