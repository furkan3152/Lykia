/**
 * The review modal's view model (pure): what you send, what you get, the
 * steps with their venue and Arc Memo, the fees, the Fence verdict and the
 * step to sign next, from an intent graph and its outrun.
 */
import { fromBaseUnits, getProtocol, memoString, verdictTag, type IntentGraph, type IntentStep, type Outrun, type StepAmount } from "@lykia/core";

export interface Figure {
  readonly symbol: string;
  /** Decimal amount, trimmed for display ("176.22"). */
  readonly amount: string;
  /** Where it ends up when it is a position ("in Aave V4 Main Spoke"), else null. */
  readonly where: string | null;
  readonly usd: string | null;
  /** Outputs: the least the plan accepts, when it has one. */
  readonly minimum: string | null;
}

export interface ReviewStep {
  readonly id: string;
  readonly n: number;
  readonly summary: string;
  readonly kind: string;
  readonly venue: string;
  readonly status: IntentStep["status"];
  /** The Arc Memo the value-moving call carries: lykia:1:<intent>:<step>:<verdict>. */
  readonly memo: string;
  readonly fee: string | null;
  readonly why: string | null;
  readonly tx: `0x${string}` | null;
}

export type ReviewStage = "dry-run" | "denied" | "ready" | "running" | "settled" | "failed";

export interface ReviewView {
  readonly id: string;
  readonly environment: IntentGraph["environment"];
  readonly decision: "allow" | "confirm" | "deny";
  readonly signable: boolean;
  readonly reasons: readonly string[];
  readonly send: readonly Figure[];
  readonly get: readonly Figure[];
  readonly steps: readonly ReviewStep[];
  /** "1% · 0.01 USDC" per token; empty when the plan is fee-free. */
  readonly fees: readonly string[];
  readonly feeBps: number | null;
  /** Transactions the wallet will be asked to sign across the remaining steps (approvals included once prepared). */
  readonly signatures: number;
  readonly nextStepId: string | null;
  readonly stage: ReviewStage;
  readonly settledCount: number;
  readonly lastTx: `0x${string}` | null;
  readonly warnings: readonly string[];
}

/** "1234.5" -> "1,234.5"; at most 6 decimals, never scientific. */
export function displayAmount(units: string, decimals: number): string {
  const text = fromBaseUnits(units, decimals);
  const [whole, fraction = ""] = text.split(".");
  const cut = fraction.slice(0, Number(whole) >= 1 ? 4 : 6).replace(/0+$/u, "");
  return `${Number(whole).toLocaleString("en-US")}${cut ? `.${cut}` : ""}`;
}

export function venueLabel(step: Pick<IntentStep, "venue" | "route" | "kind">): string {
  if (step.route?.chosen.label) return step.route.chosen.label;
  if (step.kind === "approve") return "Exact approval";
  return getProtocol(step.venue)?.name ?? step.venue;
}

function figure(a: StepAmount, output: boolean, where: string | null): Figure {
  const [symbol] = a.symbol.split("@");
  return { symbol: symbol ?? a.symbol, amount: displayAmount(a.amount, a.decimals), where, usd: a.usd, minimum: output && a.minimum ? displayAmount(a.minimum, a.decimals) : null };
}

/** Sums figures per symbol and place (same token in two places stays two figures). */
function sum(list: readonly { readonly a: StepAmount; readonly output: boolean; readonly where: string | null }[]): Figure[] {
  const groups = new Map<string, { a: StepAmount; total: bigint; min: bigint | null; usd: number | null; where: string | null; output: boolean }>();
  for (const { a, output, where } of list) {
    const key = `${a.symbol}|${where ?? ""}`;
    const g = groups.get(key);
    const usd = a.usd === null ? null : Number(a.usd);
    if (!g) groups.set(key, { a, total: BigInt(a.amount), min: a.minimum ? BigInt(a.minimum) : null, usd, where, output });
    else {
      g.total += BigInt(a.amount);
      g.min = g.min !== null && a.minimum ? g.min + BigInt(a.minimum) : null;
      g.usd = g.usd !== null && usd !== null ? g.usd + usd : null;
    }
  }
  return [...groups.values()].map((g) => figure({ ...g.a, amount: g.total.toString(), ...(g.min !== null ? { minimum: g.min.toString() } : {}), usd: g.usd === null ? null : g.usd.toFixed(2) }, g.output, g.where));
}

export function reviewView(graph: IntentGraph, outrun: Outrun | null): ReviewView {
  const steps = graph.steps.filter((s) => s.kind !== "approve" || graph.steps.length === 1);
  const consumed = new Set(graph.steps.flatMap((s) => s.dependsOn));
  // What leaves the wallet: inputs of steps that do not wait on another step's output.
  const send = sum(steps.filter((s) => s.dependsOn.length === 0).flatMap((s) => s.inputs.map((a) => ({ a, output: false, where: null }))));
  // What you end with: outputs no later step spends.
  const get = sum(
    steps
      .filter((s) => !consumed.has(s.id))
      .flatMap((s) => s.outputs.map((a) => ({ a, output: true, where: a.symbol.includes("@") ? `in ${venueLabel(s)}` : s.kind === "transfer" ? "to the recipient" : s.kind === "bridge" ? `on ${s.settlement.kind === "cctp" ? s.settlement.destination : "the destination"}` : null }))),
  );
  const tag = verdictTag(graph.verdict.digest);
  const reviewSteps: ReviewStep[] = steps.map((s, i) => ({
    id: s.id,
    n: i + 1,
    summary: s.summary,
    kind: s.kind,
    venue: venueLabel(s),
    status: s.status,
    memo: safeMemo(graph.id, s.id, tag),
    fee: s.fee ? `${(s.fee.bps / 100).toFixed(s.fee.bps % 100 === 0 ? 0 : 2)}% · ${displayAmount(s.fee.amount, s.fee.decimals)} ${s.fee.symbol}` : null,
    why: s.route?.reason ?? null,
    tx: s.references?.[s.references.length - 1] ?? null,
  }));
  const feeTotals = new Map<string, { units: bigint; decimals: number }>();
  for (const s of graph.steps) {
    if (!s.fee) continue;
    const t = feeTotals.get(s.fee.symbol) ?? { units: 0n, decimals: s.fee.decimals };
    t.units += BigInt(s.fee.amount);
    feeTotals.set(s.fee.symbol, t);
  }
  const feeBps = graph.steps.find((s) => s.fee)?.fee?.bps ?? null;
  const fees = [...feeTotals.entries()].map(([symbol, t]) => `${displayAmount(t.units.toString(), t.decimals)} ${symbol}`);
  const waypointTurn = new Map((outrun?.waypoints ?? []).map((w) => [w.stepId, w.turn]));
  const next = graph.steps.find((s) => (waypointTurn.get(s.id) ?? (s.status === "ready" || s.status === "awaiting-signature" ? "signer" : "none")) === "signer") ?? null;
  const settledCount = graph.steps.filter((s) => s.status === "settled").length;
  const decision = graph.verdict.decision;
  const failed = graph.steps.some((s) => s.status === "failed");
  const stage: ReviewStage =
    decision === "deny" ? "denied" : !graph.verdict.signable ? "dry-run" : failed ? "failed" : settledCount === graph.steps.length && graph.steps.length > 0 ? "settled" : graph.steps.some((s) => s.status === "submitted" || s.status === "settling" || s.status === "settled") ? "running" : "ready";
  const lastTx = [...graph.steps].reverse().flatMap((s) => [...(s.references ?? [])].reverse())[0] ?? null;
  return {
    id: graph.id,
    environment: graph.environment,
    decision,
    signable: graph.verdict.signable,
    reasons: graph.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message),
    send,
    get,
    steps: reviewSteps,
    fees,
    feeBps,
    signatures: graph.steps.filter((s) => s.status !== "settled" && s.kind !== "approve").length,
    nextStepId: next?.id ?? null,
    stage,
    settledCount,
    lastTx,
    warnings: graph.warnings,
  };
}

function safeMemo(intentId: string, stepId: string, verdict: string): string {
  try {
    return memoString({ intentId, stepId, verdict });
  } catch {
    return `lykia:1:${intentId}:${stepId}`;
  }
}

/** "1%" from bps. */
export function bpsLabel(bps: number | null): string | null {
  if (bps === null) return null;
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}
