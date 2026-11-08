/**
 * Owner consent: which projects an owner lets act for them.
 *
 * A secret key acts for its own owner (the developer who made it). It acts
 * for any other owner only when that owner granted the key's project consent
 * from their own SIWE session (POST /v1/consents). The same record lets a
 * project's webhook carry that owner's events. Revoking it (DELETE
 * /v1/consents/:projectId) stops both at once.
 *
 * Records live in the `owner_consents` collection under `owner:projectId`,
 * so listing an owner's grants is one prefix scan and checking one grant is
 * one get.
 */
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { StoredKey } from "./keys.js";
import { getProject } from "./projects.js";
import { typedCollection } from "./typed.js";

export interface OwnerConsent {
  readonly owner: string;
  readonly projectId: string;
  /** The project's owner (the developer whose keys may now act for `owner`). */
  readonly developer: string;
  readonly projectName: string;
  readonly grantedAt: string;
}

const MAX_CONSENTS = 50;

const consents = (ctx: AppContext) => typedCollection<OwnerConsent>(ctx, "owner_consents");

const idOf = (owner: string, projectId: string) => `${owner.toLowerCase()}:${projectId}`;

export async function grantConsent(ctx: AppContext, owner: string, projectId: string): Promise<OwnerConsent> {
  const project = await getProject(ctx, projectId);
  if (!project) throw new LykiaHttpError("NOT_FOUND", 404, "No such project.");
  const who = owner.toLowerCase();
  const existing = await consents(ctx).get(idOf(who, projectId));
  if (existing) return existing.value;
  if ((await listConsents(ctx, who)).length >= MAX_CONSENTS) throw new LykiaHttpError("LIMIT_REACHED", 409, `At most ${MAX_CONSENTS} projects can act for one owner; revoke one first.`);
  const record: OwnerConsent = { owner: who, projectId, developer: project.owner.toLowerCase(), projectName: project.name, grantedAt: new Date(ctx.clock.now()).toISOString() };
  await consents(ctx).put(idOf(who, projectId), record);
  return record;
}

export async function revokeConsent(ctx: AppContext, owner: string, projectId: string): Promise<boolean> {
  return consents(ctx).delete(idOf(owner, projectId));
}

export async function listConsents(ctx: AppContext, owner: string): Promise<OwnerConsent[]> {
  return (await consents(ctx).list({ prefix: `${owner.toLowerCase()}:`, limit: MAX_CONSENTS + 1 })).map((d) => d.value);
}

export async function hasConsent(ctx: AppContext, owner: string, projectId: string | null | undefined): Promise<boolean> {
  if (!projectId) return false;
  return (await consents(ctx).get(idOf(owner, projectId))) !== null;
}

/**
 * Whether a secret key may act for `owner`: its own owner always, anyone
 * else only through a consent granted to the key's project.
 */
export async function keyMayActFor(ctx: AppContext, key: StoredKey, owner: string): Promise<boolean> {
  if (key.kind !== "secret") return false;
  // A leash key acts inside its leash only, never for its owner in general.
  if (key.leashId) return false;
  if (key.owner.toLowerCase() === owner.toLowerCase()) return true;
  return hasConsent(ctx, owner, key.projectId);
}
