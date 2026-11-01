import { useContext } from "react";

import { getLocation, navigate } from "./history";
import { matchRoute } from "./routeTable";
import { RouterContext, type RouterState } from "./routerContext";

export { navigate };

/** Current location, matched route, params and pending state. Works outside the router too (read-only snapshot). */
export function useRoute(): RouterState {
  const state = useContext(RouterContext);
  if (state) return state;
  const location = getLocation();
  const { route, params } = matchRoute(location.pathname, { dev: import.meta.env.DEV });
  return { location, route, params, pending: false };
}

/** One route parameter (`useRouteParam("market")` on /app/trade/ETH gives "ETH"). */
export function useRouteParam(name: string): string | undefined {
  return useRoute().params[name];
}

/** One query parameter of the current URL. */
export function useSearchParam(name: string): string | null {
  const { location } = useRoute();
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}
