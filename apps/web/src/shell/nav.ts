/**
 * Lykia's information architecture, in one place.
 *
 * Three primary areas. Each label is a metaphor from the shepherd's valley
 * with a plain subtitle, so a newcomer reads the product and a returning user
 * reads the story. The top menu shows the name with a pixel icon only (see
 * NavTile.tsx); the subtitle is its tooltip, its accessible name and the page
 * title:
 *
 *   ASK LYKO   your agent                                   every action happens here
 *   THE FOLD   everything you own and everything in motion  holdings, activity, instructions, agents, rules + Lyko on watch
 *   THE FORGE  build                                        the developer portal, the League, the harbour, Circle, the ledger
 *
 * Two places, one rule: Ask Lyko starts things, the Fold shows and manages
 * them. If the agent can do something, there is no separate page for it: the
 * old Move, Orders, Alerts, Automations, Activity, What-if, Fence, Pack,
 * Security and Flock pages redirect to Ask Lyko with a prefilled intent or to
 * the matching Fold tab, and Pastures, Discover and Markets became answers
 * in Ask (see app/routes/aliases.ts). No form page is left.
 *
 * Everything else is secondary: Your Lyko (preferences, voice and memory) in
 * the avatar menu, a short "More" list, and Letoon, the team console, which
 * the avatar menu shows to admins only. Detail pages (an agent, a Tag, a
 * token check, the watch, the yields) live inside their area and are reached
 * from it. Pages in no list are reachable only by direct link, on purpose.
 *
 * Pure data: node tests import this file directly.
 */
import type { RouteId } from "../app/routes/routeTable";
import { t } from "../i18n";

export type AreaId = "ask" | "fold" | "forge";

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
  /** The plain subtitle ("your agent"). */
  readonly sub: string;
  /** A short subtitle for narrow headers. */
  readonly short: string;
  /** One word for the phone's bottom bar ("Ask", "Fold", "Forge"). */
  readonly tab: string;
  readonly href: string;
  /** One line: what the area is for. Used in the footer and as the link title. */
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
    label: t("shell.nav.askLyko"),
    sub: t("shell.nav.yourAgent"),
    short: t("shell.nav.yourAgent"),
    tab: t("shell.nav.ask"),
    href: "/app",
    blurb: t("shell.nav.sayTheOutcomeLykoPlansIt"),
    sections: [{ id: "ask", href: "/app", label: t("shell.nav.askLyko"), sub: t("shell.nav.yourAgent"), also: ["outrun"] }],
  },
  {
    id: "fold",
    label: t("shell.nav.theFold"),
    sub: t("shell.nav.everythingYouOwnAndEverythingIn"),
    short: t("shell.nav.allYouOwn"),
    tab: "Fold",
    href: "/app/fold",
    blurb: t("shell.nav.holdingsActivityInstructionsAgentsAndRul"),
    sections: [{ id: "fold", href: "/app/fold", label: t("shell.nav.theFold"), sub: t("shell.nav.everythingYouOwnAndEverythingIn"), also: ["tag", "scent"] }],
  },
  {
    id: "forge",
    label: t("shell.nav.theForge"),
    sub: "build",
    short: "build",
    tab: "Forge",
    href: "/forge",
    blurb: t("shell.nav.buildOnTheSameEngineAnd"),
    sections: [
      { id: "forge", href: "/forge", label: t("shell.nav.theForge"), sub: t("shell.nav.developerPortal"), also: ["build", "developers", "mint"] },
      { id: "league", href: "/league", label: t("shell.nav.theLeague"), sub: t("shell.nav.lykiaSCities"), also: ["city"] },
      { id: "ecosystem", href: "/ecosystem", label: t("shell.nav.harbour"), sub: "ecosystem" },
      { id: "circle", href: "/app/circle", label: "Circle", sub: "rails" },
      { id: "stats", href: "/stats", label: t("shell.nav.ledger"), sub: "stats" },
    ],
  },
];

/** "The Forge · build": the metaphor and its plain meaning, as page titles and menus show them. */
export function titleOf(item: { readonly label: string; readonly sub: string }): string {
  return item.label.toLowerCase() === item.sub.toLowerCase() ? item.label : `${item.label} · ${item.sub}`;
}

/** The account page: Your Lyko (preferences, voice and look, memory), in the avatar menu. */
export const ACCOUNT: readonly NavSection[] = [{ id: "you", href: "/app/you", label: t("shell.nav.yourLyko"), sub: t("shell.nav.preferencesAndMemory") }];

/** Secondary pages: real and working, but not part of the core story. */
export const MORE: readonly NavLink[] = [
  { id: "legal", href: "/legal/notice", label: t("shell.nav.noticeAndRisks"), blurb: t("shell.nav.softwareNoticeRiskDisclosureAndPrivacy") },
];

/** The team console: in the avatar menu for admins only (the API checks the role on every call). */
export const ADMIN: readonly NavLink[] = [{ id: "letoon", href: "/letoon", label: "Letoon", blurb: t("shell.nav.theTeamConsoleLeagueCouncilContracts") }];

/**
 * Old addresses of pages whose work the agent or the Fold now does. They
 * redirect (with the details they carried) and keep working as links; a
 * `?draft=` or `?edit=` link opens Ask Lyko with what it carried.
 */
export const REDIRECTED: readonly RouteId[] = ["move", "flock", "orders", "alerts", "automations", "activity", "whatif", "fence", "pack", "security", "pastures", "discover", "markets", "memory"];

/** Routes deliberately outside every menu. `owner` is an alias of Letoon; `chatKit` and `reviewKit` are the development-only galleries. */
export const UNLISTED: readonly RouteId[] = ["landing", "pay", "kit", "chatKit", "reviewKit", "lykaion", "owner", "appNotFound", "notFound"];

/** The primary area a route belongs to, or null for account, secondary and unlisted pages. */
export function areaOf(routeId: RouteId): NavArea | null {
  return AREAS.find((a) => a.sections.some((s) => s.id === routeId || s.also?.includes(routeId))) ?? null;
}

/** The tab row for a route: its area's sections. Null when there is nothing to switch between. */
export function tabsFor(routeId: RouteId): readonly NavSection[] | null {
  const area = areaOf(routeId);
  return area && area.sections.length > 1 ? area.sections : null;
}

export function sectionIsCurrent(section: NavSection, routeId: RouteId): boolean {
  return section.id === routeId || Boolean(section.also?.includes(routeId));
}

/** What the tile says out loud and on hover; the visible text is the label alone. */
export function navTileText(area: Pick<NavArea, "label" | "sub" | "tab">, badge = 0): { readonly visible: string; readonly visibleShort: string; readonly ariaLabel: string; readonly title: string } {
  const news = badge > 0 ? t("shell.nav.newFromLyko", { badge }) : "";
  return { visible: area.label, visibleShort: area.tab, ariaLabel: `${area.label}, ${area.sub}${news}`, title: `${area.label} · ${area.sub}` };
}
