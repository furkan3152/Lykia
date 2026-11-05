import { REDUCED_MOTION_QUERY } from "../../motion/preference";
import { LIGHT_SCHEME_QUERY, mediaMatches, subscribeMedia } from "./media";
import { resolveTheme, THEME_COLORS, THEME_SHEET, THEME_STORAGE_KEY, type ResolvedTheme, type ThemeSurface } from "./uiPrefs";
import { useUiStore } from "./uiStore";

const surface: ThemeSurface = "app";

/** An explicit sheet saved under lykia.theme wins over a store that only says "system". */
function adoptStoredSheet() {
  try {
    const sheet = window.localStorage.getItem(THEME_STORAGE_KEY);
    const state = useUiStore.getState();
    if (state.theme !== "system") return;
    if (sheet === "night") state.setTheme("dark");
    else if (sheet === "day") state.setTheme("light");
  } catch {
    // storage blocked: keep the store's preference
  }
}

function rememberTheme() {
  try {
    const theme = useUiStore.getState().theme;
    if (theme === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, THEME_SHEET[theme]);
  } catch {
    // storage blocked: the zustand store still holds the choice for this tab
  }
}

function setThemeColor(theme: ResolvedTheme) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.setAttribute("content", THEME_COLORS[theme]);
    meta.removeAttribute("media");
  }
}

/** Paints the resolved theme on <html> (data-theme="day" | "night", color-scheme, browser chrome colour). */
function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", THEME_SHEET[theme]);
  root.style.colorScheme = theme;
  setThemeColor(theme);
}

function applyDocument() {
  const state = useUiStore.getState();
  applyTheme(resolveTheme(state.theme, mediaMatches(LIGHT_SCHEME_QUERY), surface));
  rememberTheme();
  const root = document.documentElement;
  if (state.motion === "off") root.setAttribute("data-motion", "off");
  else root.removeAttribute("data-motion");
  root.setAttribute("data-mode", state.mode);
}

let installed = false;

/**
 * Keeps <html> in step with the ui store and the system preferences:
 * data-theme, data-motion (the CSS reduced-motion switch), data-mode and
 * data-hidden (pauses `.el-loop` animations in background tabs). Installed
 * once by main.tsx before the first render.
 */
export function installUiDocumentSync(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  adoptStoredSheet();
  applyDocument();
  useUiStore.subscribe(applyDocument);
  subscribeMedia(LIGHT_SCHEME_QUERY, applyDocument);
  subscribeMedia(REDUCED_MOTION_QUERY, applyDocument);
  const syncHidden = () => document.documentElement.toggleAttribute("data-hidden", document.visibilityState === "hidden");
  syncHidden();
  document.addEventListener("visibilitychange", syncHidden);
}
