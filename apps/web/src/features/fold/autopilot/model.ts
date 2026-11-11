/**
 * Autopilot in the Fold: pure helpers for the Autopilot card and its
 * turn-on sheet. The form and its checks, the request it sends, the plain
 * lines for status, tasks and runs, and the sample the sample flock shows.
 */
import { AUTOPILOT_ACK_LINES, AUTOPILOT_BETA, AUTOPILOT_LABEL, AUTOPILOT_TRUST, autopilotAckDigest, autopilotLimitIssues, isAddress, tx, type Address, type AutopilotEvery, type AutopilotTaskInput, type AutopilotTaskKind } from "@lykia/core";
import type { Autopilot, AutopilotRun, AutopilotView, EnableAutopilotRequest } from "@lykia/core/api/autopilot";
import { formatUsd, t } from "../../../i18n";

export interface AutopilotForm {
  readonly perStepUsd: string;
  readonly perDayUsd: string;
  readonly days: string;
  /** Comma- or line-separated payee addresses. */
  readonly payees: string;
  readonly accepted: boolean;
}

export const AUTOPILOT_PRESETS: readonly { readonly id: string; readonly label: string; readonly line: string; readonly form: Pick<AutopilotForm, "perStepUsd" | "perDayUsd" | "days"> }[] = [
  { id: "small", label: t("fold.autopilot.model.small"), line: t("fold.autopilot.model.n20AStep50ADay"), form: { perStepUsd: "20", perDayUsd: "50", days: "7" } },
  { id: "medium", label: t("fold.autopilot.model.medium"), line: t("fold.autopilot.model.n50AStep150ADay"), form: { perStepUsd: "50", perDayUsd: "150", days: "14" } },
  { id: "beta-max", label: t("fold.autopilot.model.betaMost"), line: t("fold.autopilot.model.aStepADay30Days", { perStepUsd: AUTOPILOT_BETA.perStepUsd, perDayUsd: AUTOPILOT_BETA.perDayUsd }), form: { perStepUsd: AUTOPILOT_BETA.perStepUsd, perDayUsd: AUTOPILOT_BETA.perDayUsd, days: "30" } },
];

export function emptyAutopilotForm(): AutopilotForm {
  return { ...AUTOPILOT_PRESETS[0]!.form, payees: "", accepted: false };
}

export function payeesOf(form: Pick<AutopilotForm, "payees">): string[] {
  return [...new Set(form.payees.split(/[\s,;]+/u).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

export interface FormIssue {
  readonly field: keyof AutopilotForm;
  readonly message: string;
}

/** What blocks the next step: "limits" checks the numbers and payees, "accept" also the acknowledgement. */
export function autopilotFormIssues(form: AutopilotForm, step: "limits" | "accept", ceilings: { readonly perStepUsd: string; readonly perDayUsd: string }, owner: string | null): FormIssue[] {
  const out: FormIssue[] = [];
  const days = Number(form.days);
  for (const i of autopilotLimitIssues({ perStepUsd: form.perStepUsd.trim(), perDayUsd: form.perDayUsd.trim(), days: Number.isInteger(days) ? days : NaN }, ceilings)) {
    const field = i.path.endsWith("perStepUsd") ? "perStepUsd" : i.path.endsWith("perDayUsd") ? "perDayUsd" : "days";
    if (!out.some((o) => o.field === field)) out.push({ field, message: i.message });
  }
  const payees = payeesOf(form);
  if (payees.length > 10) out.push({ field: "payees", message: t("fold.autopilot.model.atMost10Payees") });
  else if (!payees.every((p) => isAddress(p))) out.push({ field: "payees", message: t("fold.autopilot.model.addresses0xFollowedBy40Hex") });
  else if (owner && payees.some((p) => p === owner.toLowerCase())) out.push({ field: "payees", message: t("fold.autopilot.model.moneyToYouIsAlwaysAllowed") });
  if (step === "accept" && !form.accepted) out.push({ field: "accepted", message: t("fold.autopilot.model.tickTheBoxOnceYouHave") });
  return out;
}

export function enableRequestOf(form: AutopilotForm, environment: "mainnet" | "testnet"): EnableAutopilotRequest {
  const payees = payeesOf(form) as Address[];
  return { environment, ack: autopilotAckDigest(), limits: { perStepUsd: form.perStepUsd.trim(), perDayUsd: form.perDayUsd.trim(), days: Number(form.days) }, ...(payees.length > 0 ? { payees } : {}) };
}

/** "$20" or "$20.20". */
export function money(v: string | number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "$?";
  return formatUsd(n, { min: Number.isInteger(n) ? 0 : 2 });
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** One plain sentence for where Autopilot stands. */
export function statusLine(ap: Autopilot | null, offerReason: string | null): { readonly tag: string; readonly tone: "ok" | "ochre" | "bad" | "ghost"; readonly line: string } {
  if (!ap || ap.status === "stopped") {
    if (offerReason) return { tag: t("fold.autopilot.model.notOnThisServer"), tone: "ghost", line: offerReason };
    return { tag: "OFF", tone: "ghost", line: ap?.stopped ? t("fold.autopilot.model.stoppedLykoSignsNothingForYou", { value: ap.stopped.by === "whistle" ? t("fold.autopilot.model.byTheWhistle") : ap.stopped.by === "leash" ? t("fold.autopilot.model.becauseItsLeashEnded") : t("fold.autopilot.model.byYou") }) : t("fold.autopilot.model.offLykoSignsNothingForYou") };
  }
  if (ap.status === "pending") return { tag: t("fold.autopilot.model.waitingForYou"), tone: "ochre", line: t("fold.autopilot.model.signTheSessionOnceFromYour") };
  if (ap.status === "paused") return { tag: "PAUSED", tone: "bad", line: ap.paused?.code === "owner" ? t("fold.autopilot.model.pausedByYouNothingIsSigned") : t("fold.autopilot.model.pausedItselfNothingIsSignedUntil", { value: ap.paused?.reason ?? t("fold.autopilot.model.somethingLookedOff") }) };
  return { tag: "ON", tone: "ok", line: t("fold.autopilot.model.lykoSignsYourTasksBelowFor", { money: money(ap.limits.perStepUsd), money2: money(ap.limits.perDayUsd) }) };
}

/** "Signed by Lyko under your Autopilot leash · $20.20 · on chain". */
export function runLine(r: AutopilotRun): string {
  if (r.status === "refused") return t("fold.autopilot.model.refused", { reason: r.reasons?.[0]?.message ?? r.summary });
  const what = r.summary.charAt(0).toUpperCase() + r.summary.slice(1);
  const usd = r.usd ? ` · ${money(r.usd)}` : "";
  const state = r.status === "signing" ? t("fold.autopilot.model.waitingForCircle") : r.status === "sent" ? t("fold.autopilot.model.sentSettling") : r.status === "failed" ? t("fold.autopilot.model.failedOnChain") : "";
  return `${what}${usd}${state}`;
}

export const TASK_KINDS: readonly { readonly kind: AutopilotTaskKind; readonly label: string; readonly line: string }[] = [
  { kind: "repay", label: "Auto-repay", line: t("fold.autopilot.model.repayPartOfYourAaveLoan") },
  { kind: "dca", label: t("fold.autopilot.model.buyOnASchedule"), line: t("fold.autopilot.model.convertAFixedAmountBetweenUsdc") },
  { kind: "sweep", label: t("fold.autopilot.model.sweepIdleUsdc"), line: t("fold.autopilot.model.moveUsdcAboveWhatYouKeep") },
  { kind: "pay", label: t("fold.autopilot.model.payAnInvoice"), line: t("fold.autopilot.model.payAPayeeYouNamedOn") },
  { kind: "watch", label: t("fold.autopilot.model.afterAWatch"), line: t("fold.autopilot.model.whenOneOfYourWatchesIs") },
];

export interface TaskForm {
  readonly kind: AutopilotTaskKind;
  readonly amountUsd: string;
  readonly floor: string;
  readonly every: AutopilotEvery;
  readonly to: "EURC" | "USDC";
  readonly keepUsd: string;
  readonly vault: string;
  readonly payee: string;
  readonly watchId: string;
  readonly sentence: string;
}

export function emptyTaskForm(kind: AutopilotTaskKind = "repay"): TaskForm {
  return { kind, amountUsd: "20", floor: "1.5", every: "week", to: "EURC", keepUsd: "200", vault: "Morpho", payee: "", watchId: "", sentence: "" };
}

/** The task request, or why it cannot be sent yet. */
export function taskInputOf(f: TaskForm, watches: readonly { readonly id: string }[]): { readonly input: AutopilotTaskInput | null; readonly issue: string | null } {
  const amount = f.amountUsd.trim();
  if (!/^\d{1,12}(?:\.\d{1,2})?$/u.test(amount) || Number(amount) <= 0) return { input: null, issue: t("fold.autopilot.model.giveTheMostItMovesEach") };
  switch (f.kind) {
    case "repay":
      return Number(f.floor) > 1 ? { input: { kind: "repay", amountUsd: amount, floor: f.floor.trim() }, issue: null } : { input: null, issue: t("fold.autopilot.model.aHealthFloorAbove1E") };
    case "dca":
      return { input: { kind: "dca", amountUsd: amount, every: f.every, to: f.to }, issue: null };
    case "sweep":
      return /^\d{1,12}(?:\.\d{1,2})?$/u.test(f.keepUsd.trim()) && f.vault.trim().length >= 2 ? { input: { kind: "sweep", amountUsd: amount, keepUsd: f.keepUsd.trim(), vault: f.vault.trim() }, issue: null } : { input: null, issue: t("fold.autopilot.model.sayWhatStaysInTheAccount") };
    case "pay":
      return isAddress(f.payee.trim()) ? { input: { kind: "pay", amountUsd: amount, every: f.every, payee: f.payee.trim().toLowerCase() as Address }, issue: null } : { input: null, issue: t("fold.autopilot.model.pickAPayeeYouNamedWhen") };
    case "watch": {
      const w = watches.find((x) => x.id === f.watchId);
      if (!w) return { input: null, issue: t("fold.autopilot.model.pickOneOfYourWatches") };
      if (f.sentence.trim().length < 4) return { input: null, issue: t("fold.autopilot.model.sayWhatLykoShouldDoE") };
      return { input: { kind: "watch", watchId: w.id, sentence: f.sentence.trim(), amountUsd: amount }, issue: null };
    }
  }
}

export const ACK_LINES = AUTOPILOT_ACK_LINES;
export const TRUST = AUTOPILOT_TRUST;
export const LABEL = AUTOPILOT_LABEL;

/** The sample Autopilot on the sample flock. */
export function sampleAutopilot(now: number): AutopilotView {
  const at = (m: number) => new Date(now - m * 60_000).toISOString();
  const owner = "0x000000000000000000000000000000000000dead" as Address;
  return {
    offer: { available: true, reason: null, ceilings: { ...AUTOPILOT_BETA }, ack: { lines: AUTOPILOT_ACK_LINES, digest: autopilotAckDigest() }, trust: AUTOPILOT_TRUST },
    autopilot: {
      schema: "lykia.autopilot/v1",
      owner,
      environment: "mainnet",
      status: "on",
      leashId: "lsh_5a3b1e000001",
      signer: { provider: "circle", walletId: "00000000-0000-4000-8000-000000000001", address: "0x5a3b1e00000000000000000000000000000ca11e" as Address, blockchain: "ARC", accountType: "EOA" },
      limits: { perStepUsd: "50", perDayUsd: "150", days: 14 },
      payees: ["0x2222222222222222222222222222222222222222" as Address],
      tasks: [
        { id: "apt_00000001", kind: "repay", label: t("fold.autopilot.model.repay50UsdcOnAaveWhen"), when: { kind: "condition", condition: { kind: "health-below", threshold: "1.5", venue: "aave-v4" } }, sentence: t("fold.autopilot.model.repay50UsdcOnAave"), amountUsd: "50", enabled: true, createdAt: at(4000), lastRunAt: null, lastResult: null, met: false, runs: 0 },
        { id: "apt_00000002", kind: "dca", label: t("fold.autopilot.model.buy25UsdcWorthOfEurc"), when: { kind: "schedule", every: "week" }, sentence: t("fold.autopilot.model.convert25UsdcToEurc"), amountUsd: "25", enabled: true, createdAt: at(4000), lastRunAt: at(1440), lastResult: t("fold.autopilot.model.convert25UsdcToEurc2"), runs: 3 },
        { id: "apt_00000003", kind: "pay", label: t("fold.autopilot.model.pay40UsdcTo0x22222222"), when: { kind: "schedule", every: "month" }, sentence: t("fold.autopilot.model.send40UsdcTo0x22222222222222222222222222"), amountUsd: "40", enabled: true, createdAt: at(4000), lastRunAt: at(2880), lastResult: t("fold.autopilot.model.send40UsdcTo0x22222222"), runs: 1 },
      ],
      ack: { digest: autopilotAckDigest(), at: at(4000) },
      createdAt: at(4000),
      updatedAt: at(60),
    },
    leash: null,
    today: { spentUsd: "25.25", leftUsd: "124.75" },
    runs: [
      { id: "apr_000000000001", at: at(1440), taskId: "apt_00000002", origin: "task", summary: t("fold.autopilot.model.convert25UsdcToEurcOn"), status: "settled", usd: "25.25", txHash: `0x${"ab".repeat(32)}`, chainProven: true, verdictDigest: `sha256:${"7".repeat(64)}`, label: AUTOPILOT_LABEL },
      { id: "apr_000000000002", at: at(2000), taskId: null, origin: "owner", summary: t("fold.autopilot.model.send30UsdcTo0x33333333"), status: "refused", reasons: [{ code: "fence.recipients", message: tx("{recipient} is not the owner{value}.", { recipient: "0x3333…3333", value: tx(" and not on the allowlist") }) }] },
      { id: "apr_000000000003", at: at(2880), taskId: "apt_00000003", origin: "task", summary: t("fold.autopilot.model.send40UsdcTo0x222222222"), status: "settled", usd: "40.40", txHash: `0x${"cd".repeat(32)}`, chainProven: true, verdictDigest: `sha256:${"9".repeat(64)}`, label: AUTOPILOT_LABEL },
    ],
  };
}
