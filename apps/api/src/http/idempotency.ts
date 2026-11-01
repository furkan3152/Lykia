/**
 * `Idempotency-Key` on value-moving writes: POST /v1/intents, the step
 * prepare and submit calls, and Pack writes. The first request with a key
 * claims it (store-backed, 24 h); a retry with the same key and the same
 * body replays the stored answer with `Idempotent-Replayed: true`; the same
 * key with a different body is refused with 409. A request still in flight
 * answers 409 so a double click can never plan or submit twice. 5xx answers
 * are not stored, so a failed attempt can be retried with the same key.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "@lykia/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppContext } from "../context.js";
import type { JsonValue } from "../store/types.js";
import { sendError } from "./request.js";
import { LykiaHttpError } from "./errors.js";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
export const IDEMPOTENT_PATHS: readonly RegExp[] = [/^\/intents$/u, /^\/intents\/[^/]+\/steps\/[^/]+\/(?:prepare|submit)$/u, /^\/pack(?:\/.*)?$/u];
const KEY = /^[A-Za-z0-9_.:-]{8,128}$/u;

type Stored = {
  readonly state: "pending" | "done";
  readonly bodyHash: string;
  readonly statusCode?: number;
  readonly body?: JsonValue;
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function idempotency(ctx: AppContext): RequestHandler {
  const col = ctx.store.collection<Stored>("idempotency");
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") return next();
    const key = req.get("idempotency-key");
    if (!key || !IDEMPOTENT_PATHS.some((p) => p.test(req.path))) return next();
    void (async () => {
      if (!KEY.test(key)) throw new LykiaHttpError("INVALID_REQUEST", 400, "Idempotency-Key must be 8 to 128 characters of letters, digits, '_', '-', '.' or ':'.");
      // Scope by caller credentials so two clients cannot read each other's answers with a guessed key.
      const caller = sha(`${req.get("authorization") ?? ""}|${req.get("lykia-session") ?? ""}|${req.get("x-api-key") ?? ""}`);
      const id = sha(`${req.path}|${key}|${caller}`);
      const bodyHash = sha(canonicalJson(req.body ?? null));
      const existing = await col.get(id);
      if (existing) {
        if (existing.value.bodyHash !== bodyHash) throw new LykiaHttpError("IDEMPOTENCY_CONFLICT", 409, "This Idempotency-Key was already used with a different body.");
        if (existing.value.state === "pending") throw new LykiaHttpError("IDEMPOTENCY_CONFLICT", 409, "A request with this Idempotency-Key is still in progress.");
        res.setHeader("Idempotent-Replayed", "true");
        res.status(existing.value.statusCode ?? 200).json(existing.value.body ?? null);
        return;
      }
      const claimed = await col.compareAndSet(id, null, { state: "pending", bodyHash }, { ttlMs: IDEMPOTENCY_TTL_MS });
      if (!claimed) throw new LykiaHttpError("IDEMPOTENCY_CONFLICT", 409, "A request with this Idempotency-Key is still in progress.");
      const json = res.json.bind(res);
      res.json = (body: unknown) => {
        const status = res.statusCode;
        void (status >= 500 ? col.delete(id) : col.put(id, { state: "done", bodyHash, statusCode: status, body: (body ?? null) as JsonValue }, { ttlMs: IDEMPOTENCY_TTL_MS })).catch(() => undefined);
        return json(body);
      };
      res.on("close", () => {
        if (!res.writableEnded) void col.delete(id).catch(() => undefined);
      });
      next();
    })().catch((error: unknown) => {
      if (error instanceof LykiaHttpError) sendError(req, res, error);
      else next(error);
    });
  };
}
