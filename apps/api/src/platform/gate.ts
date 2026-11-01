/**
 * The developer gate. Requests without a key stay anonymous and fall under
 * the per-IP limits. A request that presents `Lykia-Key` must present a
 * valid one: unknown or revoked keys get 401, publishable keys only work
 * from their allowed origins and only for read/plan routes, and every key
 * has its own per-minute and per-day quota. Usage is counted per key and
 * per developer per day.
 */
import type { NextFunction, Request, Response } from "express";
import { API_KEY_HEADER, type ApiKeyScope } from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { sendError } from "../http/request.js";
import { lookupKey, touchKey, type StoredKey } from "./keys.js";
import { attachProject, countProject, getProject, verifiedOrigins } from "./projects.js";

const KEYS = new WeakMap<Request, StoredKey>();

export function keyOf(req: Request): StoredKey | null {
  return KEYS.get(req) ?? null;
}

/** The scope a route needs, from its path and method. */
export function scopeFor(method: string, path: string): ApiKeyScope {
  if (path.startsWith("/developers/webhooks")) return "webhooks";
  if (path.startsWith("/pack") || path.startsWith("/agent")) return method === "GET" ? "read" : "agents";
  if (method !== "GET" && (path.startsWith("/intents") || path.startsWith("/language") || path.startsWith("/fence") || path.startsWith("/tags") || path.startsWith("/mcp"))) return "plan";
  return "read";
}

export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function developerGate(ctx: AppContext) {
  const minute = ctx.store.counters("key_minute");
  const daily = ctx.store.counters("key_day");
  const usage = ctx.store.counters("usage_day");
  return (req: Request, res: Response, next: NextFunction) => {
    const presented = req.get(API_KEY_HEADER);
    if (!presented) return next();
    (async () => {
      const key = await lookupKey(ctx, presented);
      if (!key) throw new LykiaHttpError("UNAUTHORIZED", 401, "This API key is unknown or revoked.");
      // A project key follows its project's verified origins; a plain publishable key its own list.
      const project = key.projectId ? await getProject(ctx, key.projectId) : null;
      if (key.projectId && !project) throw new LykiaHttpError("UNAUTHORIZED", 401, "This key's project no longer exists.");
      if (key.kind === "publishable") {
        const origin = req.get("origin");
        const allowed = project ? verifiedOrigins(project) : key.allowedOrigins;
        // Lykia's own /embed pages run on Lykia's origin inside the project's site: the parent must be a verified origin.
        const parent = req.get("lykia-embed-parent");
        const embedded = project !== null && origin !== undefined && ctx.config.webOrigins.includes(origin) && parent !== undefined && allowed.includes(parent);
        if (!embedded && (!origin || !allowed.includes(origin))) throw new LykiaHttpError("FORBIDDEN", 403, "This publishable key is not allowed from this origin.");
      }
      const now = ctx.clock.now();
      const perMinute = await minute.increment(`${key.id}:${Math.floor(now / 60_000)}`, 1, { ttlMs: 120_000 });
      if (perMinute > key.perMinute) throw new LykiaHttpError("RATE_LIMITED", 429, `This key allows ${key.perMinute} requests per minute.`, undefined, { headers: { "Retry-After": "60" } });
      const day = dayKey(now);
      const perDay = await daily.increment(`${key.id}:${day}`, 1, { ttlMs: 2 * 86_400_000 });
      if (perDay > key.perDay) throw new LykiaHttpError("RATE_LIMITED", 429, `This key's daily quota (${key.perDay}) is used up.`);
      await usage.increment(`${key.owner}:${day}`, 1, { ttlMs: 8 * 86_400_000 });
      if (project) {
        await countProject(ctx, project.id, "requests");
        attachProject(req, project);
      }
      // Scope is checked after counting: refused requests still use the quota.
      const scope = scopeFor(req.method, req.path);
      if (!key.scopes.includes(scope)) throw new LykiaHttpError("FORBIDDEN", 403, `This key lacks the ${scope} scope.`);
      KEYS.set(req, key);
      if (perMinute === 1) void touchKey(ctx, key).catch(() => undefined);
      res.setHeader("X-RateLimit-Limit", String(key.perMinute));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, key.perMinute - perMinute)));
    })().then(() => next(), (error: unknown) => sendError(req, res, error));
  };
}
