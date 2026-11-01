import type { ArcEnvironment } from "@lykia/core";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../lib/api";
import { pulseFromRpc } from "../lib/arcRpc";
import type { ArcPulse } from "../lib/types";

export type PulseSource = "api" | "rpc";

export interface ArcPulseView {
  readonly pulse: ArcPulse | null;
  readonly source: PulseSource | null;
  readonly loading: boolean;
  readonly offline: boolean;
}

/**
 * Arc's pulse every 4 s: from the Lykia API when it answers, otherwise
 * straight from Arc's public RPC (labelled). Null only when both are down.
 */
export function useArcPulse(environment: ArcEnvironment, enabled = true): ArcPulseView {
  const query = useQuery({
    queryKey: ["arc-pulse", environment],
    enabled,
    refetchInterval: 4_000,
    retry: false,
    queryFn: async ({ signal }): Promise<{ pulse: ArcPulse; source: PulseSource }> => {
      try {
        const pulse = await apiGet<ArcPulse>("/v1/arc/pulse", { query: { environment }, signal, timeoutMs: 3_000 });
        return { pulse, source: "api" };
      } catch {
        return { pulse: await pulseFromRpc(environment, signal), source: "rpc" };
      }
    },
  });
  return { pulse: query.data?.pulse ?? null, source: query.data?.source ?? null, loading: query.isLoading, offline: query.isError };
}
