/**
 * The API's message catalogue: every sentence code writes for the owner
 * (desk answers, questions and options, preflight, Fence reasons, plan
 * steps, insights, card labels, notices, refusals, error messages) is a key
 * here with parameters, in the request's language. Keys are English and
 * the English catalogue defines them, so a missing key fails the typecheck.
 *
 * Messages use the web's small ICU subset: "{name}",
 * "{n, plural, one {# step} other {# steps}}", "{kind, select, a {…} other {…}}".
 */
import { DEFAULT_LOCALE, INTL_TAGS, registerCoreCatalogue, type Locale } from "@lykia/core";
import en, { type MessageKey } from "./messages/en.js";
import es from "./messages/es.js";
import fr from "./messages/fr.js";
import ptBR from "./messages/pt-BR.js";
import tr from "./messages/tr.js";
import zhCN from "./messages/zh-CN.js";
import coreEs from "@lykia/core/i18n/es";
import coreFr from "@lykia/core/i18n/fr";
import corePtBR from "@lykia/core/i18n/pt-BR";
import coreTr from "@lykia/core/i18n/tr";
import coreZhCN from "@lykia/core/i18n/zh-CN";
import { currentLocale } from "./context.js";

export type { MessageKey };
export type Params = Readonly<Record<string, string | number | null | undefined>>;
type Catalogue = Readonly<Record<MessageKey, string>>;

export const CATALOGUES: Readonly<Record<Locale, Catalogue>> = { en, tr, es, "pt-BR": ptBR, "zh-CN": zhCN, fr };

registerCoreCatalogue("tr", coreTr);
registerCoreCatalogue("es", coreEs);
registerCoreCatalogue("pt-BR", corePtBR);
registerCoreCatalogue("zh-CN", coreZhCN);
registerCoreCatalogue("fr", coreFr);

function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

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

function interpolate(locale: Locale, text: string, params: Params | undefined, hash: string | null): string {
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
      const options = branches(rest.slice(comma2 + 1));
      const value = params?.[name];
      if (kind === "plural") {
        const n = Number(value ?? 0);
        const pick = options.get(`=${n}`) ?? options.get(new Intl.PluralRules(locale).select(n)) ?? options.get("other") ?? "";
        out += interpolate(locale, pick, params, typeof value === "string" ? value : new Intl.NumberFormat(INTL_TAGS[locale]).format(n));
      } else {
        out += interpolate(locale, options.get(String(value)) ?? options.get("other") ?? "", params, hash);
      }
    }
    i = close + 1;
  }
  return out;
}

/** A message in the request's language (or the one given). */
export function t(key: MessageKey, params?: Params, locale: Locale = currentLocale()): string {
  const text = CATALOGUES[locale]?.[key] ?? en[key] ?? key;
  return params || text.includes("{") ? interpolate(locale, text, params, null) : text;
}

/** The same message in English, whatever the request's language (logs, stored audit text). */
export function tEn(key: MessageKey, params?: Params): string {
  return t(key, params, DEFAULT_LOCALE);
}
