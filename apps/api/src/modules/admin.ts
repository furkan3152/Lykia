/**
 * Owner console backend (admin role: LYKIA_ADMIN_ADDRESSES).
 *
 *   GET  /admin/deployments[?environment]   POST /admin/deployments   (verified against Arc before it is recorded)
 *   GET  /admin/flags                       PUT  /admin/flags
 *   GET  /admin/overview                    store, agents, flags, health of the RPCs
 *   GET  /deployments[?environment]         public: verified addresses for clients
 */
import { FEATURE_FLAGS, type FeatureFlag } from "@lykia/core/api/platform";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { parseBody, parseQuery } from "../http/validate.js";
import { flags, listDeployments, recordDeployment, setFlags } from "../platform/admin.js";
import { mustSession } from "../platform/session.js";
import { environmentSchema } from "./common.js";

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
      const body = parseBody(req, z.object({ environment: environmentSchema, contract: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,63}$/u), address: hex(40), txHash: hex(64) }));
      res.status(201).json(await recordDeployment(ctx, { environment: body.environment, contract: body.contract, address: body.address as `0x${string}`, txHash: body.txHash as `0x${string}`, recordedBy: session.address }));
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
