import { BadgeCheck, Code2, Fence, LayoutDashboard, PawPrint, Route, Sheet, type LucideIcon } from "lucide-react";

import { routeHref, type RouteId } from "../routes/routeTable";

export interface NavItem {
  readonly id: RouteId;
  readonly label: string;
  /** Turkish label for the language toggle. */
  readonly tr: string;
  readonly href: string;
  readonly icon: LucideIcon;
  /** One line for tooltips and the "More" menu. */
  readonly hint: string;
  /** Keyboard sequence shown in the shortcuts sheet ("g f"). */
  readonly keys?: string;
  /** In the header and the phone's tabs. */
  readonly primary?: boolean;
  /** "prefix" (default) keeps the item active on sub-paths; the deck root is "exact". */
  readonly match?: "exact" | "prefix";
}

/** The deck's destinations: the four primary ones first, then the rest (the "More" menu). */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "deck", label: "Deck", tr: "Masa", href: routeHref("deck"), icon: LayoutDashboard, hint: "One sentence becomes an Outrun", keys: "g d", primary: true, match: "exact" },
  { id: "flock", label: "Flock", tr: "Sürü", href: routeHref("flock"), icon: Sheet, hint: "Everything you hold on Arc", keys: "g f", primary: true },
  { id: "fence", label: "Fence", tr: "Çit", href: routeHref("fence"), icon: Fence, hint: "The rules around your agents, and the Whistle", keys: "g c", primary: true },
  { id: "scent", label: "Scent", tr: "Koku", href: routeHref("scent"), icon: PawPrint, hint: "Sniff a token before anyone touches it", keys: "g s", primary: true },
  { id: "kunye", label: "Künye", tr: "Künye", href: routeHref("kunye"), icon: BadgeCheck, hint: "Agent licences: ERC-8004 identity + Fence hash", keys: "g k" },
];

/** Public pages listed in "More" after the deck destinations. */
export const SITE_ITEMS: readonly NavItem[] = [
  { id: "developers", label: "Developers", tr: "Geliştiriciler", href: routeHref("developers"), icon: Code2, hint: "API, MCP and x402" },
  { id: "landing", label: "The valley", tr: "Vadi", href: routeHref("landing"), icon: Route, hint: "What Lykia is, in sixty seconds", match: "exact" },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((item) => item.primary);
export const MORE_NAV: readonly NavItem[] = [...NAV_ITEMS.filter((item) => !item.primary), ...SITE_ITEMS];
