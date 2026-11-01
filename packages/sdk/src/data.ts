/** `@lykia/sdk/data`: tokens, prices, protocols, portfolios, address screening, Scent and transaction explanations on Arc. */
import type { Address, ArcEnvironment } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { ScentReport } from "@lykia/core/api/scent";
import { q, type LykiaTransport } from "./transport.js";

export interface PriceRow {
  readonly symbol: string;
  /** null = unpriced (never zero). */
  readonly usd: string | null;
  readonly source: string;
  readonly updatedAt: string | null;
}

export function dataApi(t: LykiaTransport) {
  return {
    tokens: (environment?: ArcEnvironment) => t.request<{ environment: ArcEnvironment; tokens: { symbol: string; name: string; address: Address | null; decimals: number; priceUsd: string | null; priceSource: string | null }[] }>("GET", `/v1/data/tokens${q({ environment: t.env(environment) })}`),
    prices: (symbols?: readonly string[], environment?: ArcEnvironment) => t.request<{ prices: PriceRow[]; at: string }>("GET", `/v1/data/prices${q({ symbols: symbols?.join(","), environment: t.env(environment) })}`),
    protocols: (environment?: ArcEnvironment) => t.request<{ protocols: { id: string; name: string; category: string; status: string; lykia: string; tvlUsd: number | null; rates: unknown }[] }>("GET", `/v1/data/protocols${q({ environment: t.env(environment) })}`),
    portfolio: (address: Address, environment?: ArcEnvironment) => t.request<FlockSnapshot & { venues: { venue: string; items: number; usd: string | null }[] }>("GET", `/v1/data/portfolio/${address}${q({ environment: t.env(environment) })}`),
    screenAddress: (address: Address, options: { owner?: Address; environment?: ArcEnvironment } = {}) => t.request<{ decision: "pass" | "warn" | "block"; kind: string; findings: unknown[]; circleCompliance: unknown }>("GET", `/v1/security/screen/address/${address}${q({ owner: options.owner, environment: t.env(options.environment) })}`),
    scent: (token: Address, environment?: ArcEnvironment) => t.request<ScentReport>("GET", `/v1/security/scent/token/${token}${q({ environment: t.env(environment) })}`),
    explainTx: (input: { hash: `0x${string}`; environment?: ArcEnvironment } | { transaction: { from: Address; to: Address; data: `0x${string}`; value?: string }; environment?: ArcEnvironment }) => t.request<{ summary: string; steps: string[] }>("POST", "/v1/tx/explain", { ...input, environment: t.env(input.environment) }),
  };
}

export type DataApi = ReturnType<typeof dataApi>;
