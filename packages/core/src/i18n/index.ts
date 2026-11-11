/**
 * Core's own sentences in the interface language. Core is shared by the
 * web app and the API, so its text is looked up by its English wording
 * (the English is the key): `tx("Fuel is low")`, or with parameters,
 * `tx("{n} positions", { n })`. The app registers each language's
 * catalogue and tells core which language is current (the web: the page's;
 * the API: the request's). English, or a phrase not yet in a catalogue,
 * comes back as written. The completeness check fails on any missing phrase.
 */
import { DEFAULT_LOCALE, INTL_TAGS, type Locale } from "../locale.js";
import { formatMessage } from "./message.js";

export { formatMessage, type MessageParams } from "./message.js";

export type TextParams = Readonly<Record<string, string | number | null | undefined>>;

const catalogues = new Map<Locale, Readonly<Record<string, string>>>();
let source: () => Locale = () => DEFAULT_LOCALE;

/** Registers a language's core catalogue (English phrase → translation). */
export function registerCoreCatalogue(locale: Locale, catalogue: Readonly<Record<string, string>>): void {
  catalogues.set(locale, catalogue);
}

/** Where core reads the current language from (a constant in the web, the request's context in the API). */
export function setCoreLocaleSource(read: () => Locale): void {
  source = read;
}

/** The Intl locale tag of the current language, for numbers and dates core writes. */
export function coreIntlTag(): string {
  return INTL_TAGS[source()];
}

export function coreLocale(): Locale {
  return source();
}

/**
 * A known phrase in the language: the exact text, the same text with its first letter's case changed (a meaning
 * lowered to sit inside a sentence), or a "label · line" / "label: line" pair whose parts are known. Null otherwise.
 */
function knownIn(catalogue: Readonly<Record<string, string>>, text: string): string | null {
  const exact = catalogue[text];
  if (exact !== undefined) return exact;
  const first = text.charAt(0);
  const flipped = first === first.toLowerCase() ? first.toUpperCase() + text.slice(1) : first.toLowerCase() + text.slice(1);
  const viaCase = catalogue[flipped];
  if (viaCase !== undefined) {
    const f = viaCase.charAt(0);
    return first === first.toLowerCase() ? f.toLowerCase() + viaCase.slice(1) : f.toUpperCase() + viaCase.slice(1);
  }
  // A "label · line" or "label: line" pair, each part known on its own or sentence by sentence.
  const parts = text.split(/( · |: )/u);
  const sentences = (part: string): string | null => {
    const bits = part.split(/((?<=[.!?。])\s+(?=\S))/u);
    if (bits.length < 3) return null;
    // Sentences are matched in the longest known runs: a catalogue entry can hold two sentences.
    const said = bits.filter((_, i) => i % 2 === 0);
    const gaps = bits.filter((_, i) => i % 2 === 1);
    let hit = false;
    let out = "";
    for (let start = 0; start < said.length; ) {
      let end = said.length;
      let t: string | undefined;
      for (; end > start; end--) {
        const run = said.slice(start, end).map((x, k) => (k === 0 ? x : `${gaps[start + k - 1]}${x}`)).join("");
        t = catalogue[run];
        if (t !== undefined) break;
      }
      if (t !== undefined) hit = true;
      else end = start + 1;
      out += `${start > 0 ? gaps[start - 1] : ""}${t ?? said[start]}`;
      start = end;
    }
    return hit ? out : null;
  };
  if (parts.length < 3) return sentences(text);
  let changed = false;
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    const hit = catalogue[part] ?? sentences(part);
    if (hit !== null) changed = true;
    return hit ?? part;
  });
  return changed ? out.join("") : null;
}

/** A parameter that is itself a known English phrase (a label, a status) is shown in the language too. */
function translatedParams(locale: Locale, params: TextParams | undefined): TextParams | undefined {
  if (!params || locale === DEFAULT_LOCALE) return params;
  const catalogue = catalogues.get(locale);
  if (!catalogue) return params;
  const out: Record<string, string | number | null | undefined> = {};
  for (const [k, v] of Object.entries(params)) out[k] = typeof v === "string" && v.length > 0 ? (knownIn(catalogue, v) ?? v) : v;
  return out;
}

let recorder: ((shown: string, english: string) => void) | null = null;
let englishOf: (shown: string) => string = (shown) => shown;

/**
 * Lets the API remember, per request, the English each translated sentence came from, so a chip the owner taps in
 * their language can be read as the sentence the reader understands.
 */
export function setTextRecorder(record: ((shown: string, english: string) => void) | null, lookup?: (shown: string) => string): void {
  recorder = record;
  if (lookup) englishOf = lookup;
}

/** The English a sentence shown in this request came from (the text itself when it was not translated here). */
export function englishText(shown: string): string {
  return englishOf(shown);
}

function render(locale: Locale, english: string, params: TextParams | undefined): string {
  const translated = locale === DEFAULT_LOCALE ? undefined : catalogues.get(locale)?.[english];
  const shown = formatMessage(locale, translated ?? english, translatedParams(locale, params));
  if (recorder && locale !== DEFAULT_LOCALE) {
    const plain: Record<string, string | number | null | undefined> = {};
    for (const [k, v] of Object.entries(params ?? {})) plain[k] = typeof v === "string" ? englishOf(v) : v;
    recorder(shown, formatMessage(DEFAULT_LOCALE, english, plain));
  }
  return shown;
}

/** True when a phrase has a translation in the language (English always does). */
export function hasText(locale: Locale, english: string): boolean {
  return locale === DEFAULT_LOCALE || Boolean(catalogues.get(locale)?.[english]);
}

/** A whole string that is exactly a known phrase, in the current language; anything else comes back as it is. */
export function txKnown(text: string): string {
  const locale = source();
  if (locale === DEFAULT_LOCALE) return text;
  const catalogue = catalogues.get(locale);
  const shown = catalogue && text.length > 0 ? knownIn(catalogue, text) : null;
  if (shown === null) return text;
  recorder?.(shown, text);
  return shown;
}

/** Marks a phrase for the catalogue without translating it (module constants, read before any request has a language); translate it where it is shown with txKnown or as a tx parameter. */
export function phrase<T extends string>(english: T): T {
  return english;
}

/** A core sentence in the current language. */
export function tx(english: string, params?: TextParams): string {
  return render(source(), english, params);
}

/** A core sentence in a given language, whatever the current one is. */
export function txIn(locale: Locale, english: string, params?: TextParams): string {
  return render(locale, english, params);
}

/** A copy of plain data with every known English phrase among its words shown in the current language (sample data built in English). */
export function knownTree<T>(value: T): T {
  if (source() === DEFAULT_LOCALE) return value;
  const walk = (v: unknown, key: string, depth: number): unknown => {
    if (depth > 12 || RAW_FIELDS.has(key) || DATA_FIELDS.has(key)) return v;
    if (typeof v === "string") return txKnown(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, key, depth + 1));
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x, k, depth + 1)]));
    return v;
  };
  return walk(value, "", 0) as T;
}

/** Fields of plain data that hold codes a program compares (states, kinds, places), never words shown as they are. */
const DATA_FIELDS = new Set(["where", "venueKind", "role", "state", "status", "decision", "environment", "type", "tone", "unit", "action", "verb", "address", "owner", "at", "readAt", "hash", "txHash", "chain", "protocol", "feature", "template", "mode", "risk", "danger", "ends"]);

/** Fields that hold identifiers, patterns or sources, never words shown to a person. */
const RAW_FIELDS = new Set(["id", "kind", "key", "words", "source", "href", "env", "flag", "venue", "address", "token", "symbol", "check", "family", "severity"]);
const views = new WeakMap<object, object>();

/**
 * A read-only view of a constant whose words are shown in the current language when they are read (labels,
 * plain meanings, preset descriptions). Core's constants are built once, before any page or request has a
 * language, so they translate at the moment they are read instead.
 */
export function localized<T extends object>(value: T): T {
  const cached = views.get(value);
  if (cached) return cached as T;
  const view = new Proxy(value, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop !== "string" || RAW_FIELDS.has(prop)) return v;
      if (typeof v === "string") return txKnown(v);
      if (v !== null && typeof v === "object") return localized(v as object);
      return v;
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
  views.set(value, view);
  return view as T;
}
