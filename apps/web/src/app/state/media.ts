/** Guarded `matchMedia`: null when unknown (tests, old engines), never throws. */
export function mediaMatches(query: string): boolean | null {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    return window.matchMedia(query).matches;
  } catch {
    return null;
  }
}

/** Calls `onChange` when the media query flips. Returns the unsubscribe. */
export function subscribeMedia(query: string, onChange: () => void): () => void {
  let list: MediaQueryList;
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
    list = window.matchMedia(query);
  } catch {
    return () => undefined;
  }
  try {
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  } catch {
    // Safari < 14 only has the deprecated listener API.
    list.addListener?.(onChange);
    return () => list.removeListener?.(onChange);
  }
}

export const LIGHT_SCHEME_QUERY = "(prefers-color-scheme: light)";
