/** Contract types: the Flock (unified balance sheet on Arc). */
import type { Address } from "../contracts.js";
import type { ArcEnvironment } from "../networks.js";

export type HoldingKind = "token" | "vault" | "supply" | "debt";

export interface FlockHolding {
  readonly symbol: string;
  readonly token: Address;
  /** Whole-token decimal string. */
  readonly amount: string;
  /** USD value, decimal string; null when no price source (never zero). */
  readonly usd: string | null;
  /** "wallet", "gateway" or a venue id. */
  readonly where: string;
  readonly kind: HoldingKind;
}

export interface FlockSnapshot {
  readonly address: Address;
  readonly environment: ArcEnvironment;
  readonly at: string;
  readonly block: string | null;
  /** Sum of priced holdings minus debt; null when anything material is unpriced. */
  readonly totalUsd: string | null;
  readonly holdings: readonly FlockHolding[];
  readonly gateway: { readonly unifiedUsdc: string | null; readonly note?: string };
  readonly health: readonly { readonly venue: string; readonly healthFactor: string | null }[];
  /** Native USDC balance (gas), 18-decimal base units as a string. */
  readonly native: { readonly usdc18: string };
  /** Price sources used, e.g. { EURC: "chainlink:EUR/USD" }. */
  readonly prices: Readonly<Record<string, { readonly usd: string | null; readonly source: string }>>;
  readonly notes: readonly string[];
}

export const FLOCK_STREAM_EVENTS = ["snapshot", "unchanged", "error"] as const;

/** GET /flock/:address?environment=both: mainnet and testnet side by side. */
export interface FlockBothSnapshot {
  readonly address: Address;
  readonly mainnet: FlockSnapshot | { readonly error: string };
  readonly testnet: FlockSnapshot | { readonly error: string };
}
