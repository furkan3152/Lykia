/**
 * The message syntax every catalogue uses, a small ICU subset shared by the
 * web app, core and the API: "{name}" for a parameter,
 * "{n, plural, one {# step} other {# steps}}" (with "=0" style exact
 * matches) and "{kind, select, swap {…} other {…}}".
 */
import { INTL_TAGS, type Locale } from "../locale.js";

export type MessageParams = Readonly<Record<string, string | number | null | undefined>>;

const pluralRules = new Map<Locale, Intl.PluralRules>();
function pluralOf(locale: Locale, n: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(INTL_TAGS[locale])));
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

function interpolate(locale: Locale, text: string, params: MessageParams | undefined, hash: string | null): string {
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
        const pick = options.get(`=${n}`) ?? options.get(pluralOf(locale, n)) ?? options.get("other") ?? "";
        out += interpolate(locale, pick, params, typeof value === "string" ? value : new Intl.NumberFormat(INTL_TAGS[locale]).format(n));
      } else {
        const pick = options.get(String(value)) ?? options.get("other") ?? "";
        out += interpolate(locale, pick, params, hash);
      }
    }
    i = close + 1;
  }
  return out;
}

/** A message with its parameters filled in, plural and select forms chosen for the language. */
export function formatMessage(locale: Locale, text: string, params?: MessageParams): string {
  return params || text.includes("{") ? interpolate(locale, text, params, null) : text;
}
