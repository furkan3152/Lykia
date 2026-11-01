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
  | "developers"
  | "lykaion"
  | "deck"
  | "flock"
  | "fence"
  | "kunye"
  | "scent"
  | "outrun"
  | "toFlock"
  | "toFence"
  | "toKunye"
  | "toScent"
  | "toOutrun"
  | "appNotFound"
  | "notFound";

export type RouteKind = "site" | "app";

type PageModule = { default: ComponentType };

export interface RouteDefinition {
  readonly id: RouteId;
  /** Pattern (see matchPath.ts); also the canonical path for routes without parameters. */
  readonly pattern: string;
  readonly kind: RouteKind;
  /** Page title without the brand suffix. */
  readonly title: string;
  readonly description: string;
  readonly robots?: string;
  /** Only served by the dev server. */
  readonly devOnly?: boolean;
  readonly load: () => Promise<PageModule>;
}

const BRAND_TITLE = "Lykia — Lyko keeps your agents inside the Fence";
const BRAND_DESCRIPTION =
  "Lykia is the agent and stablecoin desk built on Arc Network: say an outcome, get a plan across Arc venues, checked by your Fence, signed in your own wallet and final in under a second. Lyko, the shepherd dog, keeps the wolves out.";
const PRIVATE_ROBOTS = "noindex,nofollow";

export const ROUTES: Readonly<Record<RouteId, RouteDefinition>> = Object.freeze({
  landing: {
    id: "landing",
    pattern: "/",
    kind: "site",
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
    load: () => import("../../pages/landing/LandingPage"),
  },
  developers: {
    id: "developers",
    pattern: "/developers",
    kind: "site",
    title: "Developers",
    description: "The Lykia API, MCP server and x402 pay-per-call surface: plan, fence, sniff and track on Arc.",
    load: () => import("../../pages/developers/DevelopersPage"),
  },
  lykaion: {
    id: "lykaion",
    pattern: "/lykaion",
    kind: "site",
    title: "Lykaion",
    description: "Mount Lykaion, Arcadia, at night.",
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/lykaion/LykaionPage"),
  },
  deck: {
    id: "deck",
    pattern: "/app",
    kind: "app",
    title: "Deck",
    description: "One sentence becomes an Outrun across Arc venues, checked by your Fence and signed in your wallet.",
    load: () => import("../../pages/deck/DeckPage"),
  },
  flock: {
    id: "flock",
    pattern: "/app/flock/:address?",
    kind: "app",
    title: "Flock",
    description: "Everything you hold on Arc in one balance sheet: wallet, Gateway unified balance and venues.",
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/flock/FlockPage"),
  },
  fence: {
    id: "fence",
    pattern: "/app/fence",
    kind: "app",
    title: "Fence",
    description: "The rules around your agents: caps, recipients, venues, tokens, slippage, health factor, FX band, Scent and the Whistle.",
    load: () => import("../../pages/fence/FencePage"),
  },
  kunye: {
    id: "kunye",
    pattern: "/app/kunye/:agentId?",
    kind: "app",
    title: "Künye",
    description: "Agent licences on Arc: an ERC-8004 identity that pins the Fence it obeys.",
    load: () => import("../../pages/kunye/KunyePage"),
  },
  scent: {
    id: "scent",
    pattern: "/app/scent/:token?",
    kind: "app",
    title: "Scent",
    description: "What can be proven about a token on Arc before anyone touches it. Never \"safe\".",
    load: () => import("../../pages/scent/ScentPage"),
  },
  outrun: {
    id: "outrun",
    pattern: "/app/outrun/:id",
    kind: "app",
    title: "Outrun",
    description: "Where the money is, step by step, from start to the Fold.",
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/outrun/OutrunPage"),
  },
  toFlock: {
    id: "toFlock",
    pattern: "/flock/*",
    kind: "site",
    title: "Lykia",
    description: BRAND_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/shortcut/ShortcutPage"),
  },
  toFence: {
    id: "toFence",
    pattern: "/fence/*",
    kind: "site",
    title: "Lykia",
    description: BRAND_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/shortcut/ShortcutPage"),
  },
  toKunye: {
    id: "toKunye",
    pattern: "/kunye/*",
    kind: "site",
    title: "Lykia",
    description: BRAND_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/shortcut/ShortcutPage"),
  },
  toScent: {
    id: "toScent",
    pattern: "/scent/*",
    kind: "site",
    title: "Lykia",
    description: BRAND_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/shortcut/ShortcutPage"),
  },
  toOutrun: {
    id: "toOutrun",
    pattern: "/outrun/*",
    kind: "site",
    title: "Lykia",
    description: BRAND_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    load: () => import("../../pages/shortcut/ShortcutPage"),
  },
  appNotFound: {
    id: "appNotFound",
    pattern: "/app/*",
    kind: "app",
    title: "Page not found",
    description: BRAND_DESCRIPTION,
    robots: "noindex,follow",
    load: () => import("../../pages/notFound/NotFoundPage"),
  },
  notFound: {
    id: "notFound",
    pattern: "/*",
    kind: "site",
    title: "Page not found",
    description: BRAND_DESCRIPTION,
    robots: "noindex,follow",
    load: () => import("../../pages/notFound/NotFoundPage"),
  },
});

/** Matching order: specific routes first, the catch-alls last. */
const ORDER: readonly RouteId[] = ["landing", "developers", "lykaion", "deck", "flock", "fence", "kunye", "scent", "outrun", "toFlock", "toFence", "toKunye", "toScent", "toOutrun", "appNotFound", "notFound"];

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
  const path = normalizePathname(pathname);
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
