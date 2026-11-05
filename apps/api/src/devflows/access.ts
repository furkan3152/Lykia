/**
 * Who is calling a developer flow route (payouts, invoices, agents,
 * automations) and for which project.
 *
 * These routes accept a secret key (server to server) or a SIWE session.
 * Publishable keys never reach their writes. The developer is the key's
 * owner or the signed-in address; the project is the one named in the
 * request (it must be the developer's) or the key's own project.
 */
import type { Project } from "@lykia/core";
import type { ApiKeyScope } from "@lykia/core/api/platform";
import type { Request } from "express";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { keyOf } from "../platform/gate.js";
import { scopeAllows } from "../platform/scopes.js";
import { getProject, ownProject } from "../platform/projects.js";
import { sessionOf } from "../platform/session.js";

/** Routes name fine-grained scopes; legacy keys (lk_sk_) are checked against the legacy scope that implies them. */
const LEGACY_OF: Readonly<Record<ApiKeyScope, ApiKeyScope>> = { read: "read", quote: "plan", build: "plan", execute: "plan", payouts: "plan", automation: "agents", agents: "agents", admin: "plan", plan: "plan", webhooks: "webhooks" };

export interface FlowCaller {
  readonly developer: string;
  readonly project: Project | null;
  readonly via: "secret" | "session";
}

/** The caller of a developer flow route. `scope` is the key scope it needs. */
export async function flowCaller(ctx: AppContext, req: Request, scope: ApiKeyScope, options: { readonly projectId?: string | null } = {}): Promise<FlowCaller> {
  const key = keyOf(req);
  let developer: string;
  let via: FlowCaller["via"];
  let project: Project | null = null;
  if (key) {
    if (key.kind !== "secret") throw new LykiaHttpError("FORBIDDEN", 403, "This route needs a secret key or a session, never a browser key.");
    const fine = key.mode !== undefined;
    const required = fine ? scope : LEGACY_OF[scope];
    if (!scopeAllows(key.scopes, required, fine)) throw new LykiaHttpError("FORBIDDEN", 403, `This key lacks the ${required} scope.`, { required });
    developer = key.owner.toLowerCase();
    via = "secret";
    if (!options.projectId && key.projectId) project = await getProject(ctx, key.projectId);
  } else {
    const session = await sessionOf(ctx, req);
    if (!session) throw new LykiaHttpError("UNAUTHORIZED", 401, "Use a secret key (Lykia-Key) or sign in (Lykia-Session).");
    developer = session.address.toLowerCase();
    via = "session";
  }
  if (options.projectId) project = await ownProject(ctx, developer, options.projectId);
  return { developer, project, via };
}

/**
 * An owner's standing instructions (standing orders, alerts, agent
 * automations) are managed by the owner's own session or by a secret key
 * (server to server; the gate has already checked its scope).
 */
export function actsFor(caller: FlowCaller, owner: string): boolean {
  return caller.via === "secret" || caller.developer === owner.toLowerCase();
}

export function assertActsFor(caller: FlowCaller, owner: string): void {
  if (!actsFor(caller, owner)) throw new LykiaHttpError("FORBIDDEN", 403, "Only the owner (or a secret key) can change that.");
}
