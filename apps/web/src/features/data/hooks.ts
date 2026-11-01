/** Data hooks over the Lykia API (react-query), shared by pages. */
import type { ArcEnvironment } from "@lykia/core";
import type { FlockBothSnapshot, FlockSnapshot } from "@lykia/core/api/flock";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../../lib/api";

export interface VaultRate { readonly address: string; readonly name: string; readonly asset: string; readonly apy: string | null; readonly tvlUsd: string | null }
export interface MarketRate { readonly marketId: string; readonly loan: string; readonly collateral: string | null; readonly borrowApy: string | null; readonly supplyApy: string | null; readonly utilization: string | null; readonly supplyUsd: string | null }
export interface ReserveRate { readonly spoke: string; readonly spokeName: string; readonly reserveId: number; readonly symbol: string; readonly supplyApy: string | null; readonly borrowApy: string | null; readonly canSupply: boolean; readonly canBorrow: boolean }
export interface RatesSnapshot { readonly environment: string; readonly vaults: readonly VaultRate[]; readonly markets: readonly MarketRate[]; readonly reserves: readonly ReserveRate[]; readonly sources: { readonly morpho: string; readonly aave: string }; readonly at: string }

export function useRates(environment: ArcEnvironment) {
  return useQuery({ queryKey: ["rates", environment], queryFn: ({ signal }) => apiGet<RatesSnapshot>("/v1/rates", { query: { environment }, signal, timeoutMs: 15_000 }), staleTime: 60_000, retry: 1 });
}

export function useFlock(address: string | null, environment: ArcEnvironment | "both") {
  return useQuery({
    queryKey: ["flock", address, environment],
    enabled: Boolean(address),
    queryFn: ({ signal }) => apiGet<FlockSnapshot | FlockBothSnapshot>(`/v1/flock/${address}`, { query: { environment }, signal, timeoutMs: 20_000 }),
    refetchInterval: 30_000,
  });
}

export function isBoth(s: FlockSnapshot | FlockBothSnapshot | undefined): s is FlockBothSnapshot {
  return Boolean(s && "mainnet" in s && "testnet" in s);
}

export function isSnapshot(s: unknown): s is FlockSnapshot {
  return Boolean(s && typeof s === "object" && "holdings" in (s as object));
}

/** Top yields per token across vaults and Aave reserves, best first. */
export function topYields(rates: RatesSnapshot | undefined, asset: string, n = 6): { label: string; apy: number | null; source: string; tvl: number | null; risk: "low" | "medium" | "high" }[] {
  if (!rates) return [];
  const rows = [
    ...rates.vaults.filter((v) => v.asset === asset).map((v) => ({ label: v.name || `Morpho vault ${v.address.slice(0, 6)}…`, apy: v.apy === null ? null : Number(v.apy) * 100, source: "Morpho API", tvl: v.tvlUsd === null ? null : Number(v.tvlUsd) })),
    ...rates.reserves.filter((r) => r.symbol === asset && r.canSupply).map((r) => ({ label: `Aave V4 ${r.spokeName}`, apy: r.supplyApy === null ? null : Number(r.supplyApy) * 100, source: "Aave API", tvl: null as number | null })),
  ];
  return rows
    .map((r) => ({ ...r, risk: (r.tvl === null ? "medium" : r.tvl >= 10_000_000 ? "low" : r.tvl >= 1_000_000 ? "medium" : "high") as "low" | "medium" | "high" }))
    .sort((a, b) => (b.apy ?? -1) - (a.apy ?? -1))
    .slice(0, n);
}

/** Shown when the API is unreachable, and labelled "sample" wherever it is used. */
export const SAMPLE_PENS = [
  { label: "Keyrock Prime USDC", apy: 5.8 },
  { label: "Galaxy USDC", apy: 6.1 },
  { label: "Aave V4 Main", apy: 4.3 },
] as const;
