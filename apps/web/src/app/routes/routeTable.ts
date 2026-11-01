/**
 * The route table. Every page is a lazy chunk; `load` is shared by
 * the router and hover/focus prefetching, so a chunk is never fetched twice.
 *
 * Kinds:
 * - `site`: marketing and public pages in the site layout. They never pull the
 *   wallet stack (wagmi, RainbowKit, viem); keep it that way.
 * - `app`: the deck under /app, rendered inside the app shell, which loads the
 *   wallet providers lazily.
 *
 * This file imports nothing at run time, so node tests load it directly; its
 * page imports are lazy and never run there.
 */
import type { ComponentType } from "react";

import { buildPath, compilePattern, matchPattern, normalizePathname, type CompiledPattern, type RouteParams } from "./matchPath";

export type RouteId =
  | "landing"
  | "ask"
  | "move"
  | "flock"
  | "pastures"
  | "pack"
  | "fence"
  | "scent"
  | "tag"
  | "outrun"
  | "build"
  | "ecosystem"
  | "you"
  | "memory"
  | "circle"
  | "owner"
  | "kit"
  | "lykaion"
  | "developers"
  | "orders"
  | "markets"
  | "discover"
  | "alerts"
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

const BRAND_TITLE = "Lykia — Arc gives agents money. Lyko keeps them in line.";
const BRAND_DESCRIPTION =
  "Lykia is the agent and stablecoin desk built on Arc Network: ask once, get a plan across Arc venues checked by your Fence, signed in your own wallet and final in under a second. Lyko, the shepherd dog, keeps the wolves out.";
const PRIVATE_ROBOTS = "noindex,nofollow";

const page = (id: RouteId, pattern: string, kind: RouteKind, title: string, description: string, load: () => Promise<PageModule>, extra: Partial<RouteDefinition> = {}): RouteDefinition => ({ id, pattern, kind, title, description, load, ...extra });

export const ROUTES: Readonly<Record<RouteId, RouteDefinition>> = Object.freeze({
  landing: page("landing", "/", "site", BRAND_TITLE, BRAND_DESCRIPTION, () => import("../../pages/landing/LandingPage")),
  ask: page("ask", "/app/ask/:threadId?", "app", "Ask Lyko", "Ask once in plain words: Lyko and the Pack plan it across Arc, the Fence checks it, you sign once.", () => import("../../pages/ask/AskPage")),
  move: page("move", "/app/move/:tab?", "app", "Move", "Send, receive, swap, earn, borrow and bridge: the best route, checked by your Fence and simulated before you sign.", () => import("../../pages/move/MovePage"), { robots: PRIVATE_ROBOTS }),
  flock: page("flock", "/app/flock/:address?", "app", "Flock", "Everything you hold on Arc mainnet and testnet in one pasture: wallet, Gateway and venues.", () => import("../../pages/flock/FlockPage"), { robots: PRIVATE_ROBOTS }),
  pastures: page("pastures", "/app/pastures", "app", "Greener pastures", "Live yields on Arc venues, grass height by rate, with risk tier and source.", () => import("../../pages/pastures/PasturesPage")),
  pack: page("pack", "/app/pack/:id?", "app", "Pack", "Your agents and their pups: spawn sub-agents whose Fence stays inside yours, carve budgets, bind sessions on chain.", () => import("../../pages/pack/PackPage")),
  fence: page("fence", "/app/fence", "app", "Fence", "The rules around your agents: caps, recipients, venues, tokens, slippage, health factor, FX band, Scent and the Whistle.", () => import("../../pages/fence/FencePage")),
  scent: page("scent", "/app/scent/:token?", "app", "Scent", "What can be proven about a token on Arc before anyone touches it. Never \"safe\".", () => import("../../pages/scent/ScentPage")),
  tag: page("tag", "/app/tag/:agentId?", "app", "Tag", "Agent Tags on Arc: an ERC-8004 identity that pins the Fence it obeys.", () => import("../../pages/tag/TagPage")),
  outrun: page("outrun", "/app/outrun/:id", "app", "Outrun", "Where the money is, step by step, from start to the Fold.", () => import("../../pages/outrun/OutrunPage"), { robots: PRIVATE_ROBOTS }),
  you: page("you", "/app/you", "app", "You", "Your Lykia: language, currency, risk, venues, Lyko's persona and look, quiet hours and notifications.", () => import("../../pages/you/YouPage"), { robots: PRIVATE_ROBOTS }),
  memory: page("memory", "/app/memory", "app", "Lyko remembers", "Intent history, learned preferences, named contacts and recurring patterns, all editable and forgettable.", () => import("../../pages/memory/MemoryPage"), { robots: PRIVATE_ROBOTS }),
  circle: page("circle", "/app/circle", "app", "Circle", "Circle's products on Arc: Gateway unified balance, CCTP, StableFX, agent wallets, compliance, nanopayments and USYC.", () => import("../../pages/circle/CirclePage")),
  orders: page("orders", "/app/orders", "app", "Orders", "Conditional orders on Arc: limit, stop-loss, take-profit, DCA and TWAP, signed once and executed by keepers.", () => import("../../pages/orders/OrdersPage")),
  markets: page("markets", "/app/markets", "app", "Perps markets", "Live perpetuals data from Extended, whose collateral sits on Arc: price, funding, open interest, candles and the book.", () => import("../../pages/markets/MarketsPage")),
  discover: page("discover", "/app/discover", "app", "Launch radar", "New pools on Arc's AMMs with each token's trust verdict, and the launchpads building on Arc.", () => import("../../pages/discover/DiscoverPage")),
  alerts: page("alerts", "/app/alerts", "app", "Alerts", "Price, health factor, transfer, Scent and fill alerts, delivered to the inbox, webhooks and Telegram.", () => import("../../pages/alerts/AlertsPage"), { robots: PRIVATE_ROBOTS }),
  activity: page("activity", "/app/activity", "app", "Activity", "Every intent, order and alert in one trail.", () => import("../../pages/activity/ActivityPage"), { robots: PRIVATE_ROBOTS }),
  whatif: page("whatif", "/app/whatif", "app", "What-if", "Shock cirBTC and EURC and see your flock's value and health factors move, with the PnL explained.", () => import("../../pages/whatif/WhatIfPage"), { robots: PRIVATE_ROBOTS }),
  pay: page("pay", "/pay/:id", "app", "Pay", "Pay an invoice or payment link on Arc: the amount, the line items and Lykia's fee shown before your wallet signs.", () => import("../../pages/pay/PayPage"), { robots: PRIVATE_ROBOTS }),
  security: page("security", "/app/security", "app", "Security", "Six layers between the flock and the wolves: pre-sign simulation, address protection, approval hygiene, agent monitors, circuit breakers and the audit log.", () => import("../../pages/security/SecurityPage"), { robots: PRIVATE_ROBOTS }),
  build: page("build", "/build", "app", "Build", "Keys, usage, webhooks, your fee, the playground, MCP, the SDK and the integration program for Arc protocols.", () => import("../../pages/build/BuildPage")),
  ecosystem: page("ecosystem", "/ecosystem", "site", "Ecosystem", "Every Arc protocol routable on Lykia, linked to its official Arc ecosystem entry, with Circle's products, TVL and the value Lykia routes, live.", () => import("../../pages/ecosystem/EcosystemPage")),
  stats: page("stats", "/stats", "site", "Stats", "Lykia in numbers: on-chain counts on Arc mainnet, value routed, protocols routable and integrators. Public, aggregate, sourced.", () => import("../../pages/stats/StatsPage")),
  legal: page("legal", "/legal/:doc?", "site", "Notice, risks and privacy", "Lykia's draft software notice and risk disclosure (open source, non-custodial, no warranty, beta caps) and privacy note.", () => import("../../pages/legal/LegalPage")),
  owner: page("owner", "/owner", "app", "Owner console", "Deploy Lykia's contracts step by step with your wallet, record them and manage flags.", () => import("../../pages/owner/OwnerPage"), { robots: PRIVATE_ROBOTS }),
  kit: page("kit", "/kit", "site", "Mosaic kit", "Every Mosaic component and scene.", () => import("../../pages/kit/KitPage"), { robots: PRIVATE_ROBOTS }),
  lykaion: page("lykaion", "/lykaion", "site", "Lykaion", "Mount Lykaion, Arcadia, at night.", () => import("../../pages/lykaion/LykaionPage"), { robots: PRIVATE_ROBOTS }),
  developers: page("developers", "/developers", "site", "Build", BRAND_DESCRIPTION, () => import("../../pages/redirect/RedirectPage"), { robots: PRIVATE_ROBOTS }),
  appNotFound: page("appNotFound", "/app/*", "site", "Page not found", BRAND_DESCRIPTION, () => import("../../pages/notFound/NotFoundPage"), { robots: "noindex,follow" }),
  notFound: page("notFound", "/*", "site", "Page not found", BRAND_DESCRIPTION, () => import("../../pages/notFound/NotFoundPage"), { robots: "noindex,follow" }),
});

/** Matching order: specific routes first, the catch-alls last. `/app` itself is Ask Lyko. */
const ORDER: readonly RouteId[] = ["landing", "ask", "move", "flock", "pastures", "pack", "fence", "scent", "tag", "outrun", "you", "memory", "circle", "orders", "markets", "discover", "alerts", "activity", "whatif", "security", "pay", "build", "ecosystem", "stats", "legal", "owner", "kit", "lykaion", "developers", "appNotFound", "notFound"];

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

/** "Fence · Lykia"; the landing keeps the full brand title. */
export function documentTitle(route: RouteDefinition): string {
  return route.id === "landing" ? route.title : `${route.title} · Lykia`;
}

export function robotsFor(route: RouteDefinition): string {
  return route.robots ?? "index,follow";
}
