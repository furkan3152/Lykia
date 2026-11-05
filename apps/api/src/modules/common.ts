/** Shared request schemas and helpers for the modules. */
import { validateActions, validateFence, type ArcEnvironment, type Fence, type PlanAction } from "@lykia/core";
import type { Request } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { keyOf } from "../platform/gate.js";
import { currentEnvironmentLock, testKeyMainnetError } from "../platform/requestState.js";
import { sessionOf } from "../platform/session.js";

export const environmentSchema = z.enum(["mainnet", "testnet"]);

export const environmentQuery = z.object({ environment: environmentSchema.optional() });

export function environmentOf(ctx: AppContext, value: ArcEnvironment | undefined): ArcEnvironment {
  // A test key locks the request to testnet: no explicit mainnet, and testnet is the default.
  if (currentEnvironmentLock() === "testnet") {
    if (value === "mainnet") throw testKeyMainnetError();
    return "testnet";
  }
  return value ?? ctx.config.mode;
}

/** A Fence from a request body, validated by core (400 INVALID_FENCE with the issues). */
export function fenceFrom(value: unknown): Fence | undefined {
  if (value === undefined || value === null) return undefined;
  const result = validateFence(value);
  if (!result.ok) throw new LykiaHttpError("INVALID_FENCE", 400, "The Fence document is invalid.", { issues: result.issues.slice(0, 20) });
  return result.fence;
}

export function actionsFrom(value: unknown): PlanAction[] {
  const issues = validateActions(value);
  if (issues.length > 0) throw new LykiaHttpError("INVALID_ACTIONS", 400, "The plan actions are invalid.", { issues: issues.slice(0, 20) });
  return value as PlanAction[];
}

/** Public base URL of this API as the client reached it (for card URIs). */
export function publicBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

/* ------------------------------------------------- owner authorization */

/**
 * The owner a request may act for: the signed-in owner, or any owner for a
 * secret key (server to server). By default the key also needs the agents
 * scope; `secretKey: "route"` accepts any secret key the gate let through for
 * the route's own scope (standing orders, where keys hold `automation`).
 */
export async function authorizeOwner(ctx: AppContext, req: Request, owner: string, secretKey: "agents" | "route" = "agents"): Promise<void> {
  const session = await sessionOf(ctx, req);
  if (session && session.address === owner.toLowerCase()) return;
  const key = keyOf(req);
  if (key && key.kind === "secret" && (secretKey === "route" || key.scopes.includes("agents"))) return;
  throw new LykiaHttpError(session ? "FORBIDDEN" : "UNAUTHORIZED", session ? 403 : 401, session ? "This session belongs to another address." : "Sign in as the owner (Lykia-Session) or use a secret API key with the agents scope.");
}

/**
 * Whether this request proved control of `owner`, and who acts for it: a SIWE
 * session for that address, or a secret key with the agents scope (the same
 * rule as authorizeOwner). A bare `owner` in a body proves nothing.
 */
export async function ownerProof(ctx: AppContext, req: Request, owner: string | null): Promise<{ readonly developer: string; readonly via: "session" | "secret" } | null> {
  if (!owner) return null;
  const session = await sessionOf(ctx, req);
  if (session && session.address.toLowerCase() === owner.toLowerCase()) return { developer: owner.toLowerCase(), via: "session" };
  const key = keyOf(req);
  if (key && key.kind === "secret" && key.scopes.includes("agents")) return { developer: key.owner.toLowerCase(), via: "secret" };
  return null;
}
