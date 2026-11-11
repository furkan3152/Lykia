/**
 * The document's own text in the interface language: <html lang>, the
 * description and the social preview tags (index.html ships the English
 * ones for crawlers). Page titles are set by the router from the catalogue.
 */
import { currentLocale, t } from "./runtime";

export function installDocumentText(): void {
  document.documentElement.lang = currentLocale();
  const set = (selector: string, value: string) => document.querySelector(selector)?.setAttribute("content", value);
  document.title = t("meta.title");
  set('meta[name="description"]', t("meta.description"));
  set('meta[property="og:title"]', t("meta.title"));
  set('meta[property="og:description"]', t("meta.ogDescription"));
}
