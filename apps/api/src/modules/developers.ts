/**
 * The developer platform: profile, keys, settings, usage and webhooks.
 * (The key gate itself is mounted by http/router.ts before every module.)
 * Account routes take a SIWE session with the developer role, or a secret
 * lk_live_/lk_test_ key with the needed scope (platform/auth.ts).
 *
 *   POST /developers/register                       become a developer (session)
 *   GET  /developers/me                             profile, settings, usage
 *   GET  /developers/keys                           POST /developers/keys
 *   GET  /developers/keys/:id                       PATCH /developers/keys/:id (scopes, IPs, limits, version)
 *   POST /developers/keys/:id/rotate                new secret; the old one works for overlapSeconds
 *   POST /developers/keys/:id/revoke
 *   PUT  /developers/settings                       integrator fee (bps, capped) and recipient
 *   GET  /developers/usage
 *   GET  /developers/webhooks                       POST /developers/webhooks
 *   PATCH /developers/webhooks/:id                  POST /developers/webhooks/:id/(disable|enable|rotate-secret)
 *   GET  /developers/webhooks/deliveries            GET /developers/webhooks/deliveries/:id
 *   POST /developers/webhooks/deliveries/:id/replay POST /developers/webhooks/test
 */
import { ALL_API_KEY_SCOPES, API_VERSIONS, MAX_INTEGRATOR_FEE_BPS, type ApiKeyScope } from "@lykia/core/api/platform";
import { z } from "zod";
import { agentServices } from "../agents/index.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { ownProject } from "../platform/projects.js";
import { evmAddress, parseBody, parseParams, parseQuery, queryInteger } from "../http/validate.js";
import { flags } from "../platform/admin.js";
import { mustDeveloper } from "../platform/auth.js";
import { planOf } from "../platform/billing.js";
import { developerProfile, registerDeveloper, updateSettings, usageOf } from "../platform/developers.js";
import { emitEvent, setDefaultEventContext, subscribableEvents } from "../platform/events.js";
import { createKey, getOwnKey, listKeys, MAX_ROTATION_OVERLAP_S, revokeKey, rotateKey, updateKey } from "../platform/keys.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { mustSession } from "../platform/session.js";

const originSchema = z.string().max(200).refine((v) => {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.hostname === "localhost") && u.origin === v;
  } catch {
    return false;
  }
}, "An exact origin such as https://app.example.com");

const scopeSchema = z.enum(ALL_API_KEY_SCOPES as unknown as [ApiKeyScope, ...ApiKeyScope[]]);
const ipSchema = z.string().min(2).max(64).describe("An IPv4/IPv6 address or a CIDR range");
const versionSchema = z.enum(API_VERSIONS as unknown as [string, ...string[]]);
const eventName = z.string().min(3).max(64).refine((e) => subscribableEvents().includes(e), "Unknown event (see GET /v1/webhooks/events)");

const createKeySchema = z.object({
  label: z.string().min(1).max(48),
  kind: z.enum(["secret", "publishable"]).default("secret"),
  mode: z.enum(["live", "test"]).optional().describe("live (lk_live_…) or test (lk_test_…, testnet only). Omit for a legacy lk_sk_ key."),
  scopes: z.array(scopeSchema).min(1).max(10).optional(),
  allowedOrigins: z.array(originSchema).max(10).optional(),
  allowedIps: z.array(ipSchema).max(20).optional(),
  perMinute: z.number().int().min(1).max(6_000).optional(),
  perDay: z.number().int().min(1).max(5_000_000).optional(),
  apiVersion: versionSchema.optional(),
  projectId: z.string().regex(/^prj_[a-z0-9]{12}$/u).optional().describe("Bind a secret key to one of your projects: the project's Fence and limits apply, and the key may act for owners who granted that project consent (POST /v1/consents)."),
});
const updateKeySchema = z.object({
  label: z.string().min(1).max(48).optional(),
  scopes: z.array(scopeSchema).min(1).max(10).optional(),
  allowedOrigins: z.array(originSchema).max(10).optional(),
  allowedIps: z.array(ipSchema).max(20).optional(),
  perMinute: z.number().int().min(1).max(6_000).optional(),
  perDay: z.number().int().min(1).max(5_000_000).optional(),
  apiVersion: versionSchema.optional(),
});
const keyView = z.object({
  id: z.string(),
  label: z.string(),
  prefix: z.string(),
  kind: z.enum(["secret", "publishable"]),
  mode: z.enum(["live", "test"]).optional(),
  scopes: z.array(z.string()),
  allowedOrigins: z.array(z.string()),
  allowedIps: z.array(z.string()),
  perMinute: z.number().int(),
  perDay: z.number().int(),
  apiVersion: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  previousSecretExpiresAt: z.string().nullable(),
  projectId: z.string().optional(),
});
const createdKey = keyView.extend({ secret: z.string().describe("The full key, shown once.") });
const KeyId = z.object({ id: z.string().regex(/^[a-z0-9]{12}$/u) });
const HookId = z.object({ id: z.string().regex(/^whe_[0-9a-f]{16}$/u) });
const DeliveryId = z.object({ id: z.string().regex(/^whd_[a-z0-9]{1,16}_[0-9a-f]{12}$/u) });
const createWebhookSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(eventName).max(64).optional(),
  projects: z.array(z.string().regex(/^prj_[a-z0-9]{12}$/u)).max(20).optional(),
  description: z.string().max(200).nullable().optional(),
}).strict(); // Strict: the old `owners` list is refused, not silently dropped.
const updateWebhookSchema = z.object({ events: z.array(eventName).min(1).max(64).optional(), projects: z.array(z.string().regex(/^prj_[a-z0-9]{12}$/u)).max(20).optional(), description: z.string().max(200).nullable().optional() });
const endpointView = z.object({ id: z.string(), url: z.string(), events: z.array(z.string()), projects: z.array(z.string()), description: z.string().nullable(), createdAt: z.string(), disabled: z.boolean(), secret: z.string().optional() });
const attempt = z.object({ at: z.string(), statusCode: z.number().int().nullable(), durationMs: z.number().int(), error: z.string().nullable() });
const deliveryView = z.object({ id: z.string(), endpointId: z.string(), event: z.string(), eventId: z.string().optional(), replayOf: z.string().nullable().optional(), attempts: z.number().int(), status: z.enum(["pending", "delivered", "failed"]), lastStatusCode: z.number().int().nullable(), nextAttemptAt: z.string().nullable(), createdAt: z.string(), attemptLog: z.array(attempt).optional() });
const deliveryQuery = z.object({ limit: queryInteger(1, 200).optional(), endpointId: z.string().max(40).optional(), status: z.enum(["pending", "delivered", "failed"]).optional(), event: z.string().max(64).optional() });
const testSchema = z.object({ endpointId: z.string().regex(/^whe_[0-9a-f]{16}$/u).optional(), type: eventName.optional() });

documentRoutes([
  { method: "get", path: "/v1/developers/keys", tag: "Keys", summary: "List API keys", auth: "session", scope: "admin", response: z.object({ keys: z.array(keyView) }) },
  { method: "post", path: "/v1/developers/keys", tag: "Keys", summary: "Create an API key (live or test, scopes, IP allowlist, limits, version pin)", auth: "session", scope: "admin", idempotent: true, status: 201, body: createKeySchema, response: createdKey },
  { method: "get", path: "/v1/developers/keys/:id", tag: "Keys", summary: "One API key", auth: "session", scope: "admin", response: keyView },
  { method: "patch", path: "/v1/developers/keys/:id", tag: "Keys", summary: "Change a key's label, scopes, IP allowlist, origins, limits or version pin", auth: "session", scope: "admin", body: updateKeySchema, response: keyView },
  { method: "post", path: "/v1/developers/keys/:id/rotate", tag: "Keys", summary: "Rotate a key: a new secret now, the old one keeps working for overlapSeconds (default 86400)", auth: "session", scope: "admin", idempotent: true, body: z.object({ overlapSeconds: z.number().int().min(0).max(MAX_ROTATION_OVERLAP_S).optional() }).optional(), response: createdKey },
  { method: "post", path: "/v1/developers/keys/:id/revoke", tag: "Keys", summary: "Revoke a key (immediate, including any rotation overlap)", auth: "session", scope: "admin", idempotent: true, response: keyView },
  { method: "get", path: "/v1/developers/webhooks", tag: "Webhooks", summary: "Webhook endpoints and the events they can subscribe to", auth: "session", scope: "admin" },
  { method: "post", path: "/v1/developers/webhooks", tag: "Webhooks", summary: "Add a webhook endpoint (signing secret shown once)", auth: "session", scope: "admin", idempotent: true, status: 201, body: createWebhookSchema, response: endpointView },
  { method: "patch", path: "/v1/developers/webhooks/:id", tag: "Webhooks", summary: "Change an endpoint's events, projects or description", auth: "session", scope: "admin", body: updateWebhookSchema, response: endpointView },
  { method: "post", path: "/v1/developers/webhooks/:id/disable", tag: "Webhooks", summary: "Disable an endpoint", auth: "session", scope: "admin", response: endpointView },
  { method: "post", path: "/v1/developers/webhooks/:id/enable", tag: "Webhooks", summary: "Enable an endpoint again", auth: "session", scope: "admin", response: endpointView },
  { method: "post", path: "/v1/developers/webhooks/:id/rotate-secret", tag: "Webhooks", summary: "A new signing secret (shown once)", auth: "session", scope: "admin", response: endpointView },
  { method: "get", path: "/v1/developers/webhooks/deliveries", tag: "Webhooks", summary: "Delivery log, newest first", auth: "session", scope: "admin", query: deliveryQuery, response: z.object({ deliveries: z.array(deliveryView) }) },
  { method: "get", path: "/v1/developers/webhooks/deliveries/:id", tag: "Webhooks", summary: "One delivery with its attempts and body", auth: "session", scope: "admin", response: deliveryView.extend({ payload: z.object({}).passthrough() }) },
  { method: "post", path: "/v1/developers/webhooks/deliveries/:id/replay", tag: "Webhooks", summary: "Send a delivery again (same event id and body)", auth: "session", scope: "admin", idempotent: true, response: deliveryView },
  { method: "post", path: "/v1/developers/webhooks/test", tag: "Webhooks", summary: "Send a test event to one endpoint or all of them", auth: "session", scope: "admin", body: testSchema.optional(), response: z.object({ sent: z.number().int(), deliveries: z.array(deliveryView) }) },
]);

export const developersModule: ApiModule = {
  name: "developers",
  register(router, ctx) {
    setDefaultEventContext(ctx);
    const hooks = () => agentServices(ctx).webhooks;

    router.post("/developers/register", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req);
      if (!(await flags(ctx))["developer.signup"] && !session.roles.includes("admin")) throw new LykiaHttpError("FORBIDDEN", 403, "Developer sign-up is closed right now.");
      const body = parseBody(req, z.object({ name: z.string().min(1).max(64), website: z.string().url().max(200).nullable().optional() }));
      res.status(201).json(await registerDeveloper(ctx, session.address, { name: body.name, website: body.website ?? null }));
    });
    router.get("/developers/me", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      res.json({ profile: await developerProfile(ctx, dev.address), usage: await usageOf(ctx, dev.address), maxIntegratorFeeBps: MAX_INTEGRATOR_FEE_BPS, plan: (await planOf(ctx, dev.address)).id, via: dev.via });
    });
    router.get("/developers/keys", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      res.json({ keys: await listKeys(ctx, dev.address) });
    });
    router.post("/developers/keys", ctx.limits.auth, async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const body = parseBody(req, createKeySchema);
      if (body.projectId) {
        await ownProject(ctx, dev.address, body.projectId);
        if (body.kind === "publishable") throw new LykiaHttpError("INVALID_REQUEST", 400, "Browser keys for a project come from POST /v1/projects/:id/keys.");
      }
      res.status(201).json(await createKey(ctx, { owner: dev.address, ...body }));
    });
    router.get("/developers/keys/:id", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, KeyId);
      res.json(await getOwnKey(ctx, dev.address, id));
    });
    router.patch("/developers/keys/:id", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, KeyId);
      res.json(await updateKey(ctx, dev.address, id, parseBody(req, updateKeySchema)));
    });
    router.post("/developers/keys/:id/rotate", ctx.limits.auth, async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, KeyId);
      const body = parseBody(req, z.object({ overlapSeconds: z.number().int().min(0).max(MAX_ROTATION_OVERLAP_S).optional() }));
      const rotated = await rotateKey(ctx, dev.address, id, body.overlapSeconds);
      void emitEvent("key.rotated", { keyId: id, prefix: rotated.prefix, previousSecretExpiresAt: rotated.previousSecretExpiresAt ?? null }, { owner: dev.address, ctx, livemode: rotated.mode !== "test" });
      res.json(rotated);
    });
    router.post("/developers/keys/:id/revoke", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, KeyId);
      res.json(await revokeKey(ctx, dev.address, id));
    });
    router.put("/developers/settings", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const body = parseBody(req, z.object({ integratorFeeBps: z.number().int().min(0).max(MAX_INTEGRATOR_FEE_BPS), feeRecipient: evmAddress.nullable() }));
      res.json(await updateSettings(ctx, dev.address, { integratorFeeBps: body.integratorFeeBps, feeRecipient: body.feeRecipient }));
    });
    router.get("/developers/usage", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      res.json(await usageOf(ctx, dev.address));
    });
    router.get("/developers/webhooks", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      res.json({ endpoints: await hooks().list(dev.address), events: subscribableEvents() });
    });
    router.post("/developers/webhooks", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const body = parseBody(req, createWebhookSchema);
      // An endpoint follows only the developer's own projects; another owner's events arrive only with that owner's consent (POST /v1/consents).
      for (const id of body.projects ?? []) await ownProject(ctx, dev.address, id);
      const plan = await planOf(ctx, dev.address);
      res.status(201).json(await hooks().create(dev.address, { ...body, maxEndpoints: plan.webhookEndpoints }));
    });
    router.patch("/developers/webhooks/:id", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, HookId);
      const patch = parseBody(req, updateWebhookSchema);
      for (const p of patch.projects ?? []) await ownProject(ctx, dev.address, p);
      res.json(await hooks().update(dev.address, id, patch));
    });
    router.post("/developers/webhooks/:id/disable", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, HookId);
      res.json(await hooks().disable(dev.address, id));
    });
    router.post("/developers/webhooks/:id/enable", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, HookId);
      res.json(await hooks().enable(dev.address, id));
    });
    router.post("/developers/webhooks/:id/rotate-secret", ctx.limits.auth, async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, HookId);
      res.json(await hooks().rotateSecret(dev.address, id));
    });
    router.get("/developers/webhooks/deliveries", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const q = parseQuery(req, deliveryQuery);
      res.json({ deliveries: await hooks().recentDeliveries(dev.address, q) });
    });
    router.get("/developers/webhooks/deliveries/:id", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, DeliveryId);
      res.json(await hooks().delivery(dev.address, id));
    });
    router.post("/developers/webhooks/deliveries/:id/replay", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const { id } = parseParams(req, DeliveryId);
      res.json(await hooks().replay(dev.address, id));
    });
    router.post("/developers/webhooks/test", async (req, res) => {
      const dev = await mustDeveloper(ctx, req);
      const body = parseBody(req, testSchema);
      res.json(await hooks().sendTest(dev.address, { ...(body.endpointId ? { endpointId: body.endpointId } : {}), ...(body.type ? { type: body.type } : {}) }));
    });
  },
  start(ctx) {
    const timer = setInterval(() => {
      void agentServices(ctx).webhooks.retryDue().catch(() => undefined);
    }, 15_000);
    timer.unref();
    TIMERS.set(ctx, timer);
  },
  stop(ctx) {
    const timer = TIMERS.get(ctx);
    if (timer) clearInterval(timer);
  },
};

const TIMERS = new WeakMap<object, NodeJS.Timeout>();
