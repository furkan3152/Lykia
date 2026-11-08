/**
 * The route artifact's view model (pure): what the panel and the outrun
 * page draw from an intent graph and its outrun.
 */
import { fromBaseUnits, type IntentGraph, type Outrun, type RouteChoice, type VerdictReason } from "@lykia/core";

import { memoryBadges } from "../ask/memoryRefs";

export interface StopView {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly venue: string;
  readonly summary: string;
  readonly status: string;
  readonly turn: "signer" | "network" | "none";
  readonly explorer: readonly string[];
  readonly route: RouteChoice | null;
  readonly leavesArc: string | null;
  /** Parts resolved from Lyko's memory (contacts, "again"). */
  readonly memory: readonly string[];
  /** "Lykia fee 1% · 2 USDC", or null on fee-free steps. */
  readonly fee: string | null;
  /** The token route options' amounts are counted in (base units), for display. */
  readonly out: { readonly symbol: string; readonly decimals: number } | null;
}

export interface ArtifactView {
  readonly id: string;
  readonly decision: "allow" | "confirm" | "deny";
  readonly signable: boolean;
  readonly reasons: readonly VerdictReason[];
  readonly waived: readonly VerdictReason[];
  readonly stops: readonly StopView[];
  readonly fold: readonly string[];
  /** Lykia fees across the plan, per token. */
  readonly fees: readonly string[];
  readonly settled: number;
  readonly ferry: boolean;
  readonly progress: number;
  readonly warnings: readonly string[];
  readonly next: string | null;
  readonly fenceHash: string;
}

export function artifactView(graph: IntentGraph, outrun: Outrun): ArtifactView {
  const byId = new Map((graph.steps ?? []).map((s) => [s.id, s]));
  const stops: StopView[] = (outrun.waypoints ?? []).map((w) => ({
    id: w.stepId,
    name: w.name,
    kind: w.kind,
    venue: w.venue,
    summary: w.summary,
    status: w.status,
    turn: w.turn,
    explorer: w.explorer ?? [],
    route: byId.get(w.stepId)?.route ?? null,
    leavesArc: w.leavesArc,
    memory: memoryBadges(byId.get(w.stepId)),
    fee: w.fee ?? null,
    out: ((o) => (o ? { symbol: o.symbol.split("@")[0] ?? o.symbol, decimals: o.decimals } : null))(byId.get(w.stepId)?.outputs[0]),
  }));
  const next = stops.find((s) => s.turn === "signer")?.id ?? null;
  return {
    id: graph.id,
    decision: graph.verdict.decision,
    signable: graph.verdict.signable,
    reasons: graph.verdict.reasons ?? [],
    waived: graph.verdict.waived ?? [],
    stops,
    fold: outrun.fold ?? [],
    fees: outrun.fees ?? [],
    settled: stops.filter((s) => s.status === "settled").length,
    ferry: stops.some((s) => s.leavesArc !== null),
    progress: outrun.progress,
    warnings: graph.warnings ?? [],
    next,
    fenceHash: graph.verdict.fenceHash,
  };
}

/** A route option's output in whole tokens ("98.986265 USDC"), or the raw figure when its token is unknown. */
export function optionOut(units: string | undefined, out: StopView["out"]): string {
  if (!units) return "—";
  if (!out || !/^\d+$/u.test(units)) return units;
  return `${fromBaseUnits(units, out.decimals)} ${out.symbol}`;
}

/** "6.12%" for a decimal-fraction APY string, "n/a" otherwise. */
export function pct(apy: string | null | undefined): string {
  if (apy === null || apy === undefined || !Number.isFinite(Number(apy))) return "n/a";
  return `${(Number(apy) * 100).toFixed(2)}%`;
}
