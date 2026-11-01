/**
 * CORS: an exact-origin allowlist (the Lykia web app origins from config).
 * Requests from other origins get no CORS headers, so browsers refuse to
 * expose the response; requests without Origin (curl, servers, Telegram)
 * are unaffected. Credentials travel in headers (`Lykia-Session`,
 * `Authorization`), never cookies, so `credentials` stays off.
 */
import cors from "cors";
import type { RequestHandler } from "express";

export const CORS_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "Lykia-Session",
  "X-Request-Id",
  "Last-Event-ID",
  "Idempotency-Key",
] as const;

export const CORS_EXPOSED_HEADERS = ["X-Request-Id", "Retry-After", "RateLimit", "RateLimit-Policy"] as const;

export function createCors(origins: readonly string[]): RequestHandler {
  const allowed = new Set(origins);
  return cors({
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowed.has(origin));
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
    credentials: false,
    maxAge: 600,
  });
}
