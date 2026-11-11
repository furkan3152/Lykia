/**
 * The interface languages (defined once in @lykia/core, shared with the
 * API). Each is named in its own language in the picker.
 */
import { pickLocale, type Locale } from "@lykia/core";

export { INTL_TAGS as INTL_TAG, isLocale, LOCALE_NAMES, LOCALES, matchLocale, type Locale } from "@lykia/core";

export const STORAGE_KEY = "lykia.locale";

/** First visit: the first browser language Lykia speaks, else English. */
export function detectLocale(languages: readonly string[] | undefined): Locale {
  return pickLocale(languages ?? []);
}
