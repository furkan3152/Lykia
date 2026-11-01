/**
 * Keys for the platform, all derived from LYKIA_SESSION_SECRET with HKDF
 * (one purpose per use: session tokens, API key hashing, webhook secrets
 * at rest). Without a secret, development and test runs use a random
 * per-process secret (sessions die with the process); production refuses
 * to issue sessions or keys.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";

const EPHEMERAL = randomBytes(32).toString("hex");
const CACHE = new WeakMap<AppContext, Map<string, Buffer>>();

export type KeyPurpose = "session" | "api-key" | "webhook" | "card" | "project";

export function platformSecret(ctx: AppContext): string {
  if (ctx.config.sessionSecret) return ctx.config.sessionSecret;
  if (ctx.config.env === "production") throw new LykiaHttpError("PLATFORM_UNAVAILABLE", 503, "Sign-in and developer keys need LYKIA_SESSION_SECRET on this server.");
  return EPHEMERAL;
}

export function purposeKey(ctx: AppContext, purpose: KeyPurpose): Buffer {
  let map = CACHE.get(ctx);
  if (!map) {
    map = new Map();
    CACHE.set(ctx, map);
  }
  const cached = map.get(purpose);
  if (cached) return cached;
  const key = Buffer.from(hkdfSync("sha256", platformSecret(ctx), "lykia-platform", `lykia:${purpose}`, 32));
  map.set(purpose, key);
  return key;
}

export function hmacHex(key: Buffer | string, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomHex(bytes = 12): string {
  return randomBytes(bytes).toString("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
