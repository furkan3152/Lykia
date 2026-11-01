/**
 * Step lifecycle: the only transitions the engine may make, the DAG checks
 * and which steps may run next. Unknown outcomes are held (failed, not
 * retryable) for a human to look at; they are never retried blindly.
 */
import type { IntentGraph, IntentStep, StepStatus } from "./intent.js";

export const TRANSITIONS: Readonly<Record<StepStatus, readonly StepStatus[]>> = Object.freeze({
  blocked: ["ready", "stopped"],
  ready: ["awaiting-signature", "stopped", "failed"],
  "awaiting-signature": ["submitted", "ready", "stopped", "failed"],
  submitted: ["settling", "settled", "failed"],
  settling: ["settled", "failed"],
  settled: [],
  failed: ["ready"],
  stopped: [],
});

export function canTransition(from: StepStatus, to: StepStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(step: IntentStep, to: StepStatus): void {
  if (!canTransition(step.status, to)) throw new Error(`Step ${step.id} cannot go from ${step.status} to ${to}.`);
  step.status = to;
}

/** Steps whose dependencies are all settled, moved from blocked to ready. Returns the ids that moved. */
export function unlockSteps(graph: IntentGraph): string[] {
  const settled = new Set(graph.steps.filter((s) => s.status === "settled").map((s) => s.id));
  const moved: string[] = [];
  for (const step of graph.steps) {
    if (step.status === "blocked" && step.dependsOn.every((id) => settled.has(id))) {
      step.status = "ready";
      moved.push(step.id);
    }
  }
  return moved;
}

export function readySteps(graph: Pick<IntentGraph, "steps">): IntentStep[] {
  return graph.steps.filter((s) => s.status === "ready");
}

/** Kahn order; throws on a cycle or a dangling dependency. */
export function topologicalOrder(steps: readonly Pick<IntentStep, "id" | "dependsOn">[]): string[] {
  const ids = new Set(steps.map((s) => s.id));
  const indegree = new Map<string, number>();
  const next = new Map<string, string[]>();
  for (const step of steps) {
    indegree.set(step.id, step.dependsOn.length);
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) throw new Error(`Step ${step.id} depends on unknown step ${dep}.`);
      next.set(dep, [...(next.get(dep) ?? []), step.id]);
    }
  }
  const queue = steps.filter((s) => s.dependsOn.length === 0).map((s) => s.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const child of next.get(id) ?? []) {
      const left = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, left);
      if (left === 0) queue.push(child);
    }
  }
  if (order.length !== steps.length) throw new Error("The intent graph has a cycle.");
  return order;
}

export interface GraphIssue {
  readonly path: string;
  readonly message: string;
}

export function validateIntentGraph(graph: IntentGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const seen = new Set<string>();
  for (const step of graph.steps) {
    if (seen.has(step.id)) issues.push({ path: `steps.${step.id}`, message: "Duplicate step id." });
    seen.add(step.id);
    for (const amount of [...step.inputs, ...step.outputs]) {
      if (!/^(?:0|[1-9]\d*)$/u.test(amount.amount)) issues.push({ path: `steps.${step.id}`, message: `${amount.symbol} amount must be base units.` });
    }
  }
  try {
    topologicalOrder(graph.steps);
  } catch (error) {
    issues.push({ path: "steps", message: (error as Error).message });
  }
  return issues;
}
