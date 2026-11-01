/**
 * Server-Sent Events helper.
 *
 * `openSse(req, res, options)` reserves a stream slot (429 TOO_MANY_STREAMS
 * before any header is written), sends the SSE headers and `retry:`, then
 * keeps the connection alive with a comment every 15 s. Writes are
 * backpressure-aware: while the socket buffer is full, heartbeats are
 * skipped, `droppable` events are dropped, and a consumer holding more than
 * 1 MB of unsent data is disconnected. Every exit path (client close,
 * `close()`, lifetime reached, socket error) runs the cleanup exactly once:
 * timers cleared, slot released, `onClose` callbacks called.
 *
 * Do not mount `compression` in front of SSE routes: it buffers the stream.
 */
import type { Request, Response } from "express";
import type { StreamSlots } from "./limits.js";

export const SSE_RETRY_MS = 3_000;
export const SSE_HEARTBEAT_MS = 15_000;
export const SSE_MAX_DURATION_MS = 30 * 60_000;
export const SSE_MAX_BUFFERED_BYTES = 1_000_000;

export interface SseEvent {
  readonly event?: string;
  /** Serialized as JSON unless already a string. */
  readonly data: unknown;
  readonly id?: string | number;
  readonly retry?: number;
}

/** Strips CR/LF from single-line fields (event names, ids): they would end the field early. */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/gu, " ");
}

/** One SSE frame. Multi-line data is split into several `data:` lines, as the format requires. */
export function formatSseEvent(event: SseEvent): string {
  let out = "";
  if (event.id !== undefined) out += `id: ${singleLine(String(event.id))}\n`;
  if (event.event) out += `event: ${singleLine(event.event)}\n`;
  if (event.retry !== undefined && Number.isInteger(event.retry) && event.retry >= 0) out += `retry: ${event.retry}\n`;
  const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  for (const line of (data ?? "null").split(/\r\n|\r|\n/u)) out += `data: ${line}\n`;
  return `${out}\n`;
}

/** A comment line (ignored by EventSource; keeps proxies from timing the connection out). */
export function formatSseComment(text: string): string {
  return `: ${singleLine(text)}\n\n`;
}

export interface SseOptions {
  readonly slots?: StreamSlots;
  readonly retryMs?: number;
  readonly heartbeatMs?: number;
  readonly maxDurationMs?: number;
  readonly maxBufferedBytes?: number;
  readonly now?: () => number;
}

export interface SendOptions {
  /** Drop instead of queueing while the client is not draining (e.g. a superseded snapshot). */
  readonly droppable?: boolean;
}

export interface SseStream {
  readonly closed: boolean;
  /** `Last-Event-ID` sent by a reconnecting EventSource, if any. */
  readonly lastEventId: string | undefined;
  /** Returns false when the event was not written (closed, or dropped under backpressure). */
  send(event: string, data: unknown, id?: string | number, options?: SendOptions): boolean;
  comment(text: string): void;
  onClose(callback: () => void): void;
  /** Ends the stream gracefully. */
  close(): void;
}

const LAST_EVENT_ID_MAX = 128;

export function openSse(req: Request, res: Response, options: SseOptions = {}): SseStream {
  const releaseSlot = options.slots?.acquire(req) ?? (() => undefined);
  let untrack: () => void = () => undefined;
  const release = () => {
    untrack();
    releaseSlot();
  };
  const maxBuffered = options.maxBufferedBytes ?? SSE_MAX_BUFFERED_BYTES;
  const now = options.now ?? Date.now;
  const callbacks: Array<() => void> = [];
  let closed = false;
  let draining = false;
  let heartbeat: NodeJS.Timeout | null = null;
  let deadline: NodeJS.Timeout | null = null;

  const rawLastEventId = req.get("last-event-id")?.trim();
  const lastEventId = rawLastEventId && rawLastEventId.length <= LAST_EVENT_ID_MAX ? rawLastEventId : undefined;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (deadline) clearTimeout(deadline);
    release();
    for (const callback of callbacks.splice(0)) {
      try {
        callback();
      } catch {
        // Cleanup callbacks must not prevent the others from running.
      }
    }
  };

  const write = (chunk: string, droppable: boolean): boolean => {
    if (closed || res.destroyed || res.writableEnded) return false;
    if (draining && droppable) return false;
    const flushed = res.write(chunk);
    if (!flushed) draining = true;
    if (res.writableLength > maxBuffered) {
      // A consumer this far behind will never catch up; cut it so memory stays bounded.
      cleanup();
      res.destroy();
      return false;
    }
    return true;
  };

  res.on("drain", () => {
    draining = false;
  });
  res.on("close", cleanup);
  res.on("error", cleanup);
  req.on("close", cleanup);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  req.socket.setNoDelay(true);
  req.socket.setTimeout(0);

  const stream: SseStream = {
    get closed() {
      return closed;
    },
    lastEventId,
    send(event, data, id, sendOptions) {
      return write(formatSseEvent({ event, data, ...(id !== undefined ? { id } : {}) }), sendOptions?.droppable === true);
    },
    comment(text) {
      write(formatSseComment(text), true);
    },
    onClose(callback) {
      if (closed) {
        callback();
        return;
      }
      callbacks.push(callback);
    },
    close() {
      if (closed) return;
      cleanup();
      if (!res.writableEnded) res.end();
    },
  };

  if (res.destroyed) {
    cleanup();
    return stream;
  }

  if (options.slots) untrack = options.slots.track(() => stream.close());
  write(`retry: ${options.retryMs ?? SSE_RETRY_MS}\n\n`, false);
  heartbeat = setInterval(() => {
    // Skipped while draining: the buffered data already proves the connection is alive.
    write(formatSseComment(`hb ${new Date(now()).toISOString()}`), true);
  }, options.heartbeatMs ?? SSE_HEARTBEAT_MS);
  deadline = setTimeout(() => {
    write(formatSseComment("stream lifetime reached; reconnect"), false);
    stream.close();
  }, options.maxDurationMs ?? SSE_MAX_DURATION_MS);
  heartbeat.unref();
  deadline.unref();
  return stream;
}
