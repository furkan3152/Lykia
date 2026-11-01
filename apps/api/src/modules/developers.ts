/**
 * The developer platform. This module is mounted first: its gate checks
 * every request that presents a `Lykia-Key` (see platform/gate.ts).
 *
 *   POST /developers/register            become a developer (session)
 *   GET  /developers/me                  profile, settings, usage
 *   GET  /developers/keys                POST /developers/keys   POST /developers/keys/:id/(rotate|revoke)
 *   PUT  /developers/settings            integrator fee (bps, capped) and recipient
 *   GET  /developers/usage
 *   GET  /developers/webhooks            POST /developers/webhooks   POST /developers/webhooks/:id/disable
 *   GET  /developers/webhooks/deliveries POST /developers/webhooks/test
 */
import { API_KEY_SCOPES, MAX_INTEGRATOR_FEE_BPS, WEBHOOK_EVENTS, type ApiKeyScope, type WebhookEvent } from "@lykia/core/api/platform";
import { z } from "zod";
import { agentServices } from "../agents/index.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams } from "../http/validate.js";
import { flags } from "../platform/admin.js";
import { developerProfile, registerDeveloper, updateSettings, usageOf } from "../platform/developers.js";
import { developerGate } from "../platform/gate.js";
import { createKey, listKeys, revokeKey, rotateKey } from "../platform/keys.js";
import { mustSession } from "../platform/session.js";

const originSchema = z.string().max(200).refine((v) => {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.hostname === "localhost") && u.origin === v;
  } catch {
    return false;
  }
}, "An exact origin such as https://app.example.com");

export const developersModule: ApiModule = {
  name: "developers",
  register(router, ctx) {
    router.use(developerGate(ctx));
    const hooks = () => agentServices(ctx).webhooks;

    router.post("/developers/register", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req);
      if (!(await flags(ctx))["developer.signup"] && !session.roles.includes("admin")) throw new LykiaHttpError("FORBIDDEN", 403, "Developer sign-up is closed right now.");
      const body = parseBody(req, z.object({ name: z.string().min(1).max(64), website: z.string().url().max(200).nullable().optional() }));
      res.status(201).json(await registerDeveloper(ctx, session.address, { name: body.name, website: body.website ?? null }));
    });
    router.get("/developers/me", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      res.json({ profile: await developerProfile(ctx, session.address), usage: await usageOf(ctx, session.address), maxIntegratorFeeBps: MAX_INTEGRATOR_FEE_BPS });
    });
    router.get("/developers/keys", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      res.json({ keys: await listKeys(ctx, session.address) });
    });
    router.post("/developers/keys", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      const body = parseBody(
        req,
        z.object({
          label: z.string().min(1).max(48),
          kind: z.enum(["secret", "publishable"]).default("secret"),
          scopes: z.array(z.enum(API_KEY_SCOPES as unknown as [ApiKeyScope, ...ApiKeyScope[]])).min(1).max(4).optional(),
          allowedOrigins: z.array(originSchema).max(10).optional(),
          perMinute: z.number().int().min(1).max(6_000).optional(),
          perDay: z.number().int().min(1).max(5_000_000).optional(),
        }),
      );
      res.status(201).json(await createKey(ctx, { owner: session.address, ...body }));
    });
    router.post("/developers/keys/:id/rotate", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      const { id } = parseParams(req, z.object({ id: z.string().regex(/^[a-z0-9]{12}$/u) }));
      res.json(await rotateKey(ctx, session.address, id));
    });
    router.post("/developers/keys/:id/revoke", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      const { id } = parseParams(req, z.object({ id: z.string().regex(/^[a-z0-9]{12}$/u) }));
      res.json(await revokeKey(ctx, session.address, id));
    });
    router.put("/developers/settings", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      const body = parseBody(req, z.object({ integratorFeeBps: z.number().int().min(0).max(MAX_INTEGRATOR_FEE_BPS), feeRecipient: evmAddress.nullable() }));
      res.json(await updateSettings(ctx, session.address, { integratorFeeBps: body.integratorFeeBps, feeRecipient: body.feeRecipient }));
    });
    router.get("/developers/usage", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      res.json(await usageOf(ctx, session.address));
    });
    router.get("/developers/webhooks", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      res.json({ endpoints: await hooks().list(session.address), events: WEBHOOK_EVENTS });
    });
    router.post("/developers/webhooks", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      const body = parseBody(req, z.object({ url: z.string().url().max(500), events: z.array(z.enum(WEBHOOK_EVENTS as unknown as [WebhookEvent, ...WebhookEvent[]])).max(WEBHOOK_EVENTS.length).optional(), owners: z.array(evmAddress).max(1000).optional() }));
      res.status(201).json(await hooks().create(session.address, body));
    });
    router.post("/developers/webhooks/:id/disable", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      const { id } = parseParams(req, z.object({ id: z.string().regex(/^whe_[0-9a-f]{16}$/u) }));
      res.json(await hooks().disable(session.address, id));
    });
    router.get("/developers/webhooks/deliveries", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      res.json({ deliveries: await hooks().recentDeliveries(session.address) });
    });
    router.post("/developers/webhooks/test", async (req, res) => {
      const session = await mustSession(ctx, req, "developer");
      const sent = await hooks().emit("intent.settled", session.address, { test: true, intentId: "out_test0000", fold: ["1 USDC"] });
      res.json({ sent });
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
