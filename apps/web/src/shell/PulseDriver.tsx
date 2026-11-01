import { useEffect } from "react";

import { useArcPulse } from "../hooks/useArcPulse";
import { apiUrl } from "../lib/api";
import { useEnvironment } from "../lib/environment";
import { usePulse } from "../lib/pulseStore";
import { openEventStream } from "../lib/sse";
import type { ArcPulse } from "../lib/types";

function parsePulse(data: unknown): ArcPulse | null {
  if (!data || typeof data !== "object") return null;
  const p = data as Partial<ArcPulse>;
  return typeof p.block === "number" && typeof p.environment === "string" ? (p as ArcPulse) : null;
}

/** Feeds the pulse store: the SSE stream when the API answers, else polling (API, then Arc RPC). */
export function PulseDriver() {
  const environment = useEnvironment();
  const receive = usePulse((s) => s.receive);
  const dim = usePulse((s) => s.dim);
  const lit = usePulse((s) => s.lit);
  const blocks = usePulse((s) => s.blocks);
  const streaming = usePulse((s) => s.source === "stream");
  const polled = useArcPulse(environment, !streaming);

  useEffect(() => {
    const stream = openEventStream<{ pulse: ArcPulse }>({
      url: apiUrl("/v1/arc/pulse/stream", { environment }),
      parsers: { pulse: parsePulse },
      onEvent: (_name, value) => receive(value, "stream"),
      maxAttempts: 3,
    });
    return () => stream.close();
  }, [environment, receive]);

  useEffect(() => {
    if (!streaming && polled.pulse && polled.source) receive(polled.pulse, polled.source);
  }, [streaming, polled.pulse, polled.source, receive]);

  useEffect(() => {
    if (!lit) return undefined;
    const id = window.setTimeout(dim, 260);
    return () => window.clearTimeout(id);
  }, [lit, blocks, dim]);

  return null;
}
