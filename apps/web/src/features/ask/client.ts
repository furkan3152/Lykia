/**
 * POST /v1/agent/chat as a stream. Calls `onEvent` for every SSE event and
 * resolves when the stream ends. Aborting cancels the request.
 */
import type { ChatEvent, ChatRequest } from "@lykia/core/api/agents";

import { apiUrl } from "../../lib/api";
import { sessionToken } from "../../lib/session";
import { parseSse, payload } from "./sse";
import { currentLocale, t } from "../../i18n";

export async function streamChat(request: ChatRequest, onEvent: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const token = sessionToken();
  const response = await fetch(apiUrl("/v1/agent/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", "Accept-Language": currentLocale(), ...(token ? { "Lykia-Session": token } : {}) },
    // Lyko answers in the interface language, whatever language the message is in.
    body: JSON.stringify({ ...request, locale: currentLocale() }),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = t("ask.client.lykoCouldNotAnswerHttp", { status: response.status });
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
