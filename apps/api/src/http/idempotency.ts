/**
 * `Idempotency-Key` on writes. Every POST under /v1 that carries the header
 * is covered (except the streaming and sign-in routes in NON_IDEMPOTENT):
 * plans, step prepare and submit, Pack writes, keys, webhooks, projects,
 * orders, alerts, payouts and every route other modules add.
 *
 * The first request with a key claims it (store-backed, 24 h); a retry with
 * the same key and the same body replays the stored answer with
 * `Idempotent-Replayed: true`; the same key with a different body is refused
 * with 409 IDEMPOTENCY_CONFLICT. A request still in flight answers 409 so a
 * double click can never plan or submit twice. 5xx answers are not stored,
 * so a failed attempt can be retried with the same key. Keys are scoped to
 * the caller's credentials and the path.
 *
 * Modules get this for free. A route that must never run without a key
 * opts in with `idempotent(ctx, { required: true })`:
 *
 *   router.post("/payouts", idempotent(ctx, { required: true }), handler);
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "@lykia/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppContext } from "../context.js";
import type { JsonValue } from "../store/types.js";
import { platformState } from "../platform/requestState.js";
import { sendError } from "./request.js";
import { LykiaHttpError } from "./errors.js";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
/** The routes covered before every POST was; kept for callers that read it. */
export const IDEMPOTENT_PATHS: readonly RegExp[] = [/^\/intents$/u, /^\/intents\/[^/]+\/steps\/[^/]+\/(?:prepare|submit)$/u, /^\/pack(?:\/.*)?$/u];
/** POST routes that stream, sign in or receive third-party callbacks: an Idempotency-Key is ignored there. */
export const NON_IDEMPOTENT: readonly RegExp[] = [/^\/auth\//u, /^\/mcp$/u, /^\/agent\/chat$/u, /\/stream$/u, /^\/telegram\/webhook$/u];
const KEY = /^[A-Za-z0-9_.:-]{8,128}$/u;

type Stored = {
  readonly state: "pending" | "done";
  readonly bodyHash: string;
  readonly statusCode?: number;
  readonly body?: JsonValue;
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const HANDLED = new WeakSet<Request>();

function covered(req: Request): boolean {
  return req.method === "POST" && !NON_IDEMPOTENT.some((p) => p.test(req.path));
}

function run(ctx: AppContext, req: Request, res: Response, next: NextFunction, key: string): void {
  const col = ctx.store.collection<Stored>("idempotency");
  HANDLED.add(req);
  void (async () => {
    if (!KEY.test(key)) throw new LykiaHttpError("INVALID_REQUEST", 400, "Idempotency-Key must be 8 to 128 characters of letters, digits, '_', '-', '.' or ':'.");
    // Scope by caller credentials so two clients cannot read each other's answers with a guessed key.
    const caller = sha(`${req.get("authorization") ?? ""}|${req.get("lykia-session") ?? ""}|${req.get("x-api-key") ?? ""}|${req.get("lykia-key") ?? ""}`);
    const id = sha(`${req.baseUrl}${req.path}|${key}|${caller}`);
    const bodyHash = sha(canonicalJson(req.body ?? null));
    const existing = await col.get(id);
    if (existing) {
      if (existing.value.bodyHash !== bodyHash) throw new LykiaHttpError("IDEMPOTENCY_CONFLICT", 409, "This Idempotency-Key was already used with a different body.");
      if (existing.value.state === "pending") throw new LykiaHttpError("IDEMPOTENCY_CONFLICT", 409, "A request with this Idempotency-Key is still in progress.");
      platformState(req).idempotentReplay = true;
      res.setHeader("Idempotent-Replayed", "true");
      res.status(existing.value.statusCode ?? 200).json(existing.value.body ?? null);
      return;
    }
    const claimed = await col.compareAndSet(id, null, { state: "pending", bodyHash }, { ttlMs: IDEMPOTENCY_TTL_MS });
    if (!claimed) throw new LykiaHttpError("IDEMPOTENCY_CONFLICT", 409, "A request with this Idempotency-Key is still in progress.");
    const json = res.json.bind(res);
    let stored = false;
    res.json = (body: unknown) => {
      stored = true;
      const status = res.statusCode;
      void (status >= 500 ? col.delete(id) : col.put(id, { state: "done", bodyHash, statusCode: status, body: (body ?? null) as JsonValue }, { ttlMs: IDEMPOTENCY_TTL_MS })).catch(() => undefined);
      return json(body);
    };
    res.on("close", () => {
      // Aborted, or answered without JSON (204, a stream): nothing to replay, free the key.
      if (!res.writableEnded || !stored) void col.delete(id).catch(() => undefined);
    });
    next();
  })().catch((error: unknown) => {
    if (error instanceof LykiaHttpError) sendError(req, res, error);
    else next(error);
  });
}

/** Router-level middleware (mounted for all of /v1 by http/router.ts). */
export function idempotency(ctx: AppContext): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.get("idempotency-key");
    if (!key || !covered(req) || HANDLED.has(req)) return next();
    run(ctx, req, res, next, key);
  };
}

export interface IdempotentOptions {
  /** Refuse the request (400 IDEMPOTENCY_KEY_REQUIRED) when it has no Idempotency-Key. */
  readonly required?: boolean;
}

/**
 * Per-route opt-in for modules (and for apps that mount routes outside /v1).
 * Safe to combine with the router-level middleware: a request is handled once.
 */
export function idempotent(ctx: AppContext, options: IdempotentOptions = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (HANDLED.has(req)) return next();
    const key = req.get("idempotency-key");
    if (!key) {
      if (options.required) return sendError(req, res, new LykiaHttpError("IDEMPOTENCY_KEY_REQUIRED", 400, "This route needs an Idempotency-Key header."));
      return next();
    }
    run(ctx, req, res, next, key);
  };
}
