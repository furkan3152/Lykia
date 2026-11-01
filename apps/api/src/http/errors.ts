/**
 * The error contract of the API. Every failure leaves as
 *
 *   { "error": { "code": "UPPER_SNAKE", "message": "...", "details"?: {...}, "requestId": "..." } }
 *
 * with a stable code. 5xx responses never carry provider text, URLs or
 * stacks: upstream failures are mapped to generic codes here and logged
 * (sanitized) instead.
 */
import { BaseError as ViemBaseError } from "viem";
import { ZodError } from "zod";

export type ErrorDetails = Readonly<Record<string, unknown>>;

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: ErrorDetails;
    readonly requestId: string;
  };
}

/** Status of each code the infrastructure emits. Modules may add their own codes. */
export const ERROR_STATUS = Object.freeze({
  INVALID_REQUEST: 400,
  INVALID_JSON: 400,
  INVALID_ADDRESS: 400,
  NETWORK_NOT_SUPPORTED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  WS_SUBSCRIPTION_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  HYPERLIQUID_REJECTED: 422,
  URL_FORBIDDEN: 422,
  URL_UNRESOLVABLE: 422,
  RATE_LIMITED: 429,
  TOO_MANY_STREAMS: 429,
  INTERNAL_ERROR: 500,
  RPC_UNAVAILABLE: 502,
  HYPERLIQUID_UNAVAILABLE: 502,
  NETWORK_UNAVAILABLE: 503,
  PROVIDER_RATE_LIMITED: 503,
  STORE_UNAVAILABLE: 503,
  PULSE_UNAVAILABLE: 503,
  WS_SUBSCRIPTION_LIMIT: 503,
  UPSTREAM_TIMEOUT: 504,
} as const);

export type KnownErrorCode = keyof typeof ERROR_STATUS;

/** Largest serialized `details` object; larger details are dropped, never truncated mid-JSON. */
export const MAX_ERROR_DETAILS_BYTES = 4_096;
const CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;

function isPlainJson(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isPlainJson(entry, depth + 1));
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every((entry) => isPlainJson(entry, depth + 1));
}

/** Plain JSON of at most 4 KB as a frozen deep copy, or null (left out of the response). */
export function safeDetails(value: unknown): ErrorDetails | null {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isPlainJson(value)) return null;
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > MAX_ERROR_DETAILS_BYTES) return null;
  return Object.freeze(JSON.parse(json) as Record<string, unknown>);
}

export interface LykiaHttpErrorOptions {
  /** Extra response headers (Retry-After, Allow, ...). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly cause?: unknown;
}

export class LykiaHttpError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ErrorDetails;
  readonly headers?: Readonly<Record<string, string>>;

  constructor(code: string, status: number, message: string, details?: ErrorDetails, options: LykiaHttpErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LykiaHttpError";
    this.code = CODE_PATTERN.test(code) ? code : "INTERNAL_ERROR";
    this.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
    const accepted = details === undefined ? null : safeDetails(details);
    if (accepted) this.details = accepted;
    if (options.headers) this.headers = Object.freeze({ ...options.headers });
  }

  /** Seconds from the Retry-After header, when set. */
  get retryAfterSeconds(): number | null {
    const raw = this.headers?.["Retry-After"];
    return raw && /^\d+$/u.test(raw) ? Number(raw) : null;
  }

  envelope(requestId: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
        requestId,
      },
    };
  }
}

export function isLykiaHttpError(error: unknown): error is LykiaHttpError {
  return error instanceof LykiaHttpError;
}

/* ------------------------------------------------------------ factories */

export function invalidRequest(message: string, details?: ErrorDetails): LykiaHttpError {
  return new LykiaHttpError("INVALID_REQUEST", 400, message, details);
}

export function notFound(message = "Not found."): LykiaHttpError {
  return new LykiaHttpError("NOT_FOUND", 404, message);
}

export function retryAfterHeader(seconds: number): Readonly<Record<string, string>> {
  return { "Retry-After": String(Math.max(1, Math.min(3_600, Math.ceil(seconds)))) };
}

export function rateLimited(message: string, retryAfterSeconds: number): LykiaHttpError {
  return new LykiaHttpError("RATE_LIMITED", 429, message, undefined, { headers: retryAfterHeader(retryAfterSeconds) });
}

/** An upstream (Hyperliquid, an RPC) still rate-limiting Lykia after bounded retries: retryable 503. */
export function providerRateLimited(provider: string, retryAfterSeconds: number): LykiaHttpError {
  const seconds = Math.max(1, Math.min(60, Math.ceil(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 2)));
  return new LykiaHttpError(
    "PROVIDER_RATE_LIMITED",
    503,
    `${provider} is limiting requests right now. This is temporary: try again in ${seconds} s.`,
    { provider },
    { headers: retryAfterHeader(seconds) },
  );
}

/** A network Lykia knows but cannot reach yet (no RPC configured, prelaunch) or right now. */
export function networkUnavailable(network: string, reason: string, retryAfterSeconds?: number): LykiaHttpError {
  return new LykiaHttpError(
    "NETWORK_UNAVAILABLE",
    503,
    `${network} is not available: ${reason}`,
    { network },
    retryAfterSeconds ? { headers: retryAfterHeader(retryAfterSeconds) } : {},
  );
}

export function upstreamTimeout(provider: string): LykiaHttpError {
  return new LykiaHttpError("UPSTREAM_TIMEOUT", 504, `${provider} did not answer in time. Try again shortly.`, { provider });
}

export function storeUnavailable(): LykiaHttpError {
  return new LykiaHttpError("STORE_UNAVAILABLE", 503, "Storage is temporarily unavailable.", undefined, { headers: retryAfterHeader(2) });
}

/* -------------------------------------------------- upstream sanitizing */

/**
 * A provider message reduced to something safe to log: URLs (which can carry
 * keyed RPC endpoints), long hex payloads and key=value secrets are removed;
 * one line of at most 200 characters.
 */
export function sanitizeUpstreamMessage(raw: string): string {
  return raw
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu, "<url>")
    .replace(/0x[0-9a-f]{40,}/giu, "<hex>")
    .replace(/\b(?:api[_-]?key|apikey|token|secret|key|password)\s*[=:]\s*\S+/giu, "<redacted>")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
}

/* ------------------------------------------------------------- mapping */

interface BodyParserError {
  readonly type: string;
  readonly status?: number;
  readonly statusCode?: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  return typeof record.type === "string" && (typeof record.status === "number" || typeof record.statusCode === "number");
}

export interface MappedError {
  readonly error: LykiaHttpError;
  /** Whether the original failure deserves an operator log line (unexpected or upstream). */
  readonly log: "none" | "upstream" | "unexpected";
}

export function zodIssues(error: ZodError, prefix?: string): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 20).map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join("."),
    message: issue.message.slice(0, 200),
  }));
}

/**
 * Maps any thrown value to an LykiaHttpError. Client errors keep their
 * message; server-side failures get a generic one so provider text never
 * reaches a response.
 */
export function mapError(error: unknown): MappedError {
  if (error instanceof LykiaHttpError) return { error, log: error.status >= 500 && error.code === "INTERNAL_ERROR" ? "unexpected" : "none" };
  if (isBodyParserError(error)) {
    switch (error.type) {
      case "entity.parse.failed":
        return { error: new LykiaHttpError("INVALID_JSON", 400, "The request body is not valid JSON."), log: "none" };
      case "entity.too.large":
        return { error: new LykiaHttpError("PAYLOAD_TOO_LARGE", 413, "The request body is too large."), log: "none" };
      case "charset.unsupported":
      case "encoding.unsupported":
        return { error: new LykiaHttpError("UNSUPPORTED_MEDIA_TYPE", 415, "Send request bodies as UTF-8 application/json."), log: "none" };
      default:
        return { error: new LykiaHttpError("INVALID_REQUEST", 400, "The request body could not be read."), log: "none" };
    }
  }
  if (error instanceof ZodError) {
    return { error: invalidRequest("The request is invalid.", { issues: zodIssues(error) }), log: "none" };
  }
  if (error instanceof URIError) {
    return { error: invalidRequest("The request path contains malformed percent-encoding."), log: "none" };
  }
  if (error instanceof ViemBaseError) {
    return { error: new LykiaHttpError("RPC_UNAVAILABLE", 502, "An EVM network read failed. Try again shortly."), log: "upstream" };
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { error: upstreamTimeout("An upstream provider"), log: "upstream" };
  }
  // Framework client errors (e.g. express' own 4xx) without leaking their text.
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return { error: invalidRequest("The request could not be processed."), log: "none" };
    }
  }
  return { error: new LykiaHttpError("INTERNAL_ERROR", 500, "Unexpected server error."), log: "unexpected" };
}

/** A one-line, sanitized description of an upstream failure for logs. */
export function describeUpstream(error: unknown): string {
  const record = error as { readonly shortMessage?: unknown; readonly message?: unknown } | null;
  const message =
    record && typeof record.shortMessage === "string" && record.shortMessage
      ? record.shortMessage
      : record && typeof record.message === "string"
        ? record.message
        : String(error);
  return sanitizeUpstreamMessage(message);
}
