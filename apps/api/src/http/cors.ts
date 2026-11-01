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
  "Lykia-Key",
  "Lykia-Embed-Parent",
] as const;

export const CORS_EXPOSED_HEADERS = ["X-Request-Id", "Retry-After", "RateLimit", "RateLimit-Policy"] as const;

/**
 * `extra` admits origins outside the static list: the verified origins of
 * white-label projects, so their browser keys work from their own sites.
 */
export function createCors(origins: readonly string[], extra?: (origin: string) => Promise<boolean>): RequestHandler {
  const allowed = new Set(origins);
  return cors({
    origin: (origin, callback) => {
      if (origin === undefined) return callback(null, false);
      if (allowed.has(origin)) return callback(null, true);
      if (!extra) return callback(null, false);
      extra(origin).then(
        (ok) => callback(null, ok),
        () => callback(null, false),
      );
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
    credentials: false,
    maxAge: 600,
  });
}
