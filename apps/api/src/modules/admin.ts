/**
 * Owner console backend (admin role: LYKIA_ADMIN_ADDRESSES).
 *
 *   GET  /admin/deployments[?environment]   POST /admin/deployments   (verified against Arc before it is recorded)
 *   GET  /admin/flags                       PUT  /admin/flags
 *   GET  /admin/overview                    store, agents, flags, health of the RPCs
 *   POST /admin/circle/entity-secret        generate + register a Circle entity secret (returned once)
 *   GET  /deployments[?environment]         public: verified addresses for clients
 *   GET  /admin/router[?environment]        LykiaRouter: owner, paused, venue allowlist + unsigned setVenue calls
 *   GET  /fees                              public: Lykia's fee policy
 */
import { FEATURE_FLAGS, type FeatureFlag } from "@lykia/core/api/platform";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { parseBody, parseQuery } from "../http/validate.js";
import { flags, listDeployments, recordDeployment, setFlags } from "../platform/admin.js";
import { mustSession } from "../platform/session.js";
import { EntitySecretError, registerEntitySecret } from "../circle/entitySecret.js";
import { LykiaHttpError } from "../http/errors.js";
import { environmentSchema } from "./common.js";
import { FEE_POLICY_TEXT, feePercent, MAX_FEE_BPS } from "@lykia/core";
import { routerStatus } from "../engine/lykiaRouter.js";

const hex = (len: number) => z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${len}}$`, "u"));

export const adminModule: ApiModule = {
  name: "admin",
  register(router, ctx) {
    router.get("/deployments", async (req, res) => {
      const { environment } = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      res.json({ deployments: (await listDeployments(ctx, environment)).filter((d) => d.verified) });
    });
    router.get("/admin/deployments", async (req, res) => {
      await mustSession(ctx, req, "admin");
      const { environment } = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      res.json({ deployments: await listDeployments(ctx, environment) });
    });
    router.post("/admin/deployments", ctx.limits.heavy, async (req, res) => {
      const session = await mustSession(ctx, req, "admin");
      const body = parseBody(req, z.object({ environment: environmentSchema, contract: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,63}$/u), name: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,63}$/u).optional(), address: hex(40), txHash: hex(64) }));
      res.status(201).json(await recordDeployment(ctx, { environment: body.environment, contract: body.contract, ...(body.name ? { name: body.name } : {}), address: body.address as `0x${string}`, txHash: body.txHash as `0x${string}`, recordedBy: session.address }));
    });
    router.get("/fees", (_req, res) => {
      const { bps, recipient } = ctx.config.fee;
      res.json({ bps, percent: feePercent(bps), recipient, maxBps: MAX_FEE_BPS, policy: FEE_POLICY_TEXT, exempt: ["repay", "withdraw", "approve", "revoke", "register-agent", "attest"], beta: ctx.config.beta ? { ...ctx.config.beta, environment: "mainnet", note: "A hard cap above every Fence while Lykia's contracts are unaudited. Moves that bring value home are never capped." } : null });
    });
    router.get("/admin/router", async (req, res) => {
      await mustSession(ctx, req, "admin");
      const { environment } = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      res.json(await routerStatus(ctx.chains, environment ?? ctx.config.mode));
    });
    router.get("/admin/flags", async (req, res) => {
      await mustSession(ctx, req, "admin");
      res.json(await flags(ctx));
    });
    router.put("/admin/flags", async (req, res) => {
      await mustSession(ctx, req, "admin");
      const body = parseBody(req, z.record(z.enum(FEATURE_FLAGS as unknown as [FeatureFlag, ...FeatureFlag[]]), z.boolean()));
      res.json(await setFlags(ctx, body));
    });
    router.post("/admin/circle/entity-secret", ctx.limits.auth, async (req, res) => {
      await mustSession(ctx, req, "admin");
      const body = parseBody(req, z.object({ replace: z.literal(true).optional() }).strict());
      if (!ctx.config.circle.apiKey) throw new LykiaHttpError("NEEDS_KEY", 409, "Set CIRCLE_API_KEY on the API first; the entity secret is registered with it.");
      if (ctx.config.circle.entitySecret && body.replace !== true) throw new LykiaHttpError("ALREADY_CONFIGURED", 409, "CIRCLE_ENTITY_SECRET is already set on this deployment. Send { \"replace\": true } only if you really mean to register a new one.");
      try {
        const registered = await registerEntitySecret(ctx.fetch, ctx.config.circle.apiKey, ctx.clock.now());
        res.setHeader("Cache-Control", "no-store, max-age=0");
        res.setHeader("Pragma", "no-cache");
        res.status(201).json({ ...registered, next: "Save the recovery file somewhere safe, then set CIRCLE_ENTITY_SECRET to entitySecret in the API's environment and redeploy. Lykia keeps neither." });
      } catch (error) {
        if (error instanceof EntitySecretError) throw new LykiaHttpError("CIRCLE_ENTITY_SECRET", error.status, error.message);
        throw error;
      }
    });
    router.get("/admin/overview", async (req, res) => {
      await mustSession(ctx, req, "admin");
      const agents = await ctx.store.collection("pack_agents").list({ limit: 1000 });
      res.json({
        version: ctx.config.version,
        mode: ctx.config.mode,
        store: ctx.store.kind,
        llm: ctx.config.agent.anthropicApiKey !== null,
        model: ctx.config.agent.model,
        flags: await flags(ctx),
        packAgents: agents.length,
        deployments: (await listDeployments(ctx)).length,
      });
    });
  },
};
