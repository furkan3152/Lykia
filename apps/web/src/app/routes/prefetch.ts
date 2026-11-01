import { matchRoute, type RouteId } from "./routeTable";

const prefetched = new Set<RouteId>();

/** Starts loading the page chunk for `href` (same-origin paths only). Errors are ignored. */
export function prefetchHref(href: string): void {
  let pathname: string;
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    pathname = url.pathname;
  } catch {
    return;
  }
  const { route } = matchRoute(pathname, { dev: import.meta.env.DEV });
  if (prefetched.has(route.id)) return;
  prefetched.add(route.id);
  route.load().catch(() => prefetched.delete(route.id));
}
