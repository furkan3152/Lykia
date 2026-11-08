/** Contract types for /v1/leashes. */
import type { Address } from "../contracts.js";
import type { IntentGraph, UnsignedTransaction } from "../intent.js";
import type { Leash, LeashBudget, LeashDenyReason, LeashSpendFrom, LeashTemplateKey, LeashTool, LeashUsage } from "../leash.js";
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
  /** Where the money is: the owner's LykiaAccount on Arc (default) or the owner's Circle Gateway balance through LykiaStile. */
  readonly spendFrom?: LeashSpendFrom;
  /** Gateway leashes: destination chain keys ("arc", "base", ...) the agent may pay to. */
  readonly destinations?: readonly string[];
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
  /** Who signs the session transaction and what it carries. Null for a Gateway leash (see `stile`). */
  readonly session: {
    readonly signer: "owner" | "parent-session";
    readonly from: Address;
    readonly account: Address;
    readonly spec: unknown;
    readonly note: string;
  } | null;
  /** Gateway leashes: the owner's LykiaStile and the session on it. */
  readonly stile?: {
    readonly address: Address;
    /** True when `transactions` creates the Stile first (its address is predicted from the owner's nonce: send the transactions in order, nothing in between). */
    readonly deploys: boolean;
    /** The Stile's creation (no `to`), sent first from the owner's wallet; null when the owner already has one. */
    readonly deployment: { readonly chainId: number; readonly from: Address; readonly data: `0x${string}`; readonly value: "0"; readonly label: string; readonly predictedAddress: Address; readonly nonce: number } | null;
    readonly session: { readonly key: Address; readonly validUntil: number; readonly destinations: readonly { readonly key: string; readonly name: string; readonly domain: number }[]; readonly limits: unknown };
    readonly note: string;
  } | null;
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
  /** revokeSession(id) on the LykiaAccount (or, for a Gateway leash, on the LykiaStile), from the owner; null when nothing is on chain yet. */
  readonly transaction: UnsignedTransaction | null;
  /** Gateway leashes: further switches the owner may flip (pause the Stile, remove it as a Gateway delegate). */
  readonly more?: readonly UnsignedTransaction[];
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
    readonly events: readonly { readonly name: "AgentCall" | "AgentTransfer" | "AgentMemo" | "Reserved" | "StileMemo"; readonly detail: string }[];
    /** The verdict tag the memo carries (first 16 hex of the digest). */
    readonly memoVerdict?: string;
  };
  /** Gateway leashes: Gateway's record of the transfer and the mint on the destination. */
  readonly gateway?: LeashGatewayTrail;
  /** "lykia": planned through Lykia; "chain": found on chain only (the session key acted directly). */
  readonly source: "lykia" | "chain";
}

/** What the trail knows about one Gateway transfer, joined from three sources. */
export interface LeashGatewayTrail {
  readonly destination: string;
  readonly digest: `0x${string}`;
  /** The payment's transferSpecHash (Reserved on Arc, AttestationUsed on the destination). */
  readonly transferSpecHash: `0x${string}`;
  readonly transferId: string | null;
  /** Gateway's GET /v1/transfer/{id} status (polled); null before submission or when Gateway did not answer. */
  readonly status: string | null;
  readonly mintTxHash: `0x${string}` | null;
  /** True when the mint receipt carries AttestationUsed with this transferSpecHash; null when the destination could not be read. */
  readonly attestationUsed: boolean | null;
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
  /** Gateway leashes: the burn intents the reservation covers and what Lykia sends to Gateway once it lands. */
  readonly gateway?: LeashGatewayStep;
}

export interface LeashGatewayStep {
  readonly destination: string;
  readonly recipient: Address;
  /** USDC the recipient receives. */
  readonly amountUsdc: string;
  /** Lykia's fee leg, USDC (minted to the fee recipient on the same destination, in the same attestation). */
  readonly lykiaFeeUsdc: string;
  /** The most Circle may charge across the intents, USDC. */
  readonly maxGatewayFeeUsdc: string;
  /** EIP-712 messages, payment first. */
  readonly burnIntents: readonly unknown[];
  /** The digest Gateway validates through isValidSignature. */
  readonly digest: `0x${string}`;
  /** abi.encode(sessionId): the opaque ERC-1271 signature bytes. */
  readonly signature: `0x${string}`;
  readonly transferSpecHash: `0x${string}`;
  readonly forward: boolean;
}

export interface LeashPlanResponse {
  readonly leashId: string;
  readonly decision: "allow";
  /** The planned intent; null for a Gateway leash, whose single transfer is in `prepared.gateway`. */
  readonly intent: IntentGraph | null;
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
  /** Gateway leashes: what Gateway answered once the reservation was on chain. */
  readonly gateway?: {
    readonly transferId: string | null;
    readonly attestation: `0x${string}` | null;
    /** gatewayMint on the destination, for anyone to send; null when forwarded. */
    readonly mint: UnsignedTransaction | null;
    readonly forwarded: boolean;
    readonly note: string;
  };
}
