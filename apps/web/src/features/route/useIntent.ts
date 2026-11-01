/** An intent and its outrun, kept live from the intent stream. */
import type { IntentGraph, Outrun } from "@lykia/core";
import type { CreateIntentResponse } from "@lykia/core/api/intents";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiGet, apiUrl } from "../../lib/api";
import { openEventStream } from "../../lib/sse";

export function useIntent(id: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["intent", id],
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      // GET /v1/intents/:id answers { intent, outrun }; older servers answered the bare graph.
      const body = await apiGet<CreateIntentResponse | IntentGraph>(`/v1/intents/${encodeURIComponent(id!)}`, { signal });
      if ("intent" in body && "outrun" in body) return { intent: body.intent, outrun: body.outrun, stored: true } satisfies CreateIntentResponse;
      const outrun = await apiGet<Outrun>(`/v1/intents/${encodeURIComponent(id!)}/outrun`, { signal });
      return { intent: body as IntentGraph, outrun, stored: true } satisfies CreateIntentResponse;
    },
  });
  useEffect(() => {
    if (!id) return undefined;
    const s = openEventStream<{ intent: IntentGraph; outrun: Outrun }>({
      url: apiUrl(`/v1/intents/${encodeURIComponent(id)}/stream`),
      parsers: { intent: (d) => (d && typeof d === "object" && "steps" in (d as object) ? (d as IntentGraph) : null), outrun: (d) => (d && typeof d === "object" && "waypoints" in (d as object) ? (d as Outrun) : null) },
      onEvent: (name, value) =>
        qc.setQueryData<CreateIntentResponse>(["intent", id], (old) => (old ? { ...old, [name]: value } : old)),
      maxAttempts: 4,
    });
    return () => s.close();
  }, [id, qc]);
  return query;
}

