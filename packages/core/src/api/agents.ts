/** Contract types: Lyko's chat, the Pack (sub-agents), insights and automations. */
import type { Address } from "../contracts.js";
import type { Decision } from "../fenceEvaluate.js";
import type { Fence } from "../fence.js";
import type { ArcEnvironment } from "../networks.js";
import type { PackAgent, PackBudget, PackRole, SessionLimits, SubFenceViolation } from "../pack.js";
import type { UnsignedTransaction } from "../intent.js";

/** Server-Sent Events of POST /v1/agent/chat, in the order they can appear. */
export type ChatEvent =
  | { readonly event: "thread"; readonly data: { readonly threadId: string; readonly mode: "llm" | "reader" } }
  | { readonly event: "reading"; readonly data: { readonly what: string; readonly ok: boolean } }
  | { readonly event: "thinking-summary"; readonly data: { readonly agent: string; readonly text: string } }
  | { readonly event: "task"; readonly data: { readonly agent: string; readonly role: PackRole; readonly task: string } }
  | { readonly event: "tool"; readonly data: { readonly agent: string; readonly name: string; readonly ok: boolean; readonly summary: string } }
  | { readonly event: "proposal"; readonly data: AgentProposal }
  | { readonly event: "clarify"; readonly data: { readonly question: string; readonly options: readonly string[] } }
  | { readonly event: "draft"; readonly data: ChatDraftLink }
  | { readonly event: "text"; readonly data: { readonly text: string } }
  | { readonly event: "error"; readonly data: { readonly code: string; readonly message: string } }
  | { readonly event: "done"; readonly data: { readonly threadId: string; readonly stopReason: string } };

export type ChatEventName = ChatEvent["event"];

export const CHAT_EVENT_NAMES: readonly ChatEventName[] = ["thread", "reading", "thinking-summary", "task", "tool", "proposal", "clarify", "draft", "text", "error", "done"];

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
}

export interface AgentProposal {
  /** Stored intent the owner can prepare and sign; null for a dry run or a refusal. */
  readonly intentId: string | null;
  readonly title: string;
  readonly steps: readonly string[];
  readonly decision: Decision;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  /** Which agents contributed which part. */
  readonly attribution: readonly { readonly agent: string; readonly role: PackRole; readonly part: string }[];
  readonly rationale: string;
}

export interface ChatRequest {
  readonly message: string;
  readonly owner?: Address;
  readonly environment?: ArcEnvironment;
  readonly threadId?: string;
  readonly fence?: Fence;
}

export interface ThreadMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: string;
  readonly proposals?: readonly AgentProposal[];
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
