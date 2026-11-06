/**
 * Owner consent for projects (see platform/consent.ts). Only the owner's own
 * SIWE session grants, lists or revokes: an API key never can.
 *
 *   GET    /consents                 projects this owner lets act for them
 *   POST   /consents                 { projectId } grant
 *   DELETE /consents/:projectId      revoke
 */
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { parseBody, parseParams } from "../http/validate.js";
import { grantConsent, listConsents, revokeConsent } from "../platform/consent.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { mustSession } from "../platform/session.js";
import { keyOf } from "../platform/gate.js";
import { LykiaHttpError } from "../http/errors.js";
import type { Request } from "express";
import type { AppContext } from "../context.js";

const projectId = z.string().regex(/^prj_[a-z0-9]{12}$/u);
const consentView = z.object({ owner: z.string(), projectId: z.string(), developer: z.string(), projectName: z.string(), grantedAt: z.string() });
const ProjectParams = z.object({ projectId });

documentRoutes([
  { method: "get", path: "/v1/consents", tag: "Consent", summary: "Projects the signed-in owner lets act for them", description: "A project's secret keys may act for an owner other than the key's own developer (agents, Fold, standing orders, automations, saved chat state, webhook events) only while that owner's consent is on record. Session only.", auth: "session", response: z.object({ consents: z.array(consentView) }) },
  { method: "post", path: "/v1/consents", tag: "Consent", summary: "Let a project act for the signed-in owner", description: "Grants the project's secret keys the right to act for this owner and adds this owner's events to the project's webhooks. Session only: an API key can never grant consent.", auth: "session", body: z.object({ projectId }), response: consentView, status: 201 },
  { method: "delete", path: "/v1/consents/:projectId", tag: "Consent", summary: "Revoke a project's consent", description: "The project's keys stop acting for this owner and its webhooks stop carrying this owner's events.", auth: "session", params: ProjectParams, response: z.object({ revoked: z.boolean() }) },
]);

/** Consent is the owner's own act: a SIWE session, never a key riding along. */
async function ownerSession(ctx: AppContext, req: Request) {
  if (keyOf(req)) throw new LykiaHttpError("FORBIDDEN", 403, "Consent is granted from the owner's own session, never with an API key.");
  return mustSession(ctx, req);
}

export const consentsModule: ApiModule = {
  name: "consents",
  register(router, ctx) {
    router.get("/consents", async (req, res) => {
      const session = await ownerSession(ctx, req);
      res.json({ consents: await listConsents(ctx, session.address) });
    });
    router.post("/consents", async (req, res) => {
      const session = await ownerSession(ctx, req);
      const body = parseBody(req, z.object({ projectId }));
      res.status(201).json(await grantConsent(ctx, session.address, body.projectId));
    });
    router.delete("/consents/:projectId", async (req, res) => {
      const session = await ownerSession(ctx, req);
      const { projectId: id } = parseParams(req, ProjectParams);
      res.json({ revoked: await revokeConsent(ctx, session.address, id) });
    });
  },
};
