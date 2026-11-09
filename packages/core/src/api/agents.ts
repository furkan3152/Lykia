/** Contract types: Lyko's chat, the Pack (sub-agents), insights and automations. */
import type { AgentInstructionKind, AgentRole } from "../agentInstructions.js";
import type { Address } from "../contracts.js";
import type { Decision } from "../fenceEvaluate.js";
import type { Fence } from "../fence.js";
import type { ArcEnvironment } from "../networks.js";
import type { PackAgent, PackBudget, PackRole, SessionLimits, SubFenceViolation } from "../pack.js";
import type { UnsignedTransaction } from "../intent.js";
import type { AnswerBlock, ChatStep } from "./answer.js";
import type { Finding } from "../preflight/types.js";

export type { AnswerBlock, AnswerBlockKind, ChatStep, ChatStepKind, ChatStepState } from "./answer.js";

/** Server-Sent Events of POST /v1/agent/chat, in the order they can appear. */
export type ChatEvent =
  | { readonly event: "thread"; readonly data: { readonly threadId: string; readonly mode: "llm" | "reader" } }
  | { readonly event: "reading"; readonly data: { readonly what: string; readonly ok: boolean } }
  | { readonly event: "thinking-summary"; readonly data: { readonly agent: string; readonly text: string } }
  | { readonly event: "task"; readonly data: { readonly agent: string; readonly role: PackRole; readonly task: string } }
  | { readonly event: "tool"; readonly data: { readonly agent: string; readonly name: string; readonly ok: boolean; readonly summary: string } }
  /** One step of "Lyko at work": sent when it starts (state "running") and again, same id, when it ends. */
  | { readonly event: "step"; readonly data: ChatStep }
  /** A typed card for the answer (gas gauge, Fence gate, balance, rate, herded, settled); the text stays the fallback. */
  | { readonly event: "block"; readonly data: AnswerBlock }
  | { readonly event: "proposal"; readonly data: AgentProposal }
  | { readonly event: "clarify"; readonly data: { readonly question: string; readonly options: readonly string[] } }
  | { readonly event: "draft"; readonly data: ChatDraftLink }
  | { readonly event: "program"; readonly data: ChatProgramView }
  | { readonly event: "text"; readonly data: { readonly text: string } }
  | { readonly event: "error"; readonly data: { readonly code: string; readonly message: string } }
  | { readonly event: "done"; readonly data: { readonly threadId: string; readonly stopReason: string } };

export type ChatEventName = ChatEvent["event"];

export const CHAT_EVENT_NAMES: readonly ChatEventName[] = ["thread", "reading", "thinking-summary", "task", "tool", "step", "block", "proposal", "clarify", "draft", "program", "text", "error", "done"];

/**
 * A compiled program (lykia.program/v1) as the chat shows it: Now (the
 * signable plan), Scheduled (drafts), Assumptions (each with the values the
 * owner can switch to, sent back to POST /v1/ai/compile as overrides), each
 * part with its Fence verdict, plus the why.
 */
export interface ChatProgramView {
  readonly programHash: string;
  readonly resolutionHash: string;
  readonly status: "ready" | "needs-input" | "refused";
  readonly source: "llm" | "deterministic";
  /** The owner's words, to recompile with overrides. */
  readonly text: string;
  readonly overrides: Readonly<Record<string, string>>;
  readonly summary: string;
  readonly goals: readonly string[];
  readonly hypothetical: boolean;
  readonly now: {
    readonly steps: readonly { readonly summary: string; readonly rationale: string }[];
    readonly decision: "allow" | "confirm" | "deny" | "unknown";
    readonly reasons: readonly string[];
    readonly intentId: string | null;
  } | null;
  readonly scheduled: readonly {
    readonly kind: "automation" | "order" | "alert" | "standing" | "budget" | "leash";
    readonly summary: string;
    readonly rationale: string;
    readonly href: string;
    readonly saved: boolean;
    readonly decision: "allow" | "confirm" | "deny" | "unknown";
    readonly reasons: readonly string[];
  }[];
  readonly assumptions: readonly { readonly id: string; readonly text: string; readonly value: string; readonly options: readonly string[] }[];
  readonly questions: readonly string[];
  readonly refusals: readonly string[];
  readonly blockers: readonly string[];
  readonly kept: readonly string[];
  readonly fees: string | null;
  readonly tradeoffs: readonly string[];
  readonly rejected: readonly { readonly option: string; readonly reason: string }[];
}

/**
 * An alert or automation Lyko set up in chat. saved: true means it was saved
 * for the signed-in owner (href manages it); saved: false means nothing was
 * saved and href opens the page with the form prefilled from `?draft=`.
 */
export interface ChatDraftLink {
  readonly kind: "alert" | "automation";
  readonly saved: boolean;
  readonly label: string;
  readonly href: string;
  /** When it runs next, in words ("every Friday at 17:00 Europe/Istanbul"); automations only. */
  readonly next?: string;
}

export interface AgentProposal {
  /** Stored intent the owner can prepare and sign; null for a dry run or a refusal. */
  readonly intentId: string | null;
  readonly title: string;
  readonly steps: readonly string[];
  readonly decision: Decision;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  /** What will go wrong before it is signed: blocks, warnings and notes with code-computed fixes (lykia.preflight/v1). */
  readonly preflight?: readonly Finding[];
  /** Which agents contributed which part. */
  readonly attribution: readonly { readonly agent: string; readonly role: PackRole; readonly part: string }[];
  readonly rationale: string;
  /** Planned from an instruction the other agent handed over ("From Lyko on watch"). */
  readonly from?: { readonly agent: AgentRole; readonly instructionId: string };
}

export interface ChatRequest {
  readonly message: string;
  readonly owner?: Address;
  readonly environment?: ArcEnvironment;
  readonly threadId?: string;
  readonly fence?: Fence;
  /** Where the message was written; the server records it on the shared thread. */
  readonly origin?: "ask" | "fold";
  /** Context carried from the Fold (an insight, a Herding item) when a conversation moves to Ask Lyko. */
  readonly context?: string;
}

export interface ThreadMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: string;
  readonly proposals?: readonly AgentProposal[];
  /** Cards that rode on an assistant answer (validated with parseAnswerBlock when read back). */
  readonly blocks?: readonly AnswerBlock[];
  /** Where it was written: Ask Lyko (default) or Lyko on watch in the Fold. Both share one thread. */
  readonly origin?: "ask" | "fold";
  /** A hand-off between the two agents this message carries: who sent what to whom. */
  readonly instruction?: { readonly id: string; readonly from: AgentRole; readonly to: AgentRole; readonly kind: AgentInstructionKind; readonly label: string };
}

export interface ThreadView {
  readonly id: string;
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ThreadMessage[];
}

export type InsightKind = "idle-cash" | "concentration" | "health-factor" | "fx-exposure" | "stale-approval" | "scent-warning" | "unpriced" | "low-gas";

export interface Insight {
  readonly id: string;
  readonly kind: InsightKind;
  readonly severity: "info" | "watch" | "act";
  readonly title: string;
  readonly detail: string;
  /** A sentence the deck can plan with one tap; null when nothing is proposed. */
  readonly proposal: string | null;
  /** The specialist that would carry it out. */
  readonly role: PackRole;
  /** Ready-to-sign transactions for fixes that are not intents (e.g. revoking a stale approval). */
  readonly transactions?: readonly UnsignedTransaction[];
}

export interface InsightsResponse {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly at: string;
  readonly insights: readonly Insight[];
}

export interface PackAgentView extends PackAgent {
  readonly budget: { readonly caps: PackBudget; readonly allocated: PackBudget; readonly free: PackBudget; readonly spent: { readonly dayUsd: string; readonly weekUsd: string } };
  readonly children: readonly string[];
}

export interface CreatePackAgentRequest {
  readonly owner: Address;
  readonly environment?: ArcEnvironment;
  readonly name: string;
  readonly role: PackRole;
  readonly fence?: Fence;
  readonly mission?: string;
  readonly signer?: Address;
  readonly agentId?: string;
}

export interface SpawnRejected {
  readonly code: "SUB_FENCE_VIOLATION" | "BUDGET_EXCEEDED";
  readonly violations: readonly SubFenceViolation[];
}

export interface SessionTxResponse {
  readonly agentId: string;
  readonly limits: SessionLimits;
  /** Unsigned call to the owner's LykiaAccount; null when the contracts are not deployed on this environment. */
  readonly transaction: UnsignedTransaction | null;
  readonly note: string;
}

export interface Automation {
  readonly id: string;
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly agentId: string | null;
  readonly when: { readonly insight: InsightKind } | { readonly everyMinutes: number };
  readonly sentence: string;
  /** propose: the owner signs; session: the agent executes through its LykiaAccount session. */
  readonly mode: "propose" | "session";
  readonly maxRunsPerDay: number;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly lastRunAt?: string;
}
