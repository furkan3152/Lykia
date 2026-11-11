/**
 * The interface languages Lykia speaks. English is the source; the web app
 * and the API translate every code-written sentence into the others, and
 * Lyko answers in the one the owner chose. Input is read in any language.
 */
export const LOCALES = ["en", "tr", "es", "pt-BR", "zh-CN", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language in its own words, for pickers and for the model's instructions. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  tr: "Türkçe",
  es: "Español",
  "pt-BR": "Português",
  "zh-CN": "中文",
  fr: "Français",
};

/** The language's English name, as the model is told which language to answer in. */
export const LOCALE_ENGLISH_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  tr: "Turkish",
  es: "Spanish",
  "pt-BR": "Brazilian Portuguese",
  "zh-CN": "Simplified Chinese",
  fr: "French",
};

/** The BCP 47 tag Intl formats numbers, money and dates with. */
export const INTL_TAGS: Readonly<Record<Locale, string>> = { en: "en-US", tr: "tr-TR", es: "es-ES", "pt-BR": "pt-BR", "zh-CN": "zh-CN", fr: "fr-FR" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Any language tag ("pt", "pt-PT", "zh-Hans-CN", "es-MX", "fr-CA") to a supported locale, or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const t = tag.trim().toLowerCase();
  if (!t) return null;
  const base = t.split(/[-_]/u)[0];
  if (base === "en") return "en";
  if (base === "tr") return "tr";
  if (base === "es") return "es";
  if (base === "pt") return "pt-BR";
  if (base === "fr") return "fr";
  // Simplified Chinese only: Traditional (zh-TW, zh-HK, zh-MO, zh-Hant) is not offered and falls back.
  if (base === "zh") return /hant|-tw\b|-hk\b|-mo\b/u.test(t) ? null : "zh-CN";
  return null;
}

/** The first supported language in a list (browser languages), else English. */
export function pickLocale(languages: readonly (string | null | undefined)[]): Locale {
  for (const l of languages) {
    const m = matchLocale(l);
    if (m) return m;
  }
  return DEFAULT_LOCALE;
}

/** An Accept-Language header ("tr-TR,tr;q=0.9,en;q=0.8") to a supported locale, by weight; null when none matches. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/u.exec(p)?.[1]).find(Boolean);
      return { tag: tag ?? "", q: q === undefined ? 1 : Number(q), i };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranked) {
    const m = matchLocale(r.tag);
    if (m) return m;
  }
  return null;
}
