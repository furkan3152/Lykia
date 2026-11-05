/**
 * The developer gate. Requests without a key stay anonymous and fall under
 * the per-IP limits. A request that presents `Lykia-Key` must present a
 * valid one: unknown or revoked keys get 401, keys with an IP allowlist only
 * work from those addresses, publishable keys only work from their allowed
 * origins and only for their scopes, test keys never reach mainnet, and
 * every key has its own per-minute and per-day quota (projects and plans add
 * theirs). Usage is counted per key, per developer, per project and per
 * endpoint, and every keyed request is written to the request log.
 *
 * Mounted by http/router.ts before every module, after the JSON parser.
 */
import type { NextFunction, Request, Response } from "express";
import { API_KEY_HEADER, API_VERSION_HEADER, API_VERSIONS } from "@lykia/core/api/platform";
import { cityPaused } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { requestIdOf, sendError } from "../http/request.js";
import { chargeRequest, planOf } from "./billing.js";
import { ipAllowed, lookupKey, touchKey, type StoredKey } from "./keys.js";
import { recordRequest } from "./metering.js";
import { attachProject, countProject, getProject, verifiedOrigins } from "./projects.js";
import { platformState, runWithState, testKeyMainnetError } from "./requestState.js";
import { fineScopeFor, legacyScopeFor, scopeAllows } from "./scopes.js";
import { projectLimits } from "./projectLimits.js";

const KEYS = new WeakMap<Request, StoredKey>();

export function keyOf(req: Request): StoredKey | null {
  return KEYS.get(req) ?? null;
}

export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * `Lykia-Version`: a known date is honoured, anything else is 400. The
 * answer always carries the version it was served under.
 */
export function apiVersionMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const asked = req.get(API_VERSION_HEADER)?.trim();
    if (asked && !API_VERSIONS.includes(asked)) {
      sendError(req, res, new LykiaHttpError("INVALID_API_VERSION", 400, `Unknown Lykia-Version ${asked}. Known versions: ${API_VERSIONS.join(", ")}.`, { known: [...API_VERSIONS] }));
      return;
    }
    const state = platformState(req);
    if (asked) state.apiVersion = asked;
    res.setHeader(API_VERSION_HEADER, state.apiVersion);
    next();
  };
}

/** `environment` / `network` asked for in the query or the JSON body. */
function askedEnvironments(req: Request): string[] {
  const out: string[] = [];
  const q = req.query as Record<string, unknown>;
  const b = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
  for (const source of [q, b, (b.facts && typeof b.facts === "object" ? b.facts : {}) as Record<string, unknown>]) {
    for (const name of ["environment", "network"]) if (typeof source[name] === "string") out.push(source[name] as string);
  }
  return out;
}

const INTENT_PATH = /^\/intents\/(out_[A-Za-z0-9_-]{6,32})(?:\/|$)/u;

/** The response's error code, read from the envelope as it is written. */
function captureErrorCode(res: Response): () => string | null {
  let code: string | null = null;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const error = (body as { error?: { code?: unknown } } | null)?.error;
    if (error && typeof error.code === "string") code = error.code;
    return json(body);
  };
  return () => code;
}

function logOnFinish(ctx: AppContext, req: Request, res: Response, key: StoredKey, retentionDays: Promise<number>): void {
  const started = ctx.clock.now();
  const errorCode = captureErrorCode(res);
  const path = (req.originalUrl || req.url).split("?")[0]?.slice(0, 200) ?? "";
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const state = platformState(req);
    const route = req.route?.path ? `/v1${String(req.route.path)}` : null;
    const entry = {
      requestId: requestIdOf(req),
      at: new Date(started).toISOString(),
      method: req.method,
      path,
      route,
      status: res.statusCode,
      latencyMs: Math.max(0, ctx.clock.now() - started),
      errorCode: res.statusCode >= 400 ? errorCode() : null,
      keyId: key.id,
      projectId: key.projectId ?? null,
      mode: key.mode ?? null,
      apiVersion: state.apiVersion,
      idempotentReplay: state.idempotentReplay,
    };
    void retentionDays
      .then((days) => recordRequest(ctx, entry, { owner: key.owner, retentionDays: days }))
      .catch((error: unknown) => ctx.log.warn("request log write failed", { error: error instanceof Error ? error.message : String(error) }));
  };
  res.once("finish", finish);
  res.once("close", finish);
}

function setLimitHeaders(res: Response, name: string, limit: number, used: number, resetSeconds: number): void {
  const remaining = Math.max(0, limit - used);
  if (name === "key") {
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(resetSeconds));
  }
  // IETF RateLimit fields (draft 8): one entry per policy, appended to the per-IP one.
  const append = (header: string, value: string) => {
    const existing = res.getHeader(header);
    res.setHeader(header, existing ? `${String(existing)}, ${value}` : value);
  };
  append("RateLimit", `"${name}";r=${remaining};t=${resetSeconds}`);
  append("RateLimit-Policy", `"${name}";q=${limit};w=${name.endsWith("day") ? 86_400 : 60}`);
}

export function developerGate(ctx: AppContext) {
  const minute = ctx.store.counters("key_minute");
  const daily = ctx.store.counters("key_day");
  const usage = ctx.store.counters("usage_day");
  const projectMinute = ctx.store.counters("project_minute");
  const projectDay = ctx.store.counters("project_day");
  return (req: Request, res: Response, next: NextFunction) => {
    const presented = req.get(API_KEY_HEADER);
    if (!presented) return next();
    (async () => {
      const key = await lookupKey(ctx, presented);
      if (!key) throw new LykiaHttpError("UNAUTHORIZED", 401, "This API key is unknown or revoked.");
      const plan = planOf(ctx, key.owner);
      // From here on the request is the key's: log it whatever the outcome.
      logOnFinish(ctx, req, res, key, plan.then((p) => p.logRetentionDays).catch(() => 7));
      const state = platformState(req);
      state.mode = key.mode ?? null;
      if (!req.get(API_VERSION_HEADER) && key.apiVersion && key.apiVersion !== state.apiVersion) {
        state.apiVersion = key.apiVersion;
        res.setHeader(API_VERSION_HEADER, key.apiVersion);
      }
      if (!ipAllowed(key.allowedIps, req.ip)) throw new LykiaHttpError("IP_NOT_ALLOWED", 403, "This key is not allowed from this IP address.");
      // A project key follows its project's verified origins; a plain publishable key its own list.
      const project = key.projectId ? await getProject(ctx, key.projectId) : null;
      if (key.projectId && !project) throw new LykiaHttpError("UNAUTHORIZED", 401, "This key's project no longer exists.");
      // A city the League council paused answers reads only: nothing new is planned or sent through it.
      if (project && cityPaused(project) && req.method !== "GET" && req.method !== "HEAD") throw new LykiaHttpError("CITY_PAUSED", 423, "This city is paused by the Lykia team. Reads still work; nothing new is planned or sent through it.");
      if (key.kind === "publishable") {
        const origin = req.get("origin");
        const allowed = project ? verifiedOrigins(project) : key.allowedOrigins;
        // Lykia's own /embed pages run on Lykia's origin inside the project's site: the parent must be a verified origin.
        const parent = req.get("lykia-embed-parent");
        const embedded = project !== null && origin !== undefined && ctx.config.webOrigins.includes(origin) && parent !== undefined && allowed.includes(parent);
        if (!embedded && (!origin || !allowed.includes(origin))) throw new LykiaHttpError("FORBIDDEN", 403, "This publishable key is not allowed from this origin.");
      }
      if (key.mode === "test") {
        state.environmentLock = "testnet";
        if (askedEnvironments(req).includes("mainnet")) throw testKeyMainnetError();
      }
      const now = ctx.clock.now();
      const resetSeconds = 60 - Math.floor((now % 60_000) / 1000);
      const perMinute = await minute.increment(`${key.id}:${Math.floor(now / 60_000)}`, 1, { ttlMs: 120_000 });
      setLimitHeaders(res, "key", key.perMinute, perMinute, resetSeconds);
      if (perMinute > key.perMinute) throw new LykiaHttpError("RATE_LIMITED", 429, `This key allows ${key.perMinute} requests per minute.`, { limit: key.perMinute, window: "minute" }, { headers: { "Retry-After": String(resetSeconds) } });
      const day = dayKey(now);
      const perDay = await daily.increment(`${key.id}:${day}`, 1, { ttlMs: 2 * 86_400_000 });
      const dayReset = Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86_400_000 - now) / 1000);
      setLimitHeaders(res, "key-day", key.perDay, perDay, dayReset);
      res.setHeader("X-Daily-Quota-Limit", String(key.perDay));
      res.setHeader("X-Daily-Quota-Remaining", String(Math.max(0, key.perDay - perDay)));
      if (perDay > key.perDay) throw new LykiaHttpError("RATE_LIMITED", 429, `This key's daily quota (${key.perDay}) is used up.`, { limit: key.perDay, window: "day" }, { headers: { "Retry-After": String(dayReset) } });
      await usage.increment(`${key.owner}:${day}`, 1, { ttlMs: 8 * 86_400_000 });
      const ownerPlan = await plan;
      if (project) {
        const limits = await projectLimits(ctx, project.id, ownerPlan);
        const pMinute = await projectMinute.increment(`${project.id}:${Math.floor(now / 60_000)}`, 1, { ttlMs: 120_000 });
        setLimitHeaders(res, "project", limits.perMinute, pMinute, resetSeconds);
        if (pMinute > limits.perMinute) throw new LykiaHttpError("RATE_LIMITED", 429, `This project allows ${limits.perMinute} requests per minute.`, { limit: limits.perMinute, window: "minute", scope: "project" }, { headers: { "Retry-After": String(resetSeconds) } });
        const pDay = await projectDay.increment(`${project.id}:${day}`, 1, { ttlMs: 2 * 86_400_000 });
        if (pDay > limits.perDay) throw new LykiaHttpError("RATE_LIMITED", 429, `This project's daily quota (${limits.perDay}) is used up.`, { limit: limits.perDay, window: "day", scope: "project" }, { headers: { "Retry-After": String(dayReset) } });
        await countProject(ctx, project.id, "requests");
        attachProject(req, project);
      }
      // Scope is checked after counting: refused requests still use the quota.
      const fine = key.mode !== undefined;
      const scope = fine ? fineScopeFor(req.method, req.path) : legacyScopeFor(req.method, req.path);
      if (!scopeAllows(key.scopes, scope, fine, req.path)) throw new LykiaHttpError("FORBIDDEN", 403, `This key lacks the ${scope} scope.`, { required: scope });
      // A test key may not act on a mainnet plan, even one it did not create.
      const intent = key.mode === "test" && req.method !== "GET" ? INTENT_PATH.exec(req.path) : null;
      if (intent) {
        const { services } = await import("../services.js");
        const found = await services(ctx).intents.get(intent[1] as string).catch(() => null);
        if (found && found.intent.environment === "mainnet") throw testKeyMainnetError();
      }
      // Monthly plan quota and overage: live keys only (the sandbox is free).
      if (key.mode !== "test") {
        const charged = await chargeRequest(ctx, req, key.owner, ownerPlan);
        res.setHeader("X-Monthly-Quota-Limit", String(charged.included));
        res.setHeader("X-Monthly-Quota-Used", String(charged.used));
      }
      KEYS.set(req, key);
      if (perMinute === 1) void touchKey(ctx, key).catch(() => undefined);
    })().then(
      () => runWithState(req, next),
      (error: unknown) => sendError(req, res, error),
    );
  };
}
