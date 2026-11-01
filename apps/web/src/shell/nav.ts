import type { RouteId } from "../app/routes/routeTable";

export interface NavItem {
  readonly id: RouteId;
  readonly href: string;
  readonly en: string;
  readonly match: readonly RouteId[];
}

/** Header order: ASK LYKO · FLOCK · DESK · PACK · FENCE · BUILD. */
export const NAV: readonly NavItem[] = [
  { id: "ask", href: "/app", en: "Ask Lyko", match: ["ask", "outrun"] },
  { id: "flock", href: "/app/flock", en: "Flock", match: ["flock", "pastures"] },
  { id: "orders", href: "/app/orders", en: "Desk", match: ["orders", "markets", "discover", "alerts", "activity", "whatif"] },
  { id: "pack", href: "/app/pack", en: "Pack", match: ["pack", "kunye"] },
  { id: "fence", href: "/app/fence", en: "Fence", match: ["fence", "scent"] },
  { id: "build", href: "/build", en: "Build", match: ["build", "owner"] },
];
