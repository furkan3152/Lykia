/** Contract types: Arc pulse and system routes. */
import type { ArcEnvironment } from "../networks.js";

export interface ArcPulse {
  readonly environment: ArcEnvironment;
  readonly block: number;
  /** Average block interval over the recent window, ms (server clock). */
  readonly blockTimeMs: number | null;
  /** Base fee in gwei of native USDC (18 decimals), as a decimal string. */
  readonly gasPriceGwei: string | null;
  /** User transactions per second over the recent window. */
  readonly tps: number | null;
  /** Cost of a plain USDC transfer (~65k gas) in USD, decimal string. */
  readonly transferCostUsd: string | null;
  readonly finality: "deterministic";
  readonly at: string;
}

export const PULSE_STREAM_EVENTS = ["pulse"] as const;

export interface HealthResponse {
  readonly status: "ok" | "degraded" | "down";
  readonly version: string;
  readonly environment: ArcEnvironment;
  readonly uptimeSeconds: number;
  readonly networks: Record<string, { readonly reachable: boolean; readonly head: number | null; readonly latencyMs: number | null }>;
  readonly store: { readonly kind: string; readonly ok: boolean };
  readonly features: { readonly agent: boolean; readonly stablefx: boolean; readonly x402: boolean; readonly x402Settlement: boolean };
}
