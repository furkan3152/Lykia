/**
 * Verifying Lykia webhooks. The `Lykia-Signature` header is
 * `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 * Pass the raw request body (not re-serialized JSON). Uses Web Crypto, so
 * it runs in Node 20+, edge runtimes, Deno and Bun.
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
  const pairs = signatureHeader.split(",").map((p) => p.trim().split("=", 2) as [string, string | undefined]);
  const t = Number(pairs.find(([k]) => k === "t")?.[1]);
  const signatures = pairs.filter(([k, v]) => k === "v1" && v).map(([, v]) => v as string);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(t) || signatures.length === 0 || Math.abs(now - t) > (options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return signatures.some((s) => constantTimeEqual(s, expected));
}

/** The parsed body of a delivery (see WebhookEnvelope in @lykia/core/api/platform). */
export interface LykiaWebhookEvent<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly event: string;
  readonly createdAt: string;
  readonly owner: string | null;
  readonly project: string | null;
  readonly livemode: boolean;
  readonly apiVersion: string;
  readonly data: T;
}

export class WebhookSignatureError extends Error {
  constructor(message = "The Lykia-Signature header does not match this body and secret.") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/**
 * Verifies a delivery and returns the parsed event, or throws
 * WebhookSignatureError. Pass the raw body exactly as received.
 *
 *   const event = await constructEvent(process.env.LYKIA_WEBHOOK_SECRET, rawBody, req.headers["lykia-signature"]);
 *   if (event.type === "payout.sent") { ... }
 */
export async function constructEvent<T = unknown>(secret: string, rawBody: string, signatureHeader: string | null | undefined, options: VerifyOptions = {}): Promise<LykiaWebhookEvent<T>> {
  if (!(await verifyWebhook(secret, rawBody, signatureHeader, options))) throw new WebhookSignatureError();
  return JSON.parse(rawBody) as LykiaWebhookEvent<T>;
}

/** Signs a payload the way Lykia does (for tests of your receiver). */
export async function signWebhook(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}
