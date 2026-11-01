/**
 * Two languages, English and Turkish. Small on purpose: Lyko's lines, nav
 * labels and the key strings of each page. Pure lookups live in `copy()`;
 * the store persists the choice through the guarded storage.
 */
import { create } from "zustand";

import { readStorage, writeStorage } from "../app/state/storage";

export type Lang = "en" | "tr";

const KEY = "lykia.lang";

function initialLang(): Lang {
  const stored = readStorage(KEY);
  if (stored === "en" || stored === "tr") return stored;
  try {
    return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
  } catch {
    return "en";
  }
}

interface LangState {
  readonly lang: Lang;
  setLang(lang: Lang): void;
}

export const useLangStore = create<LangState>()((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    writeStorage(KEY, lang);
    set({ lang });
  },
}));

export function useLang(): Lang {
  return useLangStore((s) => s.lang);
}

/** Picks the string for `lang`. */
export function pick(lang: Lang, text: { readonly en: string; readonly tr: string }): string {
  return lang === "tr" ? text.tr : text.en;
}
