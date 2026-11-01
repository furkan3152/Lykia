/** Pure configuration rules (no import.meta.env here: node tests load this file). */

export const DEFAULT_API_URL = "http://localhost:3002";

export interface ApiBaseResult {
  readonly base: string;
  /** Plain-words problem with the configured value, when it was rejected. */
  readonly warning: string | null;
}

/**
 * The API origin from VITE_API_URL. It must be an origin only (scheme, host,
 * optional port): no path, query, fragment or credentials, so every request
 * path is built by Lykia and a misconfigured value cannot smuggle a prefix.
 * Invalid values fall back to the local default and say why.
 */
export function resolveApiBase(raw: string | undefined | null): ApiBaseResult {
  const value = (raw ?? "").trim();
  if (value === "") return { base: DEFAULT_API_URL, warning: null };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { base: DEFAULT_API_URL, warning: `VITE_API_URL "${value}" is not a URL; using ${DEFAULT_API_URL}.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { base: DEFAULT_API_URL, warning: `VITE_API_URL must use http or https; using ${DEFAULT_API_URL}.` };
  }
  if (url.username || url.password) {
    return { base: DEFAULT_API_URL, warning: `VITE_API_URL must not carry credentials; using ${DEFAULT_API_URL}.` };
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    return { base: DEFAULT_API_URL, warning: `VITE_API_URL must be an origin only (no path, query or fragment); using ${DEFAULT_API_URL}.` };
  }
  return { base: url.origin, warning: null };
}
