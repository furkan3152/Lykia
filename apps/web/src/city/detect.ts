/**
 * City mode: which League city, if any, this page is. Pure, so it is tested
 * without a browser. In order:
 *
 *   1. <slug>.<root domain>       pay.lykia.app (VITE_LYKIA_ROOT_DOMAIN)
 *   2. /c/<slug>                  works on any host, before a domain exists
 *   3. ?city=<slug>               the same, as a query
 *   4. a verified custom domain   any other host, once a root domain is set
 *
 * The root domain itself, www, Lykia's own reserved labels, localhost and
 * *.vercel.app hosts boot the full app.
 */

export type CityTarget =
  | { readonly kind: "slug"; readonly slug: string; readonly via: "subdomain" | "path" | "query" }
  | { readonly kind: "host"; readonly host: string };

const CITY_SLUG = /^[a-z][a-z0-9-]{1,22}[a-z0-9]$/u;
/** Labels that are Lykia's own hosts, never a city (kept in step with core's RESERVED_SLUGS). */
const OWN_LABELS: ReadonlySet<string> = new Set(["www", "api", "app", "admin", "letoon", "mint", "league", "lykia", "static", "assets", "cdn", "docs", "mail", "status"]);

export interface PageAddress {
  readonly hostname: string;
  readonly pathname: string;
  readonly search: string;
}

function local(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

export function detectCity(page: PageAddress, rootDomain: string | null | undefined): CityTarget | null {
  const host = page.hostname.toLowerCase();
  const root = rootDomain?.trim().toLowerCase().replace(/^\.+|\.+$/gu, "") || null;
  if (root && host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1));
    if (!label.includes(".") && CITY_SLUG.test(label) && !OWN_LABELS.has(label)) return { kind: "slug", slug: label, via: "subdomain" };
  }
  const path = /^\/c\/([a-z0-9-]+)\/?(?:$|\/)/u.exec(page.pathname);
  if (path && CITY_SLUG.test(path[1]!)) return { kind: "slug", slug: path[1]!, via: "path" };
  const query = new URLSearchParams(page.search).get("city");
  if (query && CITY_SLUG.test(query)) return { kind: "slug", slug: query, via: "query" };
  if (root && host !== root && !host.endsWith(`.${root}`) && !local(host) && !host.endsWith(".vercel.app")) return { kind: "host", host };
  return null;
}

/** Where a city lives: its subdomain when a root domain is set, otherwise /c/<slug> on this site. */
export function cityUrl(slug: string, rootDomain: string | null | undefined, origin: string): string {
  const root = rootDomain?.trim().toLowerCase() || null;
  return root ? `https://${slug}.${root}` : `${origin}/c/${slug}`;
}

/** The main Lykia site, seen from a city (the root domain when there is one). */
export function lykiaHome(rootDomain: string | null | undefined, origin: string, target: CityTarget): string {
  const root = rootDomain?.trim().toLowerCase() || null;
  if (target.kind === "slug" && target.via === "subdomain" && root) return `https://${root}`;
  return target.kind === "host" && root ? `https://${root}` : origin;
}
