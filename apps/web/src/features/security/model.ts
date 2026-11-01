/** Pure view helpers for the security layer (node-testable: no React, no wallet). */
import type { FindingSeverity, SecurityDecision, SecurityFinding, SecurityReport } from "@lykia/core/security/index";

export type Tone = "ok" | "bad" | "ochre" | "sea" | "ghost";

export function decisionTone(decision: SecurityDecision): Tone {
  return decision === "block" ? "bad" : decision === "warn" ? "ochre" : "ok";
}

export function decisionLabel(decision: SecurityDecision): string {
  return decision === "block" ? "BLOCKED" : decision === "warn" ? "CHECK FIRST" : "CLEAN";
}

export function severityTone(severity: FindingSeverity): Tone {
  return severity === "block" ? "bad" : severity === "warn" ? "ochre" : "ghost";
}

export function stateTone(state: string): Tone {
  return state === "blocked" || state === "alert" ? "bad" : state === "degraded" ? "ochre" : state === "healthy" || state === "active" ? "ok" : "ghost";
}

/** Findings worth showing next to a step: blocks first, then warnings; info stays in the details. */
export function visibleFindings(findings: readonly SecurityFinding[]): SecurityFinding[] {
  const rank = { block: 0, warn: 1, info: 2 } as const;
  return findings.filter((f) => f.severity !== "info").sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Base units to a short decimal string. */
export function units(amount: string, decimals: number): string {
  const v = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/u, "").slice(0, 6);
  return frac ? `${whole}.${frac}` : whole.toString();
}

const DECIMALS: Readonly<Record<string, number>> = { USDC: 6, EURC: 6, cirBTC: 8, WETH: 18, USYC: 6 };

/** One line per balance change: "-20.2 USDC". */
export function balanceLines(report: Pick<SecurityReport, "summary">): string[] {
  return report.summary.balanceChanges.map((b) => {
    const d = (b.symbol ? DECIMALS[b.symbol] : undefined) ?? 18;
    const out = `-${units(b.out, d)} ${b.symbol ?? short(b.token)}`;
    return b.in ? `${out} · +${units(b.in, d)} back` : out;
  });
}

export function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** The security report a SECURITY_BLOCKED error carries, if any. */
export function reportFromError(error: unknown): SecurityReport | null {
  const e = error as { code?: string; details?: { security?: SecurityReport } | null };
  return e?.code === "SECURITY_BLOCKED" && e.details?.security ? e.details.security : null;
}
