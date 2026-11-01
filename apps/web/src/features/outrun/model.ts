/**
 * Pure helpers behind the Outrun card: verdict lines, whose turn it is,
 * Lyko's mood for a plan, and the threat count (wolves at the fence).
 */
import { lykoMood, type FenceVerdict, type IntentGraph, type LykoMood, type Outrun, type VerdictReason } from "@lykia/core";

export interface VerdictLine {
  readonly rule: string;
  readonly decision: "allow" | "confirm" | "deny";
  readonly message: string;
  readonly step: string | null;
  readonly waived: boolean;
}

/** Deny first, then confirm, then allow; waived lines last. */
export function verdictLines(verdict: FenceVerdict): VerdictLine[] {
  const rank = { deny: 0, confirm: 1, allow: 2 } as const;
  const map = (r: VerdictReason, waived: boolean): VerdictLine => ({ rule: r.rule, decision: r.decision, message: r.message, step: r.step ?? null, waived });
  return [...verdict.reasons.map((r) => map(r, false)).sort((a, b) => rank[a.decision] - rank[b.decision]), ...verdict.waived.map((r) => map(r, true))];
}

const THREAT_RULES = new Set(["scent", "tokens.unlisted", "recipients"]);

/** Wolves at the fence: denials that come from tokens or strangers. */
export function threatCount(verdict: FenceVerdict | null | undefined): number {
  if (!verdict) return 0;
  return verdict.reasons.filter((r) => r.decision === "deny" && THREAT_RULES.has(r.rule)).length;
}

export function runningSteps(graph: IntentGraph | null | undefined): number {
  if (!graph) return 0;
  return graph.steps.filter((s) => s.status === "awaiting-signature" || s.status === "submitted" || s.status === "settling").length;
}

export function moodFor(input: { readonly whistle: boolean; readonly graph: IntentGraph | null; readonly outrun: Outrun | null; readonly idleMinutes?: number }): LykoMood {
  return lykoMood({
    whistle: input.whistle,
    threats: threatCount(input.graph?.verdict),
    running: runningSteps(input.graph) + (input.outrun && input.outrun.status === "running" ? 1 : 0),
    settledJustNow: input.outrun?.status === "settled",
    idleMinutes: input.idleMinutes ?? 0,
  });
}

/** The next step a signer can act on (ready or awaiting signature), in outrun order. */
export function nextActionable(outrun: Outrun | null): string | null {
  if (!outrun) return null;
  const w = outrun.waypoints.find((p) => p.turn === "signer");
  return w ? w.stepId : null;
}

export function decisionLabel(decision: "allow" | "confirm" | "deny", lang: "en" | "tr"): string {
  if (lang === "tr") return decision === "allow" ? "İZİN" : decision === "confirm" ? "ONAY" : "RET";
  return decision.toUpperCase();
}

export const STATUS_TR: Readonly<Record<string, string>> = {
  blocked: "bekliyor",
  ready: "hazır",
  "awaiting-signature": "imza bekliyor",
  submitted: "gönderildi",
  settling: "yerleşiyor",
  settled: "kesin",
  failed: "başarısız",
  stopped: "durduruldu",
};
