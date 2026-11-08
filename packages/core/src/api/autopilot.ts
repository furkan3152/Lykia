/** Contract types for /v1/autopilot. */
import type { Address } from "../contracts.js";
import type { UnsignedTransaction } from "../intent.js";
import type { LeashDenyReason } from "../leash.js";
import type { ArcEnvironment } from "../networks.js";
import type { AutopilotLimits, AutopilotPauseCode, AutopilotSigner, AutopilotStatus, AutopilotTask, TrustLine } from "../autopilot.js";
import type { LeashView } from "./leash.js";

export interface Autopilot {
  readonly schema: "lykia.autopilot/v1";
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly status: AutopilotStatus;
  /** The leash Lyko signs under (its session is on the owner's LykiaAccount). */
  readonly leashId: string;
  readonly signer: AutopilotSigner;
  readonly limits: AutopilotLimits;
  readonly payees: readonly Address[];
  readonly tasks: readonly AutopilotTask[];
  /** The acknowledgement the owner accepted. */
  readonly ack: { readonly digest: string; readonly at: string };
  /** While pending: the transactions the owner signs once (the LykiaAccount if new, and createSession). */
  readonly sign?: readonly UnsignedTransaction[];
  readonly paused?: { readonly code: AutopilotPauseCode; readonly reason: string; readonly at: string };
  readonly stopped?: { readonly by: "owner" | "whistle" | "ask" | "leash"; readonly reason: string; readonly at: string };
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One thing Autopilot did or refused. */
export interface AutopilotRun {
  readonly id: string;
  readonly at: string;
  readonly taskId: string | null;
  readonly origin: "task" | "watch" | "owner";
  readonly summary: string;
  /** signing: handed to Circle. sent: Circle broadcast it. settled / failed: final on chain. refused: never signed. */
  readonly status: "signing" | "sent" | "settled" | "failed" | "refused";
  readonly intentId?: string;
  readonly stepId?: string;
  /** The Fence verdict digest, also carried in the transaction's Arc Memo. */
  readonly verdictDigest?: string;
  readonly usd?: string | null;
  readonly circleTxId?: string;
  readonly txHash?: `0x${string}`;
  readonly chainProven?: boolean;
  readonly reasons?: readonly LeashDenyReason[];
  /** "Signed by Lyko under your Autopilot leash", on every signed step. */
  readonly label?: string;
}

export interface AutopilotOffer {
  /** Whether this server can sign for Autopilot at all (LYKIA_CIRCLE_SERVER_WALLETS and Circle credentials). */
  readonly available: boolean;
  readonly reason: string | null;
  readonly ceilings: { readonly perStepUsd: string; readonly perDayUsd: string };
  readonly ack: { readonly lines: readonly string[]; readonly digest: string };
  readonly trust: readonly TrustLine[];
}

export interface AutopilotView {
  readonly offer: AutopilotOffer;
  readonly autopilot: Autopilot | null;
  readonly leash: LeashView | null;
  /** Spent by Autopilot today, USD, and what is left of its own daily cap. */
  readonly today: { readonly spentUsd: string; readonly leftUsd: string } | null;
  readonly runs: readonly AutopilotRun[];
}

export interface EnableAutopilotRequest {
  readonly environment?: ArcEnvironment;
  /** autopilotAckDigest(): proves the owner was shown the acknowledgement. */
  readonly ack: string;
  readonly limits: AutopilotLimits;
  readonly payees?: readonly Address[];
}

export interface EnableAutopilotResponse {
  readonly autopilot: Autopilot;
  /** Sign these once from the owner's wallet: the LykiaAccount (if new) and createSession for the Autopilot key. */
  readonly transactions: readonly UnsignedTransaction[];
  readonly notes: readonly string[];
}

export interface StopAutopilotResponse {
  readonly autopilot: Autopilot | null;
  /** True: the server will not ask Circle to sign anything more. */
  readonly signingStopped: true;
  /** revokeSession for the owner's wallet, when the session is on chain. */
  readonly transaction: UnsignedTransaction | null;
  readonly note: string;
}
