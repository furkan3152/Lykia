/**
 * The route table. Every page is a lazy chunk; `load` is shared by
 * the router and hover/focus prefetching, so a chunk is never fetched twice.
 *
 * Kinds:
 * - `site`: marketing and public pages in the site layout. They never pull the
 *   wallet stack (wagmi, viem); keep it that way.
 * - `app`: the deck under /app, rendered inside the app shell, which loads the
 *   wallet providers lazily.
 *
 * This file imports nothing at run time, so node tests load it directly; its
 * page imports are lazy and never run there.
 */
import type { ComponentType } from "react";

import { buildPath, compilePattern, matchPattern, normalizePathname, type CompiledPattern, type RouteParams } from "./matchPath";
import { t } from "../../i18n";

export type RouteId =
  | "landing"
  | "ask"
  | "fold"
  | "move"
  | "flock"
  | "pastures"
  | "pack"
  | "fence"
  | "scent"
  | "tag"
  | "outrun"
  | "build"
  | "forge"
  | "mint"
  | "league"
  | "city"
  | "letoon"
  | "ecosystem"
  | "you"
  | "memory"
  | "circle"
  | "owner"
  | "kit"
  | "chatKit"
  | "reviewKit"
  | "lykaion"
  | "developers"
  | "orders"
  | "markets"
  | "discover"
  | "alerts"
  | "automations"
  | "activity"
  | "whatif"
  | "security"
  | "pay"
  | "stats"
  | "legal"
  | "appNotFound"
  | "notFound";

/** `site` pages never load the wallet stack; `app` pages render inside the wallet providers. */
export type RouteKind = "site" | "app";

type PageModule = { default: ComponentType };

export interface RouteDefinition {
  readonly id: RouteId;
  readonly pattern: string;
  readonly kind: RouteKind;
  readonly title: string;
  readonly description: string;
  readonly robots?: string;
  readonly devOnly?: boolean;
  readonly load: () => Promise<PageModule>;
}

const BRAND_TITLE = t("app.routes.routeTable.lykiaThePolicyLayerForMoney");
const BRAND_DESCRIPTION =
  t("app.routes.routeTable.sayTheOutcomeLykiaCompilesIt");
const PRIVATE_ROBOTS = "noindex,nofollow";

/** Pages whose work Ask Lyko or the Fold does now: they redirect, keeping what they carried (see aliases.ts). */
const LEGACY = () => import("../../pages/redirect/LegacyPage");

const page = (id: RouteId, pattern: string, kind: RouteKind, title: string, description: string, load: () => Promise<PageModule>, extra: Partial<RouteDefinition> = {}): RouteDefinition => ({ id, pattern, kind, title, description, load, ...extra });

export const ROUTES: Readonly<Record<RouteId, RouteDefinition>> = Object.freeze({
  landing: page("landing", "/", "site", BRAND_TITLE, BRAND_DESCRIPTION, () => import("../../pages/landing/LandingPage")),
  ask: page("ask", "/app/ask/:threadId?", "app", t("app.routes.routeTable.askLykoYourAgent"), t("app.routes.routeTable.sayTheOutcomeInPlainWords"), () => import("../../pages/ask/AskPage")),
  fold: page("fold", "/app/fold/:tab?", "app", t("app.routes.routeTable.theFoldEverythingYouOwnAnd"), t("app.routes.routeTable.everythingYouHoldOnArcAnd"), () => import("../../pages/fold/FoldPage"), { robots: PRIVATE_ROBOTS }),
  move: page("move", "/app/move/:tab?", "app", t("app.routes.routeTable.moveSendAndSwap"), t("app.routes.routeTable.movingMoneyHappensInAskLyko"), LEGACY, { robots: PRIVATE_ROBOTS }),
  flock: page("flock", "/app/flock/:address?", "app", t("app.routes.routeTable.flockHoldings"), t("app.routes.routeTable.holdingsLiveInTheFoldNow"), LEGACY, { robots: PRIVATE_ROBOTS }),
  pastures: page("pastures", "/app/pastures", "app", t("app.routes.routeTable.yields"), t("app.routes.routeTable.whereStablecoinsEarnOnArcIs"), LEGACY, { robots: PRIVATE_ROBOTS }),
  pack: page("pack", "/app/pack/:id?", "app", t("app.routes.routeTable.packYourAgentsAndTheirLeashes"), t("app.routes.routeTable.yourAgentsAndTheirLeashesLive"), LEGACY, { robots: PRIVATE_ROBOTS }),
  fence: page("fence", "/app/fence", "app", t("app.routes.routeTable.fenceRules"), t("app.routes.routeTable.yourFenceLivesInTheFold"), LEGACY, { robots: PRIVATE_ROBOTS }),
  scent: page("scent", "/app/scent/:token?", "app", t("app.routes.routeTable.scentTokenCheck"), t("app.routes.routeTable.whatCanBeProvenAboutA"), () => import("../../pages/scent/ScentPage")),
  tag: page("tag", "/app/tag/:agentId?", "app", t("app.routes.routeTable.tagAgentIdentity"), t("app.routes.routeTable.agentTagsOnArcAnErc"), () => import("../../pages/tag/TagPage")),
  outrun: page("outrun", "/app/outrun/:id", "app", t("app.routes.routeTable.outrunPlan"), t("app.routes.routeTable.whereTheMoneyIsStepBy"), () => import("../../pages/outrun/OutrunPage"), { robots: PRIVATE_ROBOTS }),
  you: page("you", "/app/you", "app", t("app.routes.routeTable.yourLykoPreferencesAndMemory"), t("app.routes.routeTable.howLykoDecidesAndSpeaksFor"), () => import("../../pages/you/YourLykoPage"), { robots: PRIVATE_ROBOTS }),
  memory: page("memory", "/app/memory", "app", t("app.routes.routeTable.memory"), t("app.routes.routeTable.memoryLivesInYourLykoNow"), LEGACY, { robots: PRIVATE_ROBOTS }),
  circle: page("circle", "/app/circle", "app", t("app.routes.routeTable.circleRails"), t("app.routes.routeTable.circleSProductsOnArcGateway"), () => import("../../pages/circle/CirclePage")),
  orders: page("orders", "/app/orders", "app", t("app.routes.routeTable.orders"), t("app.routes.routeTable.ordersStartInAskLykoAnd"), LEGACY, { robots: PRIVATE_ROBOTS }),
  markets: page("markets", "/app/markets", "app", t("app.routes.routeTable.perpsMarkets"), t("app.routes.routeTable.perpsMarketsAreAnAnswerIn"), LEGACY, { robots: PRIVATE_ROBOTS }),
  discover: page("discover", "/app/discover", "app", t("app.routes.routeTable.newPools"), t("app.routes.routeTable.newPoolsOnArcAreAn"), LEGACY, { robots: PRIVATE_ROBOTS }),
  alerts: page("alerts", "/app/alerts", "app", t("app.routes.routeTable.watches"), t("app.routes.routeTable.watchesStartInAskLykoAnd"), LEGACY, { robots: PRIVATE_ROBOTS }),
  automations: page("automations", "/app/automations", "app", t("app.routes.routeTable.automations"), t("app.routes.routeTable.automationsStartInAskLykoAnd"), LEGACY, { robots: PRIVATE_ROBOTS }),
  activity: page("activity", "/app/activity", "app", t("app.routes.routeTable.trailsActivity"), t("app.routes.routeTable.everyIntentOrderAndWatchIn"), LEGACY, { robots: PRIVATE_ROBOTS }),
  whatif: page("whatif", "/app/whatif", "app", t("app.routes.routeTable.whatIfStressTest"), t("app.routes.routeTable.shockCirbtcAndEurcAndSee"), LEGACY, { robots: PRIVATE_ROBOTS }),
  pay: page("pay", "/pay/:id", "app", t("app.routes.routeTable.pay"), t("app.routes.routeTable.payAnInvoiceOrPaymentLink"), () => import("../../pages/pay/PayPage"), { robots: PRIVATE_ROBOTS }),
  security: page("security", "/app/security", "app", t("app.routes.routeTable.safety"), t("app.routes.routeTable.safetyIsASectionOfThe"), LEGACY, { robots: PRIVATE_ROBOTS }),
  build: page("build", "/build", "site", t("app.routes.routeTable.theForgeBuild"), t("app.routes.routeTable.theDeveloperPortalMovedToThe"), () => import("../../pages/redirect/RedirectPage"), { robots: PRIVATE_ROBOTS }),
  forge: page("forge", "/forge/:section?", "app", t("app.routes.routeTable.theForgeDeveloperPortal"), t("app.routes.routeTable.buildOnLykiaSEngineStrike"), () => import("../../pages/forge/ForgePage")),
  mint: page("mint", "/mint/:section?", "site", t("app.routes.routeTable.theForgeBuild"), t("app.routes.routeTable.theDeveloperPortalIsTheForge"), () => import("../../pages/redirect/RedirectPage"), { robots: PRIVATE_ROBOTS }),
  league: page("league", "/league", "site", t("app.routes.routeTable.theLeagueLykiaSCities"), t("app.routes.routeTable.theLeagueHostsCitiesProjectsBuilt"), () => import("../../pages/league/LeaguePage")),
  city: page("city", "/league/:city", "site", t("app.routes.routeTable.cityOfTheLeague"), t("app.routes.routeTable.oneCityOfTheLeagueWhat"), () => import("../../pages/league/CityPage")),
  letoon: page("letoon", "/letoon/:section?", "app", t("app.routes.routeTable.letoonTeamConsole"), t("app.routes.routeTable.theLykiaTeamSConsoleThe"), () => import("../../pages/letoon/LetoonPage"), { robots: PRIVATE_ROBOTS }),
  ecosystem: page("ecosystem", "/ecosystem", "site", t("app.routes.routeTable.harbourEcosystem"), t("app.routes.routeTable.theProtocolsOnArcEachMarked"), () => import("../../pages/ecosystem/EcosystemPage")),
  stats: page("stats", "/stats", "site", t("app.routes.routeTable.ledgerStats"), t("app.routes.routeTable.lykiaInNumbersOnChainCounts"), () => import("../../pages/stats/StatsPage")),
  legal: page("legal", "/legal/:doc?", "site", t("app.routes.routeTable.noticeRisksAndPrivacy"), t("app.routes.routeTable.lykiaSDraftSoftwareNoticeAnd"), () => import("../../pages/legal/LegalPage")),
  owner: page("owner", "/owner", "site", t("app.routes.routeTable.letoonTeamConsole"), t("app.routes.routeTable.theOwnerConsoleMovedToLetoon"), () => import("../../pages/redirect/RedirectPage"), { robots: PRIVATE_ROBOTS }),
  kit: page("kit", "/kit", "site", t("app.routes.routeTable.mosaicKit"), t("app.routes.routeTable.everyMosaicComponentAndScene"), () => import("../../pages/kit/KitPage"), { robots: PRIVATE_ROBOTS, devOnly: true }),
  chatKit: page("chatKit", "/app/kit/chat", "app", t("app.routes.routeTable.chatKitSample"), t("app.routes.routeTable.everyAskLykoCardAndThinking"), () => import("../../pages/kit/ChatKitPage"), { robots: PRIVATE_ROBOTS, devOnly: true }),
  reviewKit: page("reviewKit", "/app/kit/review", "app", t("app.routes.routeTable.reviewKitSample"), t("app.routes.routeTable.everyStateOfTheReviewAnd"), () => import("../../pages/kit/ReviewKitPage"), { robots: PRIVATE_ROBOTS, devOnly: true }),
  lykaion: page("lykaion", "/lykaion", "site", t("app.routes.routeTable.lykaion"), t("app.routes.routeTable.mountLykaionArcadiaAtNight"), () => import("../../pages/lykaion/LykaionPage"), { robots: PRIVATE_ROBOTS }),
  developers: page("developers", "/developers", "site", t("app.routes.routeTable.theForgeBuild"), BRAND_DESCRIPTION, () => import("../../pages/redirect/RedirectPage"), { robots: PRIVATE_ROBOTS }),
  appNotFound: page("appNotFound", "/app/*", "site", t("app.routes.routeTable.pageNotFound"), BRAND_DESCRIPTION, () => import("../../pages/notFound/NotFoundPage"), { robots: "noindex,follow" }),
  notFound: page("notFound", "/*", "site", t("app.routes.routeTable.pageNotFound"), BRAND_DESCRIPTION, () => import("../../pages/notFound/NotFoundPage"), { robots: "noindex,follow" }),
});

/** Matching order: specific routes first, the catch-alls last. `/app` itself is Ask. */
const ORDER: readonly RouteId[] = ["landing", "ask", "fold", "move", "flock", "pastures", "pack", "fence", "scent", "tag", "outrun", "you", "memory", "circle", "orders", "markets", "discover", "alerts", "automations", "activity", "whatif", "security", "pay", "build", "forge", "mint", "league", "city", "letoon", "ecosystem", "stats", "legal", "owner", "kit", "chatKit", "reviewKit", "lykaion", "developers", "appNotFound", "notFound"];

let compiled: ReadonlyArray<readonly [RouteDefinition, CompiledPattern]> | null = null;

function table() {
  compiled ??= ORDER.map((id) => [ROUTES[id], compilePattern(ROUTES[id].pattern)] as const);
  return compiled;
}

export interface RouteMatch {
  readonly route: RouteDefinition;
  readonly params: RouteParams;
}

export interface MatchOptions {
  /** Serve dev-only routes (the router passes import.meta.env.DEV). */
  readonly dev?: boolean;
}

export function matchRoute(pathname: string, options: MatchOptions = {}): RouteMatch {
  const normal = normalizePathname(pathname);
  const path = normal === "/app" ? "/app/ask" : normal;
  for (const [route, pattern] of table()) {
    if (route.devOnly && !options.dev) continue;
    const params = matchPattern(pattern, path);
    if (params) return { route, params };
  }
  return { route: ROUTES.notFound, params: {} };
}

/** Typed link builder: `routeHref("scent", { token: "0x…" })` -> "/app/scent/0x…". */
export function routeHref(id: RouteId, params: Readonly<Record<string, string | number | undefined>> = {}): string {
  return buildPath(ROUTES[id].pattern, params);
}

/** "Fence · rules · Lykia"; the landing keeps the full brand title. */
export function documentTitle(route: RouteDefinition): string {
  return route.id === "landing" ? route.title : `${route.title} · Lykia`;
}

export function robotsFor(route: RouteDefinition): string {
  return route.robots ?? "index,follow";
}
