/**
 * Lykia Intent Specification v1 (`lykia.intent/v1`).
 *
 * An intent is an outcome ("put half my USDC to work", "send 200 EURC to
 * the supplier with invoice 4411", "bridge 50 USDC to Base"). The planner
 * compiles it into an IntentGraph: a DAG of steps on Arc, each owned by one
 * account and executed through one venue. Arc finality is deterministic, so
 * a same-chain step is settled the moment its receipt exists; only
 * cross-chain legs (CCTP, Gateway) wait for a destination.
 *
 * The server never signs. `prepare` hands out unsigned transactions plus a
 * binding hash; `submit` takes only transaction hashes and re-derives the
 * outcome from receipts. Every value-moving call carries an Arc Memo with
 * the outrun id, the step id and the Fence verdict digest, so anyone can
 * follow the money on the explorer.
 */
import type { Sha256Digest } from "./canonical.js";
import type { Address } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";
import type { FenceVerdict } from "./fenceEvaluate.js";
import type { RouteChoice } from "./routes.js";
import type { StepFee } from "./fee.js";

export const INTENT_SPEC_VERSION = "lykia.intent/v1" as const;

export const STEP_KINDS = Object.freeze([
  "approve",
  "transfer",
  "swap",
  "fx",
  "deposit",
  "withdraw",
  "supply",
  "borrow",
  "repay",
  "bridge",
  "gateway-deposit",
  "register-agent",
  "attest",
] as const);

/**
 * - approve: ERC-20 allowance (folded into the next call through Multicall3From when possible);
 * - transfer: send to an address, with an Arc Memo (invoice, payroll line, agent job);
 * - swap: AMM swap; fx: USDC <-> EURC conversion, routed through the best on-chain pool and checked against the reference rate;
 * - deposit / withdraw: ERC-4626 vaults; supply / borrow / repay: lending markets;
 * - bridge: CCTP V2 burn on Arc for a native mint elsewhere; gateway-deposit: into the unified Gateway balance;
 * - register-agent: ERC-8004 identity (a Tag); attest: a Fence verdict filed to the ValidationRegistry.
 */
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_STATUSES = Object.freeze([
  "blocked",
  "ready",
  "awaiting-signature",
  "submitted",
  "settling",
  "settled",
  "failed",
  "stopped",
] as const);

export type StepStatus = (typeof STEP_STATUSES)[number];

/** Who authorises a step. `agent` = an agent wallet acting inside its Fence. */
export type Signer = "wallet" | "agent" | "settlement" | "read";

export interface StepAmount {
  readonly symbol: string;
  readonly token: Address;
  readonly decimals: number;
  /** Base units, decimal integer string. */
  readonly amount: string;
  /** Outputs: the floor the step must meet. */
  readonly minimum?: string;
  /** USD value (decimal string); null = unpriced, never zero. */
  readonly usd: string | null;
}

export interface UnsignedTransaction {
  readonly chainId: number;
  readonly from: Address;
  readonly to: Address;
  readonly data: `0x${string}`;
  /** Native USDC, 18-decimal base units. */
  readonly value: string;
  /** What the wallet shows: "Approve 100 USDC to Aave", "Deposit 50 USDC". */
  readonly label: string;
}

export interface StepFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface IntentStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly venue: string;
  readonly summary: string;
  readonly signer: Signer;
  readonly account: Address;
  readonly dependsOn: readonly string[];
  readonly inputs: readonly StepAmount[];
  readonly outputs: readonly StepAmount[];
  /** CCTP / Gateway legs leave Arc; everything else settles on the receipt. */
  readonly settlement: { readonly kind: "receipt" } | { readonly kind: "cctp" | "gateway"; readonly destination: string; readonly expectedSeconds: number };
  /** Why this venue: the chosen option, the alternatives it beat and one sentence of reasoning. */
  readonly route?: RouteChoice;
  /** Lykia's protocol fee for this step, paid on chain in the same transaction (see fee.ts). */
  readonly fee?: StepFee;
  status: StepStatus;
  /** Once prepared: the unsigned calls (one when batched through Multicall3From). */
  transactions?: readonly UnsignedTransaction[];
  /** Digest of the prepared calls; submit refuses receipts that do not match. */
  binding?: Sha256Digest;
  /** Transaction hashes the client reported. */
  references?: readonly `0x${string}`[];
  failure?: StepFailure;
  settledAt?: string;
  /**
   * Steps with the same stage are signed together (one Multicall3From
   * batch when the signer is an EOA). A new stage starts where a step spends
   * what the step before delivered, or where a step leaves Arc.
   */
  readonly stage?: number;
  /** What the step delivered to the account, read from its receipt (net Transfer logs of the output token). */
  received?: StepAmount;
  /** Set when the step was rebuilt at prepare time from what the step before actually delivered. */
  replanned?: { readonly symbol: string; readonly planned: string; readonly actual: string; readonly at: string };
}

export interface IntentGraph {
  readonly spec: typeof INTENT_SPEC_VERSION;
  readonly id: string;
  readonly environment: ArcEnvironment;
  readonly createdAt: string;
  /** The sentence or goal the graph came from. */
  readonly source: string;
  readonly owner: Address;
  /** Set when an agent acts for the owner. */
  readonly agent?: { readonly address: Address; readonly agentId?: string };
  readonly steps: IntentStep[];
  readonly verdict: FenceVerdict;
  readonly warnings: readonly string[];
}

export type IntentStatus = "planned" | "running" | "settled" | "failed" | "stopped" | "denied";

export function deriveIntentStatus(graph: Pick<IntentGraph, "steps" | "verdict">): IntentStatus {
  if (graph.verdict.decision === "deny") return "denied";
  const statuses = graph.steps.map((step) => step.status);
  if (statuses.length > 0 && statuses.every((s) => s === "settled")) return "settled";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "stopped") && !statuses.some((s) => s === "submitted" || s === "settling")) return "stopped";
  if (statuses.some((s) => s !== "blocked" && s !== "ready")) return "running";
  return "planned";
}
