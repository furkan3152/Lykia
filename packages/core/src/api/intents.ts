/** Contract types: intents and outruns. */
import type { SecurityReport } from "../security/types.js";
import type { IntentGraph, UnsignedTransaction, IntentStep } from "../intent.js";
import type { Outrun } from "../outrun.js";
import type { ProtocolDescriptor } from "../protocols.js";

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
