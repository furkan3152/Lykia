/**
 * The interface language of the request being served. A middleware reads
 * it once (the body's `locale` on chat and plan routes, else
 * Accept-Language) and every code-written sentence of that request, core's
 * included, is looked up in it. Outside a request it is English.
 */
import { localizeOut } from "./out.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_LOCALE, isLocale, localeFromAcceptLanguage, matchLocale, setCoreLocaleSource, setTextRecorder, type Locale } from "@lykia/core";
import type { RequestHandler } from "express";

const store = new AsyncLocalStorage<{ locale: Locale; english?: Map<string, string> }>();

export function currentLocale(): Locale {
  return store.getStore()?.locale ?? DEFAULT_LOCALE;
}

/** Runs `fn` with `locale` as the current language (evals, jobs, tests). */
/** The English a sentence shown in this request came from (itself when it was not translated here). */
export function englishOf(shown: string): string {
  return store.getStore()?.english?.get(shown) ?? shown;
}

/** Remembers that `shown` stands for `english` for the rest of this request (a choice read back from the thread). */
export function rememberEnglish(shown: string, english: string): void {
  const s = store.getStore();
  if (s && shown !== english) (s.english ??= new Map()).set(shown, english);
}

export function withLocale<T>(locale: Locale, fn: () => T): T {
  return store.run({ locale }, fn);
}

/** Changes the language for the rest of this request (a body field read after parsing). */
export function setRequestLocale(locale: Locale): void {
  const s = store.getStore();
  if (s) s.locale = locale;
}

/** The locale a request asks for: an explicit `locale` (body or query), else Accept-Language, else English. */
export function requestLocale(input: { readonly body?: unknown; readonly query?: unknown; readonly header?: string | undefined }): Locale {
  const explicit = (v: unknown) => (typeof v === "object" && v !== null ? (v as { locale?: unknown }).locale : undefined);
  for (const v of [explicit(input.body), explicit(input.query)]) {
    if (isLocale(v)) return v;
    const loose = typeof v === "string" ? matchLocale(v) : null;
    if (loose) return loose;
  }
  return localeFromAcceptLanguage(input.header) ?? DEFAULT_LOCALE;
}

/** Express middleware: the request's language for everything it runs, and Content-Language on the answer. */
export function localeMiddleware(): RequestHandler {
  return (req, res, next) => {
    const locale = requestLocale({ body: req.body, query: req.query, header: req.get("accept-language") });
    res.setHeader("Content-Language", locale);
    res.vary("Accept-Language");
    if (locale !== DEFAULT_LOCALE && !/openapi|\.well-known/u.test(req.path)) {
      // Known phrases in a JSON answer (labels, statuses, constant sentences) leave in the request's language.
      const json = res.json.bind(res);
      res.json = (body: unknown) => json(store.run({ locale }, () => localizeOut(body)));
    }
    store.run({ locale }, next);
  };
}

// Core's sentences follow the request too, and each translated one remembers its English for the request.
setCoreLocaleSource(currentLocale);
setTextRecorder((shown, english) => {
  const s = store.getStore();
  if (!s) return;
  (s.english ??= new Map()).set(shown, english);
}, englishOf);
