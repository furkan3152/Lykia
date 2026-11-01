import type { IntentGraph, Outrun } from "@lykia/core";
import { useEffect, useState } from "react";

import { apiUrl } from "../../lib/api";
import { openEventStream, type StreamState } from "../../lib/sse";

interface StreamEvents {
  readonly intent: IntentGraph;
  readonly outrun: Outrun;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Follows /v1/intents/:id/stream; returns the latest graph and outrun pushed by the server. */
export function useIntentStream(id: string | null): { readonly intent: IntentGraph | null; readonly outrun: Outrun | null; readonly state: StreamState | "idle" } {
  const [intent, setIntent] = useState<IntentGraph | null>(null);
  const [outrun, setOutrun] = useState<Outrun | null>(null);
  const [state, setState] = useState<StreamState | "idle">("idle");
  useEffect(() => {
    if (!id) return undefined;
    const stream = openEventStream<StreamEvents>({
      url: apiUrl(`/v1/intents/${encodeURIComponent(id)}/stream`),
      parsers: {
        intent: (data) => (isObject(data) && Array.isArray(data.steps) ? (data as unknown as IntentGraph) : null),
        outrun: (data) => (isObject(data) && Array.isArray(data.waypoints) ? (data as unknown as Outrun) : null),
      },
      onEvent: (name, value) => {
        if (name === "intent") setIntent(value as IntentGraph);
        else setOutrun(value as Outrun);
      },
      onStateChange: (next) => setState(next),
      maxAttempts: 8,
    });
    return () => stream.close();
  }, [id]);
  return { intent, outrun, state };
}
