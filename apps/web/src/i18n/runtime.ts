/**
 * The message runtime. The English catalogue is bundled; every other
 * language is its own chunk, loaded once before the app renders. Switching
 * language stores the choice and reloads, so every module (including
 * constants computed at import) reads the new catalogue.
 *
 * Messages use a small ICU subset: "{name}" for a parameter,
 * "{n, plural, one {# step} other {# steps}}" and
 * "{kind, select, swap {…} other {…}}".
 */
import en, { type MessageKey } from "./messages/en";
import { registerCoreCatalogue, setCoreLocaleSource } from "@lykia/core";
import { detectLocale, isLocale, matchLocale, STORAGE_KEY, type Locale } from "./locales";

export type { MessageKey };
export type Params = Readonly<Record<string, string | number | null | undefined>>;
type Catalogue = Readonly<Record<MessageKey, string>>;

let locale: Locale = "en";
let messages: Catalogue = en;

export function currentLocale(): Locale {
  return locale;
}

const LOADERS: Readonly<Record<Exclude<Locale, "en">, () => Promise<{ default: Catalogue }>>> = {
  tr: () => import("./messages/tr"),
  es: () => import("./messages/es"),
  "pt-BR": () => import("./messages/pt-BR"),
  "zh-CN": () => import("./messages/zh-CN"),
  fr: () => import("./messages/fr"),
};

/** Core's own sentences (plain meanings, checks, Fence reasons) in the same language, one chunk per language. */
const CORE_LOADERS: Readonly<Record<Exclude<Locale, "en">, () => Promise<{ default: Readonly<Record<string, string>> }>>> = {
  tr: () => import("@lykia/core/i18n/tr"),
  es: () => import("@lykia/core/i18n/es"),
  "pt-BR": () => import("@lykia/core/i18n/pt-BR"),
  "zh-CN": () => import("@lykia/core/i18n/zh-CN"),
  fr: () => import("@lykia/core/i18n/fr"),
};

setCoreLocaleSource(() => locale);

/** The stored choice, else the browser's language if Lykia speaks it, else English. */
export function preferredLocale(): Locale {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
    const loose = matchLocale(stored);
    if (loose) return loose;
  } catch {
    /* storage blocked: fall back to the browser */
  }
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  return detectLocale(nav?.languages ?? (nav?.language ? [nav.language] : []));
}

/** Loads a language's catalogue and makes it current. Sets <html lang>. */
export async function loadLocale(next: Locale): Promise<void> {
  if (next !== "en") {
    const [own, core] = await Promise.all([LOADERS[next](), CORE_LOADERS[next]()]);
    messages = own.default;
    registerCoreCatalogue(next, core.default);
  } else messages = en;
  locale = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
}

/** Stores the owner's choice and reloads the page in that language. */
export function chooseLocale(next: Locale, reload = true): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    /* storage blocked: this visit only */
  }
  if (reload && typeof window !== "undefined") window.location.reload();
}

/** Use only in tests: switch the catalogue without a page. */
export function setCatalogueForTests(next: Locale, catalogue: Catalogue): void {
  locale = next;
  messages = catalogue;
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralOf(n: number): string {
  const key = locale;
  let rules = pluralRules.get(key);
  if (!rules) pluralRules.set(key, (rules = new Intl.PluralRules(key)));
  return rules.select(n);
}

/** Finds the matching close brace of the "{" at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** "one {# step} other {# steps}" → { one: "# step", other: "# steps" }. */
function branches(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf("{", i);
    if (open < 0) break;
    const name = body.slice(i, open).trim();
    const close = closing(body, open);
    if (close < 0) break;
    out.set(name, body.slice(open + 1, close));
    i = close + 1;
  }
  return out;
}

function interpolate(text: string, params: Params | undefined, hash: string | null): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "#" && hash !== null) {
      out += hash;
      i++;
      continue;
    }
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const close = closing(text, i);
    if (close < 0) {
      out += text.slice(i);
      break;
    }
    const inner = text.slice(i + 1, close);
    const comma = inner.indexOf(",");
    if (comma < 0) {
      const name = inner.trim();
      const v = params?.[name];
      out += v === undefined && !(params && name in params) ? `{${inner}}` : v === null || v === undefined ? "" : String(v);
    } else {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1);
      const comma2 = rest.indexOf(",");
      const kind = rest.slice(0, comma2).trim();
      const body = rest.slice(comma2 + 1);
      const value = params?.[name];
      const options = branches(body);
      if (kind === "plural") {
        const n = Number(value ?? 0);
        const pick = options.get(`=${n}`) ?? options.get(pluralOf(n)) ?? options.get("other") ?? "";
        out += interpolate(pick, params, typeof value === "string" ? value : formatCount(n));
      } else {
        const pick = options.get(String(value)) ?? options.get("other") ?? "";
        out += interpolate(pick, params, hash);
      }
    }
    i = close + 1;
  }
  return out;
}

function formatCount(n: number): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** The message for a key in the interface language, with its parameters filled in. */
export function t(key: MessageKey, params?: Params): string {
  const text = messages[key] ?? en[key] ?? key;
  return params || text.includes("{") ? interpolate(text, params, null) : text;
}

/** True when a string is a catalogue key (for values that may be a key or already text). */
export function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}
