/**
 * What the preflight card shows and does, pure (tested without a DOM):
 * the most severe one or two findings first and the rest behind "N more
 * checks", the chips under them (each finding's fixes, then "Use all
 * anyway" when only warnings stand in the way, then "Cancel"), and the
 * owner's acknowledgements, kept per plan for this browser session.
 */
import { preflightGate, topFindings, type Finding, type FindingFix } from "@lykia/core";
import { create } from "zustand";
import { t } from "../../i18n";

export const SEVERITY_WORD: Readonly<Record<Finding["severity"], string>> = { block: t("route.preflightModel.canTSignYet"), warn: t("route.preflightModel.checkThis"), note: t("route.preflightModel.goodToKnow") };

export interface PreflightChip {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly fix?: FindingFix;
  readonly role: "fix" | "proceed" | "cancel";
}

/** Findings that need the owner (blocks, warnings), most severe first, then notes. */
export function preflightView(findings: readonly Finding[] | undefined, acknowledged: boolean) {
  const list = findings ?? [];
  const gate = preflightGate(list, acknowledged);
  const { shown, more } = topFindings(list, 2);
  const rest = list.filter((f) => !shown.includes(f));
  return { list, gate, shown, more, rest, needsOwner: gate.blocked || gate.needsAck.length > 0 };
}

const AMOUNT_CHECKS = new Set(["gas-reserve", "cash-floor", "obligations", "dust"]);

/** The chips under the card: the shown findings' fixes (no duplicates), then the way past a warning, then Cancel. */
export function preflightChips(findings: readonly Finding[] | undefined, options: { readonly acknowledged: boolean; readonly cancellable: boolean }): PreflightChip[] {
  const { shown, gate } = preflightView(findings, options.acknowledged);
  const seen = new Set<string>();
  const chips: PreflightChip[] = [];
  for (const f of shown) {
    for (const fix of f.fixes) {
      const key = `${fix.kind}:${fix.sentence ?? fix.path ?? fix.label}`;
      if (seen.has(key) || chips.length >= 3) continue;
      seen.add(key);
      chips.push({ key, label: fix.label, ...(fix.detail ? { detail: fix.detail } : {}), fix, role: "fix" });
    }
  }
  if (!gate.blocked && gate.needsAck.length > 0) chips.push({ key: "proceed", label: shown.some((f) => AMOUNT_CHECKS.has(f.check)) ? t("route.preflightModel.useAllAnyway") : t("route.preflightModel.goAheadAnyway"), detail: t("route.preflightModel.youReadTheWarning"), role: "proceed" });
  if (options.cancellable && (gate.blocked || gate.needsAck.length > 0)) chips.push({ key: "cancel", label: t("route.preflightModel.cancel"), role: "cancel" });
  return chips;
}

/** "3 more checks", "1 more check". */
export const moreLabel = (n: number) => t("route.preflightModel.moreChecks", { n });

/** Acknowledged plans, by intent id (this browser session only; the server keeps its own record at prepare). */
export const usePreflightAcks = create<{ readonly acked: Readonly<Record<string, true>>; ack(intentId: string): void }>((set) => ({
  acked: {},
  ack: (intentId) => set((s) => ({ acked: { ...s.acked, [intentId]: true } })),
}));
