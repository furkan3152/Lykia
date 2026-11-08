/**
 * Lyko Autopilot (`lykia.autopilot/v1`): Lyko signs the owner's own
 * automations inside a leash on the owner's own LykiaAccount.
 *
 * The money never leaves the owner's LykiaAccount. Lyko gets a session on it
 * like any leashed agent (per step, per day, in total, payees, call rules,
 * an expiry), and the session key is a Circle developer-controlled wallet
 * (MPC) made for this owner alone. Lykia's server asks Circle to sign only a
 * step that passed the Fence, the Autopilot ceilings, the anomaly guard and
 * the leash's own checks (spendable() and the call rules read from the
 * account, then a simulation from the key). Off by default; see
 * docs/autopilot.md for the trust model.
 *
 * Pure: no I/O.
 */
import { formatUsdMicros, usdMicros, USD_PATTERN, FENCE_SCHEMA, type Fence } from "./fence.js";
import { isAddress, type Address } from "./contracts.js";
import { sha256Hex } from "./canonical.js";
import { LEASH_EARN_VENUES, LEASH_SWAP_VENUES } from "./leash.js";
import { watchIssue, watchLabel, type WatchCondition } from "./agentInstructions.js";
import type { ArcEnvironment } from "./networks.js";

export const AUTOPILOT_SCHEMA = "lykia.autopilot/v1" as const;

/**
 * Beta ceilings while Autopilot is new, in USD, on both environments. Every
 * Autopilot leash is at or under them, and under the mainnet beta cap. The
 * owner can choose lower values.
 */
export const AUTOPILOT_BETA = Object.freeze({ perStepUsd: "100", perDayUsd: "300" });

export const AUTOPILOT_LIMITS = Object.freeze({
  minDays: 1,
  maxDays: 30,
  defaultDays: 7,
  payees: 10,
  tasks: 10,
  /** Calls the session allows over its life. */
  maxCalls: 500,
});

/** What every signed Autopilot step is labelled with, in the Fold and the trail. */
export const AUTOPILOT_LABEL = "Signed by Lyko under your Autopilot leash";

/**
 * The risk acknowledgement the owner reads before turning Autopilot on. The
 * API only accepts `enable` with the digest of exactly this text, so what the
 * owner agreed to is on record.
 */
export const AUTOPILOT_ACK_LINES: readonly string[] = Object.freeze([
  "Lyko signs for you up to these limits.",
  "Lykia never holds your funds: they stay in your own LykiaAccount.",
  "The signing key is a Circle wallet made for you; Circle holds it, Lykia asks Circle to sign.",
  "The server can act within these caps until you revoke, even if Lykia's server is compromised.",
  "Stop Autopilot ends server signing at once; signing revokeSession ends it on chain.",
]);

export const AUTOPILOT_ACK_TEXT = AUTOPILOT_ACK_LINES.join("\n");

/** `sha256:` + hex of the acknowledgement text (what `enable` must carry). */
export function autopilotAckDigest(text: string = AUTOPILOT_ACK_TEXT): string {
  return `sha256:${sha256Hex(text)}`;
}

/**
 * pending: the owner has not signed the session transaction yet.
 * on: Lyko signs due tasks inside the leash.
 * paused: the anomaly guard (or the owner) paused it; the session still exists, nothing is signed.
 * stopped: Stop Autopilot, the Whistle, or the leash ended. Server signing is off for good; turn it on again for a new leash.
 */
export type AutopilotStatus = "pending" | "on" | "paused" | "stopped";

export interface AutopilotLimits {
  /** Largest single step, USD (at most AUTOPILOT_BETA.perStepUsd). */
  readonly perStepUsd: string;
  /** Rolling day, USD (at most AUTOPILOT_BETA.perDayUsd). */
  readonly perDayUsd: string;
  /** How long the session lives, in days. */
  readonly days: number;
}

/** The signing key: a Circle developer-controlled wallet, one per owner per network. */
export interface AutopilotSigner {
  readonly provider: "circle";
  readonly walletId: string;
  readonly address: Address;
  readonly blockchain: string;
  /** EOA: it sends agentExecute / agentTransfer itself, so the account sees it as msg.sender. */
  readonly accountType: "EOA";
}

/* ------------------------------------------------------------ tasks */

export type AutopilotTaskKind = "repay" | "dca" | "sweep" | "pay" | "watch";
export const AUTOPILOT_TASK_KINDS: readonly AutopilotTaskKind[] = ["repay", "dca", "sweep", "pay", "watch"];

export type AutopilotEvery = "day" | "week" | "month";

/** When a task runs: on a schedule, or each time a condition on the LykiaAccount becomes true. */
export type AutopilotWhen =
  | { readonly kind: "schedule"; readonly every: AutopilotEvery }
  | { readonly kind: "condition"; readonly condition: WatchCondition; readonly watchId?: string };

export interface AutopilotTask {
  readonly id: string;
  readonly kind: AutopilotTaskKind;
  /** "Repay 50 USDC on Aave when health drops below 1.5". */
  readonly label: string;
  readonly when: AutopilotWhen;
  /** What Lyko plans each time, e.g. "repay 50 USDC on Aave". Sweeps fill the amount when they run. */
  readonly sentence: string;
  /** The most one run moves, USD. */
  readonly amountUsd: string;
  /** Sweeps: what stays in the account. */
  readonly keepUsd?: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly lastRunAt: string | null;
  readonly lastResult: string | null;
  /** Condition tasks: whether it held at the last check (a task runs again only after it was clear). */
  readonly met?: boolean;
  readonly runs: number;
}

/** What the owner asks for; the API fills in the rest. */
export type AutopilotTaskInput =
  | { readonly kind: "repay"; readonly amountUsd: string; readonly floor: string; readonly venue?: "aave-v4" }
  | { readonly kind: "dca"; readonly amountUsd: string; readonly every: AutopilotEvery; readonly to: "EURC" | "USDC" }
  | { readonly kind: "sweep"; readonly keepUsd: string; readonly amountUsd: string; readonly vault: string }
  | { readonly kind: "pay"; readonly amountUsd: string; readonly every: AutopilotEvery; readonly payee: Address; readonly note?: string }
  /** The condition is the watch's own (the API reads it from the watch). */
  | { readonly kind: "watch"; readonly watchId: string; readonly condition?: WatchCondition; readonly sentence: string; readonly amountUsd: string };

export interface AutopilotIssue {
  readonly path: string;
  readonly message: string;
}

const PERIOD_MS: Readonly<Record<AutopilotEvery, number>> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

export function periodMs(every: AutopilotEvery): number {
  return PERIOD_MS[every];
}

function money(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Checks a task request and builds the task. */
export function autopilotTask(input: AutopilotTaskInput, at: { readonly id: string; readonly now: string; readonly limits: Pick<AutopilotLimits, "perStepUsd">; readonly payees: readonly Address[] }): { readonly task: AutopilotTask | null; readonly issues: readonly AutopilotIssue[] } {
  const issues: AutopilotIssue[] = [];
  const amount = input.amountUsd;
  if (typeof amount !== "string" || !USD_PATTERN.test(amount) || usdMicros(amount) <= 0n) issues.push({ path: "amountUsd", message: 'A USD amount above 0, e.g. "25".' });
  else if (usdMicros(amount) > usdMicros(at.limits.perStepUsd)) issues.push({ path: "amountUsd", message: `Autopilot moves at most $${at.limits.perStepUsd} in one step; ask for that or less.` });
  const base = { id: at.id, enabled: true, createdAt: at.now, lastRunAt: null, lastResult: null, runs: 0, amountUsd: amount };
  let task: AutopilotTask | null = null;
  switch (input.kind) {
    case "repay": {
      const floor = Number(input.floor);
      if (!Number.isFinite(floor) || floor <= 1 || floor > 5) issues.push({ path: "floor", message: "A health factor between 1 and 5, e.g. 1.5." });
      const condition: WatchCondition = { kind: "health-below", threshold: String(input.floor), venue: input.venue ?? "aave-v4" };
      task = { ...base, kind: "repay", label: `Repay ${money(amount)} USDC on Aave when health drops below ${input.floor}`, when: { kind: "condition", condition }, sentence: `repay ${money(amount)} USDC on Aave` };
      break;
    }
    case "dca": {
      if (!PERIOD_MS[input.every]) issues.push({ path: "every", message: "day, week or month." });
      if (input.to !== "EURC" && input.to !== "USDC") issues.push({ path: "to", message: "EURC or USDC." });
      const from = input.to === "EURC" ? "USDC" : "EURC";
      task = { ...base, kind: "dca", label: `Buy ${money(amount)} ${from === "USDC" ? "USDC worth of EURC" : "EURC worth of USDC"} every ${input.every}`, when: { kind: "schedule", every: input.every }, sentence: `convert ${money(amount)} ${from} to ${input.to}` };
      break;
    }
    case "sweep": {
      if (typeof input.keepUsd !== "string" || !USD_PATTERN.test(input.keepUsd)) issues.push({ path: "keepUsd", message: 'What stays in the account, e.g. "200".' });
      if (typeof input.vault !== "string" || !/^[A-Za-z0-9 .'-]{2,48}$/u.test(input.vault)) issues.push({ path: "vault", message: 'A vault name, e.g. "Galaxy vault" or "Morpho".' });
      const keep = issues.some((i) => i.path === "keepUsd") ? "0" : input.keepUsd;
      const condition: WatchCondition = { kind: "idle-above", token: "USDC", amount: keep === "0" ? "0.01" : keep };
      task = { ...base, kind: "sweep", label: `Move idle USDC above $${money(keep)} into ${input.vault}, up to $${money(amount)} at a time`, when: { kind: "condition", condition }, sentence: `deposit {amount} USDC into ${input.vault}`, keepUsd: keep };
      break;
    }
    case "pay": {
      if (!isAddress(input.payee)) issues.push({ path: "payee", message: "An address, 0x followed by 40 hex characters." });
      else if (!at.payees.some((p) => p.toLowerCase() === input.payee.toLowerCase())) issues.push({ path: "payee", message: "Autopilot pays only payees named when it was turned on. Turn it on again with this payee." });
      if (!PERIOD_MS[input.every]) issues.push({ path: "every", message: "day, week or month." });
      const note = input.note ? input.note.replace(/[^\w .#:-]/gu, "").slice(0, 40) : "";
      task = { ...base, kind: "pay", label: `Pay ${money(amount)} USDC to ${input.payee.slice(0, 6)}…${input.payee.slice(-4)} every ${input.every}${note ? ` (${note})` : ""}`, when: { kind: "schedule", every: input.every }, sentence: `send ${money(amount)} USDC to ${input.payee.toLowerCase()}${note ? ` for ${note}` : ""}` };
      break;
    }
    case "watch": {
      const bad = input.condition ? watchIssue(input.condition) : "The watch's condition is missing.";
      if (bad) issues.push({ path: "condition", message: bad });
      if (typeof input.sentence !== "string" || input.sentence.trim().length < 4 || input.sentence.length > 200) issues.push({ path: "sentence", message: 'What Lyko should do, e.g. "repay 50 USDC on Aave".' });
      if (!/^[0-9a-fx]{42}:ins_[a-f0-9]{16}$/u.test(input.watchId ?? "")) issues.push({ path: "watchId", message: "The id of one of your watches." });
      task = bad || !input.condition ? null : { ...base, kind: "watch", label: `${watchLabel(input.condition)}, then ${input.sentence.trim()}`, when: { kind: "condition", condition: input.condition, watchId: input.watchId }, sentence: input.sentence.trim() };
      break;
    }
    default:
      issues.push({ path: "kind", message: `One of ${AUTOPILOT_TASK_KINDS.join(", ")}.` });
  }
  return { task: issues.length > 0 ? null : task, issues };
}

/** The sentence a task plans now. Sweeps move the idle amount above what stays, at most the task's amount. Null when there is nothing to move. */
export function taskSentence(task: Pick<AutopilotTask, "kind" | "sentence" | "amountUsd" | "keepUsd">, facts?: { readonly idleUsdc?: number }): string | null {
  if (task.kind !== "sweep") return task.sentence;
  const idle = facts?.idleUsdc ?? 0;
  const extra = Math.min(Number(task.amountUsd), idle - Number(task.keepUsd ?? "0"));
  if (!(extra >= 1)) return null;
  return task.sentence.replace("{amount}", String(Math.floor(extra * 100) / 100));
}

/** Whether a schedule task is due at `now`. */
export function scheduleDue(task: Pick<AutopilotTask, "when" | "lastRunAt" | "createdAt">, now: number): boolean {
  if (task.when.kind !== "schedule") return false;
  if (!task.lastRunAt) return true;
  return now - Date.parse(task.lastRunAt) >= periodMs(task.when.every);
}

/* ------------------------------------------------------------ limits */

/** Checks Autopilot limits against its ceilings and the mainnet beta cap. */
export function autopilotLimitIssues(limits: Partial<AutopilotLimits> | undefined, beta: { readonly perStepUsd: string; readonly perDayUsd: string } | null): AutopilotIssue[] {
  const out: AutopilotIssue[] = [];
  if (!limits) return [{ path: "limits", message: "Give perStepUsd, perDayUsd and days." }];
  const step = limits.perStepUsd;
  const day = limits.perDayUsd;
  for (const [key, v] of [["perStepUsd", step], ["perDayUsd", day]] as const) {
    if (typeof v !== "string" || !USD_PATTERN.test(v) || usdMicros(v) <= 0n) out.push({ path: `limits.${key}`, message: 'A USD amount above 0, e.g. "50".' });
  }
  if (!Number.isInteger(limits.days) || (limits.days as number) < AUTOPILOT_LIMITS.minDays || (limits.days as number) > AUTOPILOT_LIMITS.maxDays) out.push({ path: "limits.days", message: `${AUTOPILOT_LIMITS.minDays} to ${AUTOPILOT_LIMITS.maxDays} days.` });
  if (out.length > 0) return out;
  const ceiling = autopilotCeiling(beta);
  if (usdMicros(step!) > usdMicros(ceiling.perStepUsd)) out.push({ path: "limits.perStepUsd", message: `Autopilot allows at most $${ceiling.perStepUsd} per step${ceiling.perStepUsd === AUTOPILOT_BETA.perStepUsd ? " while it is in beta" : " (the mainnet beta cap)"}.` });
  if (usdMicros(day!) > usdMicros(ceiling.perDayUsd)) out.push({ path: "limits.perDayUsd", message: `Autopilot allows at most $${ceiling.perDayUsd} a day${ceiling.perDayUsd === AUTOPILOT_BETA.perDayUsd ? " while it is in beta" : " (the mainnet beta cap)"}.` });
  if (usdMicros(step!) > usdMicros(day!)) out.push({ path: "limits.perStepUsd", message: "One step cannot be more than a day." });
  return out;
}

/** The lower of the Autopilot beta ceilings and the mainnet beta cap. */
export function autopilotCeiling(beta: { readonly perStepUsd: string; readonly perDayUsd: string } | null): { readonly perStepUsd: string; readonly perDayUsd: string } {
  const lower = (a: string, b: string | undefined) => (b !== undefined && usdMicros(b) < usdMicros(a) ? b : a);
  return { perStepUsd: lower(AUTOPILOT_BETA.perStepUsd, beta?.perStepUsd), perDayUsd: lower(AUTOPILOT_BETA.perDayUsd, beta?.perDayUsd) };
}

/** The leash budget an Autopilot leash carries: per step, per day, and the day times the days in total. */
export function autopilotBudget(limits: AutopilotLimits): { readonly perStepUsd: string; readonly perDayUsd: string; readonly totalUsd: string } {
  return { perStepUsd: limits.perStepUsd, perDayUsd: limits.perDayUsd, totalUsd: formatUsdMicros(usdMicros(limits.perDayUsd) * BigInt(limits.days)) };
}

/**
 * The Autopilot leash's Fence: pay named payees, convert USDC and EURC,
 * earn in Morpho vaults and Aave V4, repay and withdraw, all into the owner's
 * own account. Only tokens and venues a LykiaAccount session can pin.
 */
export function autopilotFence(input: { readonly environment: ArcEnvironment; readonly limits: AutopilotLimits; readonly payees: readonly Address[] }): Fence {
  const payees = [...new Set(input.payees.map((p) => p.toLowerCase()))] as Address[];
  return {
    schema: FENCE_SCHEMA,
    label: "Lyko Autopilot",
    mode: "live",
    environments: [input.environment],
    kinds: { allow: ["transfer", "fx", "swap", "deposit", "withdraw", "supply", "repay"] },
    venues: { allow: ["arc-transfer", ...LEASH_SWAP_VENUES, ...LEASH_EARN_VENUES] },
    tokens: { allow: ["USDC", "EURC"], unlisted: "deny" },
    recipients: payees.length > 0 ? { mode: "allowlist", allow: payees } : { mode: "own" },
    caps: { perStepUsd: input.limits.perStepUsd, perIntentUsd: input.limits.perDayUsd, dailyUsd: input.limits.perDayUsd },
    limits: { maxSteps: 4, maxSlippageBps: 50 },
    scent: { require: "verified" },
    confirm: { when: [] },
    signers: ["agent"],
  };
}

/* ------------------------------------------------------------ anomaly guard */

export const AUTOPILOT_GUARD = Object.freeze({
  /** This many refusals inside the window pause Autopilot. */
  denies: 3,
  denyWindowMs: 60 * 60_000,
  /** More than this many signed steps in an hour pause it. */
  stepsPerHour: 6,
  /** Signing more than this share of the daily cap inside the burst window pauses it. */
  burstShare: 0.5,
  burstWindowMs: 15 * 60_000,
});

export type AutopilotPauseCode = "anomaly.denies" | "anomaly.velocity" | "owner";

export interface GuardEvent {
  /** ms since epoch. */
  readonly at: number;
  readonly kind: "signed" | "refused";
  /** USD of a signed step. */
  readonly usd?: string | null;
}

/**
 * Whether Autopilot should pause. `next` is the step about to be signed
 * (velocity is checked before signing, so the burst never happens); without
 * it, only refusals are counted.
 */
export function guardVerdict(events: readonly GuardEvent[], input: { readonly now: number; readonly perDayUsd: string; readonly next?: { readonly usd: string | null } }): { readonly pause: false } | { readonly pause: true; readonly code: Exclude<AutopilotPauseCode, "owner">; readonly reason: string } {
  const g = AUTOPILOT_GUARD;
  const denies = events.filter((e) => e.kind === "refused" && input.now - e.at <= g.denyWindowMs).length;
  if (denies >= g.denies) return { pause: true, code: "anomaly.denies", reason: `${denies} refusals in the last hour: something is off, so Autopilot paused itself.` };
  if (!input.next) return { pause: false };
  const hour = events.filter((e) => e.kind === "signed" && input.now - e.at <= 3_600_000).length;
  if (hour + 1 > g.stepsPerHour) return { pause: true, code: "anomaly.velocity", reason: `This would be step ${hour + 1} in an hour; more than ${g.stepsPerHour} is unusual, so Autopilot paused itself.` };
  const burst = events.filter((e) => e.kind === "signed" && input.now - e.at <= g.burstWindowMs).reduce((s, e) => s + usdMicros(e.usd && USD_PATTERN.test(e.usd) ? e.usd : "0"), 0n);
  const next = input.next.usd && USD_PATTERN.test(input.next.usd) ? usdMicros(input.next.usd) : 0n;
  const limit = (usdMicros(input.perDayUsd) * BigInt(Math.round(g.burstShare * 100))) / 100n;
  if (burst + next > limit && burst > 0n) return { pause: true, code: "anomaly.velocity", reason: `$${formatUsdMicros(burst + next)} in ${g.burstWindowMs / 60_000} minutes is more than half the $${input.perDayUsd} daily cap, so Autopilot paused itself.` };
  return { pause: false };
}

/* ------------------------------------------------------------ trust */

export interface TrustLine {
  readonly who: "Circle" | "Lykia" | "Chain" | "You";
  readonly holds: string;
}

/** Who holds what. The docs and the opt-in screen show this table. */
export const AUTOPILOT_TRUST: readonly TrustLine[] = [
  { who: "You", holds: "Your funds, in your own LykiaAccount. Only your wallet can create, widen or revoke the session, withdraw, or blow the Whistle." },
  { who: "Circle", holds: "The signing key, as an MPC developer-controlled wallet under the operator's Circle entity. The private key never exists on Lykia's servers." },
  { who: "Lykia", holds: "The right to ask Circle to sign, with the operator's entity secret. It asks only for steps that passed the Fence, the Autopilot ceilings, the anomaly guard and the leash checks, and stops asking the moment you press Stop." },
  { who: "Chain", holds: "Your LykiaAccount enforces the session: per call, per day and lifetime caps per token, payees, call rules that pin outputs to your account, a call count and the expiry. A compromised server can do no more than that until you revoke." },
];
