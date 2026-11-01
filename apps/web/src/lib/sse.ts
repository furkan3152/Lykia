/**
 * EventSource wrapper: typed, validated events and reconnection.
 *
 * The browser reconnects an EventSource by itself after a dropped connection
 * (sending Last-Event-ID), but gives up for good on an HTTP error or a wrong
 * content type. This wrapper reopens it with exponential backoff in that case,
 * validates every event's JSON with the caller's parser (a malformed event is
 * dropped, never passed on) and reports a single state machine:
 * connecting -> open -> reconnecting -> open ... -> closed.
 */
import { backoffDelay } from "./backoff";

export type StreamState = "connecting" | "open" | "reconnecting" | "closed";

/** Event name -> parser: returns the typed value, or null to drop a malformed event. */
export type EventParsers<E> = { readonly [K in keyof E]: (data: unknown) => E[K] | null };

export interface EventStreamOptions<E> {
  readonly url: string;
  readonly parsers: EventParsers<E>;
  readonly onEvent: <K extends keyof E>(name: K, value: E[K], lastEventId: string) => void;
  readonly onStateChange?: (state: StreamState, info: { readonly attempt: number }) => void;
  /** Consecutive failed (re)opens before giving up; default unlimited. */
  readonly maxAttempts?: number;
  readonly backoff?: { readonly baseMs?: number; readonly maxMs?: number };
  readonly withCredentials?: boolean;
}

export interface EventStream {
  close(): void;
  readonly state: StreamState;
}

export function openEventStream<E>(options: EventStreamOptions<E>): EventStream {
  let state: StreamState = "connecting";
  let source: EventSource | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const setState = (next: StreamState) => {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next, { attempt });
  };

  const scheduleReopen = () => {
    if (closed) return;
    attempt += 1;
    if (options.maxAttempts !== undefined && attempt > options.maxAttempts) {
      closed = true;
      setState("closed");
      return;
    }
    setState("reconnecting");
    retryTimer = setTimeout(open, backoffDelay(attempt, options.backoff));
  };

  function open() {
    if (closed) return;
    retryTimer = null;
    if (typeof EventSource === "undefined") {
      closed = true;
      setState("closed");
      return;
    }
    let es: EventSource;
    try {
      es = new EventSource(options.url, { withCredentials: options.withCredentials ?? false });
    } catch {
      scheduleReopen();
      return;
    }
    source = es;
    es.onopen = () => {
      attempt = 0;
      setState("open");
    };
    es.onerror = () => {
      if (closed || source !== es) return;
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        source = null;
        scheduleReopen();
      } else {
        setState("reconnecting");
      }
    };
    for (const name of Object.keys(options.parsers) as Array<keyof E & string>) {
      es.addEventListener(name, (event: MessageEvent) => {
        if (closed || source !== es) return;
        let data: unknown;
        try {
          data = typeof event.data === "string" ? JSON.parse(event.data) : null;
        } catch {
          return;
        }
        const value = options.parsers[name](data);
        if (value !== null) options.onEvent(name, value, event.lastEventId);
      });
    }
  }

  open();

  return {
    close() {
      if (closed) return;
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      source = null;
      setState("closed");
    },
    get state() {
      return state;
    },
  };
}
