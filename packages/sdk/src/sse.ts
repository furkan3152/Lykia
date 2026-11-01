/** Server-Sent Events over fetch (works in Node 18+, browsers, Deno, Bun and edge runtimes). */
export interface SseMessage<T = unknown> {
  readonly event: string;
  readonly data: T;
  readonly id?: string;
}

/** Parses an SSE byte stream into messages. JSON data is parsed; anything else stays a string. */
export async function* readSse<T = unknown>(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage<T>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buffer.search(/\r?\n\r?\n/u)) >= 0) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/u, "");
        const message = parseFrame<T>(frame);
        if (message) yield message;
      }
    }
    const tail = parseFrame<T>(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export function parseFrame<T>(frame: string): SseMessage<T> | null {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /u, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  if (data.length === 0) return null;
  const raw = data.join("\n");
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* keep the string */
  }
  return { event, data: parsed as T, ...(id !== undefined ? { id } : {}) };
}
