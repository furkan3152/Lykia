/** Contract types: intents and outruns. */
import type { SecurityReport } from "../security/types.js";
import type { IntentGraph, UnsignedTransaction, IntentStep } from "../intent.js";
import type { Outrun } from "../outrun.js";
import type { ProtocolDescriptor } from "../protocols.js";
import type { Finding } from "../preflight/types.js";

export interface CreateIntentResponse {
  readonly intent: IntentGraph;
  readonly outrun: Outrun;
  /** False when stored nothing (dryRun). */
  readonly stored: boolean;
}

export interface PrepareStepResponse {
  readonly stepId: string;
  readonly transactions: readonly UnsignedTransaction[];
  readonly binding: string;
  /** The memo string each value-moving call carries. */
  readonly memo: string;
  /** What the security layer checked before returning these calls ("What you will sign"). */
  readonly security?: SecurityReport;
  /** Every step these transactions carry: more than one when a stage's steps go out as one Multicall3From batch. */
  readonly stepIds?: readonly string[];
  /** Set when the step was rebuilt from what the step before actually delivered (base units). */
  readonly replanned?: { readonly symbol: string; readonly planned: string; readonly actual: string };
  /** Preflight as read now, before these calls are signed (warnings were acknowledged to get here). */
  readonly preflight?: readonly Finding[];
}

export interface PreflightResponse {
  readonly intentId: string;
  readonly at: string;
  readonly findings: readonly Finding[];
  readonly gate: { readonly blocked: boolean; readonly needsAck: readonly string[] };
}

export interface SubmitStepResponse {
  readonly step: IntentStep;
  readonly outrun: Outrun;
}

export interface VenueRow extends ProtocolDescriptor {
  readonly executable: boolean;
  readonly live: boolean;
}

export interface VenuesResponse {
  readonly environment: string;
  readonly venues: readonly VenueRow[];
}

export const INTENT_STREAM_EVENTS = ["intent", "outrun"] as const;
