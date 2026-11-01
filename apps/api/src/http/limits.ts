/**
 * Per-IP rate limits (express-rate-limit, process-local, 1-minute windows,
 * IPv6 grouped to /56) and SSE stream slots.
 *
 * | bucket  | applies to                               | default/min |
 * |---------|------------------------------------------|-------------|
 * | default | every /v1 request                        | 600         |
 * | heavy   | routes that fan out upstream (opt-in)    | 60          |
 * | auth    | sign-in and credential routes (opt-in)   | 20          |
 *
 * A route opts in by adding `ctx.limits.heavy` / `ctx.limits.auth` before its
 * handler; those buckets count on top of the default one.
 */
import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { RateLimitConfig } from "../config.js";
import { LykiaHttpError, rateLimited, retryAfterHeader } from "./errors.js";
import { sendError } from "./request.js";

export type RateLimitBucket = "default" | "heavy" | "auth";

/** Rate-limit identity of the caller's address (IPv6 grouped to /56). */
export function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown");
}

function retryAfterSeconds(req: Request): number {
  const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
  const reset = info?.resetTime?.getTime();
  return reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : 60;
}

function createBucket(name: RateLimitBucket, limit: number): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit,
    identifier: name,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `${name}:${clientIp(req)}`,
    handler: (req, res) => {
      const seconds = retryAfterSeconds(req);
      sendError(req, res, rateLimited(`Rate limit of ${limit} requests per minute exceeded (${name}). Retry in ${seconds} s.`, seconds));
    },
  });
}

export const MAX_STREAMS_PER_CLIENT = 10;
export const MAX_STREAMS_TOTAL = 2_000;

/**
 * Open SSE streams per client address and in total. `acquire` returns an
 * idempotent release function, or throws 429 TOO_MANY_STREAMS.
 */
export class StreamSlots {
  private readonly open = new Map<string, number>();
  private readonly closers = new Set<() => void>();
  private total = 0;

  constructor(
    readonly perClient = MAX_STREAMS_PER_CLIENT,
    readonly maxTotal = MAX_STREAMS_TOTAL,
  ) {}

  tryAcquire(client: string): (() => void) | null {
    if (this.total >= this.maxTotal) return null;
    const current = this.open.get(client) ?? 0;
    if (current >= this.perClient) return null;
    this.open.set(client, current + 1);
    this.total += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total -= 1;
      const remaining = (this.open.get(client) ?? 1) - 1;
      if (remaining <= 0) this.open.delete(client);
      else this.open.set(client, remaining);
    };
  }

  acquire(req: Request): () => void {
    const release = this.tryAcquire(`ip:${clientIp(req)}`);
    if (!release) {
      throw new LykiaHttpError("TOO_MANY_STREAMS", 429, "Too many open event streams for this client. Close one and retry.", undefined, {
        headers: retryAfterHeader(30),
      });
    }
    return release;
  }

  get count(): number {
    return this.total;
  }

  /** Registers an open stream's graceful close (for shutdown); returns the unregister function. */
  track(close: () => void): () => void {
    this.closers.add(close);
    return () => {
      this.closers.delete(close);
    };
  }

  /** Ends every tracked stream now (shutdown: SSE never ends on its own, clients reconnect elsewhere). */
  closeAll(): number {
    const closers = [...this.closers];
    this.closers.clear();
    for (const close of closers) {
      try {
        close();
      } catch {
        // One stream failing to close must not keep the others open.
      }
    }
    return closers.length;
  }
}

export interface HttpLimits {
  readonly default: RequestHandler;
  readonly heavy: RequestHandler;
  readonly auth: RequestHandler;
  readonly streams: StreamSlots;
}

export function createHttpLimits(config: RateLimitConfig, streams = new StreamSlots()): HttpLimits {
  return {
    default: createBucket("default", config.defaultPerMinute),
    heavy: createBucket("heavy", config.heavyPerMinute),
    auth: createBucket("auth", config.authPerMinute),
    streams,
  };
}
