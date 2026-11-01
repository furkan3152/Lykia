/** Shared request schemas and helpers for the modules. */
import { validateActions, validateFence, type ArcEnvironment, type Fence, type PlanAction } from "@lykia/core";
import type { Request } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { currentEnvironmentLock, testKeyMainnetError } from "../platform/requestState.js";

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
