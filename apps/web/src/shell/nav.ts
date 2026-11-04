/**
 * Lykia's information architecture, in one place.
 *
 * Five primary areas. Each label is a metaphor from the shepherd's valley
 * with a short plain subtitle beside it, so a newcomer reads the product and
 * a returning user reads the story:
 *
 *   ASK LYKO   assistant                say the outcome, get a checked plan
 *   FLOCK      portfolio                what you hold, moving it, yields, stress tests
 *   FENCE      rules                    the Fence, the Pack, Tags, Scent, the watch
 *   HERDING    orders and automations   orders, rounds, barks, tracks
 *   THE MINT   build                    the developer portal, the League, the harbour, Circle, the ledger
 *
 * Everything else is secondary: the account pages (settings, memory), a
 * short "More" list in the avatar menu and the footer, and Letoon, the team
 * console, which the avatar menu shows to admins only. Pages in no list (the
 * design kit, the night scene, payment links, redirects) are reachable only
 * by direct link, on purpose.
 *
 * Pure data: node tests import this file directly.
 */
import type { RouteId } from "../app/routes/routeTable";

export type AreaId = "ask" | "flock" | "fence" | "herding" | "mint";

export interface NavSection {
  readonly id: RouteId;
  readonly href: string;
  /** The metaphor (or the plain word when there is no metaphor). */
  readonly label: string;
  /** What it is, in plain words. */
  readonly sub: string;
  /** Other routes that light this section up (a detail page, for example). */
  readonly also?: readonly RouteId[];
}

export interface NavArea {
  readonly id: AreaId;
  /** The metaphor shown first. */
  readonly label: string;
  /** The plain subtitle shown under it ("portfolio"). */
  readonly sub: string;
  /** A one-word subtitle for the phone's bottom bar. */
  readonly short: string;
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
    label: "Ask Lyko",
    sub: "assistant",
    short: "assistant",
    href: "/app",
    blurb: "Say the outcome; get a plan checked by your Fence.",
    sections: [{ id: "ask", href: "/app", label: "Ask Lyko", sub: "assistant", also: ["outrun"] }],
  },
  {
    id: "flock",
    label: "Flock",
    sub: "portfolio",
    short: "portfolio",
    href: "/app/flock",
    blurb: "What you hold on Arc, and moving it without a sentence.",
    sections: [
      { id: "flock", href: "/app/flock", label: "Flock", sub: "portfolio" },
      { id: "move", href: "/app/move", label: "Move", sub: "send and swap" },
      { id: "pastures", href: "/app/pastures", label: "Pastures", sub: "yields" },
      { id: "whatif", href: "/app/whatif", label: "What-if", sub: "stress test" },
    ],
  },
  {
    id: "fence",
    label: "Fence",
    sub: "rules",
    short: "rules",
    href: "/app/fence",
    blurb: "Your rules, your agents and their Tags, token checks and the watch.",
    sections: [
      { id: "fence", href: "/app/fence", label: "Fence", sub: "rules" },
      { id: "pack", href: "/app/pack", label: "Pack", sub: "agents" },
      { id: "tag", href: "/app/tag", label: "Tag", sub: "agent identity" },
      { id: "scent", href: "/app/scent", label: "Scent", sub: "token check" },
      { id: "security", href: "/app/security", label: "Watch", sub: "security" },
    ],
  },
  {
    id: "herding",
    label: "Herding",
    sub: "orders and automations",
    short: "orders",
    href: "/app/orders",
    blurb: "Orders, automations and alerts that run under the same Fence.",
    sections: [
      { id: "orders", href: "/app/orders", label: "Orders", sub: "limit, stop, DCA" },
      { id: "automations", href: "/app/automations", label: "Rounds", sub: "automations" },
      { id: "alerts", href: "/app/alerts", label: "Barks", sub: "alerts" },
      { id: "activity", href: "/app/activity", label: "Tracks", sub: "activity" },
    ],
  },
  {
    id: "mint",
    label: "The Mint",
    sub: "build",
    short: "build",
    href: "/mint",
    blurb: "Build on the same engine, and the League of cities built with it.",
    sections: [
      { id: "mint", href: "/mint", label: "The Mint", sub: "developer portal", also: ["build", "developers"] },
      { id: "league", href: "/league", label: "The League", sub: "Lykia's cities", also: ["city"] },
      { id: "ecosystem", href: "/ecosystem", label: "Harbour", sub: "ecosystem" },
      { id: "circle", href: "/app/circle", label: "Circle", sub: "rails" },
      { id: "stats", href: "/stats", label: "Ledger", sub: "stats" },
    ],
  },
];

/** "Flock · portfolio": the metaphor and its plain meaning, as page titles and menus show them. */
export function titleOf(item: { readonly label: string; readonly sub: string }): string {
  return item.label.toLowerCase() === item.sub.toLowerCase() ? item.label : `${item.label} · ${item.sub}`;
}

/** The account pages, shown as tabs of their own and in the avatar menu. */
export const ACCOUNT: readonly NavSection[] = [
  { id: "you", href: "/app/you", label: "Settings", sub: "settings" },
  { id: "memory", href: "/app/memory", label: "Memory", sub: "memory" },
];

/** Secondary pages: real and working, but not part of the core story. */
export const MORE: readonly NavLink[] = [
  { id: "markets", href: "/app/markets", label: "Perps markets", blurb: "Read-only perpetuals data from Extended." },
  { id: "discover", href: "/app/discover", label: "New pools", blurb: "Fresh pools on Arc's exchanges, each token checked." },
  { id: "legal", href: "/legal/notice", label: "Notice and risks", blurb: "Software notice, risk disclosure and privacy." },
];

/** The team console: in the avatar menu for admins only (the API checks the role on every call). */
export const ADMIN: readonly NavLink[] = [{ id: "letoon", href: "/letoon", label: "Letoon", blurb: "The team console: League council, contracts, flags and the Whistle, Circle, audit, usage." }];

/** Routes deliberately outside every menu. `owner` is an alias of Letoon. */
export const UNLISTED: readonly RouteId[] = ["landing", "pay", "kit", "lykaion", "owner", "appNotFound", "notFound"];

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
