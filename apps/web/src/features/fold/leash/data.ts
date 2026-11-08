/** The owner's leashes (signed in), or the sample leashes on the sample flock; what the API offers for Gateway leashes; the owner's Gateway balance. */
import type { LeashView } from "@lykia/core/api/leash";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiGet } from "../../../lib/api";
import type { FoldOwner } from "../data";
import { sampleLeashes, type GatewayOffer } from "./model";

export function useLeashes(o: FoldOwner) {
  const q = useQuery({
    queryKey: ["leashes", o.address, o.environment, o.signedIn],
    enabled: Boolean(o.address && o.signedIn),
    refetchInterval: 30_000,
    queryFn: ({ signal }) => apiGet<{ leashes: LeashView[] }>("/v1/leashes", { query: { owner: o.address, environment: o.environment }, signal, timeoutMs: 20_000 }),
  });
  const [now] = useState(() => Date.now());
  const sample = useMemo(() => (o.sample ? { leashes: sampleLeashes(now) } : undefined), [o.sample, now]);
  return { ...q, data: q.data ?? sample };
}

/** GET /v1/leashes/templates (public): where spending from a Gateway balance is offered. */
export function useGatewayOffer() {
  return useQuery({
    queryKey: ["leash-templates"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: ({ signal }) => apiGet<{ gateway?: GatewayOffer }>("/v1/leashes/templates", { signal, timeoutMs: 10_000 }),
    select: (r) => r.gateway,
  });
}

export interface GatewayBalanceView {
  readonly total: string | null;
  readonly perChain?: readonly { readonly chain: string; readonly balance: string }[];
}

/** The owner's unified Gateway balance per chain (Circle's API through Lykia). */
export function useGatewayBalance(address: string | null, environment: FoldOwner["environment"], enabled: boolean) {
  return useQuery({
    queryKey: ["gateway", address, environment],
    enabled: Boolean(address) && enabled,
    retry: false,
    queryFn: ({ signal }) => apiGet<GatewayBalanceView>("/v1/circle/gateway/balance", { query: { owner: address, environment }, signal, timeoutMs: 10_000 }),
  });
}
