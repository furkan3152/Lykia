/** Per-project rate limits: the owner's plan by default, lowered (or, on Enterprise, raised) per project. */
import type { BillingPlan } from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "./typed.js";

export interface ProjectLimits {
  readonly perMinute: number;
  readonly perDay: number;
}

interface Stored extends Partial<ProjectLimits> {
  readonly updatedAt: string;
}

const col = (ctx: AppContext) => typedCollection<Stored>(ctx, "project_limits");

export async function projectLimits(ctx: AppContext, projectId: string, plan: BillingPlan): Promise<ProjectLimits> {
  const doc = (await col(ctx).get(projectId))?.value;
  return { perMinute: doc?.perMinute ?? plan.perMinute, perDay: doc?.perDay ?? plan.perDay };
}

/** Sets a project's limits; a value above the plan's needs the Enterprise plan. */
export async function setProjectLimits(ctx: AppContext, projectId: string, plan: BillingPlan, input: Partial<ProjectLimits>): Promise<ProjectLimits> {
  for (const [name, value, max] of [["perMinute", input.perMinute, plan.perMinute], ["perDay", input.perDay, plan.perDay]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || (value > max && plan.id !== "enterprise"))) throw new LykiaHttpError("INVALID_REQUEST", 400, `${name} must be 1 to ${max} on the ${plan.name} plan.`);
  }
  const current = (await col(ctx).get(projectId))?.value;
  await col(ctx).put(projectId, { ...(current ?? {}), ...input, updatedAt: new Date(ctx.clock.now()).toISOString() });
  return projectLimits(ctx, projectId, plan);
}
