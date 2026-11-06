/**
 * The League: Lykia's sub-products as cities (spec in @lykia/core/league).
 * Every city is a real Project; its listing lives on `project.league`.
 *
 * - Official cities are created by `seedLeague`, owned by the first address
 *   in LYKIA_ADMIN_ADDRESSES. The seed is idempotent: each city has a
 *   deterministic project id, so running it twice (or concurrently) never
 *   creates a second copy, and it never overwrites what the council changed.
 * - Community cities are developer projects whose owner asked for a listing;
 *   only an admin approves, features, pauses or delists them, and every
 *   decision is appended to the platform audit chain.
 */
import { createHash } from "node:crypto";
import {
  LEAGUE_SCHEMA,
  LeagueTransitionError,
  applyLeagueAction,
  buildProject,
  compareCities,
  isListed,
  isReservedSlug,
  leaguePublic,
  publicProject,
  requestListing,
  validateLeagueRequest,
  type LeagueAction,
  type LeagueCity,
  type LeagueRequestInput,
  type LeagueUsage,
  type Project,
  type ProjectInput,
  type ProjectLeague,
} from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { auditSafe, PLATFORM_CHAIN } from "../security/audit.js";
import { dayKey } from "./gate.js";
import { forgetProjectOrigins, ownProject, takenSlugs, verifiedOrigins } from "./projects.js";
import { typedCollection } from "./typed.js";
import { listAll } from "../store/types.js";

const projects = (ctx: AppContext) => typedCollection<Project>(ctx, "projects");

async function allProjects(ctx: AppContext): Promise<Project[]> {
  return (await listAll(projects(ctx))).map((d) => d.value);
}

/* ------------------------------------------------------------ usage */

async function cityUsage(ctx: AppContext, projectId: string): Promise<LeagueUsage> {
  const now = ctx.clock.now();
  const requests = ctx.store.counters("project_requests");
  const plans = ctx.store.counters("project_plans");
  let r7 = 0;
  let p7 = 0;
  let today = { requests: 0, plans: 0 };
  for (let i = 6; i >= 0; i--) {
    const day = dayKey(now - i * 86_400_000);
    const r = await requests.get(`${projectId}:${day}`);
    const p = await plans.get(`${projectId}:${day}`);
    r7 += r;
    p7 += p;
    if (i === 0) today = { requests: r, plans: p };
  }
  return { today, last7Days: { requests: r7, plans: p7 } };
}

async function cityOf(ctx: AppContext, project: Project & { league: ProjectLeague }): Promise<LeagueCity> {
  return { slug: project.league.slug, league: leaguePublic(project.league), project: publicProject(project), usage: await cityUsage(ctx, project.id) };
}

/* ------------------------------------------------------------ public */

/** Every listed city, in League order. */
export async function leagueCities(ctx: AppContext): Promise<LeagueCity[]> {
  const listed = (await allProjects(ctx)).filter((p): p is Project & { league: ProjectLeague } => isListed(p));
  const cities = await Promise.all(listed.map((p) => cityOf(ctx, p)));
  return cities.sort(compareCities);
}

export async function leagueCity(ctx: AppContext, slug: string): Promise<LeagueCity> {
  const project = (await allProjects(ctx)).find((p): p is Project & { league: ProjectLeague } => isListed(p) && p.league?.slug === slug);
  if (!project) throw new LykiaHttpError("NOT_FOUND", 404, "No such city in the League.");
  return cityOf(ctx, project);
}

/** A listed city by its project slug (what a <slug>.<root domain> host or /c/<slug> asks for). */
export async function cityBySlug(ctx: AppContext, slug: string): Promise<LeagueCity> {
  const project = (await allProjects(ctx)).find((p): p is Project & { league: ProjectLeague } => isListed(p) && (p.slug === slug || p.league?.slug === slug));
  if (!project) throw new LykiaHttpError("NOT_FOUND", 404, "No listed city has that address.");
  return cityOf(ctx, project);
}

/** A listed city by one of its verified custom domains (https://<host>). */
export async function cityByHost(ctx: AppContext, host: string): Promise<LeagueCity> {
  const origin = `https://${host.toLowerCase()}`;
  const project = (await allProjects(ctx)).find((p): p is Project & { league: ProjectLeague } => isListed(p) && verifiedOrigins(p).includes(origin));
  if (!project) throw new LykiaHttpError("NOT_FOUND", 404, "No listed city is served from that domain.");
  return cityOf(ctx, project);
}

/* ------------------------------------------------------------ city hosts (CORS) */

const SLUG_CACHE = new WeakMap<AppContext, { readonly at: number; readonly slugs: ReadonlySet<string> }>();

/**
 * Whether `origin` is https://<slug>.<root domain> for a listed city. Only
 * listed cities' subdomains are admitted, so a random label under the root
 * domain gets no CORS headers. Cached for 30 seconds.
 */
export async function isCityOrigin(ctx: AppContext, origin: string): Promise<boolean> {
  const root = ctx.config.platform.rootDomain;
  if (!root) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || !url.hostname.endsWith(`.${root}`)) return false;
  const label = url.hostname.slice(0, -(root.length + 1));
  if (label.includes(".")) return false;
  const now = ctx.clock.now();
  let cached = SLUG_CACHE.get(ctx);
  if (!cached || now - cached.at > 30_000) {
    const slugs = (await allProjects(ctx)).filter(isListed).flatMap((p) => [p.slug, p.league?.slug].filter((s): s is string => Boolean(s)));
    cached = { at: now, slugs: new Set(slugs) };
    SLUG_CACHE.set(ctx, cached);
  }
  return cached.slugs.has(label);
}

function forgetCitySlugs(ctx: AppContext): void {
  SLUG_CACHE.delete(ctx);
}

/* ------------------------------------------------------------ developers */

export async function requestLeagueListing(ctx: AppContext, owner: string, id: string, input: LeagueRequestInput): Promise<Project> {
  const project = await ownProject(ctx, owner, id);
  const issues = validateLeagueRequest(input);
  if (issues.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `Invalid listing request: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, { issues });
  if (project.league?.status === "official") throw new LykiaHttpError("ALREADY_OFFICIAL", 409, "This is an official city; the Lykia team manages its listing.");
  if (project.league && project.league.review === "approved" && project.league.listed) throw new LykiaHttpError("ALREADY_LISTED", 409, "This city is already listed in the League.");
  const now = new Date(ctx.clock.now()).toISOString();
  const league = requestListing(project, input, now);
  if (isReservedSlug(league.slug)) throw new LykiaHttpError("INVALID_REQUEST", 400, `"${league.slug}" is reserved; send another slug.`);
  if ((await takenSlugs(ctx, project.id)).has(league.slug)) throw new LykiaHttpError("SLUG_TAKEN", 409, `Another city already uses "${league.slug}"; send another slug.`);
  const next: Project = { ...project, slug: league.slug, league, updatedAt: now };
  await projects(ctx).put(next.id, next);
  return next;
}

/* ------------------------------------------------------------ the council (admins) */

export interface CouncilCity {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly league: ProjectLeague;
  readonly modules: Project["modules"];
  readonly network: Project["network"];
  readonly brand: Project["brand"];
  readonly usage: LeagueUsage;
}

/** Every project that has a League entry: listed, requested, rejected, delisted or paused. */
export async function councilCities(ctx: AppContext): Promise<CouncilCity[]> {
  const withLeague = (await allProjects(ctx)).filter((p): p is Project & { league: ProjectLeague } => Boolean(p.league));
  const out = await Promise.all(withLeague.map(async (p) => ({ id: p.id, owner: p.owner, name: p.name, league: p.league, modules: p.modules, network: p.network, brand: p.brand, usage: await cityUsage(ctx, p.id) })));
  const rank = (c: CouncilCity) => (c.league.review === "requested" ? 0 : c.league.status === "official" ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export async function actOnCity(ctx: AppContext, admin: string, id: string, action: LeagueAction, note?: string): Promise<CouncilCity> {
  const project = (await projects(ctx).get(id))?.value;
  if (!project?.league) throw new LykiaHttpError("NOT_FOUND", 404, "No League entry for that project.");
  const now = new Date(ctx.clock.now()).toISOString();
  let league: ProjectLeague;
  try {
    league = applyLeagueAction(project.league, action, admin, now);
  } catch (error) {
    if (error instanceof LeagueTransitionError) throw new LykiaHttpError("INVALID_TRANSITION", 409, error.message);
    throw error;
  }
  const next: Project = { ...project, league, updatedAt: now };
  await projects(ctx).put(next.id, next);
  forgetProjectOrigins(ctx);
  forgetCitySlugs(ctx);
  await auditSafe(ctx, PLATFORM_CHAIN, { kind: "league", actor: admin.toLowerCase(), subject: id, data: { action, slug: league.slug, ...(note ? { note } : {}) } });
  return { id: next.id, owner: next.owner, name: next.name, league, modules: next.modules, network: next.network, brand: next.brand, usage: await cityUsage(ctx, next.id) };
}

/* ------------------------------------------------------------ the seed */

export interface SeedCity {
  readonly key: string;
  readonly input: ProjectInput;
  readonly league: Omit<ProjectLeague, "schema" | "seedKey" | "listed" | "review" | "featured">;
}

/** The official cities. Codenames are Lycian cities, shown small on each coin. */
export const OFFICIAL_CITIES: readonly SeedCity[] = Object.freeze([
  {
    key: "pay",
    input: {
      name: "Lykia Pay",
      network: "mainnet",
      modules: ["chat", "send", "flock", "scent"],
      fence: { template: "shepherd", caps: { perStepUsd: "500", dailyUsd: "2500" } },
      brand: { mascot: "lyko", mosaic: true, scheme: "auto", radius: 10, colors: { primary: "#1e8fa3", accent: "#d9a441" } },
      prompt: "Lykia Pay helps people send invoices, share payment links and run payouts in USDC and EURC on Arc.",
    },
    league: {
      status: "official",
      state: "live",
      slug: "pay",
      emblem: "lighthouse",
      tagline: "Invoices, payment links and payouts in USDC on Arc.",
      category: "payments",
      codename: "Patara",
      codenameNote: "Patara's lighthouse guided every ship into the harbour: Pay guides every payment to its recipient.",
      note: "Every payment is a plain USDC or EURC transfer the payer signs in their own wallet. Lykia never holds the money or the keys.",
      does: ["Send an invoice with line items and get paid at a hosted page.", "Share a payment link anyone can pay from any wallet.", "Run payouts to many recipients from a CSV, checked by the Fence first."],
      pages: [
        { label: "Hosted invoice page", href: "/pay/:id" },
        { label: "Invoices API", href: "/v1/invoices" },
        { label: "Payouts API", href: "/v1/payouts" },
        { label: "Send without a sentence", href: "/app/move/send" },
      ],
    },
  },
  {
    key: "agents",
    input: {
      name: "Lykia Agents",
      network: "mainnet",
      modules: ["chat", "pack", "fence"],
      fence: { template: "lamb", caps: { perStepUsd: "50", dailyUsd: "250" } },
      brand: { mascot: "lyko", mosaic: true, scheme: "auto", radius: 10, colors: { primary: "#b9472e", accent: "#5f8a3a" } },
      prompt: "Lykia Agents gives each agent a budget, a Fence inside its owner's and an on-chain Tag.",
    },
    league: {
      status: "official",
      state: "live",
      slug: "agents",
      emblem: "temple",
      tagline: "Budgeted agents with a Fence and an on-chain Tag.",
      category: "agents",
      codename: "Xanthos",
      codenameNote: "Xanthos was the capital where the League's work was done: Agents is where your agents do theirs.",
      note: "An agent never gets more than its budget, carved from the owner's. Its Fence sits inside the owner's Fence, and its Tag pins the hash of the Fence it obeys.",
      does: ["Create an agent with a daily budget and its own Fence.", "Give it an ERC-8004 identity (a Tag) that pins its rules.", "Stop every agent at once with the Whistle."],
      pages: [
        { label: "Pack · agents", href: "/app/pack" },
        { label: "Fence · rules", href: "/app/fence" },
        { label: "Tag · agent identity", href: "/app/tag" },
      ],
    },
  },
  {
    key: "perps",
    input: {
      name: "Lykia Perps",
      network: "mainnet",
      modules: ["chat", "orders", "fence"],
      fence: { template: "lamb", caps: { perStepUsd: "100", dailyUsd: "500" } },
      brand: { mascot: "lyko", mosaic: true, scheme: "auto", radius: 10, colors: { primary: "#13233a", accent: "#d9a441" } },
    },
    league: {
      status: "official",
      state: "coming",
      slug: "perps",
      emblem: "prow",
      tagline: "Perpetuals under a Fence, with collateral on Arc.",
      category: "trading",
      codename: "Phaselis",
      codenameNote: "Phaselis traded through three harbours with ports far beyond the coast, while its goods were counted at home.",
      note: "Not live. Orders would match on Extended's engine, off Arc; the collateral sits on Arc. Lykia would check each order against your Fence and never hold funds or keys.",
      does: ["Place perpetual orders checked against your Fence.", "Keep collateral on Arc in your own account.", "Read live markets today on the Perps markets page."],
      pages: [{ label: "Perps markets (read only)", href: "/app/markets" }],
    },
  },
]);

/** The deterministic project id of a seeded city: the same on every run and every instance. */
export function seedProjectId(key: string): string {
  return `prj_${createHash("sha256").update(`lykia.league.seed:${key}`).digest("hex").slice(0, 12)}`;
}

export interface SeedReport {
  readonly owner: string | null;
  readonly cities: readonly { readonly key: string; readonly projectId: string; readonly name: string; readonly outcome: "created" | "present" | "missing" }[];
}

/** Which official cities exist, without changing anything. */
export async function seedStatus(ctx: AppContext): Promise<SeedReport> {
  const owner = ctx.config.platform.adminAddresses[0] ?? null;
  const cities = await Promise.all(
    OFFICIAL_CITIES.map(async (c) => {
      const projectId = seedProjectId(c.key);
      return { key: c.key, projectId, name: c.input.name, outcome: (await projects(ctx).get(projectId)) ? ("present" as const) : ("missing" as const) };
    }),
  );
  return { owner, cities };
}

/**
 * Creates the official cities that do not exist yet. Safe in production:
 * idempotent, owned by the first admin address, never touches a city that is
 * already there (so the council's pauses and delistings stand).
 */
export async function seedLeague(ctx: AppContext, actor = "seed"): Promise<SeedReport> {
  const owner = ctx.config.platform.adminAddresses[0];
  if (!owner) throw new LykiaHttpError("NOT_CONFIGURED", 409, "Set LYKIA_ADMIN_ADDRESSES first: the official cities belong to the first admin address.");
  const now = new Date(ctx.clock.now()).toISOString();
  const out: SeedReport["cities"][number][] = [];
  for (const city of OFFICIAL_CITIES) {
    const projectId = seedProjectId(city.key);
    if (await projects(ctx).get(projectId)) {
      out.push({ key: city.key, projectId, name: city.input.name, outcome: "present" });
      continue;
    }
    const league: ProjectLeague = { schema: LEAGUE_SCHEMA, ...city.league, listed: true, review: "approved", featured: city.league.state === "live", seedKey: city.key, reviewedAt: now, reviewedBy: owner };
    const project: Project = { ...buildProject(projectId, owner, { ...city.input, slug: city.league.slug }, now), league };
    await projects(ctx).put(projectId, project);
    out.push({ key: city.key, projectId, name: city.input.name, outcome: "created" });
  }
  forgetProjectOrigins(ctx);
  forgetCitySlugs(ctx);
  if (out.some((c) => c.outcome === "created")) await auditSafe(ctx, PLATFORM_CHAIN, { kind: "league", actor, subject: "seed", data: { created: out.filter((c) => c.outcome === "created").map((c) => c.key) } });
  return { owner, cities: out };
}
