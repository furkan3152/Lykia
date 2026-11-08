/** Contract types for /v1/leashes. */
import type { Address } from "../contracts.js";
import type { IntentGraph, UnsignedTransaction } from "../intent.js";
import type { Leash, LeashBudget, LeashDenyReason, LeashTemplateKey, LeashTool, LeashUsage } from "../leash.js";
import type { ArcEnvironment } from "../networks.js";
import type { Fence } from "../fence.js";

export interface CreateLeashRequest {
  /** Defaults to the signed-in address. Required with a project key acting through consent. */
  readonly owner?: Address;
  readonly environment?: ArcEnvironment;
  /** A new agent (a root leash, carved from the owner's own Fence) … */
  readonly agent?: {
    readonly name: string;
    readonly mission?: string;
    /** The agent's own key: the LykiaAccount session key. Lykia never sees its private key. */
    readonly signer: Address;
  };
  /** … or a sub-agent of a Pack agent (its Fence and budget are carved from that agent's). */
  readonly parentAgentId?: string;
  /** With parentAgentId: the new sub-agent's name and session key. */
  readonly name?: string;
  readonly signer?: Address;
  readonly template?: LeashTemplateKey;
  /** "custom" only. */
  readonly fence?: Fence;
  readonly budget: LeashBudget;
  readonly expiresAt: string;
  readonly venues?: readonly string[];
  readonly recipients?: readonly Address[];
  readonly maxSlippageBps?: number;
  readonly tools?: readonly LeashTool[];
  readonly maxCalls?: number;
  /** Also draft an ERC-8004 Tag registration pinning the leash's Fence. */
  readonly tag?: boolean;
}

export interface LeashView extends Leash {
  readonly usage: LeashUsage;
  /** The newest actions (plans, denials, transactions), newest first. */
  readonly recent: readonly LeashTrailItem[];
}

export interface McpConfigSnippet {
  readonly mcpServers: Readonly<Record<string, { readonly url: string; readonly headers: Readonly<Record<string, string>> }>>;
}

export interface CreateLeashResponse {
  readonly leash: LeashView;
  /** Send in order. The first creates the owner's LykiaAccount when it does not exist yet. */
  readonly transactions: readonly UnsignedTransaction[];
  /** Who signs the session transaction and what it carries. */
  readonly session: {
    readonly signer: "owner" | "parent-session";
    readonly from: Address;
    readonly account: Address;
    readonly spec: unknown;
    readonly note: string;
  };
  /** The leash key, shown once. It works for this leash only and dies with it. */
  readonly apiKey: { readonly id: string; readonly secret: string; readonly prefix: string };
  readonly mcp: McpConfigSnippet;
  /** Optional ERC-8004 Tag registration (unsigned). */
  readonly tag: { readonly transaction: UnsignedTransaction; readonly cardDigest: string; readonly agentURI: string } | null;
  readonly enforcement: readonly { readonly limit: string; readonly enforcedBy: "chain" | "api" | "both"; readonly how: string }[];
  readonly notes: readonly string[];
}

export interface RevokeLeashResponse {
  readonly leash: LeashView;
  /** True: the key already stopped working at the API. */
  readonly keyDisabled: boolean;
  /** revokeSession(id) on the LykiaAccount, from the owner; null when nothing is on chain yet. */
  readonly transaction: UnsignedTransaction | null;
  readonly note: string;
}

export interface RenewLeashResponse extends CreateLeashResponse {
  readonly previous: { readonly id: string; readonly revokeTransaction: UnsignedTransaction | null };
}

export interface LeashTrailItem {
  readonly at: string;
  readonly kind: "planned" | "denied" | "submitted" | "settled" | "failed" | "onchain";
  readonly summary: string;
  readonly intentId?: string;
  readonly stepId?: string;
  readonly verdictDigest?: string;
  readonly decision?: "allow" | "confirm" | "deny";
  readonly reasons?: readonly LeashDenyReason[];
  readonly usd?: string | null;
  readonly txHash?: `0x${string}`;
  /** True when the chain shows it: a successful receipt with AgentCall or AgentTransfer for this session and a memo that names this intent, step and verdict. */
  readonly chainProven: boolean;
  readonly chain?: {
    readonly block: string;
    readonly events: readonly { readonly name: "AgentCall" | "AgentTransfer" | "AgentMemo"; readonly detail: string }[];
    /** The verdict tag the memo carries (first 16 hex of the digest). */
    readonly memoVerdict?: string;
  };
  /** "lykia": planned through Lykia; "chain": found on chain only (the session key acted directly). */
  readonly source: "lykia" | "chain";
}

export interface LeashTrailResponse {
  readonly leashId: string;
  readonly items: readonly LeashTrailItem[];
  readonly scanned: { readonly fromBlock: string | null; readonly toBlock: string | null; readonly note: string };
}

/** One step the leashed agent signs with its session key. */
export interface LeashPreparedStep {
  readonly intentId: string;
  readonly stepId: string;
  /** From the session key: one call on the account, or a Multicall3From batch of them. */
  readonly transaction: UnsignedTransaction;
  readonly calls: readonly { readonly kind: "agentTransfer" | "agentExecute"; readonly target: Address; readonly selector?: `0x${string}`; readonly token?: Address; readonly to?: Address; readonly amount?: string; readonly spendToken?: Address; readonly spendAmount?: string }[];
  readonly memo: string;
  readonly simulated: boolean;
}

export interface LeashPlanResponse {
  readonly leashId: string;
  readonly decision: "allow";
  readonly intent: IntentGraph;
  readonly prepared: LeashPreparedStep | null;
  readonly remaining: { readonly stepUsd: string; readonly dayUsd: string; readonly totalUsd: string };
  readonly notes: readonly string[];
}

/** details of a 422 LEASH_DENIED error. */
export interface LeashDenied {
  readonly leashId: string;
  readonly reasons: readonly LeashDenyReason[];
  readonly remaining: { readonly stepUsd: string; readonly dayUsd: string; readonly totalUsd: string };
  readonly verdictDigest: string | null;
  readonly intentId: string | null;
}

export interface LeashSubmitResponse {
  readonly leashId: string;
  readonly status: "settled" | "failed" | "pending";
  readonly chainProven: boolean;
  readonly next: LeashPreparedStep | null;
  readonly usage: LeashUsage;
}
