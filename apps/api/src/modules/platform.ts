/**
 * The API platform: reference, versions, event catalogue and feed, request
 * logs, usage, plans, billing and project limits.
 *
 *   GET  /reference                    rendered API reference (HTML)
 *   GET  /versions                     dated API versions and the latest
 *   GET  /webhooks/events              the event catalogue (public)
 *   GET  /events                       GET /events/:id    the owner's event feed
 *   GET  /logs                         GET /logs/:requestId   request logs (filters, cursor)
 *   GET  /billing/plans                every plan (public)
 *   GET  /billing/plan                 PUT /billing/plan   the account's plan
 *   GET  /billing/usage                month to date, per day and per endpoint
 *   POST /billing/credits              buy prepaid credits with x402 (USDC on Arc)
 *   GET  /billing/ledger               credit purchases and paid overage
 *   GET  /projects/:id/limits          PUT /projects/:id/limits   per-project rate limits
 *   GET  /projects/:id/usage/endpoints usage of a project per endpoint and day
 */
import { API_VERSIONS, BILLING_PLANS, LATEST_API_VERSION, type BillingPlanId } from "@lykia/core/api/platform";
import { z } from "zod";
import { agentServices } from "../agents/index.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { cachePublicly } from "../http/request.js";
import { evmAddress, parseBody, parseParams, parseQuery, queryInteger } from "../http/validate.js";
import { mustDeveloper } from "../platform/auth.js";
import { billingUsage, buyCredits, creditsOf, ledgerOf, planOf, setPlan } from "../platform/billing.js";
import { eventCatalogue } from "../platform/events.js";
import { getLog, listLogs, usageByDay } from "../platform/metering.js";
import { buildOpenApi } from "../platform/openapi/document.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { renderReference } from "../platform/openapi/reference.js";
import { projectLimits, setProjectLimits } from "../platform/projectLimits.js";
import { ownProject } from "../platform/projects.js";
import { originOf } from "../x402/manifest.js";

const logEntry = z.object({
  requestId: z.string(),
  at: z.string(),
  method: z.string(),
  path: z.string(),
  route: z.string().nullable(),
  status: z.number().int(),
  latencyMs: z.number().int(),
  errorCode: z.string().nullable(),
  keyId: z.string().nullable(),
  projectId: z.string().nullable(),
  mode: z.enum(["live", "test"]).nullable(),
  apiVersion: z.string(),
  idempotentReplay: z.boolean(),
});
const logQuery = z.object({
  keyId: z.string().regex(/^[a-z0-9]{12}$/u).optional(),
  projectId: z.string().regex(/^prj_[a-z0-9]{12}$/u).optional(),
  status: queryInteger(100, 599).optional(),
  statusClass: z.enum(["2xx", "3xx", "4xx", "5xx", "error"]).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "get", "post", "put", "patch", "delete"]).optional(),
  path: z.string().max(200).optional(),
  since: z.string().datetime().optional().describe("Only entries newer than this time (for tailing)."),
  limit: queryInteger(1, 200).optional(),
  cursor: z.string().max(200).optional(),
});
const planView = z.object({ id: z.enum(["free", "payg", "enterprise"]), name: z.string(), summary: z.string(), includedRequests: z.number().int(), overageUnitsPerRequest: z.string().nullable(), perMinute: z.number().int(), perDay: z.number().int(), logRetentionDays: z.number().int(), webhookEndpoints: z.number().int() });
const usageView = z.object({
  plan: z.string(),
  month: z.string(),
  requests: z.number().int(),
  includedRequests: z.number().int(),
  overageRequests: z.number().int(),
  overageUnits: z.string(),
  creditsUnits: z.string(),
  days: z.array(z.object({ day: z.string(), requests: z.number().int(), errors: z.number().int() })),
  endpoints: z.array(z.object({ day: z.string(), endpoint: z.string(), requests: z.number().int(), errors: z.number().int(), avgLatencyMs: z.number().int() })),
});
const eventQuery = z.object({ limit: queryInteger(1, 200).optional(), cursor: z.string().max(200).optional(), since: z.string().datetime().optional(), type: z.string().max(64).optional() });
const ProjectId = z.object({ id: z.string().regex(/^prj_[a-z0-9]{12}$/u) });
const limitsSchema = z.object({ perMinute: z.number().int().min(1).max(100_000).optional(), perDay: z.number().int().min(1).max(100_000_000).optional() });
const envelope = z.object({ id: z.string(), type: z.string(), event: z.string(), createdAt: z.string(), owner: z.string().nullable(), project: z.string().nullable(), livemode: z.boolean(), apiVersion: z.string(), data: z.unknown() });

documentRoutes([
  { method: "get", path: "/v1/reference", tag: "Platform", summary: "The API reference as a web page", auth: "public" },
  { method: "get", path: "/v1/versions", tag: "Platform", summary: "Dated API versions (send one as Lykia-Version)", auth: "public", response: z.object({ latest: z.string(), versions: z.array(z.string()), header: z.literal("Lykia-Version") }) },
  { method: "get", path: "/v1/webhooks/events", tag: "Webhooks", summary: "The event catalogue: every event type, its group and older aliases", auth: "public", response: z.object({ events: z.array(z.object({ type: z.string(), group: z.string(), description: z.string(), aliases: z.array(z.string()) })) }) },
  { method: "get", path: "/v1/events", tag: "Events", summary: "The account's events, newest first (what webhooks deliver)", auth: "session", scope: "read", query: eventQuery, response: z.object({ data: z.array(envelope), nextCursor: z.string().nullable() }) },
  { method: "get", path: "/v1/events/:id", tag: "Events", summary: "One event", auth: "session", scope: "read", response: envelope },
  { method: "get", path: "/v1/logs", tag: "Logs", summary: "Request logs of the account's keys, newest first", auth: "session", scope: "read", query: logQuery, response: z.object({ data: z.array(logEntry), nextCursor: z.string().nullable() }) },
  { method: "get", path: "/v1/logs/:requestId", tag: "Logs", summary: "One logged request by X-Request-Id", auth: "session", scope: "read", response: logEntry },
  { method: "get", path: "/v1/billing/plans", tag: "Billing", summary: "Every API plan", auth: "public", response: z.object({ plans: z.array(planView) }) },
  { method: "get", path: "/v1/billing/plan", tag: "Billing", summary: "The account's plan, credits and limits", auth: "session", scope: "read", response: z.object({ plan: planView, creditsUnits: z.string(), plans: z.array(planView) }) },
  { method: "put", path: "/v1/billing/plan", tag: "Billing", summary: "Switch between Free and Pay as you go", auth: "session", scope: "admin", body: z.object({ plan: z.enum(["free", "payg", "enterprise"]), owner: evmAddress.optional().describe("Admins only: the account to change.") }), response: z.object({ plan: planView }) },
  { method: "get", path: "/v1/billing/usage", tag: "Billing", summary: "Usage this month, per day and per endpoint", auth: "session", scope: "read", query: z.object({ days: queryInteger(1, 90).optional() }), response: usageView },
  { method: "post", path: "/v1/billing/credits", tag: "Billing", summary: "Buy prepaid API credits with x402 (USDC on Arc); answers 402 with the requirements until paid", auth: "session", scope: "admin", idempotent: true, x402: true, body: z.object({ amountUsdc: z.string().regex(/^\d{1,5}(?:\.\d{1,6})?$/u) }), response: z.object({ creditsUnits: z.string(), bought: z.string(), payer: z.string(), settlement: z.string() }) },
  { method: "get", path: "/v1/billing/ledger", tag: "Billing", summary: "Credit purchases and overage paid over x402", auth: "session", scope: "read" },
  { method: "get", path: "/v1/projects/:id/limits", tag: "Projects", summary: "A project's rate limits", auth: "session", scope: "read", response: z.object({ perMinute: z.number().int(), perDay: z.number().int() }) },
  { method: "put", path: "/v1/projects/:id/limits", tag: "Projects", summary: "Set a project's rate limits (up to the plan's)", auth: "session", scope: "admin", body: limitsSchema, response: z.object({ perMinute: z.number().int(), perDay: z.number().int() }) },
  { method: "get", path: "/v1/projects/:id/usage/endpoints", tag: "Projects", summary: "A project's requests per endpoint and day", auth: "session", scope: "read", query: z.object({ days: queryInteger(1, 90).optional() }) },
]);

function toUnits(amount: string): number {
  const [whole, frac = ""] = amount.split(".");
  return Number(whole) * 1_000_000 + Number(frac.padEnd(6, "0").slice(0, 6));
}

export const platformModule: ApiModule = {
  name: "platform",
  register(router, ctx) {
    router.get("/reference", (req, res) => {
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
      cachePublicly(res, 300);
      res.type("html").send(renderReference(buildOpenApi(ctx, originOf(req))));
    });
    router.get("/versions", (_req, res) => {
      cachePublicly(res, 300);
      res.json({ latest: LATEST_API_VERSION, versions: API_VERSIONS, header: "Lykia-Version" });
    });
    router.get("/webhooks/events", (_req, res) => {
      cachePublicly(res, 300);
      res.json({ events: eventCatalogue() });
    });
    router.get("/events", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const q = parseQuery(req, eventQuery);
      res.json(await agentServices(ctx).webhooks.listEvents(dev.address, { ...(q.limit ? { limit: q.limit } : {}), ...(q.cursor ? { after: q.cursor } : {}), ...(q.since ? { since: q.since } : {}), ...(q.type ? { type: q.type } : {}) }));
    });
    router.get("/events/:id", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, z.object({ id: z.string().regex(/^evt_[0-9a-f]{20}$/u) }));
      const event = await agentServices(ctx).webhooks.getEvent(dev.address, id);
      if (!event) throw new LykiaHttpError("NOT_FOUND", 404, "No such event.");
      res.json(event);
    });
    router.get("/logs", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const q = parseQuery(req, logQuery);
      res.json(await listLogs(ctx, dev.address, { ...q, ...(q.method ? { method: q.method.toUpperCase() } : {}) }));
    });
    router.get("/logs/:requestId", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { requestId } = parseParams(req, z.object({ requestId: z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/u) }));
      const entry = await getLog(ctx, dev.address, requestId);
      if (!entry) throw new LykiaHttpError("NOT_FOUND", 404, "No logged request with that id (logs are kept for your plan's retention).");
      res.json(entry);
    });
    router.get("/billing/plans", (_req, res) => {
      cachePublicly(res, 300);
      res.json({ plans: BILLING_PLANS });
    });
    router.get("/billing/plan", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      res.json({ plan: await planOf(ctx, dev.address), creditsUnits: String(await creditsOf(ctx, dev.address)), plans: BILLING_PLANS });
    });
    router.put("/billing/plan", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const body = parseBody(req, z.object({ plan: z.enum(["free", "payg", "enterprise"]), owner: evmAddress.optional() }));
      if (body.owner && !dev.admin) throw new LykiaHttpError("FORBIDDEN", 403, "Only admins change another account's plan.");
      res.json({ plan: await setPlan(ctx, body.owner ?? dev.address, body.plan as BillingPlanId, dev.admin) });
    });
    router.get("/billing/usage", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const q = parseQuery(req, z.object({ days: queryInteger(1, 90).optional() }));
      res.json(await billingUsage(ctx, dev.address, q.days ?? 30));
    });
    router.post("/billing/credits", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const body = parseBody(req, z.object({ amountUsdc: z.string().regex(/^\d{1,5}(?:\.\d{1,6})?$/u) }));
      res.json(await buyCredits(ctx, req, dev.address, toUnits(body.amountUsdc)));
    });
    router.get("/billing/ledger", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      res.json({ entries: await ledgerOf(ctx, dev.address) });
    });
    router.get("/projects/:id/limits", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, ProjectId);
      await ownProject(ctx, dev.address, id);
      res.json(await projectLimits(ctx, id, await planOf(ctx, dev.address)));
    });
    router.put("/projects/:id/limits", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, ProjectId);
      await ownProject(ctx, dev.address, id);
      res.json(await setProjectLimits(ctx, id, await planOf(ctx, dev.address), parseBody(req, limitsSchema)));
    });
    router.get("/projects/:id/usage/endpoints", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, ProjectId);
      await ownProject(ctx, dev.address, id);
      const q = parseQuery(req, z.object({ days: queryInteger(1, 90).optional() }));
      res.json(await usageByDay(ctx, id, q.days ?? 30));
    });
  },
};

