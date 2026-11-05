import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { safeLocalStorage } from "./storage";
import {
  DEFAULT_UI_PREFS,
  modeAvailability,
  sanitizeUiPrefs,
  UI_STORAGE_KEY,
  UI_STORAGE_VERSION,
  type MotionSetting,
  type NetworkMode,
  type PersistedUiPrefs,
  type ThemePreference,
} from "./uiPrefs";

export interface UiState extends PersistedUiPrefs {
  setTheme(theme: ThemePreference): void;
  setMotion(motion: MotionSetting): void;
  /** Returns false (and changes nothing) when the mode is not available yet. */
  setMode(mode: NetworkMode): boolean;
  setRailCollapsed(collapsed: boolean): void;
  toggleRail(): void;
}

/**
 * Interface preferences: theme, motion, network mode and the rail. Persisted
 * under `lykia-ui` through the guarded storage adapter (a blocked storage
 * means "remember nothing", never a crash). index.html reads the same key
 * before the first paint.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_UI_PREFS,
      setTheme: (theme) => set({ theme }),
      setMotion: (motion) => set({ motion }),
      setMode: (mode) => {
        if (!modeAvailability(mode).available) return false;
        if (get().mode !== mode) set({ mode });
        return true;
      },
      setRailCollapsed: (railCollapsed) => set({ railCollapsed }),
      toggleRail: () => set({ railCollapsed: !get().railCollapsed }),
    }),
    {
      name: UI_STORAGE_KEY,
      version: UI_STORAGE_VERSION,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state): PersistedUiPrefs => ({
        theme: state.theme,
        motion: state.motion,
        mode: state.mode,
        railCollapsed: state.railCollapsed,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizeUiPrefs(persisted) }),
      migrate: (persisted) => sanitizeUiPrefs(persisted),
    },
  ),
);
