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

const BRAND_TITLE = "Lykia — the policy layer for money that agents and apps move";
const BRAND_DESCRIPTION =
  "Say the outcome; Lykia compiles it into a route across Arc protocols and Circle rails, the Fence checks every step against your rules, and you or your agent sign it. The same engine is an API for every builder. Built on Arc Network, powered by Circle.";
const PRIVATE_ROBOTS = "noindex,nofollow";

const page = (id: RouteId, pattern: string, kind: RouteKind, title: string, description: string, load: () => Promise<PageModule>, extra: Partial<RouteDefinition> = {}): RouteDefinition => ({ id, pattern, kind, title, description, load, ...extra });

export const ROUTES: Readonly<Record<RouteId, RouteDefinition>> = Object.freeze({
  landing: page("landing", "/", "site", BRAND_TITLE, BRAND_DESCRIPTION, () => import("../../pages/landing/LandingPage")),
  ask: page("ask", "/app/ask/:threadId?", "app", "Ask Lyko · assistant", "Say the outcome in plain words: Lykia plans it across Arc protocols and Circle rails, the Fence checks every step, you sign once.", () => import("../../pages/ask/AskPage")),
  move: page("move", "/app/move/:tab?", "app", "Move · send and swap", "Send, receive, swap, earn, borrow and bridge: the best route, checked by your Fence and simulated before you sign.", () => import("../../pages/move/MovePage"), { robots: PRIVATE_ROBOTS }),
  flock: page("flock", "/app/flock/:address?", "app", "Flock · portfolio", "Everything you hold on Arc mainnet and testnet in one view: wallet, Circle Gateway balance and protocol positions.", () => import("../../pages/flock/FlockPage"), { robots: PRIVATE_ROBOTS }),
  pastures: page("pastures", "/app/pastures", "app", "Pastures · yields", "Live USDC and EURC rates on Arc lending and vault protocols, with risk tier and source.", () => import("../../pages/pastures/PasturesPage")),
  pack: page("pack", "/app/pack/:id?", "app", "Pack · agents", "Your agents and sub-agents: each with a Fence that stays inside yours and a budget carved from yours, optionally bound on chain.", () => import("../../pages/pack/PackPage")),
  fence: page("fence", "/app/fence", "app", "Fence · rules", "Your rules for money: caps, recipients, protocols, tokens, slippage, health factor, FX band and an emergency stop. Every plan is checked against it.", () => import("../../pages/fence/FencePage")),
  scent: page("scent", "/app/scent/:token?", "app", "Scent · token check", "What can be proven about a token on Arc before anyone touches it. Never \"safe\".", () => import("../../pages/scent/ScentPage")),
  tag: page("tag", "/app/tag/:agentId?", "app", "Tag · agent identity", "Agent Tags on Arc: an ERC-8004 identity that pins the Fence it obeys.", () => import("../../pages/tag/TagPage")),
  outrun: page("outrun", "/app/outrun/:id", "app", "Outrun · plan", "Where the money is, step by step, from the first call to where it ends up.", () => import("../../pages/outrun/OutrunPage"), { robots: PRIVATE_ROBOTS }),
  you: page("you", "/app/you", "app", "Settings", "Currency, risk, protocols, the assistant's voice and look, quiet hours and notifications.", () => import("../../pages/you/YouPage"), { robots: PRIVATE_ROBOTS }),
  memory: page("memory", "/app/memory", "app", "Memory", "Intent history, learned preferences, named contacts and recurring patterns, all editable and forgettable.", () => import("../../pages/memory/MemoryPage"), { robots: PRIVATE_ROBOTS }),
  circle: page("circle", "/app/circle", "app", "Circle · rails", "Circle's products on Arc: Gateway unified balance, CCTP, StableFX, agent wallets, compliance, nanopayments and USYC.", () => import("../../pages/circle/CirclePage")),
  orders: page("orders", "/app/orders", "app", "Orders · limit, stop, DCA", "Conditional orders on Arc: limit, stop-loss, take-profit, DCA and TWAP, signed once and executed by keepers.", () => import("../../pages/orders/OrdersPage")),
  markets: page("markets", "/app/markets", "app", "Perps markets", "Live perpetuals data from Extended, whose collateral sits on Arc: price, funding, open interest, candles and the book.", () => import("../../pages/markets/MarketsPage")),
  discover: page("discover", "/app/discover", "app", "New pools", "New pools on Arc's exchanges with each token's check result, and the launchpads building on Arc.", () => import("../../pages/discover/DiscoverPage")),
  alerts: page("alerts", "/app/alerts", "app", "Barks · alerts", "Price, health factor, transfer, token-check and fill alerts, delivered to the inbox, webhooks and Telegram.", () => import("../../pages/alerts/AlertsPage"), { robots: PRIVATE_ROBOTS }),
  automations: page("automations", "/app/automations", "app", "Rounds · automations", "Schedules, price feeds, balances and payout events that re-plan a sentence under your Fence or notify your webhooks.", () => import("../../pages/automations/AutomationsPage"), { robots: PRIVATE_ROBOTS }),
  activity: page("activity", "/app/activity", "app", "Tracks · activity", "Every intent, order and alert in one trail.", () => import("../../pages/activity/ActivityPage"), { robots: PRIVATE_ROBOTS }),
  whatif: page("whatif", "/app/whatif", "app", "What-if · stress test", "Shock cirBTC and EURC and see your portfolio's value and health factors move, with the PnL explained.", () => import("../../pages/whatif/WhatIfPage"), { robots: PRIVATE_ROBOTS }),
  pay: page("pay", "/pay/:id", "app", "Pay", "Pay an invoice or payment link on Arc: the amount, the line items and Lykia's fee shown before your wallet signs.", () => import("../../pages/pay/PayPage"), { robots: PRIVATE_ROBOTS }),
  security: page("security", "/app/security", "app", "Watch · security", "Six checks between a plan and your wallet: pre-sign simulation, address protection, approval hygiene, agent monitors, circuit breakers and the audit log.", () => import("../../pages/security/SecurityPage"), { robots: PRIVATE_ROBOTS }),
  build: page("build", "/build", "site", "The Mint · build", "The developer portal moved to The Mint.", () => import("../../pages/redirect/RedirectPage"), { robots: PRIVATE_ROBOTS }),
  mint: page("mint", "/mint/:section?", "app", "The Mint · developer portal", "Build on Lykia's engine: strike a project (a city) in steps, try it in the workshop, manage keys, usage, logs and webhooks, and read the API reference, SDKs and MCP.", () => import("../../pages/mint/MintPage")),
  league: page("league", "/league", "site", "The League · Lykia's cities", "Lykia's products as the cities of a league: Lykia Pay, Lykia Agents and what comes next, each a real project with its own brand, modules and Fence caps, live on Arc.", () => import("../../pages/league/LeaguePage")),
  city: page("city", "/league/:city", "site", "City of the League", "One city of the League: what it does, how it uses Lykia, whether it is live, and the city itself, running on Lykia.", () => import("../../pages/league/CityPage")),
  letoon: page("letoon", "/letoon/:section?", "app", "Letoon · team console", "The Lykia team's console: the League council, contracts and deployments, flags and the Whistle, Circle setup, the audit log and platform usage. Admins only.", () => import("../../pages/letoon/LetoonPage"), { robots: PRIVATE_ROBOTS }),
  ecosystem: page("ecosystem", "/ecosystem", "site", "Harbour · ecosystem", "Every Arc protocol routable on Lykia, linked to its official Arc ecosystem entry, with Circle's products, TVL and the value Lykia routes, live.", () => import("../../pages/ecosystem/EcosystemPage")),
  stats: page("stats", "/stats", "site", "Ledger · stats", "Lykia in numbers: on-chain counts on Arc mainnet, value routed, protocols routable and integrators. Public, aggregate, sourced.", () => import("../../pages/stats/StatsPage")),
  legal: page("legal", "/legal/:doc?", "site", "Notice, risks and privacy", "Lykia's draft software notice and risk disclosure (open source, non-custodial, no warranty, beta caps) and privacy note.", () => import("../../pages/legal/LegalPage")),
  owner: page("owner", "/owner", "site", "Letoon · team console", "The owner console moved to Letoon.", () => import("../../pages/redirect/RedirectPage"), { robots: PRIVATE_ROBOTS }),
  kit: page("kit", "/kit", "site", "Mosaic kit", "Every Mosaic component and scene.", () => import("../../pages/kit/KitPage"), { robots: PRIVATE_ROBOTS }),
  lykaion: page("lykaion", "/lykaion", "site", "Lykaion", "Mount Lykaion, Arcadia, at night.", () => import("../../pages/lykaion/LykaionPage"), { robots: PRIVATE_ROBOTS }),
  developers: page("developers", "/developers", "site", "The Mint · build", BRAND_DESCRIPTION, () => import("../../pages/redirect/RedirectPage"), { robots: PRIVATE_ROBOTS }),
  appNotFound: page("appNotFound", "/app/*", "site", "Page not found", BRAND_DESCRIPTION, () => import("../../pages/notFound/NotFoundPage"), { robots: "noindex,follow" }),
  notFound: page("notFound", "/*", "site", "Page not found", BRAND_DESCRIPTION, () => import("../../pages/notFound/NotFoundPage"), { robots: "noindex,follow" }),
});

/** Matching order: specific routes first, the catch-alls last. `/app` itself is Ask. */
const ORDER: readonly RouteId[] = ["landing", "ask", "move", "flock", "pastures", "pack", "fence", "scent", "tag", "outrun", "you", "memory", "circle", "orders", "markets", "discover", "alerts", "automations", "activity", "whatif", "security", "pay", "build", "mint", "league", "city", "letoon", "ecosystem", "stats", "legal", "owner", "kit", "lykaion", "developers", "appNotFound", "notFound"];

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
