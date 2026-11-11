/**
 * The review modal's stage machine (pure): which stage of a staged plan is
 * on screen and what it is doing, folded from the plan as the server sees
 * it (core planStages) and the wallet flow's phases.
 *
 *   review     the current stage's quote is shown; "Sign" signs it
 *   signing    the wallet is open
 *   settling   sent; Lykia is reading the receipt
 *   advancing  a stage just settled: the next one is rebuilt from what it
 *              delivered (the receipt), then shown for a new signature
 *   paused     a step failed or was refused: say why, offer "Retry this
 *              step" or "Stop here"; nothing later is signed
 *   done / stopped / dry-run / denied
 *
 * The plan on the server is the source of truth, so a reload lands on the
 * right stage: "graph" alone rebuilds the state.
 */
import type { StagedPlan } from "@lykia/core";
import { t } from "../../i18n";

export type StageMode = "loading" | "review" | "signing" | "settling" | "advancing" | "paused" | "done" | "stopped" | "dry-run" | "denied";

export interface StageState {
  readonly mode: StageMode;
  /** 1-based stage on screen (0 while loading). */
  readonly stage: number;
  readonly total: number;
  /** The stage that just settled and what it delivered, during "advancing" and on the next review. */
  readonly settled: { readonly n: number; readonly received: string | null } | null;
  /** "Re-planned with the 442.61 EURC step 1 delivered (planned 440.4)". */
  readonly replanned: string | null;
  readonly pause: { readonly reason: string; readonly retryable: boolean } | null;
}

export type StageEvent =
  | { readonly type: "graph"; readonly plan: StagedPlan; readonly decision: "allow" | "confirm" | "deny"; readonly signable: boolean }
  | { readonly type: "phase"; readonly phase: "quoting" | "quoted" | "switching" | "signing" | "submitting" | "submitted" | "settled" }
  | { readonly type: "failed"; readonly reason: string; readonly retryable?: boolean }
  | { readonly type: "retry" }
  | { readonly type: "stop" };

export const STAGE_START: StageState = { mode: "loading", stage: 0, total: 0, settled: null, replanned: null, pause: null };

function fromPlan(state: StageState, plan: StagedPlan, decision: "allow" | "confirm" | "deny", signable: boolean): StageState {
  const total = plan.total;
  if (decision === "deny") return { ...STAGE_START, mode: "denied", total };
  if (!signable) return { ...STAGE_START, mode: "dry-run", total, stage: 1 };
  if (plan.done) return { ...state, mode: "done", stage: total, total, pause: null };
  if (plan.stopped) return { ...state, mode: "stopped", total, pause: null };
  const current = plan.current;
  if (!current) return { ...state, mode: "done", stage: total, total };
  const replanned = current.replanned;
  if (current.state === "paused") return { ...state, mode: "paused", stage: current.n, total, replanned, pause: { reason: current.reason ?? t("route.stagedFlow.thisStepDidNotGoThrough"), retryable: current.retryable } };
  if (current.state === "settling") return { ...state, mode: "settling", stage: current.n, total, replanned, pause: null };
  // A stage that moved forward since the last view: the one before it settled.
  if (state.stage > 0 && current.n > state.stage) {
    const before = plan.stages[current.n - 2];
    return { mode: "advancing", stage: current.n, total, settled: { n: current.n - 1, received: before?.received ?? null }, replanned, pause: null };
  }
  // A client-side pause (the wallet refused) holds until the owner retries, whatever the plan says.
  if (state.mode === "paused" && state.stage === current.n) return { ...state, total, replanned };
  const keep = state.mode === "signing" || state.mode === "advancing" ? state.mode : "review";
  return { ...state, mode: keep, stage: current.n, total, replanned, pause: null };
}

export function stageReduce(state: StageState, event: StageEvent): StageState {
  switch (event.type) {
    case "graph":
      return fromPlan(state, event.plan, event.decision, event.signable);
    case "phase": {
      if (state.mode === "done" || state.mode === "stopped" || state.mode === "denied" || state.mode === "dry-run") return state;
      if (event.phase === "signing" || event.phase === "switching") return { ...state, mode: "signing", pause: null };
      if (event.phase === "submitting" || event.phase === "submitted") return { ...state, mode: "settling", pause: null };
      // The rebuilt quote of the next stage is in: back to a review, the settled stage still named above it.
      if (event.phase === "quoted") return state.mode === "paused" ? state : { ...state, mode: "review" };
      return state;
    }
    case "failed":
      return { ...state, mode: "paused", pause: { reason: event.reason, retryable: event.retryable !== false } };
    case "retry":
      return state.mode === "paused" ? { ...state, mode: "review", pause: null } : state;
    case "stop":
      return { ...state, mode: "stopped", pause: null };
  }
}

/** The modal's headline for the stage on screen. */
export function stageHeadline(state: StageState, summary: string | null): string {
  if (state.total <= 1 || state.stage === 0) return summary ?? t("route.stagedFlow.reviewAndSign");
  return summary ? t("route.stagedFlow.stepOfSummary", { stage: state.stage, total: state.total, summary }) : t("route.stagedFlow.stepOf", { stage: state.stage, total: state.total });
}
