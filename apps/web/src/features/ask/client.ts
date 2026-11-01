/**
 * POST /v1/agent/chat as a stream. Calls `onEvent` for every SSE event and
 * resolves when the stream ends. Aborting cancels the request.
 */
import type { ChatEvent, ChatRequest } from "@lykia/core/api/agents";

import { apiUrl } from "../../lib/api";
import { sessionToken } from "../../lib/session";
import { parseSse, payload } from "./sse";

export async function streamChat(request: ChatRequest, onEvent: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const token = sessionToken();
  const response = await fetch(apiUrl("/v1/agent/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { "Lykia-Session": token } : {}) },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = `Lyko could not answer (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSse(buffer);
    buffer = rest;
    for (const e of events) {
      const data = payload<unknown>(e);
      if (data !== null) onEvent({ event: e.event, data } as ChatEvent);
    }
  }
}
