/**
 * Store-backed limits that hold across every function instance (the
 * express-rate-limit buckets in limits.ts count per process, which on a
 * serverless host means per instance).
 *
 * - `sharedLimit(ctx, name, perMinute)`: per-IP fixed one-minute windows in
 *   the shared store. One counter upsert per request (on Postgres a single
 *   INSERT ... ON CONFLICT on a primary key); rows expire after two minutes
 *   and the store's sweep removes them.
 * - `modelBudget(ctx)`: a global daily cap on model calls
 *   (LYKIA_MODEL_DAILY_CALLS). Each call increments one counter; once the
 *   day's count passes the cap the breaker trips and `agentServices().llm()`
 *   answers null, so every caller falls back to the deterministic reader
 *   until the UTC day turns.
 */
import type { Request, RequestHandler } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import type { AppContext } from "../context.js";
import { rateLimited } from "./errors.js";
import { sendError } from "./request.js";

function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown");
}

/** A per-IP per-minute limit counted in the shared store. Fails open if the store is down (the per-process bucket still applies). */
export function sharedLimit(ctx: AppContext, name: string, perMinute: number): RequestHandler {
  const counters = ctx.store.counters("rl_shared");
  return (req, res, next) => {
    const now = ctx.clock.now();
    const window = Math.floor(now / 60_000);
    counters
      .increment(`${name}:${clientIp(req)}:${window}`, 1, { ttlMs: 120_000 })
      .then((count) => {
        const reset = 60 - Math.floor((now % 60_000) / 1000);
        res.setHeader("RateLimit", `"${name}-shared";r=${Math.max(0, perMinute - count)};t=${reset}`);
        if (count > perMinute) return sendError(req, res, rateLimited(`Rate limit of ${perMinute} requests per minute exceeded (${name}, across all instances). Retry in ${reset} s.`, reset));
        next();
      })
      .catch((error: unknown) => {
        ctx.log.warn("shared rate limit unavailable", { name, error: error instanceof Error ? error.message : String(error) });
        next();
      });
  };
}

const TRIPPED = new WeakMap<AppContext, string>();

const today = (ctx: AppContext) => new Date(ctx.clock.now()).toISOString().slice(0, 10);

export interface ModelBudget {
  /** True while today's calls are under the cap on this instance's latest reading. */
  open(): boolean;
  /** Counts one model call; trips the breaker when the shared count passes the cap. */
  spend(): Promise<void>;
  /** Today's shared count and the cap (status pages). */
  status(): Promise<{ readonly day: string; readonly used: number; readonly limit: number; readonly open: boolean }>;
}

export function modelBudget(ctx: AppContext): ModelBudget {
  const counters = ctx.store.counters("model_calls_day");
  const limit = ctx.config.modelDailyCalls;
  return {
    open: () => TRIPPED.get(ctx) !== today(ctx),
    async spend() {
      const day = today(ctx);
      const used = await counters.increment(day, 1, { ttlMs: 2 * 86_400_000 }).catch(() => 0);
      if (used >= limit && TRIPPED.get(ctx) !== day) {
        TRIPPED.set(ctx, day);
        ctx.log.warn("model budget reached: the deterministic reader answers until the UTC day turns", { used, limit });
      }
    },
    async status() {
      const day = today(ctx);
      const used = await counters.get(day).catch(() => 0);
      if (used >= limit) TRIPPED.set(ctx, day);
      return { day, used, limit, open: used < limit };
    },
  };
}
