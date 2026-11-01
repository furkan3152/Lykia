/**
 * The transport every SDK module shares: base URL, keys, sessions, the
 * project, retries with backoff, idempotency keys, SSE streams and typed
 * client events. `@lykia/sdk/intents`, `/fence`, `/agents`, `/circle`,
 * `/ecosystem` and `/projects` take a transport, so an app can import only
 * the parts it uses; `Lykia` bundles them all.
 */
import type { ArcEnvironment } from "@lykia/core";
import { errorFrom, LykiaError } from "./errors.js";
import { readSse, type SseMessage } from "./sse.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LykiaOptions {
  /** API origin, e.g. https://lykia-api-akdogan1.vercel.app (default http://localhost:3002). */
  readonly baseUrl?: string;
  /** A secret (server) or publishable (browser) API key. */
  readonly apiKey?: string;
  /** A Lykia-Session token from sign-in (owner actions). */
  readonly session?: string;
  readonly environment?: ArcEnvironment;
  /** The project this client acts for (white-label). A project's publishable key implies it. */
  readonly project?: string;
  readonly fetch?: FetchLike;
  /** Extra attempts for retryable failures (default 2). */
  readonly retries?: number;
  readonly timeoutMs?: number;
  /** Headers sent on every request (for example Lykia-Embed-Parent from an embed page). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Pin the API version (`Lykia-Version`, e.g. "2026-11-01"); defaults to the key's pinned version. */
  readonly apiVersion?: string;
}

export interface RequestOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Client events, typed. Subscribe with `client.on(name, handler)`. */
export interface LykiaEventMap {
  request: { readonly method: HttpMethod; readonly path: string };
  response: { readonly method: HttpMethod; readonly path: string; readonly status: number; readonly ms: number };
  retry: { readonly method: HttpMethod; readonly path: string; readonly attempt: number; readonly status: number };
  error: { readonly method: HttpMethod; readonly path: string; readonly error: LykiaError };
  "plan-created": { readonly intentId: string; readonly steps: number; readonly decision: string };
  "step-signed": { readonly intentId: string; readonly stepId: string; readonly hashes: readonly string[] };
  settled: { readonly intentId: string; readonly stepId: string; readonly status: string };
}

export type LykiaEventName = keyof LykiaEventMap;
export type LykiaEventHandler<K extends LykiaEventName> = (event: LykiaEventMap[K]) => void;

const RETRY_STATUSES = new Set([429, 502, 503, 504]);

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function backoff(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 4_000) + Math.floor(Math.random() * 100);
}

/** "?a=1&b=2" from defined values only. */
export function q(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined);
  return entries.length === 0 ? "" : `?${new URLSearchParams(entries).toString()}`;
}

export class LykiaTransport {
  readonly baseUrl: string;
  readonly environment: ArcEnvironment | undefined;
  readonly project: string | undefined;
  protected apiKey: string | undefined;
  protected session: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private readonly baseHeaders: Readonly<Record<string, string>>;
  private readonly handlers = new Map<LykiaEventName, Set<(event: never) => void>>();

  constructor(options: LykiaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:3002").replace(/\/+$/u, "");
    this.apiKey = options.apiKey;
    this.session = options.session;
    this.environment = options.environment;
    this.project = options.project;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.retries = options.retries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.baseHeaders = { ...(options.apiVersion ? { "Lykia-Version": options.apiVersion } : {}), ...(options.headers ?? {}) };
  }

  /** Use a session token from now on (after sign-in). */
  setSession(token: string | undefined): void {
    this.session = token;
  }

  /** Subscribes to a client event; returns the unsubscribe function. */
  on<K extends LykiaEventName>(name: K, handler: LykiaEventHandler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as (event: never) => void);
    return () => set.delete(handler as (event: never) => void);
  }

  emit<K extends LykiaEventName>(name: K, event: LykiaEventMap[K]): void {
    for (const handler of this.handlers.get(name) ?? []) {
      try {
        (handler as LykiaEventHandler<K>)(event);
      } catch {
        // A listener never breaks a request.
      }
    }
  }

  protected headers(extra?: Record<string, string>): Record<string, string> {
    return {
      accept: "application/json",
      ...this.baseHeaders,
      ...(this.apiKey ? { "Lykia-Key": this.apiKey } : {}),
      ...(this.session ? { "Lykia-Session": this.session } : {}),
      ...(extra ?? {}),
    };
  }

  /** The environment to send: the call's, else the client's. */
  env(environment?: ArcEnvironment): ArcEnvironment | undefined {
    return environment ?? this.environment;
  }

  async request<T>(method: HttpMethod, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const idempotencyKey = method === "GET" ? undefined : (options.idempotencyKey ?? randomKey());
    let attempt = 0;
    this.emit("request", { method, path });
    const started = Date.now();
    for (;;) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: this.headers({ ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), ...(options.headers ?? {}) }),
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal,
        });
      } catch (error) {
        if (options.signal?.aborted || attempt >= this.retries) {
          const failure = new LykiaError({ code: "NETWORK_ERROR", status: 0, message: error instanceof Error ? error.message : "Network error" });
          this.emit("error", { method, path, error: failure });
          throw failure;
        }
        await sleep(backoff(attempt++));
        continue;
      }
      if (response.ok) {
        this.emit("response", { method, path, status: response.status, ms: Date.now() - started });
        return (response.status === 204 ? undefined : await response.json()) as T;
      }
      if (RETRY_STATUSES.has(response.status) && attempt < this.retries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        this.emit("retry", { method, path, attempt: attempt + 1, status: response.status });
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : backoff(attempt));
        attempt++;
        continue;
      }
      const failure = await errorFrom(response);
      this.emit("error", { method, path, error: failure });
      throw failure;
    }
  }

  async *stream<T>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<SseMessage<T>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: this.headers({ accept: "text/event-stream", ...(body !== undefined ? { "content-type": "application/json" } : {}) }),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok || !response.body) throw await errorFrom(response);
    yield* readSse<T>(response.body);
  }
}

/** A transport from options, for apps that import single modules. */
export function createTransport(options: LykiaOptions = {}): LykiaTransport {
  return new LykiaTransport(options);
}
