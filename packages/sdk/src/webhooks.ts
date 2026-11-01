/**
 * Verifying Lykia webhooks. The `Lykia-Signature` header is
 * `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 * Pass the raw request body (not re-serialized JSON). Uses Web Crypto, so
 * it runs in Node 18+, edge runtimes, Deno and Bun.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface VerifyOptions {
  /** Current time in unix seconds (default: now). */
  readonly now?: number;
  readonly toleranceSeconds?: number;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhook(secret: string, rawBody: string, signatureHeader: string | null | undefined, options: VerifyOptions = {}): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = new Map(signatureHeader.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(t) || !v1 || Math.abs(now - t) > (options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return false;
  return constantTimeEqual(v1, await hmacHex(secret, `${t}.${rawBody}`));
}

/** Signs a payload the way Lykia does (for tests of your receiver). */
export async function signWebhook(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}
