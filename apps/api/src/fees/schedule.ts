/**
 * Fee schedule resolution for API customers. The base fee and the per-kind
 * schedule come from the config (LYKIA_FEE_BPS, LYKIA_FEE_SCHEDULE); a plan
 * may override kinds (LYKIA_FEE_SCHEDULE_PLANS, e.g. {"scale":{"transfer":0}}).
 * With nothing set every fee-bearing kind pays the base fee, exactly as before.
 *
 * Hook for billing: resolve the caller's plan, then hand the result to the
 * planner as its FeePolicy (`{ bps, recipient, schedule }`).
 */
import { feeBpsFor, type FeePolicy, type FeeSchedule, type StepKind } from "@lykia/core";
import type { Config } from "../config.js";

/** The schedule in force for a plan: the plan's overrides layered over the global schedule. */
export function scheduleForPlan(fee: Config["fee"], plan?: string | null): FeeSchedule | null {
  const override = plan ? fee.plans?.[plan] : undefined;
  if (!override) return fee.schedule ?? null;
  return Object.freeze({ ...(fee.schedule ?? {}), ...override });
}

/** The FeePolicy a planner should use for a caller on `plan`. */
export function feePolicyForPlan(fee: Config["fee"], plan?: string | null): FeePolicy {
  return { bps: fee.bps, recipient: fee.recipient, schedule: scheduleForPlan(fee, plan) };
}

/** Basis points for one kind on one plan. */
export function bpsForPlan(fee: Config["fee"], kind: StepKind, plan?: string | null): number {
  return feeBpsFor(kind, fee.bps, scheduleForPlan(fee, plan));
}
