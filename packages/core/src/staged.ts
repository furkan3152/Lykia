/**
 * Staged plans: one plan, signed stage by stage. Steps that share a stage
 * go out together (one Multicall3From batch from an EOA); a new stage
 * starts where a step spends what the step before delivered, so it is
 * rebuilt from the receipt before it is signed. Derived from the intent
 * graph alone, so a reload resumes at the right stage.
 */
import { fromBaseUnits } from "./amounts.js";
import type { IntentGraph, IntentStep } from "./intent.js";

export type StageState = "done" | "active" | "settling" | "paused" | "next" | "stopped";

export interface PlanStage {
  /** 1-based position among the stages. */
  readonly n: number;
  readonly stepIds: readonly string[];
  /** The first step's summary, plus "and N more" when the stage batches steps. */
  readonly summary: string;
  readonly venue: string;
  readonly state: StageState;
  /** "442.61 EURC" once a settled stage's receipt was read. */
  readonly received: string | null;
  /** "Re-planned with the 442.61 EURC step 1 delivered (planned 440.4)" when the step was rebuilt. */
  readonly replanned: string | null;
  /** Why the stage paused, in plain words. */
  readonly reason: string | null;
  readonly retryable: boolean;
}

export interface StagedPlan {
  readonly total: number;
  readonly stages: readonly PlanStage[];
  /** The stage to sign (or settling, or paused); null when every stage is done or stopped. */
  readonly current: PlanStage | null;
  readonly done: boolean;
  readonly paused: boolean;
  readonly stopped: boolean;
  /** "Step 1 of 2: Swap 500 USDC to EURC on Uniswap v4", "Done: 2 of 2 settled", "Paused at step 2 of 2". */
  readonly headline: string;
}

const amountText = (a: { readonly amount: string; readonly decimals: number; readonly symbol: string }) => `${fromBaseUnits(a.amount, a.decimals)} ${a.symbol}`;

/** Groups the steps by stage, in order; a graph without stage numbers stages every step on its own. */
export function stageGroups(steps: readonly IntentStep[]): IntentStep[][] {
  const groups: IntentStep[][] = [];
  let key: number | null = null;
  for (const step of steps) {
    const stage = step.stage ?? null;
    const last = groups[groups.length - 1];
    if (last && stage !== null && stage === key) last.push(step);
    else groups.push([step]);
    key = stage;
  }
  return groups;
}

function stateOf(group: readonly IntentStep[]): { state: StageState; reason: string | null; retryable: boolean } {
  if (group.every((s) => s.status === "settled")) return { state: "done", reason: null, retryable: false };
  if (group.some((s) => s.status === "stopped") && !group.some((s) => s.status === "submitted" || s.status === "settling")) return { state: "stopped", reason: null, retryable: false };
  const failed = group.find((s) => s.status === "failed" || ((s.status === "ready" || s.status === "awaiting-signature") && s.failure));
  if (failed) return { state: "paused", reason: failed.failure?.message ?? "This step did not go through.", retryable: failed.failure?.retryable !== false || failed.status === "failed" };
  if (group.some((s) => s.status === "submitted" || s.status === "settling")) return { state: "settling", reason: null, retryable: false };
  if (group.some((s) => s.status === "ready" || s.status === "awaiting-signature")) return { state: "active", reason: null, retryable: false };
  return { state: "next", reason: null, retryable: false };
}

export function planStages(graph: Pick<IntentGraph, "steps">): StagedPlan {
  const groups = stageGroups(graph.steps ?? []);
  const total = groups.length;
  const stages: PlanStage[] = groups.map((group, i) => {
    const lead = group[0]!;
    const { state, reason, retryable } = stateOf(group);
    const last = group[group.length - 1]!;
    const replanned = group.find((s) => s.replanned)?.replanned;
    const decimals = lead.inputs[0]?.decimals ?? 6;
    return {
      n: i + 1,
      stepIds: group.map((s) => s.id),
      summary: group.length > 1 ? `${lead.summary}, and ${group.length - 1} more in the same transaction` : lead.summary,
      venue: lead.venue,
      state,
      received: state === "done" && last.received ? amountText(last.received) : null,
      replanned: replanned ? `Re-planned with the ${fromBaseUnits(replanned.actual, decimals)} ${replanned.symbol} step ${i} delivered (planned ${fromBaseUnits(replanned.planned, decimals)})` : null,
      reason,
      retryable,
    };
  });
  const current = stages.find((s) => s.state !== "done" && s.state !== "stopped") ?? null;
  const done = total > 0 && stages.every((s) => s.state === "done");
  const stopped = !done && current === null && stages.some((s) => s.state === "stopped");
  const settled = stages.filter((s) => s.state === "done").length;
  const headline = done
    ? `Done: ${total} of ${total} settled`
    : stopped
      ? `Stopped after ${settled} of ${total}`
      : current?.state === "paused"
        ? `Paused at step ${current.n} of ${total}`
        : current
          ? `Step ${current.n} of ${total}: ${current.summary}`
          : "Nothing to sign";
  // Stages after the current one wait; a stage before it that is not done can only be stopped.
  const view = stages.map((s) => (current && s.n > current.n && s.state === "active" ? { ...s, state: "next" as const } : s));
  return { total, stages: view, current: current ? view[current.n - 1]! : null, done, paused: current?.state === "paused", stopped, headline };
}
