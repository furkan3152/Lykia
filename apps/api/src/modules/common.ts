/** Shared request schemas and helpers for the modules. */
import { evaluateFence, fenceForProfile, validateActions, validateFence, type Address, type ArcEnvironment, type Fence, type FenceFacts, type FenceVerdict, type PlanAction } from "@lykia/core";
import type { Request } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { keyMayActFor } from "../platform/consent.js";
import { keyOf } from "../platform/gate.js";
import type { StoredKey } from "../platform/keys.js";
import { currentEnvironmentLock, testKeyMainnetError } from "../platform/requestState.js";
import { sessionOf } from "../platform/session.js";
import { getProfile } from "../personal/profile.js";
import { services } from "../services.js";

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
 * Whether the request's secret key may act for `owner`: the key's own
 * developer always; any other owner only when that owner granted the key's
 * project consent from their own session (POST /v1/consents). By default the
 * key also needs the agents scope; `secretKey: "route"` accepts any secret
 * key the gate let through for the route's own scope (standing orders, where
 * keys hold `automation`).
 */
async function keyActsFor(ctx: AppContext, req: Request, owner: string, secretKey: "agents" | "route"): Promise<StoredKey | null> {
  const key = keyOf(req);
  if (!key || key.kind !== "secret") return null;
  if (secretKey === "agents" && !key.scopes.includes("agents")) return null;
  return (await keyMayActFor(ctx, key, owner)) ? key : null;
}

/**
 * The owner a request may act for: the signed-in owner, or a secret key
 * acting for its own developer or for an owner who consented to the key's
 * project. Anything else is 401 / 403.
 */
export async function authorizeOwner(ctx: AppContext, req: Request, owner: string, secretKey: "agents" | "route" = "agents"): Promise<void> {
  const session = await sessionOf(ctx, req);
  if (session && session.address === owner.toLowerCase()) return;
  if (await keyActsFor(ctx, req, owner, secretKey)) return;
  const key = keyOf(req);
  if (key && key.kind === "secret") throw new LykiaHttpError("FORBIDDEN", 403, "This key may act only for its own developer, or for an owner who granted its project consent (POST /v1/consents from the owner's session).");
  throw new LykiaHttpError(session ? "FORBIDDEN" : "UNAUTHORIZED", session ? 403 : 401, session ? "This session belongs to another address." : "Sign in as the owner (Lykia-Session) or use a secret API key with the agents scope that may act for this owner.");
}

/**
 * Whether this request proved control of `owner`, and who acts for it: a SIWE
 * session for that address, or a secret key with the agents scope that may
 * act for it (the same rule as authorizeOwner). A bare `owner` in a body
 * proves nothing.
 */
export async function ownerProof(ctx: AppContext, req: Request, owner: string | null): Promise<{ readonly developer: string; readonly via: "session" | "secret"; readonly projectId?: string } | null> {
  if (!owner) return null;
  const session = await sessionOf(ctx, req);
  if (session && session.address.toLowerCase() === owner.toLowerCase()) return { developer: owner.toLowerCase(), via: "session" };
  const key = await keyActsFor(ctx, req, owner, "agents");
  if (key) return { developer: key.owner.toLowerCase(), via: "secret", ...(key.projectId ? { projectId: key.projectId } : {}) };
  return null;
}

/* ------------------------------------------------- value-moving routes */

/**
 * The Fence and the mainnet beta cap for a value-moving route that does not
 * go through the planner (CCTP forward, Gateway transfers, StableFX trades,
 * USYC, LykiaOrders). The request's Fence wins; without one the owner's
 * profile shapes the default (used only when the request proved the owner,
 * see personal/guard.ts). Spend so far counts toward the daily caps.
 */
export async function valueVerdict(ctx: AppContext, input: { readonly environment: ArcEnvironment; readonly owner: Address; readonly fence?: unknown; readonly signer?: "wallet" | "agent"; readonly steps: FenceFacts["steps"] }): Promise<FenceVerdict> {
  const fence = fenceFrom(input.fence) ?? fenceForProfile(await getProfile(ctx, input.owner));
  return evaluateFence(
    fence,
    { environment: input.environment, signer: input.signer ?? "wallet", owner: input.owner, steps: input.steps, spent: await services(ctx).intents.spent(input.environment, input.owner), now: ctx.clock.now() },
    ctx.config.beta ? { beta: ctx.config.beta } : {},
  );
}

/** 422 FENCE_DENIED (with the verdict) unless the verdict lets the owner sign. */
export function assertSignable(verdict: FenceVerdict): void {
  if (verdict.signable) return;
  throw new LykiaHttpError("FENCE_DENIED", 422, verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message).join(" ") || "The Fence refused this move.", { verdict: { decision: verdict.decision, digest: verdict.digest, reasons: verdict.reasons } });
}

/** Valuation of a registry token amount in USD (USDC is 1; others from the price feeds); null when unpriced. */
export async function usdOf(ctx: AppContext, symbol: string, amount: string): Promise<string | null> {
  if (symbol === "USDC") return amount;
  const quote = (await services(ctx).prices.prices([symbol]).catch(() => ({}) as Record<string, { usd: string | null }>))[symbol];
  if (!quote?.usd) return null;
  return (Number(amount) * Number(quote.usd)).toFixed(6);
}
