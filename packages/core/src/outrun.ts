/**
 * The Outrun: "where is my money" for one intent, derived from the graph
 * alone. A sheepdog's outrun is the wide arc it runs to reach the flock;
 * here it is the path from where the value starts to the Fold, where it
 * ends up. Waypoints carry Lycian Way names for the UI (lore.ts).
 */
import { fromBaseUnits } from "./amounts.js";
import type { IntentGraph, IntentStep, StepStatus } from "./intent.js";
import { deriveIntentStatus, type IntentStatus } from "./intent.js";
import { topologicalOrder } from "./lifecycle.js";
import { waypointName } from "./lore.js";
import { explorerTx, networkFor } from "./networks.js";

export interface OutrunWaypoint {
  readonly stepId: string;
  readonly name: string;
  readonly kind: IntentStep["kind"];
  readonly venue: string;
  readonly summary: string;
  readonly status: StepStatus;
  /** "100 USDC" style strings. */
  readonly gives: readonly string[];
  readonly gets: readonly string[];
  readonly explorer: readonly string[];
  /** Whose move it is: the wallet/agent signs, the network settles, or nothing to do. */
  readonly turn: "signer" | "network" | "none";
  readonly leavesArc: string | null;
}

export interface Outrun {
  readonly intentId: string;
  readonly status: IntentStatus;
  readonly waypoints: readonly OutrunWaypoint[];
  /** Index of the first waypoint that is not settled, or null when all are. */
  readonly current: number | null;
  /** What the owner holds at the end, summed per symbol from final outputs. */
  readonly fold: readonly string[];
  /** 0..1 along the arc, for the drawing. */
  readonly progress: number;
  readonly verdictDigest: string;
}

function amountText(amount: { readonly amount: string; readonly decimals: number; readonly symbol: string }): string {
  return `${fromBaseUnits(amount.amount, amount.decimals)} ${amount.symbol}`;
}

function turnOf(status: StepStatus): OutrunWaypoint["turn"] {
  if (status === "ready" || status === "awaiting-signature") return "signer";
  if (status === "submitted" || status === "settling") return "network";
  return "none";
}

export function outrunOf(graph: IntentGraph): Outrun {
  const network = networkFor(graph.environment);
  const order = topologicalOrder(graph.steps);
  const byId = new Map(graph.steps.map((s) => [s.id, s]));
  const steps = order.map((id) => byId.get(id) as IntentStep);
  const waypoints = steps.map((step, index): OutrunWaypoint => ({
    stepId: step.id,
    name: waypointName(index),
    kind: step.kind,
    venue: step.venue,
    summary: step.summary,
    status: step.status,
    gives: step.inputs.map(amountText),
    gets: step.outputs.map(amountText),
    explorer: (step.references ?? []).map((hash) => explorerTx(network, hash)),
    turn: turnOf(step.status),
    leavesArc: step.settlement.kind === "receipt" ? null : step.settlement.destination,
  }));
  const currentIndex = waypoints.findIndex((w) => w.status !== "settled");
  // The fold: everything the plan produces, minus what later steps spend again (per symbol, in order).
  const totals = new Map<string, { amount: bigint; decimals: number }>();
  for (const step of steps) {
    if (step.kind === "approve") continue;
    for (const input of step.inputs) {
      const prev = totals.get(input.symbol);
      if (prev) prev.amount = prev.amount > BigInt(input.amount) ? prev.amount - BigInt(input.amount) : 0n;
    }
    for (const out of step.outputs) {
      const prev = totals.get(out.symbol);
      totals.set(out.symbol, { amount: (prev?.amount ?? 0n) + BigInt(out.amount), decimals: out.decimals });
    }
  }
  for (const [symbol, t] of totals) if (t.amount === 0n) totals.delete(symbol);
  const settled = waypoints.filter((w) => w.status === "settled").length;
  return {
    intentId: graph.id,
    status: deriveIntentStatus(graph),
    waypoints,
    current: currentIndex < 0 ? null : currentIndex,
    fold: [...totals.entries()].map(([symbol, t]) => `${fromBaseUnits(t.amount, t.decimals)} ${symbol}`),
    progress: waypoints.length === 0 ? 0 : settled / waypoints.length,
    verdictDigest: graph.verdict.digest,
  };
}
