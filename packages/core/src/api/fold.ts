/** Contract types: the Fold (insights, proposals, instructions, trails, preferences, threads). */
import type { AgentInstructionStatus, AgentRole } from "../agentInstructions.js";
import type { Address } from "../contracts.js";
import type { Decision } from "../fenceEvaluate.js";
import type { FoldInsightKind, FoldPreferenceEffect, FoldPreferences, FoldShocks, ShockResult } from "../fold.js";
import type { UnsignedTransaction } from "../intent.js";
import type { ArcEnvironment } from "../networks.js";
import type { BlockSource } from "./answer.js";

/** One figure behind an insight's "Why?", with a human label. */
export interface FoldFigure {
  readonly label: string;
  readonly value: string;
}

/** What a one-tap draft does: plan a sentence under the Fence, or hand over ready-to-sign transactions (a revoke). */
export interface FoldDraft {
  readonly label: string;
  readonly sentence: string | null;
  readonly transactions?: readonly UnsignedTransaction[];
  /** "Add USDC to this wallet": the address to send USDC to on Arc. Needs no gas from this wallet. */
  readonly receive?: Address;
  /** Open a page instead (the plan in flight, Herding). */
  readonly href?: string;
}

export interface FoldInsight {
  /** Stable for the same condition, so "handled" survives a refresh. */
  readonly id: string;
  readonly kind: FoldInsightKind;
  readonly severity: "info" | "watch" | "act";
  readonly title: string;
  /** One or two plain sentences. */
  readonly explain: string;
  readonly figures: readonly FoldFigure[];
  readonly draft: FoldDraft | null;
  /** True once a proposal was made from it (or it was dismissed) and the condition has not changed. */
  readonly handled: boolean;
  /** A watch task Ask Lyko handed to Lyko on watch raised this insight. */
  readonly origin?: { readonly agent: AgentRole; readonly instructionId: string };
  /** Where its figures were read: the source, the time and the Arc block (the card shows "source · block or time"). */
  readonly from?: BlockSource;
  /** Handed to Ask Lyko ("Sent to Ask Lyko · planned"), with the plan it became. */
  readonly sent?: { readonly instructionId: string; readonly status: AgentInstructionStatus; readonly intentId: string | null; readonly threadId: string | null };
}

export interface FoldInsightsResponse {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly at: string;
  readonly insights: readonly FoldInsight[];
  /** "New since your last visit": lines for the morning brief; empty when nothing changed. */
  readonly brief: { readonly since: string | null; readonly lines: readonly string[] };
  /** True when the reader proved control of the address (handled flags and preferences apply). */
  readonly personal: boolean;
}

export type FoldProposalStatus = "proposed" | "approved" | "done" | "stopped";
export const FOLD_PROPOSAL_STATUSES: readonly FoldProposalStatus[] = ["proposed", "approved", "done", "stopped"];
export type FoldProposalSource = "insight" | "automation" | "chat" | "fence" | "holding";

export interface FoldProposal {
  readonly id: string;
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly source: { readonly kind: FoldProposalSource; readonly ref: string | null };
  readonly title: string;
  /** The sentence Lyko planned, when the draft is a plan. */
  readonly sentence: string | null;
  /** Ready-to-sign transactions (a revoke), when the draft is not an intent. */
  readonly transactions?: readonly UnsignedTransaction[];
  /** A Fence edit, applied by the owner's own deck; loosening needs the owner's wallet. */
  readonly fencePatch?: Readonly<Record<string, unknown>>;
  /** The stored intent the owner prepares and signs; null for a refusal, a dry run or a non-intent draft. */
  readonly intentId: string | null;
  readonly decision: Decision | "unknown";
  readonly reasons: readonly string[];
  readonly steps: readonly string[];
  readonly status: FoldProposalStatus;
  readonly outcome: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: readonly { readonly status: FoldProposalStatus; readonly at: string; readonly note: string | null }[];
}

export interface FoldFeedEntry {
  readonly id: string;
  readonly at: string;
  readonly proposalId: string;
  readonly status: FoldProposalStatus;
  readonly title: string;
  readonly note: string | null;
}

export type InstructionSource = "automation" | "standing" | "alert" | "agent" | "order" | "recurring" | "watch" | "plan" | "leash" | "autopilot" | "autopilot-task" | "pack-agent" | "invoice";

/**
 * The one noun a Running row is, whatever engine holds it. Autopilot tasks,
 * standing orders, recurring payments and agent automations are all
 * "automation" (with who signs); alerts and watch tasks are "watch"; Pack
 * agents and leashes are "leash" (an agent is what holds a leash).
 */
export type RunningKind = "automation" | "order" | "watch" | "leash" | "autopilot" | "plan" | "payment";
export const RUNNING_KINDS: readonly RunningKind[] = ["automation", "order", "watch", "leash", "autopilot", "plan", "payment"];

/** Who signs each run of an automation. */
export type RunningSigner = "you" | "autopilot" | "leash";

/**
 * The one control a Running row offers, described as the HTTP call that
 * does it (the web only follows it). `sign` controls need the owner's wallet
 * after the call: a LykiaOrders cancel, a leash's revokeSession.
 */
export interface RunningControl {
  readonly action: "pause" | "resume" | "stop" | "cancel";
  readonly label: string;
  readonly method: "get" | "post" | "delete";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: Readonly<Record<string, string>>;
  /** After the call the owner signs a transaction (a LykiaOrders cancel, a revokeSession). */
  readonly sign?: "order-cancel" | "revoke-session";
}

/** One standing instruction, whatever created it, in one shape. */
export interface FoldInstruction {
  readonly id: string;
  readonly source: InstructionSource;
  /** The row's chip: "Automation", "Order", "Watch", "Leash", "Autopilot", "Plan", "Payment link", "Invoice". */
  readonly sourceLabel: string;
  readonly name: string;
  readonly status: "active" | "paused" | "waiting" | "done" | "failed" | "cancelled";
  readonly trigger: string;
  readonly nextRunAt: string | null;
  /** "on price", "on an insight", "in 3 h", when no exact time is known. */
  readonly nextRunLabel: string;
  readonly lastRunAt: string | null;
  readonly lastResult: string | null;
  /** The Fence verdict the next run is expected to get, when it can be told. */
  readonly nextVerdict: { readonly decision: Decision | "unknown"; readonly reason: string } | null;
  /** Pause and resume work without a signature. */
  readonly controllable: boolean;
  /** The sentence that prefills Ask Lyko to change it. */
  readonly editSentence: string;
  readonly environment: ArcEnvironment | null;
  /** A chat plan still in progress: Stop ends every step not started yet (POST /v1/intents/:id/stop). */
  readonly stop?: { readonly intentId: string };
  /** An open LykiaOrders order: Cancel is a transaction the owner signs (GET /v1/orders/:hash/cancel-tx). */
  readonly cancel?: { readonly hash: string; readonly environment: ArcEnvironment };
  /** The one noun it is in the Running list. */
  readonly kind?: RunningKind;
  /** Automations: who signs each run ("You sign each time", "Autopilot signs"). */
  readonly signs?: RunningSigner;
  /** What happens next, in one plain line ("Pays 300 USDC in 3 d", "Bot may spend $20 more today"). */
  readonly nextLine?: string;
  /** The one control that fits (Pause, Resume, Stop or Cancel); null when nothing can be done from here. */
  readonly control?: RunningControl | null;
  /** Watches: where it is delivered (in-app, webhook, Telegram). */
  readonly channels?: readonly ("in-app" | "webhook" | "telegram")[];
}

export interface FoldInstructionsResponse {
  readonly owner: Address;
  readonly at: string;
  readonly instructions: readonly FoldInstruction[];
  /** Proposals waiting for the owner's signature (automations, insights, chat). */
  readonly waiting: readonly FoldProposal[];
  readonly counts: { readonly running: number; readonly paused: number; readonly ordersWaiting: number; readonly waitingSignature: number; readonly agentsWorking?: number; readonly byKind?: Readonly<Partial<Record<RunningKind, number>>> };
}

export interface FoldTrailEntry {
  readonly id: string;
  readonly at: string;
  readonly kind: "settled" | "planned" | "running" | "failed" | "refused" | "order" | "alert" | "proposal";
  readonly title: string;
  readonly detail: string;
  readonly environment: ArcEnvironment;
  readonly memo: string | null;
  readonly verdict: { readonly decision: Decision; readonly digest: string } | null;
  readonly transactions: readonly string[];
  readonly feeUsd: string | null;
  readonly link: string | null;
}

export interface FoldTrailsResponse {
  readonly owner: Address;
  readonly items: readonly FoldTrailEntry[];
  readonly totals: { readonly settled: number; readonly failed: number; readonly refused: number; readonly feesUsd: string };
}

/** A structured explanation the server writes (PnL and yield): label, value and a note per line. */
export interface FoldExplainArtifact {
  readonly kind: "yield" | "whatif" | "week" | "approvals";
  readonly title: string;
  readonly summary: string;
  readonly lines: readonly { readonly label: string; readonly value: string; readonly note: string | null; readonly from?: BlockSource }[];
  readonly sources: readonly string[];
  readonly at: string;
  /** The Arc block the figures were read at, when one read was used. */
  readonly block?: string | null;
}

export interface FoldSummaryResponse {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly at: string;
  readonly spent: { readonly dayUsd: string | null };
  readonly beta: { readonly perDayUsd: string } | null;
  /** The daily cap of the Fence the profile implies (the deck may hold a tighter one). */
  readonly fenceDailyUsd: string | null;
  readonly counts: { readonly rules: number; readonly ordersWaiting: number; readonly agentsWorking: number; readonly proposalsWaiting: number };
}

export interface FoldWhatIfResponse {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly shocks: FoldShocks;
  readonly result: ShockResult;
  readonly sentence: string;
  /** Where the holdings came from: the position map, when and at which block it was read. */
  readonly from?: BlockSource;
}

export type FoldQuestion = "yield" | "whatif" | "week" | "approvals";

export interface FoldAnswerResponse {
  readonly threadId: string;
  readonly question: string;
  readonly reply: string;
  readonly artifact: FoldExplainArtifact;
}

export interface PreferencesResponse {
  readonly owner: string;
  readonly preferences: FoldPreferences;
  readonly effects: readonly FoldPreferenceEffect[];
}

/** One shared thread, as the rail and the Fold list it (Ask Lyko and Lyko on watch write to the same threads). */
export interface ThreadSummaryView {
  readonly id: string;
  readonly title: string;
  readonly environment: ArcEnvironment;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: number;
  readonly last: string | null;
  /** Where the last message was written: "ask" or "fold". */
  readonly origin: "ask" | "fold";
}

/* ------------------------------------------------------------ the Whistle */

export type WhistleItemKind = "automation" | "standing" | "agent-automation" | "agent" | "leash" | "autopilot" | "alert";

/** One thing the Whistle stopped, with how to let it run again. */
export interface WhistleItem {
  readonly kind: WhistleItemKind;
  readonly id: string;
  readonly label: string;
  readonly environment: ArcEnvironment | null;
  /** "paused" now; "resumed" once let go; "kept" when it was already stopped before the Whistle. */
  readonly state: "paused" | "resumed";
}

export interface WhistleResponse {
  readonly owner: Address;
  readonly blownAt: string | null;
  readonly items: readonly WhistleItem[];
  /** blowWhistle() on the owner's LykiaAccount, to stop every on-chain session too; null when the owner has no account. */
  readonly transaction: UnsignedTransaction | null;
  readonly account: Address | null;
  readonly counts: Readonly<Record<WhistleItemKind, number>>;
  readonly note: string;
}
