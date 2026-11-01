import { createContext } from "react";

import type { RouteLocation } from "./history";
import type { RouteParams } from "./matchPath";
import type { RouteDefinition } from "./routeTable";

export interface RouterState {
  readonly location: RouteLocation;
  readonly route: RouteDefinition;
  readonly params: RouteParams;
  /** True while a navigation is waiting for its lazy route chunk. */
  readonly pending: boolean;
}

export const RouterContext = createContext<RouterState | null>(null);
