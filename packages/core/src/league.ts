/**
 * The League (`lykia.league/v1`): Lykia's sub-products, shown as the cities
 * of a federation. The historical Lycian League was a union of cities that
 * minted a shared coinage; here every city is a real white-label Project
 * (see project.ts) built in The Forge, listed in the League and struck as a
 * coin.
 *
 * - "official" cities are created and listed by the Lykia team (admin only).
 * - "community" cities are developer projects whose owner asked for a
 *   listing; an admin approves, features, pauses or delists them.
 *
 * Pure: validation, slugs, the public view and the admin transitions. Storage,
 * usage counters and the seed live in the API.
 */
import { CITY_SLUG, isCitySlug, type Project, type ProjectPublicView } from "./project.js";

export const LEAGUE_SCHEMA = "lykia.league/v1" as const;

/** Who stands behind the city. */
export type LeagueStatus = "official" | "community";
/** Whether the city runs: live, announced but not running yet, or paused by the council. */
export type LeagueState = "live" | "coming" | "paused";
/** Where a listing request stands. Official cities are always "approved". */
export type LeagueReview = "requested" | "approved" | "rejected" | "delisted";

/** The emblem struck on the city's coin. Drawn in tesserae by the web app. */
export type LeagueEmblem = "lighthouse" | "temple" | "prow" | "lyre" | "triskeles" | "flame";
export const LEAGUE_EMBLEMS: readonly LeagueEmblem[] = Object.freeze(["lighthouse", "temple", "prow", "lyre", "triskeles", "flame"]);

export type LeagueCategory = "payments" | "agents" | "trading" | "treasury" | "commerce" | "tools";
export const LEAGUE_CATEGORIES: readonly LeagueCategory[] = Object.freeze(["payments", "agents", "trading", "treasury", "commerce", "tools"]);

/** A product page inside Lykia that the city relies on (Pay uses the hosted invoice page, for example). */
export interface LeaguePage {
  readonly label: string;
  /** A path on Lykia's site or the API, starting with "/". */
  readonly href: string;
}

export interface ProjectLeague {
  readonly schema: typeof LEAGUE_SCHEMA;
  readonly status: LeagueStatus;
  /** Shown on /league and in GET /v1/league. */
  readonly listed: boolean;
  readonly state: LeagueState;
  readonly review: LeagueReview;
  readonly featured: boolean;
  /** The URL name: /league/:slug. */
  readonly slug: string;
  readonly emblem: LeagueEmblem;
  readonly tagline: string;
  readonly category: LeagueCategory;
  /** A Lycian city name struck small on the coin, never in place of the product name. */
  readonly codename?: string;
  /** Why the codename fits, one line. */
  readonly codenameNote?: string;
  /** An honest note shown on the city page (how it works, what it does not do). */
  readonly note?: string;
  /** What the city does, in a few short lines. */
  readonly does?: readonly string[];
  readonly pages?: readonly LeaguePage[];
  readonly requestedAt?: string;
  readonly reviewedAt?: string;
  readonly reviewedBy?: string;
  /** Set when the seed created the city, so a later seed recognises it. */
  readonly seedKey?: string;
}

/** What a developer sends to ask for a community listing. */
export interface LeagueRequestInput {
  readonly tagline: string;
  readonly category: LeagueCategory;
  readonly emblem?: LeagueEmblem;
  readonly slug?: string;
  readonly codename?: string;
}

export type LeagueAction = "approve" | "reject" | "feature" | "unfeature" | "delist" | "relist" | "pause" | "resume" | "launch";
export const LEAGUE_ACTIONS: readonly LeagueAction[] = Object.freeze(["approve", "reject", "feature", "unfeature", "delist", "relist", "pause", "resume", "launch"]);

export const LEAGUE_LIMITS = Object.freeze({ tagline: 90, slug: 24, codename: 24, note: 400 });

const CODENAME = /^[A-Z][A-Za-z -]{1,23}$/u;

/** A URL name from a project name: "Acme Pay" becomes "acme-pay". */
export function leagueSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, LEAGUE_LIMITS.slug)
    .replace(/-+$/u, "");
  const prefixed = (/^[a-z]/u.test(base) ? base : `city-${base}`).slice(0, LEAGUE_LIMITS.slug).replace(/-+$/u, "");
  const slug = prefixed.length >= 3 ? prefixed : `${prefixed || "city"}-app`.replace(/^-/u, "");
  return isCitySlug(slug) ? slug : `${slug.slice(0, 19)}-city`;
}

export interface LeagueIssue {
  readonly path: string;
  readonly message: string;
}

function plain(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f<>]/u.test(value);
}

/** Checks a listing request; returns every problem with its path. */
export function validateLeagueRequest(input: LeagueRequestInput): LeagueIssue[] {
  const issues: LeagueIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (typeof input.tagline !== "string" || input.tagline.trim().length < 8 || input.tagline.length > LEAGUE_LIMITS.tagline || !plain(input.tagline)) add("tagline", `One plain line of 8 to ${LEAGUE_LIMITS.tagline} characters.`);
  if (!LEAGUE_CATEGORIES.includes(input.category)) add("category", `One of ${LEAGUE_CATEGORIES.join(", ")}.`);
  if (input.emblem !== undefined && !LEAGUE_EMBLEMS.includes(input.emblem)) add("emblem", `One of ${LEAGUE_EMBLEMS.join(", ")}.`);
  if (input.slug !== undefined && !isCitySlug(input.slug)) add("slug", "3 to 24 lowercase letters, digits and dashes, starting with a letter (not a reserved word).");
  if (input.codename !== undefined && !CODENAME.test(input.codename)) add("codename", `A place name of 2 to ${LEAGUE_LIMITS.codename} letters, starting with a capital.`);
  return issues;
}

export function isReservedSlug(slug: string): boolean {
  return !isCitySlug(slug) && CITY_SLUG.test(slug);
}

/** A community listing request, ready for review. A previous rejection or delisting may ask again. */
export function requestListing(project: Pick<Project, "name" | "league" | "slug">, input: LeagueRequestInput, now: string): ProjectLeague {
  return {
    schema: LEAGUE_SCHEMA,
    status: "community",
    listed: false,
    state: project.league?.state === "paused" ? "paused" : "live",
    review: "requested",
    featured: false,
    slug: input.slug ?? project.slug ?? project.league?.slug ?? leagueSlug(project.name),
    emblem: input.emblem ?? "triskeles",
    tagline: input.tagline.trim(),
    category: input.category,
    ...(input.codename ? { codename: input.codename } : {}),
    requestedAt: now,
  };
}

export class LeagueTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeagueTransitionError";
  }
}

/**
 * The council's decisions. Each returns the next listing or throws a
 * LeagueTransitionError that explains why the action does not apply.
 */
export function applyLeagueAction(league: ProjectLeague, action: LeagueAction, by: string, now: string): ProjectLeague {
  const stamp = { reviewedAt: now, reviewedBy: by.toLowerCase() };
  switch (action) {
    case "approve":
      if (league.review !== "requested" && league.review !== "rejected") throw new LeagueTransitionError("Only a requested or rejected listing can be approved.");
      return { ...league, review: "approved", listed: true, ...stamp };
    case "reject":
      if (league.status === "official") throw new LeagueTransitionError("Official cities are not reviewed; delist or pause them instead.");
      if (league.review !== "requested") throw new LeagueTransitionError("Only a requested listing can be rejected.");
      return { ...league, review: "rejected", listed: false, featured: false, ...stamp };
    case "feature":
      if (!league.listed) throw new LeagueTransitionError("List the city before featuring it.");
      return { ...league, featured: true, ...stamp };
    case "unfeature":
      return { ...league, featured: false, ...stamp };
    case "delist":
      if (!league.listed) throw new LeagueTransitionError("The city is not listed.");
      return { ...league, listed: false, featured: false, review: league.status === "official" ? "approved" : "delisted", ...stamp };
    case "relist":
      if (league.listed) throw new LeagueTransitionError("The city is already listed.");
      if (league.status === "community" && league.review !== "delisted") throw new LeagueTransitionError("A community city is listed by approving its request.");
      return { ...league, listed: true, review: "approved", ...stamp };
    case "pause":
      if (league.state === "paused") throw new LeagueTransitionError("The city is already paused.");
      return { ...league, state: "paused", ...stamp };
    case "resume":
      if (league.state !== "paused") throw new LeagueTransitionError("The city is not paused.");
      return { ...league, state: "live", ...stamp };
    case "launch":
      if (league.state !== "coming") throw new LeagueTransitionError("Only a coming city can launch.");
      return { ...league, state: "live", ...stamp };
  }
}

/** Whether the city appears in the public League. */
export function isListed(project: Pick<Project, "league">): boolean {
  return Boolean(project.league?.listed && project.league.review === "approved");
}

/** Whether the city's project keys may move money right now (a paused city answers reads only). */
export function cityPaused(project: Pick<Project, "league">): boolean {
  return project.league?.state === "paused";
}

export interface LeaguePublic {
  readonly status: LeagueStatus;
  readonly state: LeagueState;
  readonly featured: boolean;
  readonly slug: string;
  readonly emblem: LeagueEmblem;
  readonly tagline: string;
  readonly category: LeagueCategory;
  readonly codename: string | null;
  readonly codenameNote: string | null;
  readonly note: string | null;
  readonly does: readonly string[];
  readonly pages: readonly LeaguePage[];
}

export interface LeagueUsage {
  readonly today: { readonly requests: number; readonly plans: number };
  readonly last7Days: { readonly requests: number; readonly plans: number };
}

/** A city as anyone may read it: the listing, the project's public view and live usage counts. */
export interface LeagueCity {
  readonly slug: string;
  readonly league: LeaguePublic;
  readonly project: ProjectPublicView;
  readonly usage: LeagueUsage;
}

export function leaguePublic(league: ProjectLeague): LeaguePublic {
  return {
    status: league.status,
    state: league.state,
    featured: league.featured,
    slug: league.slug,
    emblem: league.emblem,
    tagline: league.tagline,
    category: league.category,
    codename: league.codename ?? null,
    codenameNote: league.codenameNote ?? null,
    note: league.note ?? null,
    does: league.does ?? [],
    pages: league.pages ?? [],
  };
}

const STATE_ORDER: Readonly<Record<LeagueState, number>> = { live: 0, paused: 1, coming: 2 };

/** League order: official before community, featured first, live before paused before coming, then by name. */
export function compareCities(a: { readonly league: Pick<LeaguePublic, "status" | "featured" | "state">; readonly project: Pick<ProjectPublicView, "name"> }, b: typeof a): number {
  return (
    Number(b.league.status === "official") - Number(a.league.status === "official") ||
    Number(b.league.featured) - Number(a.league.featured) ||
    STATE_ORDER[a.league.state] - STATE_ORDER[b.league.state] ||
    a.project.name.localeCompare(b.project.name)
  );
}
