import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../../lib/api";

interface FeesBeta {
  readonly beta?: { readonly perStepUsd: string; readonly perDayUsd: string } | null;
}

/** The mainnet beta cap from GET /v1/fees (shares the fees query). */
export function useBetaCap() {
  return useQuery({ queryKey: ["fees"], queryFn: ({ signal }) => apiGet<FeesBeta>("/v1/fees", { signal }), staleTime: 300_000, select: (d) => d.beta ?? null });
}
