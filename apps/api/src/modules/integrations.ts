/**
 * Protocol integration: Lykia Adapter Manifests (`lykia.adapter/v1`).
 *
 *   POST /integrations/adapters                  submit or re-submit a manifest (secret key or session)
 *   GET  /integrations/adapters                  approved and routable adapters; ?mine=true your own; admins any ?status
 *   GET  /integrations/adapters/:id              one adapter (public once approved; otherwise its submitter or an admin)
 *   GET  /integrations/adapters/:id/status       status, last validation, history
 *   POST /integrations/adapters/:id/validate     on-chain validation (eth_getCode, selectors, reads, dry simulation)
 *   POST /integrations/adapters/:id/review       admin: approve, reject, route or suspend
 *   GET  /integrations/manifest                  the spec: templates, verbs, statuses and an example
 *
 * A routable adapter joins the knowledge model, the route search and the
 * aggregator at runtime, with no redeploy. See docs/integrate-your-protocol.md.
 */
import { ADAPTER_SPEC_VERSION, ADAPTER_STATUSES, ADAPTER_TEMPLATES, ADAPTER_VERBS, type AdapterRecord, type AdapterStatus } from "@lykia/core";
import type { Request } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { parseBody, parseParams, parseQuery, queryBoolean } from "../http/validate.js";
import { getAdapter, listAdapters, recordValidation, setAdapterStatus, submitAdapter } from "../integrations/registry.js";
import { validateOnChain } from "../integrations/validate.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { keyOf } from "../platform/gate.js";
import { sessionOf } from "../platform/session.js";
import { environmentSchema } from "./common.js";
import { EXAMPLE_MANIFEST } from "../integrations/example.js";

const IdParams = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/u) });

/** Who is calling: a session address, a secret key (its owner), or nobody. */
async function callerOf(ctx: AppContext, req: Request): Promise<{ id: string; admin: boolean } | null> {
  const session = await sessionOf(ctx, req);
  if (session) return { id: session.address.toLowerCase(), admin: session.roles.includes("admin") };
  const key = keyOf(req);
  if (key && key.kind === "secret") return { id: key.owner.toLowerCase(), admin: false };
  return null;
}

async function mustCaller(ctx: AppContext, req: Request) {
  const caller = await callerOf(ctx, req);
  if (!caller) throw new LykiaHttpError("UNAUTHORIZED", 401, "Submit with a secret key (Lykia-Key) or a signed-in session (Lykia-Session).");
  return caller;
}

function canSee(record: AdapterRecord, caller: { id: string; admin: boolean } | null): boolean {
  return record.status === "approved" || record.status === "routable" || caller?.admin === true || caller?.id === record.submittedBy.toLowerCase();
}

const submitBody = z.object({ manifest: z.unknown(), validate: z.boolean().optional(), environment: environmentSchema.optional() }).strict();
const validateBody = z.object({ environment: environmentSchema.optional() }).strict();
const reviewBody = z.object({ decision: z.enum(["approve", "reject", "route", "suspend"]), note: z.string().max(400).optional() }).strict();
const listQuery = z.object({ mine: queryBoolean.optional(), status: z.enum(ADAPTER_STATUSES).optional() });
const record = z.object({ id: z.string(), status: z.enum(ADAPTER_STATUSES), manifest: z.record(z.string(), z.unknown()), submittedBy: z.string(), submittedAt: z.string(), updatedAt: z.string(), validation: z.unknown().optional(), review: z.unknown().optional(), history: z.array(z.unknown()) }).passthrough();
const DECISION: Record<z.infer<typeof reviewBody>["decision"], AdapterStatus> = { approve: "approved", reject: "rejected", route: "routable", suspend: "suspended" };

documentRoutes([
  { method: "post", path: "/v1/integrations/adapters", tag: "Integrations", summary: "Submit a Lykia Adapter Manifest", description: `A ${ADAPTER_SPEC_VERSION} document. validate: true runs the on-chain validation right away.`, scope: "build", auth: "secret", body: submitBody, response: record, idempotent: true },
  { method: "get", path: "/v1/integrations/adapters", tag: "Integrations", summary: "List adapters", scope: "read", auth: "public", query: listQuery, response: z.object({ adapters: z.array(record) }) },
  { method: "get", path: "/v1/integrations/adapters/:id", tag: "Integrations", summary: "One adapter", scope: "read", auth: "public", params: IdParams, response: record },
  { method: "get", path: "/v1/integrations/adapters/:id/status", tag: "Integrations", summary: "Adapter status and last validation", scope: "read", auth: "public", params: IdParams, response: z.object({ id: z.string(), status: z.enum(ADAPTER_STATUSES), validation: z.unknown().nullable(), history: z.array(z.unknown()) }) },
  { method: "post", path: "/v1/integrations/adapters/:id/validate", tag: "Integrations", summary: "Validate an adapter on chain", description: "eth_getCode for every contract, selectors in the ABI (and the bytecode, info only), every read callable, and a dry simulation of each capability with a sample amount.", scope: "build", auth: "secret", params: IdParams, body: validateBody, response: record },
  { method: "post", path: "/v1/integrations/adapters/:id/review", tag: "Integrations", summary: "Admin review: approve, reject, route or suspend", scope: "admin", auth: "session", params: IdParams, body: reviewBody, response: record },
  { method: "get", path: "/v1/integrations/manifest", tag: "Integrations", summary: "The adapter manifest spec and an example", scope: "read", auth: "public", response: z.object({ schema: z.string(), verbs: z.array(z.string()), templates: z.array(z.string()), statuses: z.array(z.string()), example: z.unknown() }) },
]);

export const integrationsModule: ApiModule = {
  name: "integrations",
  register(router, ctx) {
    router.get("/integrations/manifest", (_req, res) => {
      res.json({ schema: ADAPTER_SPEC_VERSION, verbs: ADAPTER_VERBS, templates: [...ADAPTER_TEMPLATES, "$contract:<key>"], statuses: ADAPTER_STATUSES, flow: "submitted -> validated -> approved (admin) -> routable (admin)", example: EXAMPLE_MANIFEST });
    });

    router.post("/integrations/adapters", ctx.limits.heavy, async (req, res) => {
      const caller = await mustCaller(ctx, req);
      const body = parseBody(req, submitBody);
      let rec = await submitAdapter(ctx, body.manifest, caller.id);
      if (body.validate) {
        const validation = await validateOnChain(ctx, rec.manifest, body.environment ?? ctx.config.mode);
        rec = validation.ok ? await setAdapterStatus(ctx, rec.id, "validated", { by: caller.id, role: "owner", validation }) : await recordValidation(ctx, rec.id, validation);
      }
      res.status(201).json(rec);
    });

    router.get("/integrations/adapters", async (req, res) => {
      const q = parseQuery(req, listQuery);
      const caller = await callerOf(ctx, req);
      if (q.mine && !caller) throw new LykiaHttpError("UNAUTHORIZED", 401, "Sign in or send a secret key to list your own adapters.");
      const all = await listAdapters(ctx, { ...(q.status ? { status: q.status } : {}), ...(q.mine && caller ? { submittedBy: caller.id } : {}) });
      res.json({ adapters: all.filter((r) => (q.mine ? true : canSee(r, caller) && (caller?.admin || r.status === "approved" || r.status === "routable"))) });
    });

    router.get("/integrations/adapters/:id", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const rec = await getAdapter(ctx, id);
      if (!rec || !canSee(rec, await callerOf(ctx, req))) throw new LykiaHttpError("NOT_FOUND", 404, `No adapter called ${id}.`);
      res.json(rec);
    });

    router.get("/integrations/adapters/:id/status", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const rec = await getAdapter(ctx, id);
      if (!rec || !canSee(rec, await callerOf(ctx, req))) throw new LykiaHttpError("NOT_FOUND", 404, `No adapter called ${id}.`);
      res.json({ id: rec.id, status: rec.status, validation: rec.validation ?? null, review: rec.review ?? null, history: rec.history });
    });

    router.post("/integrations/adapters/:id/validate", ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const body = parseBody(req, validateBody);
      const caller = await mustCaller(ctx, req);
      const rec = await getAdapter(ctx, id);
      if (!rec || !canSee(rec, caller) || (!caller.admin && caller.id !== rec.submittedBy.toLowerCase())) throw new LykiaHttpError("NOT_FOUND", 404, `No adapter called ${id}.`);
      const validation = await validateOnChain(ctx, rec.manifest, body.environment ?? ctx.config.mode);
      const canMark = rec.status === "submitted" || rec.status === "validated" || rec.status === "rejected";
      res.json(validation.ok && canMark ? await setAdapterStatus(ctx, id, "validated", { by: caller.id, role: caller.admin ? "admin" : "owner", validation }) : await recordValidation(ctx, id, validation));
    });

    router.post("/integrations/adapters/:id/review", ctx.limits.auth, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const body = parseBody(req, reviewBody);
      const session = await sessionOf(ctx, req);
      if (!session?.roles.includes("admin")) throw new LykiaHttpError("FORBIDDEN", 403, "Adapter reviews need a Lykia admin session.");
      res.json(await setAdapterStatus(ctx, id, DECISION[body.decision], { by: session.address.toLowerCase(), role: "admin", ...(body.note ? { note: body.note } : {}) }));
    });
  },
};
