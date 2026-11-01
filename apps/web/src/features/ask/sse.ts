/**
 * Server-Sent Events over a POST response (EventSource only does GET).
 * Pure framing: feed text chunks, get complete events back plus the
 * unfinished remainder. Tolerates CRLF, comments and multi-line data.
 */
export interface SseEvent {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
}

export function parseSse(buffer: string): { readonly events: SseEvent[]; readonly rest: string } {
  const normal = buffer.replace(/\r\n/gu, "\n");
  const blocks = normal.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /u, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }
    if (data.length === 0 && event === "message") continue;
    events.push({ event, data: data.join("\n"), ...(id ? { id } : {}) });
  }
  return { events, rest };
}

/** Parses one event's JSON payload; null when malformed. */
export function payload<T>(e: SseEvent): T | null {
  try {
    return JSON.parse(e.data) as T;
  } catch {
    return null;
  }
}
