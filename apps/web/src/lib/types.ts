/**
 * API contract types the web app reads. Domain types (IntentGraph, Outrun,
 * Fence, FenceVerdict, PlanAction, …) come from @lykia/core; the response
 * envelopes are mirrored here so the web build never depends on the API
 * package's build order.
 */
import type {
  Address,
  ArcEnvironment,
  CommandWord,
  EasterEggWord,
  Fence,
  FenceIssue,
  FenceVerdict,
  IntentGraph,
  IntentStep,
  Outrun,
  PlanAction,
  ProtocolDescriptor,
  ScentLevel,
  TokenTrust,
  UnsignedTransaction,
  WolfKind,
} from "@lykia/core";

export interface ArcPulse {
  readonly environment: ArcEnvironment;
  readonly block: number;
  readonly blockTimeMs: number | null;
  readonly gasPriceGwei: string | null;
  readonly tps: number | null;
  readonly transferCostUsd?: string | null;
  readonly finality: "deterministic";
  readonly at: string;
}

export interface HealthResponse {
  readonly status: "ok" | "degraded" | "down";
  readonly version: string;
  readonly environment: ArcEnvironment;
  readonly features?: { readonly agent: boolean; readonly stablefx: boolean; readonly x402: boolean; readonly x402Settlement?: boolean };
}

export type HoldingKind = "token" | "vault" | "supply" | "debt";

export interface FlockHolding {
  readonly symbol: string;
  readonly token: Address;
  readonly amount: string;
  readonly usd: string | null;
  readonly where: string;
  readonly kind: HoldingKind;
}

export interface FlockSnapshot {
  readonly address: Address;
  readonly environment: ArcEnvironment;
  readonly at: string;
  readonly block?: string | null;
  readonly totalUsd: string | null;
  readonly holdings: readonly FlockHolding[];
  readonly gateway: { readonly unifiedUsdc: string | null; readonly note?: string };
  readonly health: readonly { readonly venue: string; readonly healthFactor: string | null }[];
  readonly native: { readonly usdc18: string };
  readonly prices?: Readonly<Record<string, { readonly usd: string | null; readonly source: string }>>;
  readonly notes?: readonly string[];
}

export interface FenceValidateResponse {
  readonly ok: boolean;
  readonly issues?: readonly FenceIssue[];
  readonly hash?: string;
  readonly loosened?: readonly string[];
}

export interface FenceTemplatesResponse {
  readonly templates: Readonly<Record<string, Fence>>;
}

export interface ParseResponse {
  readonly actions: readonly PlanAction[];
  readonly command: CommandWord | null;
  readonly easterEgg: EasterEggWord | null;
  readonly clarify: readonly string[];
  readonly reply: string;
  readonly lang: "en" | "tr";
}

export interface CreateIntentResponse {
  readonly intent: IntentGraph;
  readonly outrun: Outrun;
  readonly stored?: boolean;
}

export interface PrepareStepResponse {
  readonly stepId?: string;
  readonly transactions: readonly UnsignedTransaction[];
  readonly binding: string;
  readonly memo: string;
}

export interface SubmitStepResponse {
  readonly step: IntentStep;
  readonly outrun: Outrun;
}

export interface ScentCheck {
  readonly id: string;
  readonly ok: boolean | null;
  readonly detail: string;
}

export interface ScentReport {
  readonly token: Address;
  readonly environment: ArcEnvironment;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
  readonly level: ScentLevel;
  readonly wolves: readonly WolfKind[];
  readonly checks: readonly ScentCheck[];
  readonly trust: TokenTrust;
  readonly at: string;
  readonly deep?: boolean;
}

export interface KunyeRecord {
  readonly agentId: string;
  readonly environment: ArcEnvironment;
  readonly owner: Address | null;
  readonly uri?: string | null;
  readonly card?: unknown;
  readonly fenceHash?: string | null;
  readonly reputation?: { readonly count: number; readonly score?: string | null } | null;
  readonly validations?: number | null;
  readonly [key: string]: unknown;
}

export interface KunyeDraftResponse {
  readonly card: unknown;
  readonly cardDigest: string;
  readonly fenceHash: string;
  readonly transaction: UnsignedTransaction;
  readonly uri?: string;
}

export interface VenueRow extends ProtocolDescriptor {
  readonly executable: boolean;
  readonly live: boolean;
}

export interface VenuesResponse {
  readonly environment: string;
  readonly venues: readonly VenueRow[];
}

export type { FenceVerdict, IntentGraph, Outrun, UnsignedTransaction };
