/** The owner's leashes (signed in), or the sample leashes on the sample flock. */
import type { LeashView } from "@lykia/core/api/leash";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiGet } from "../../../lib/api";
import type { FoldOwner } from "../data";
import { sampleLeashes } from "./model";

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
