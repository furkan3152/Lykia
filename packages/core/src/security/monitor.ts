/**
 * Layer 4, the agent safety monitor. Pure rules over a subject's recent
 * activity (an agent, a keeper-run standing order, or an owner): velocity
 * limits that block, and anomalies that raise the Auto-Whistle.
 */
import { sameAddress, type Address } from "../contracts.js";
import type { SecurityFinding } from "./types.js";

export interface ActivityEvent {
  /** Epoch ms. */
  readonly at: number;
  readonly kind: "prepare" | "submit" | "failed";
  readonly usd: number | null;
  readonly venue: string | null;
  readonly recipient: Address | null;
}

export interface MonitorPolicy {
  readonly txPerMinute: number;
  readonly usdPerHour: number;
  /** Spend above this many times the rolling average is an anomaly. */
  readonly spikeMultiple: number;
  readonly newRecipientBurst: number;
  readonly failureBurst: number;
  /** What the Auto-Whistle does on an anomaly: only flag, or pause keeper-run sessions too. */
  readonly onAnomaly: "flag" | "pause";
  /** Hours (0-23, UTC) when the subject is expected to act; empty = any time. */
  readonly activeHoursUtc: readonly number[];
}

export const DEFAULT_MONITOR_POLICY: MonitorPolicy = Object.freeze({ txPerMinute: 6, usdPerHour: 5_000, spikeMultiple: 5, newRecipientBurst: 3, failureBurst: 3, onAnomaly: "flag", activeHoursUtc: [] });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface PendingMove {
  readonly at: number;
  readonly usd: number | null;
  readonly venue: string | null;
  readonly recipient: Address | null;
}

export function monitorFindings(history: readonly ActivityEvent[], next: PendingMove, policy: MonitorPolicy = DEFAULT_MONITOR_POLICY, stepId?: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const add = (rule: string, severity: SecurityFinding["severity"], message: string) => out.push({ layer: "monitor", rule: `monitor.${rule}`, severity, message, ...(stepId ? { stepId } : {}) });
  const moves = history.filter((e) => e.kind === "prepare");
  const lastMinute = moves.filter((e) => e.at > next.at - MINUTE).length;
  if (lastMinute + 1 > policy.txPerMinute) add("velocity-tx", "block", `${lastMinute + 1} moves in one minute exceeds the limit of ${policy.txPerMinute}.`);
  const hourUsd = moves.filter((e) => e.at > next.at - HOUR).reduce((s, e) => s + (e.usd ?? 0), 0) + (next.usd ?? 0);
  if (hourUsd > policy.usdPerHour) add("velocity-usd", "block", `$${hourUsd.toFixed(2)} in one hour exceeds the limit of $${policy.usdPerHour}.`);
  const priced = moves.filter((e) => e.usd !== null && e.usd > 0).map((e) => e.usd as number);
  if (next.usd !== null && priced.length >= 5) {
    const avg = priced.reduce((s, v) => s + v, 0) / priced.length;
    if (next.usd > avg * policy.spikeMultiple) add("spend-spike", "warn", `$${next.usd.toFixed(2)} is more than ${policy.spikeMultiple} times the usual $${avg.toFixed(2)}.`);
  }
  if (next.venue && moves.length >= 5 && !moves.some((e) => e.venue === next.venue)) add("unusual-venue", "warn", `${next.venue} has not been used before by this subject.`);
  if (next.recipient) {
    const seenBefore = (a: Address, before: number) => moves.some((e) => e.at < before && e.recipient !== null && sameAddress(e.recipient, a));
    const recent = moves.filter((e) => e.at > next.at - 10 * MINUTE && e.recipient !== null && !seenBefore(e.recipient, e.at));
    const fresh = new Set(recent.map((e) => (e.recipient as string).toLowerCase()));
    if (!seenBefore(next.recipient, next.at)) fresh.add(next.recipient.toLowerCase());
    if (fresh.size >= policy.newRecipientBurst) add("new-recipient-burst", "warn", `${fresh.size} new recipients within ten minutes.`);
  }
  const failures = history.filter((e) => e.kind === "failed" && e.at > next.at - 15 * MINUTE).length;
  if (failures >= policy.failureBurst) add("repeated-failures", "warn", `${failures} failed steps in fifteen minutes.`);
  if (policy.activeHoursUtc.length > 0 && !policy.activeHoursUtc.includes(new Date(next.at).getUTCHours())) add("outside-schedule", "warn", "This move is outside the subject's usual hours.");
  return out;
}

/** What the Auto-Whistle does with a set of monitor findings. */
export function whistleAction(findings: readonly SecurityFinding[], policy: MonitorPolicy, keeperRun: boolean): "none" | "flag" | "pause" {
  const monitor = findings.filter((f) => f.layer === "monitor" && f.severity !== "info");
  if (monitor.length === 0) return "none";
  return policy.onAnomaly === "pause" && keeperRun ? "pause" : "flag";
}
