/**
 * "Lyko at work" (pure): the steps of a turn as the trail draws them, the
 * summary it collapses into, and the avatar's state. Steps come from the
 * server's `step` events; for older streams (or a thread read back) the
 * legacy reading / task / tool events are shown the same way. Nothing here
 * invents a step: every tessera is one event the server sent.
 */
import type { ChatStep, ChatStepKind } from "@lykia/core/api/agents";

import type { ChatMessage, TrailItem } from "./model";
import { t } from "../../i18n";

function guessKind(label: string): ChatStepKind {
  const l = label.toLowerCase();
  if (/flock|wallet|balance/u.test(l)) return "wallet";
  if (/memory/u.test(l)) return "memory";
  if (/plan_intent|search_routes|route/u.test(l)) return "route";
  if (/fence/u.test(l)) return "fence";
  if (/price/u.test(l)) return "price";
  if (/scent/u.test(l)) return "scent";
  if (/compile/u.test(l)) return "compile";
  if (/alert|automation|order/u.test(l)) return "draft";
  if (/: /u.test(l)) return "delegate";
  return "read";
}

function fromLegacy(items: readonly TrailItem[]): ChatStep[] {
  return items.map((t, i) => ({ id: `legacy${i}`, kind: guessKind(t.label), label: t.label.replace(/_/gu, " "), state: t.ok ? "ok" : "fail", ...(t.detail ? { detail: t.detail } : {}) }));
}

/** The steps to draw: the server's own, or the legacy events read as steps. */
export function trailSteps(m: Pick<ChatMessage, "steps" | "trail">): readonly ChatStep[] {
  return m.steps && m.steps.length > 0 ? m.steps : fromLegacy(m.trail);
}

/** "1.8s", "640ms", "12s". */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

/** The collapsed trail: "Checked 4 things · 1 flag" (no timings: the steps say what was checked). */
export function trailSummary(steps: readonly ChatStep[]): string {
  const n = steps.length;
  const flags = steps.filter((s) => s.state === "warn" || s.state === "fail").length;
  const parts = [t("ask.workTrail.checkedThings", { n })];
  if (flags > 0) parts.push(t("ask.workTrail.flags", { n: flags }));
  return parts.join(" · ");
}

export type AvatarState = "sniffing" | "found" | "warning" | "done";

/** Lyko's small states: sniffing while he works, found when a step lands, warning when something needs you, done. */
export function avatarState(m: Pick<ChatMessage, "streaming" | "error" | "steps" | "trail" | "proposals" | "blocks">): AvatarState {
  const steps = trailSteps(m);
  const flagged = Boolean(m.error) || steps.some((s) => s.state === "fail") || m.proposals.some((p) => p.decision === "deny") || (m.blocks ?? []).some((b) => b.kind === "fence" && b.decision === "deny");
  if (m.streaming) {
    const last = steps[steps.length - 1];
    if (!last || last.state === "running") return "sniffing";
    return last.state === "ok" ? "found" : "warning";
  }
  if (flagged || steps.some((s) => s.state === "warn") || (m.blocks ?? []).some((b) => b.kind === "gas" && Number(b.balance) < Number(b.floor))) return "warning";
  return "done";
}

/** The elapsed time of a finished turn, when both ends were seen. */
export function elapsedOf(m: Pick<ChatMessage, "startedAt" | "endedAt">): number | undefined {
  return m.startedAt !== undefined && m.endedAt !== undefined && m.endedAt >= m.startedAt ? m.endedAt - m.startedAt : undefined;
}
