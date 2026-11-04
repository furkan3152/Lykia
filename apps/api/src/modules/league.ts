/**
 * The League: Lykia's sub-products as cities, each a real Project
 * (platform/league.ts, @lykia/core/league).
 *
 *   GET  /league                          public: listed cities, their public project view and live usage
 *   GET  /league/:slug                    public: one listed city
 *   GET  /league/by-slug/:slug            public: a listed city by project slug (city subdomains, /c/:slug)
 *   GET  /league/by-host?host=            public: a listed city by a verified custom domain
 *   POST /projects/:id/league/request     developer: ask for a community listing (reviewed by an admin)
 *   PUT  /league/:id                      admin: approve, reject, feature, unfeature, delist, relist, pause, resume, launch
 *   GET  /admin/league                    admin: every League entry (requests included) and the seed status
 *   POST /admin/league/seed               admin: create the official cities that are missing (idempotent)
 *
 * Admin routes check the admin role on the server for every call (a SIWE
 * session whose address is in LYKIA_ADMIN_ADDRESSES); API keys never reach them.
 */
import { LEAGUE_ACTIONS, LEAGUE_CATEGORIES, LEAGUE_EMBLEMS, type LeagueAction, type LeagueCategory, type LeagueEmblem } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { cachePublicly } from "../http/request.js";
import { parseBody, parseParams, parseQuery } from "../http/validate.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { actOnCity, cityByHost, cityBySlug, councilCities, leagueCities, leagueCity, requestLeagueListing, seedLeague, seedStatus } from "../platform/league.js";
import { mustDeveloper } from "../platform/auth.js";
import { mustSession } from "../platform/session.js";

const ProjectId = z.object({ id: z.string().regex(/^prj_[a-z0-9]{12}$/u) });
const Slug = z.object({ slug: z.string().regex(/^[a-z][a-z0-9-]{1,22}[a-z0-9]$/u) });
const Host = z.object({ host: z.string().max(253).regex(/^[a-z0-9.-]+$/iu) });

const usage = z.object({ today: z.object({ requests: z.number().int(), plans: z.number().int() }), last7Days: z.object({ requests: z.number().int(), plans: z.number().int() }) });
const leaguePublic = z.object({
  status: z.enum(["official", "community"]),
  state: z.enum(["live", "coming", "paused"]),
  featured: z.boolean(),
  slug: z.string(),
  emblem: z.enum(LEAGUE_EMBLEMS as unknown as [LeagueEmblem, ...LeagueEmblem[]]),
  tagline: z.string(),
  category: z.enum(LEAGUE_CATEGORIES as unknown as [LeagueCategory, ...LeagueCategory[]]),
  codename: z.string().nullable(),
  codenameNote: z.string().nullable(),
  note: z.string().nullable(),
  does: z.array(z.string()),
  pages: z.array(z.object({ label: z.string(), href: z.string() })),
});
const city = z.object({ slug: z.string(), league: leaguePublic, project: z.object({ id: z.string(), name: z.string(), modules: z.array(z.string()), network: z.enum(["mainnet", "testnet"]), assistantName: z.string() }).passthrough(), usage });
const requestBody = z
  .object({
    tagline: z.string().min(8).max(90),
    category: z.enum(LEAGUE_CATEGORIES as unknown as [LeagueCategory, ...LeagueCategory[]]),
    emblem: z.enum(LEAGUE_EMBLEMS as unknown as [LeagueEmblem, ...LeagueEmblem[]]).optional(),
    slug: z.string().max(32).optional(),
    codename: z.string().max(24).optional(),
  })
  .strict();
const actionBody = z.object({ action: z.enum(LEAGUE_ACTIONS as unknown as [LeagueAction, ...LeagueAction[]]), note: z.string().trim().max(200).optional() }).strict();
const seedReport = z.object({ owner: z.string().nullable(), cities: z.array(z.object({ key: z.string(), projectId: z.string(), name: z.string(), outcome: z.enum(["created", "present", "missing"]) })) });

documentRoutes([
  { method: "get", path: "/v1/league", tag: "League", summary: "The League: listed cities (Lykia's sub-products and approved community projects) with their public project view and live usage", auth: "public", response: z.object({ cities: z.array(city) }) },
  { method: "get", path: "/v1/league/:slug", tag: "League", summary: "One listed city", auth: "public", params: Slug, response: city },
  { method: "get", path: "/v1/league/by-slug/:slug", tag: "League", summary: "A listed city by its project slug: what <slug>.<root domain> and /c/<slug> load", auth: "public", params: Slug, response: city },
  { method: "get", path: "/v1/league/by-host", tag: "League", summary: "A listed city by one of its verified custom domains", auth: "public", query: Host, response: city },
  { method: "post", path: "/v1/projects/:id/league/request", tag: "League", summary: "Ask for a community listing of your project; an admin reviews it", auth: "session", scope: "admin", params: ProjectId, body: requestBody },
  { method: "put", path: "/v1/league/:id", tag: "League", summary: "Admin: approve, reject, feature, unfeature, delist, relist, pause, resume or launch a city (audited)", auth: "session", scope: "admin", params: ProjectId, body: actionBody },
  { method: "get", path: "/v1/admin/league", tag: "League", summary: "Admin: every League entry, requests first, and which official cities exist", auth: "session", scope: "admin" },
  { method: "post", path: "/v1/admin/league/seed", tag: "League", summary: "Admin: create the official cities that are missing (idempotent, owned by the first admin address)", auth: "session", scope: "admin", response: seedReport },
]);

export const leagueModule: ApiModule = {
  name: "league",
  register(router, ctx) {
    router.get("/league", async (_req, res) => {
      cachePublicly(res, 30);
      res.json({ cities: await leagueCities(ctx) });
    });
    router.get("/league/by-slug/:slug", async (req, res) => {
      const { slug } = parseParams(req, Slug);
      cachePublicly(res, 30);
      res.json(await cityBySlug(ctx, slug));
    });
    router.get("/league/by-host", async (req, res) => {
      const { host } = parseQuery(req, Host);
      cachePublicly(res, 30);
      res.json(await cityByHost(ctx, host));
    });
    router.get("/league/:slug", async (req, res) => {
      const { slug } = parseParams(req, Slug);
      cachePublicly(res, 30);
      res.json(await leagueCity(ctx, slug));
    });
    router.post("/projects/:id/league/request", ctx.limits.auth, async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, ProjectId);
      const body = parseBody(req, requestBody);
      const project = await requestLeagueListing(ctx, dev.address, id, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as typeof body);
      res.status(201).json({ projectId: project.id, league: project.league });
    });
    router.put("/league/:id", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req, "admin");
      const { id } = parseParams(req, ProjectId);
      const body = parseBody(req, actionBody);
      res.json(await actOnCity(ctx, session.address, id, body.action, body.note));
    });
    router.get("/admin/league", async (req, res) => {
      await mustSession(ctx, req, "admin");
      res.setHeader("Cache-Control", "no-store");
      res.json({ cities: await councilCities(ctx), seed: await seedStatus(ctx) });
    });
    router.post("/admin/league/seed", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req, "admin");
      res.json(await seedLeague(ctx, session.address));
    });
  },
};
