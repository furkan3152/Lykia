/**
 * Autopilot records.
 *
 *   autopilots          <environment>:<owner> -> Autopilot (one per owner per network)
 *   autopilot_signers   <environment>:<owner> -> the owner's Circle wallet (kept across turning it off and on)
 *   autopilot_runs      <environment>:<owner>:<inverted ms>:<rand> -> AutopilotRun (newest first)
 *   autopilot_spend     counters: <environment>:<owner>:<UTC day>, USD micro-dollars signed that day
 */
import type { Address, ArcEnvironment, AutopilotSigner } from "@lykia/core";
import type { Autopilot, AutopilotRun } from "@lykia/core/api/autopilot";
import type { AppContext } from "../context.js";
import { typedCollection } from "../platform/typed.js";

export const AUTOPILOT_TTL_MS = 400 * 86_400_000;

export const autopilots = (ctx: AppContext) => typedCollection<Autopilot>(ctx, "autopilots");
export const autopilotSigners = (ctx: AppContext) => typedCollection<AutopilotSigner & { readonly owner: Address; readonly environment: ArcEnvironment; readonly createdAt: string }>(ctx, "autopilot_signers");
export const autopilotRuns = (ctx: AppContext) => typedCollection<AutopilotRun>(ctx, "autopilot_runs");
export const autopilotSpend = (ctx: AppContext) => ctx.store.counters("autopilot_spend");

export const keyOf = (environment: ArcEnvironment, owner: string) => `${environment}:${owner.toLowerCase()}`;
