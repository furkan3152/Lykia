/**
 * Lykia's security layer (`lykia.security/v1`): the shared vocabulary.
 *
 * Every check returns findings. A finding with severity `block` stops a step
 * before anything reaches a wallet; `warn` is shown next to the step; `info`
 * explains what was checked. The layer fails closed on what it can decode:
 * an outflow it cannot explain is a block, never a warning.
 */
import type { Address } from "../contracts.js";
import type { UnsignedTransaction } from "../intent.js";

export const SECURITY_SPEC_VERSION = "lykia.security/v1" as const;

export const SECURITY_LAYERS = Object.freeze(["simulation", "address", "approvals", "monitor", "breakers", "platform"] as const);
export type SecurityLayer = (typeof SECURITY_LAYERS)[number];

export type FindingSeverity = "block" | "warn" | "info";

export interface SecurityFinding {
  readonly layer: SecurityLayer;
  /** Stable rule id, for example `simulation.unexpected-transfer`. */
  readonly rule: string;
  readonly severity: FindingSeverity;
  /** One plain English sentence. */
  readonly message: string;
  readonly stepId?: string;
  readonly address?: Address;
}

export type SecurityDecision = "pass" | "warn" | "block";

export function decisionOf(findings: readonly SecurityFinding[]): SecurityDecision {
  if (findings.some((f) => f.severity === "block")) return "block";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "pass";
}

/** One decoded call inside a prepared transaction (batches and memos are unwrapped). */
export type DecodedCall =
  | { readonly kind: "erc20-transfer"; readonly token: Address; readonly to: Address; readonly amount: string }
  | { readonly kind: "erc20-approve"; readonly token: Address; readonly spender: Address; readonly amount: string }
  | { readonly kind: "erc20-transfer-from"; readonly token: Address; readonly from: Address; readonly to: Address; readonly amount: string }
  | { readonly kind: "permit"; readonly token: Address; readonly spender: Address; readonly amount: string }
  | { readonly kind: "permit2-approve"; readonly token: Address; readonly spender: Address; readonly amount: string }
  | { readonly kind: "approval-for-all"; readonly target: Address; readonly operator: Address; readonly approved: boolean }
  | { readonly kind: "native"; readonly to: Address; readonly value: string }
  | {
      readonly kind: "call";
      readonly target: Address;
      readonly selector: string;
      /** Decoded signature when the ABI is known, for example `deposit(uint256,address)`. */
      readonly fn: string | null;
      /** Addresses the call names as a receiver of value (`receiver`, `recipient`, `onBehalfOf`, `mintRecipient`, `to`). */
      readonly receivers: readonly { readonly name: string; readonly address: Address }[];
      /** True when the call carries an Arc Memo around it. */
      readonly memo?: boolean;
    };

export interface BalanceChange {
  readonly token: Address;
  readonly symbol: string | null;
  /** Base units leaving the signer (upper bound from transfers and approvals). */
  readonly out: string;
  /** Base units coming back, when the simulation could read them. */
  readonly in: string | null;
}

/** The "What you will sign" summary shown before any signature. */
export interface SigningSummary {
  readonly lines: readonly string[];
  readonly calls: readonly DecodedCall[];
  readonly balanceChanges: readonly BalanceChange[];
  readonly approvals: readonly { readonly token: Address; readonly spender: Address; readonly amount: string; readonly exact: boolean }[];
  readonly contractsTouched: readonly Address[];
}

export interface SecurityReport {
  readonly schema: typeof SECURITY_SPEC_VERSION;
  readonly stepId: string;
  readonly decision: SecurityDecision;
  readonly findings: readonly SecurityFinding[];
  readonly summary: SigningSummary;
  /** How the transactions were simulated: `eth_call`, `eth_simulateV1`, or `unavailable` (with a warning). */
  readonly simulation: "eth_call" | "eth_simulateV1" | "unavailable" | "skipped";
  readonly checkedAt: string;
  /** Ready-to-sign resets for approvals that may leave an allowance behind (sign after the step settles). */
  readonly cleanup: readonly UnsignedTransaction[];
  /** sha256 of the canonical report body; the audit log records it. */
  readonly digest: string;
}
