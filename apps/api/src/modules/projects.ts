/**
 * Projects: white-label Lykia (see platform/projects.ts and docs/platform/projects.md).
 *
 *   GET    /projects                          the developer's projects
 *   POST   /projects                          create (SIWE session or a secret key)
 *   GET    /projects/:id                      full project (owner)
 *   PATCH  /projects/:id                      partial update
 *   DELETE /projects/:id
 *   GET    /projects/:id/public               brand, modules, network, fee bps: what embeds read
 *   POST   /projects/:id/origins/challenge    the DNS TXT / .well-known value for an origin
 *   POST   /projects/:id/origins/verify       check the proof and mark the origin verified
 *   GET    /projects/:id/keys                 POST /projects/:id/keys (publishable, origin-bound)
 *   GET    /projects/:id/usage                requests and plans per day
 *   POST   /projects/:id/webhook              register the project's webhook URL (signing secret shown once)
 *   GET    /projects/:id/fence                the project's default Fence (template + caps + modules)
 */
import { FENCE_TEMPLATES, PROJECT_MODULES, fenceHash, projectFence, type FenceTemplateKey, type ProjectInput, type ProjectModule } from "@lykia/core";
import type { Request } from "express";
import { z } from "zod";
import { agentServices } from "../agents/index.js";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { cachePublicly } from "../http/request.js";
import { evmAddress, parseBody, parseParams } from "../http/validate.js";
import { keyOf } from "../platform/gate.js";
import { listKeys } from "../platform/keys.js";
import {
  createProject,
  createProjectKey,
  deleteProject,
  getProject,
  listProjects,
  originChallenge,
  ownProject,
  projectUsage,
  publicView,
  saveProject,
  updateProject,
  verifyOrigin,
} from "../platform/projects.js";
import { mustSession } from "../platform/session.js";

const usd = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/u);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const Id = z.object({ id: z.string().regex(/^prj_[a-z0-9]{12}$/u) });

const brandSchema = z
  .object({
    logoUrl: z.string().max(300).optional(),
    colors: z.object({ primary: hex.optional(), accent: hex.optional(), background: hex.optional(), foreground: hex.optional() }).strict().optional(),
    font: z.string().max(120).optional(),
    scheme: z.enum(["light", "dark", "auto"]).optional(),
    mosaic: z.boolean().optional(),
    mascot: z.enum(["lyko", "none", "custom"]).optional(),
    assistant: z.object({ name: z.string().max(32).optional(), avatarUrl: z.string().max(300).optional() }).strict().optional(),
    radius: z.number().int().min(0).max(24).optional(),
  })
  .strict();

const projectSchema = z
  .object({
    name: z.string().min(1).max(64),
    slug: z.string().min(3).max(24).optional(),
    brand: brandSchema.optional(),
    origins: z.array(z.string().max(200)).max(10).optional(),
    modules: z.array(z.enum(PROJECT_MODULES as unknown as [ProjectModule, ...ProjectModule[]])).max(PROJECT_MODULES.length).optional(),
    fence: z
      .object({
        template: z.enum(Object.keys(FENCE_TEMPLATES) as [FenceTemplateKey, ...FenceTemplateKey[]]).optional(),
        caps: z.object({ perStepUsd: usd.optional(), perIntentUsd: usd.optional(), dailyUsd: usd.optional(), maxSlippageBps: z.number().int().min(1).max(1000).optional() }).strict().optional(),
      })
      .strict()
      .optional(),
    network: z.enum(["mainnet", "testnet"]).optional(),
    fee: z.object({ bps: z.number().int().min(0), recipient: evmAddress.nullable() }).optional(),
    webhookUrl: z.string().max(300).nullable().optional(),
    prompt: z.string().max(2400).optional(),
    vocabulary: z.record(z.string().max(48), z.string().max(160)).optional(),
    locale: z.string().max(8).optional(),
  })
  .strict();

/** The developer behind the request: a SIWE session with the developer role, or a secret key. */
async function developerOf(ctx: AppContext, req: Request): Promise<string> {
  const key = keyOf(req);
  if (key) {
    if (key.kind !== "secret") throw new LykiaHttpError("FORBIDDEN", 403, "Manage projects with a session or a secret key, never a browser key.");
    return key.owner;
  }
  return (await mustSession(ctx, req, "developer")).address;
}

function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export const projectsModule: ApiModule = {
  name: "projects",
  register(router, ctx) {
    router.get("/projects", async (req, res) => {
      res.json({ projects: await listProjects(ctx, await developerOf(ctx, req)), modules: PROJECT_MODULES, templates: Object.keys(FENCE_TEMPLATES) });
    });
    router.post("/projects", ctx.limits.auth, async (req, res) => {
      const owner = await developerOf(ctx, req);
      const body = parseBody(req, projectSchema);
      res.status(201).json(await createProject(ctx, owner, clean(body) as ProjectInput));
    });
    router.get("/projects/:id", async (req, res) => {
      const { id } = parseParams(req, Id);
      res.json(await ownProject(ctx, await developerOf(ctx, req), id));
    });
    router.patch("/projects/:id", async (req, res) => {
      const { id } = parseParams(req, Id);
      const owner = await developerOf(ctx, req);
      const body = parseBody(req, projectSchema.partial());
      res.json(await updateProject(ctx, owner, id, clean(body) as Partial<ProjectInput>));
    });
    router.delete("/projects/:id", async (req, res) => {
      const { id } = parseParams(req, Id);
      res.json(await deleteProject(ctx, await developerOf(ctx, req), id));
    });
    // Public: embeds and widgets read the brand before any key is used. No owner, webhook or prompt.
    router.get("/projects/:id/public", async (req, res) => {
      const { id } = parseParams(req, Id);
      const project = await getProject(ctx, id);
      if (!project) throw new LykiaHttpError("NOT_FOUND", 404, "No such project.");
      cachePublicly(res, 60);
      res.json(publicView(project));
    });
    router.get("/projects/:id/fence", async (req, res) => {
      const { id } = parseParams(req, Id);
      const project = await getProject(ctx, id);
      if (!project) throw new LykiaHttpError("NOT_FOUND", 404, "No such project.");
      const fence = projectFence(project);
      cachePublicly(res, 60);
      res.json({ fence, fenceHash: fenceHash(fence) });
    });
    router.post("/projects/:id/origins/challenge", async (req, res) => {
      const { id } = parseParams(req, Id);
      const project = await ownProject(ctx, await developerOf(ctx, req), id);
      const { origin } = parseBody(req, z.object({ origin: z.string().max(200) }));
      res.json(originChallenge(ctx, project, origin));
    });
    router.post("/projects/:id/origins/verify", ctx.limits.auth, async (req, res) => {
      const { id } = parseParams(req, Id);
      const owner = await developerOf(ctx, req);
      const { origin, method } = parseBody(req, z.object({ origin: z.string().max(200), method: z.enum(["dns", "well-known"]) }));
      res.json(await verifyOrigin(ctx, owner, id, origin, method));
    });
    router.get("/projects/:id/keys", async (req, res) => {
      const { id } = parseParams(req, Id);
      const owner = await developerOf(ctx, req);
      await ownProject(ctx, owner, id);
      res.json({ keys: (await listKeys(ctx, owner)).filter((k) => k.projectId === id) });
    });
    router.post("/projects/:id/keys", ctx.limits.auth, async (req, res) => {
      const { id } = parseParams(req, Id);
      const owner = await developerOf(ctx, req);
      const { label } = parseBody(req, z.object({ label: z.string().min(1).max(48) }).default({ label: "browser" }));
      res.status(201).json(await createProjectKey(ctx, owner, id, label));
    });
    router.get("/projects/:id/usage", async (req, res) => {
      const { id } = parseParams(req, Id);
      res.json(await projectUsage(ctx, await developerOf(ctx, req), id));
    });
    router.post("/projects/:id/webhook", ctx.limits.auth, async (req, res) => {
      const { id } = parseParams(req, Id);
      const owner = await developerOf(ctx, req);
      const project = await ownProject(ctx, owner, id);
      if (!project.webhookUrl) throw new LykiaHttpError("INVALID_REQUEST", 400, "Set the project's webhookUrl first.");
      const hooks = agentServices(ctx).webhooks;
      if (project.webhookId) await hooks.disable(owner, project.webhookId).catch(() => undefined);
      const endpoint = await hooks.create(owner, { url: project.webhookUrl });
      await saveProject(ctx, { ...project, webhookId: endpoint.id });
      res.status(201).json(endpoint);
    });
  },
};
