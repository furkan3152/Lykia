/**
 * `@lykia/sdk/aggregator`: best execution on Arc. Quote any action (swap,
 * fx, transfer, bridge, deposit, withdraw, supply, borrow, repay, batch),
 * then build ready-to-sign calls from the quote id. Builds are simulated on
 * Arc and checked by the Fence and the security layer before they come back;
 * nothing is signed by Lykia.
 */
import type { Address, ArcEnvironment, Fence, PlanAction, UnsignedTransaction } from "@lykia/core";
import { q, type LykiaTransport } from "./transport.js";

export type ActionKind = "transfer" | "swap" | "fx" | "bridge" | "deposit" | "withdraw" | "supply" | "borrow" | "repay" | "batch";

export interface ActionParams {
  /** The signing address. */
  readonly taker: Address;
  readonly environment?: ArcEnvironment;
  readonly tokenIn?: string;
  readonly tokenOut?: string;
  readonly token?: string;
  /** Whole tokens as a decimal string, or "all". */
  readonly amount?: string;
  readonly to?: Address;
  readonly memo?: string;
  readonly destination?: string;
  readonly recipient?: Address;
  readonly venue?: string;
  readonly maxRisk?: "low" | "medium" | "high";
  readonly collateral?: { readonly token: string; readonly amount?: string };
  readonly minHealth?: string;
  readonly actions?: readonly PlanAction[];
  readonly slippageBps?: number;
  /** Your fee, paid on chain beside Lykia's (at most 50 bps). */
  readonly integratorFee?: { readonly bps: number; readonly recipient: Address };
  readonly venues?: { readonly include?: readonly string[]; readonly exclude?: readonly string[] };
  readonly split?: boolean;
  readonly fence?: Fence;
  readonly signer?: "wallet" | "agent";
  readonly agent?: { readonly address: Address; readonly agentId?: string };
}

export interface BuildOptions {
  readonly format?: "transactions" | "calls" | "eip5792";
  readonly batch?: "step" | "single";
  readonly confirm?: boolean;
  readonly preview?: boolean;
  /** A registered execution provider (for example a Circle-native path); default "lykia". */
  readonly provider?: string;
}

export interface AmountView {
  readonly symbol: string;
  readonly token: Address;
  readonly amount: string;
  readonly units: string;
  readonly minimum?: string;
  readonly minimumUnits?: string;
  readonly usd: string | null;
}

export interface Quote {
  readonly id: string;
  readonly kind: ActionKind;
  readonly environment: ArcEnvironment;
  readonly taker: Address;
  readonly expiresAt: string;
  readonly sell: readonly AmountView[];
  readonly buy: readonly AmountView[];
  readonly route: { readonly steps: readonly { id: string; kind: string; venue: string; summary: string; reason: string | null }[] };
  readonly best: { readonly venue: string; readonly label: string; readonly amountOut?: string; readonly apy?: string | null } | null;
  readonly alternatives: readonly { readonly venue: string; readonly label: string; readonly amountOut?: string; readonly apy?: string | null; readonly executable: boolean }[];
  readonly priceImpactBps: number | null;
  readonly gas: { readonly units: number; readonly priceWei: string; readonly usdc: string };
  readonly fees: { readonly lykiaBps: number; readonly lykiaUsd: string | null; readonly integratorUsd: string | null; readonly totalUsd: string | null; readonly integrator: { bps: number; recipient: Address } | null };
  readonly fence: { readonly decision: "allow" | "confirm" | "deny"; readonly signable: boolean; readonly reasons: readonly string[]; readonly digest: string };
  readonly warnings: readonly string[];
  readonly providers?: { readonly quotes: readonly { provider: string; label: string; poweredBy?: "Circle"; badge: string | null }[] };
}

export interface Build extends Omit<Quote, "id" | "expiresAt"> {
  readonly quoteId: string | null;
  readonly intentId: string;
  readonly format: "transactions" | "calls" | "eip5792";
  readonly preview: boolean;
  readonly chainId: number;
  readonly transactions: readonly UnsignedTransaction[];
  readonly calls: readonly { readonly to: Address; readonly data: `0x${string}`; readonly value: string; readonly label: string; readonly stepId: string }[];
  readonly walletSendCalls: { version: "2.0.0"; chainId: `0x${string}`; from: Address; atomicRequired: true; calls: readonly { to: Address; data: `0x${string}`; value: `0x${string}` }[] } | null;
  readonly steps: readonly { readonly id: string; readonly kind: string; readonly venue: string; readonly summary: string; readonly binding: string; readonly memo: string; readonly security: { readonly decision: string; readonly findings: readonly unknown[] } }[];
  readonly simulation: { readonly ok: boolean; readonly block: string | null; readonly reason?: string };
  readonly security: { readonly decision: "pass" | "warn" | "block"; readonly findings: number; readonly warnings: readonly string[] };
}

export function aggregatorApi(t: LykiaTransport) {
  return {
    /** A swap quote from query parameters. */
    swapQuote: (input: { taker: Address; tokenIn: string; tokenOut: string; amount: string; slippageBps?: number; environment?: ArcEnvironment }) =>
      t.request<Quote>("GET", `/v1/aggregator/quote${q({ taker: input.taker, tokenIn: input.tokenIn, tokenOut: input.tokenOut, amount: input.amount, slippageBps: input.slippageBps === undefined ? undefined : String(input.slippageBps), environment: t.env(input.environment) })}`),
    /** Quote any action. */
    quote: (kind: ActionKind, params: ActionParams) => t.request<Quote>("POST", "/v1/aggregator/quote", { kind, ...params, environment: t.env(params.environment) }),
    /** Ready-to-sign calls from a quote id. */
    build: (quoteId: string, options: BuildOptions = {}) => t.request<Build>("POST", "/v1/aggregator/build", { quoteId, ...options }),
  };
}

export type AggregatorApi = ReturnType<typeof aggregatorApi>;
