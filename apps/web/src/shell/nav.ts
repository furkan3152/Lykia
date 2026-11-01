import type { RouteId } from "../app/routes/routeTable";

export interface NavItem {
  readonly id: RouteId;
  readonly href: string;
  readonly en: string;
  readonly tr: string;
  readonly match: readonly RouteId[];
}

/** Header order: ASK LYKO · FLOCK · PACK · FENCE · BUILD. */
export const NAV: readonly NavItem[] = [
  { id: "ask", href: "/app", en: "Ask Lyko", tr: "Lyko'ya sor", match: ["ask", "outrun"] },
  { id: "flock", href: "/app/flock", en: "Flock", tr: "Sürü", match: ["flock", "pastures"] },
  { id: "pack", href: "/app/pack", en: "Pack", tr: "Yavrular", match: ["pack", "kunye"] },
  { id: "fence", href: "/app/fence", en: "Fence", tr: "Çit", match: ["fence", "scent"] },
  { id: "build", href: "/build", en: "Build", tr: "Geliştir", match: ["build", "owner"] },
];
