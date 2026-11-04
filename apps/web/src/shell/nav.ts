/**
 * Lykia's information architecture, in one place.
 *
 * Five primary areas, each a short list of sections shown as tabs:
 *
 *   ASK        say the outcome, get a checked plan
 *   PORTFOLIO  what you hold, moving it, yields, stress tests
 *   RULES      the Fence, agents, Tags, token checks, security
 *   AUTOMATE   orders, automations, alerts, the activity trail
 *   BUILD      the developer platform, the ecosystem, Circle, stats
 *
 * Everything else is secondary: the account pages (settings, memory) and a
 * short "More" list in the avatar menu and the footer. Pages that are not in
 * any list (the design kit, the night scene, payment links, redirects) are
 * reachable only by direct link, on purpose.
 *
 * Pure data: node tests import this file directly.
 */
import type { RouteId } from "../app/routes/routeTable";

export type AreaId = "ask" | "portfolio" | "rules" | "automate" | "build";

export interface NavSection {
  readonly id: RouteId;
  readonly href: string;
  readonly label: string;
  /** Other routes that light this section up (a detail page, for example). */
  readonly also?: readonly RouteId[];
}

export interface NavArea {
  readonly id: AreaId;
  readonly label: string;
  readonly href: string;
  /** One line: what the area is for. Used in the footer and the menu. */
  readonly blurb: string;
  readonly sections: readonly NavSection[];
}

export interface NavLink {
  readonly id: RouteId;
  readonly href: string;
  readonly label: string;
  readonly blurb: string;
}

export const AREAS: readonly NavArea[] = [
  {
    id: "ask",
    label: "Ask",
    href: "/app",
    blurb: "Say the outcome; get a plan checked by your Fence.",
    sections: [{ id: "ask", href: "/app", label: "Ask", also: ["outrun"] }],
  },
  {
    id: "portfolio",
    label: "Portfolio",
    href: "/app/flock",
    blurb: "What you hold on Arc, and moving it without a sentence.",
    sections: [
      { id: "flock", href: "/app/flock", label: "Holdings" },
      { id: "move", href: "/app/move", label: "Move" },
      { id: "pastures", href: "/app/pastures", label: "Yields" },
      { id: "whatif", href: "/app/whatif", label: "What-if" },
    ],
  },
  {
    id: "rules",
    label: "Rules",
    href: "/app/fence",
    blurb: "The Fence, agents and their Tags, token checks and security.",
    sections: [
      { id: "fence", href: "/app/fence", label: "Fence" },
      { id: "pack", href: "/app/pack", label: "Agents" },
      { id: "tag", href: "/app/tag", label: "Tags" },
      { id: "scent", href: "/app/scent", label: "Token check" },
      { id: "security", href: "/app/security", label: "Security" },
    ],
  },
  {
    id: "automate",
    label: "Automate",
    href: "/app/orders",
    blurb: "Orders, automations and alerts that run under the same Fence.",
    sections: [
      { id: "orders", href: "/app/orders", label: "Orders" },
      { id: "automations", href: "/app/automations", label: "Automations" },
      { id: "alerts", href: "/app/alerts", label: "Alerts" },
      { id: "activity", href: "/app/activity", label: "Activity" },
    ],
  },
  {
    id: "build",
    label: "Build",
    href: "/build",
    blurb: "The same engine as an API, MCP server, SDKs and components.",
    sections: [
      { id: "build", href: "/build", label: "Developers", also: ["developers"] },
      { id: "ecosystem", href: "/ecosystem", label: "Ecosystem" },
      { id: "circle", href: "/app/circle", label: "Circle" },
      { id: "stats", href: "/stats", label: "Stats" },
    ],
  },
];

/** The account pages, shown as tabs of their own and in the avatar menu. */
export const ACCOUNT: readonly NavSection[] = [
  { id: "you", href: "/app/you", label: "Settings" },
  { id: "memory", href: "/app/memory", label: "Memory" },
];

/** Secondary pages: real and working, but not part of the core story. */
export const MORE: readonly NavLink[] = [
  { id: "markets", href: "/app/markets", label: "Perps markets", blurb: "Read-only perpetuals data from Extended." },
  { id: "discover", href: "/app/discover", label: "New pools", blurb: "Fresh pools on Arc's exchanges, each token checked." },
  { id: "owner", href: "/owner", label: "Owner console", blurb: "Deploy and record Lykia's own contracts." },
  { id: "legal", href: "/legal/notice", label: "Notice and risks", blurb: "Software notice, risk disclosure and privacy." },
];

/** Routes deliberately outside every menu. */
export const UNLISTED: readonly RouteId[] = ["landing", "pay", "kit", "lykaion", "appNotFound", "notFound"];

/** The primary area a route belongs to, or null for account, secondary and unlisted pages. */
export function areaOf(routeId: RouteId): NavArea | null {
  return AREAS.find((a) => a.sections.some((s) => s.id === routeId || s.also?.includes(routeId))) ?? null;
}

/** The tab row for a route: its area's sections, or the account tabs. Null when there is nothing to switch between. */
export function tabsFor(routeId: RouteId): readonly NavSection[] | null {
  const area = areaOf(routeId);
  if (area) return area.sections.length > 1 ? area.sections : null;
  return ACCOUNT.some((s) => s.id === routeId) ? ACCOUNT : null;
}

export function sectionIsCurrent(section: NavSection, routeId: RouteId): boolean {
  return section.id === routeId || Boolean(section.also?.includes(routeId));
}
