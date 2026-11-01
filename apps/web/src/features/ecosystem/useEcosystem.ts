import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../../lib/api";
import type { EcosystemView } from "./model";

export function useEcosystem(environment: "mainnet" | "testnet" = "mainnet") {
  return useQuery({ queryKey: ["ecosystem", environment], queryFn: ({ signal }) => apiGet<EcosystemView>("/v1/ecosystem", { query: { environment }, signal, timeoutMs: 20_000 }), staleTime: 60_000, retry: 1 });
}
