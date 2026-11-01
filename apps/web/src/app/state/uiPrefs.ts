/**
 * Pure rules for the interface preferences (theme, motion, network mode).
 * No DOM and no storage access at import: node tests load this file, and
 * index.html's pre-paint script mirrors `UI_STORAGE_KEY` and the theme rule.
 */

/** One localStorage key for the persisted ui store (zustand `persist` JSON). */
export const UI_STORAGE_KEY = "lykia-ui";
export const UI_STORAGE_VERSION = 1;

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";
export type MotionSetting = "on" | "off";
export type NetworkMode = "testnet" | "mainnet";

/** Browser chrome colour per theme: the Pixel Survey page paper (DAY #F4EEE0, NIGHT #0C1417; see styles/tokens.css). */
export const THEME_COLORS: Readonly<Record<ResolvedTheme, string>> = Object.freeze({ dark: "#0C1417", light: "#F4EEE0" });

/** The sheet names painted on <html data-theme>: DAY (paper map) and NIGHT (headlamp). */
export const THEME_SHEET: Readonly<Record<ResolvedTheme, "day" | "night">> = Object.freeze({ dark: "night", light: "day" });

/** Where the visitor is: the site defaults to DAY; the deck (/app, /tg) follows the system. */
export type ThemeSurface = "site" | "app";

/** localStorage key mirroring an explicit choice ("day" | "night"), read by index.html before paint. */
export const THEME_STORAGE_KEY = "lykia.theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light";
}

export function isMotionSetting(value: unknown): value is MotionSetting {
  return value === "on" || value === "off";
}

export function isNetworkMode(value: unknown): value is NetworkMode {
  return value === "testnet" || value === "mainnet";
}

/**
 * The theme to paint: an explicit choice wins. Otherwise the site is the DAY
 * sheet, and the deck follows the system (NIGHT on dark systems, DAY when unknown).
 */
export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean | null, surface: ThemeSurface = "app"): ResolvedTheme {
  if (preference !== "system") return preference;
  if (surface === "site") return "light";
  return systemPrefersLight === false ? "dark" : "light";
}

/** The next explicit theme when the toggle is pressed (system resolves first). */
export function nextTheme(preference: ThemePreference, systemPrefersLight: boolean | null, surface: ThemeSurface = "app"): ResolvedTheme {
  return resolveTheme(preference, systemPrefersLight, surface) === "dark" ? "light" : "dark";
}

export interface ModeAvailability {
  readonly available: boolean;
  /** Plain-words reason shown next to a disabled switch. */
  readonly reason: string | null;
}

/**
 * Both Arc environments are open (mainnet 5042 has a public RPC). Testnet
 * and mainnet capital never mix in one intent.
 */
export function modeAvailability(mode: NetworkMode): ModeAvailability {
  if (mode === "testnet") return { available: true, reason: null };
  // Arc mainnet (5042) is live with a public RPC; mainnet capital never mixes with testnet.
  return { available: true, reason: null };
}

/** The mode to use: a stored mainnet choice falls back to testnet while mainnet is unavailable. */
export function effectiveMode(stored: unknown): NetworkMode {
  if (stored === "mainnet" && modeAvailability("mainnet").available) return "mainnet";
  return "testnet";
}

export interface PersistedUiPrefs {
  readonly theme: ThemePreference;
  readonly motion: MotionSetting;
  readonly mode: NetworkMode;
  readonly railCollapsed: boolean;
}

export const DEFAULT_UI_PREFS: PersistedUiPrefs = Object.freeze({
  theme: "system",
  motion: "on",
  mode: "testnet",
  railCollapsed: false,
});

/** Strict parse of the persisted state: unknown or malformed fields fall back to defaults one by one. */
export function sanitizeUiPrefs(value: unknown): PersistedUiPrefs {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    theme: isThemePreference(record.theme) ? record.theme : DEFAULT_UI_PREFS.theme,
    motion: isMotionSetting(record.motion) ? record.motion : DEFAULT_UI_PREFS.motion,
    mode: effectiveMode(record.mode),
    railCollapsed: typeof record.railCollapsed === "boolean" ? record.railCollapsed : DEFAULT_UI_PREFS.railCollapsed,
  };
}
