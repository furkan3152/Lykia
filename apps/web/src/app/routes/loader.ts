import type React from "react";

/** Route chunk loading, shared by the router and the pages that warm the next one. */
import { matchRoute, ROUTES, type RouteId } from "./routeTable";

export const loadProviders = () => import("../providers");

export const resolved = new Map<RouteId, React.ComponentType>();
const inflight = new Map<RouteId, Promise<void>>();

export function loadRoute(id: RouteId): Promise<void> {
  if (resolved.has(id)) return Promise.resolve();
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = ROUTES[id]
    .load()
    .then((m) => {
      resolved.set(id, m.default);
      inflight.delete(id);
    })
    .catch((error: unknown) => {
      inflight.delete(id);
      throw error;
    });
  inflight.set(id, p);
  return p;
}

/** Warm the chunks a navigation to `pathname` needs (route + wallet stack for app pages). */
export function warmRoute(pathname: string): Promise<unknown> {
  const { route } = matchRoute(pathname, { dev: import.meta.env.DEV });
  return Promise.all([loadRoute(route.id), route.kind === "app" ? loadProviders() : null]).catch(() => undefined);
}
