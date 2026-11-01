/**
 * The API's error contract, client side (pure). Every failure leaves the API as
 * `{ error: { code, message, details?, requestId } }`; transport problems get
 * client codes so callers branch on `code`, never on message text.
 */

export type ClientErrorCode = "NETWORK_ERROR" | "TIMEOUT" | "ABORTED" | "INVALID_RESPONSE" | "HTTP_ERROR";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly details: Readonly<Record<string, unknown>> | null;
  readonly requestId: string | null;
  /** From Retry-After, when the server sent one. */
  readonly retryAfterMs: number | null;

  constructor(input: {
    readonly code: string;
    readonly message: string;
    readonly status?: number | null;
    readonly details?: Readonly<Record<string, unknown>> | null;
    readonly requestId?: string | null;
    readonly retryAfterMs?: number | null;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status ?? null;
    this.details = input.details ?? null;
    this.requestId = input.requestId ?? null;
    this.retryAfterMs = input.retryAfterMs ?? null;
  }

  /** True for failures worth retrying later (transport, timeouts, 429, 5xx). */
  get retryable(): boolean {
    return this.code === "NETWORK_ERROR" || this.code === "TIMEOUT" || this.status === 429 || (this.status !== null && this.status >= 500);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Retry-After in ms from seconds or an HTTP date; null when absent or invalid. */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/u.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

const GENERIC_MESSAGES: Readonly<Record<number, string>> = {
  400: "The request was not accepted.",
  401: "Sign in to continue.",
  403: "This action is not allowed.",
  404: "Not found.",
  429: "Too many requests. Wait a moment and try again.",
  500: "The Lykia API had a problem. Try again shortly.",
  502: "An upstream service did not answer. Try again shortly.",
  503: "The Lykia API is temporarily unavailable. Try again shortly.",
  504: "An upstream service timed out. Try again shortly.",
};

/** Builds an ApiError from a non-2xx response body (parsed JSON or text). */
export function errorFromResponse(status: number, body: unknown, retryAfter: string | null = null): ApiError {
  const envelope = isRecord(body) && isRecord(body.error) ? body.error : null;
  const retryAfterMs = parseRetryAfter(retryAfter);
  if (envelope && typeof envelope.code === "string" && typeof envelope.message === "string") {
    return new ApiError({
      code: envelope.code,
      message: envelope.message,
      status,
      details: isRecord(envelope.details) ? envelope.details : null,
      requestId: typeof envelope.requestId === "string" ? envelope.requestId : null,
      retryAfterMs,
    });
  }
  const fallback = GENERIC_MESSAGES[status] ?? (status >= 500 ? GENERIC_MESSAGES[500]! : `The request failed (HTTP ${status}).`);
  return new ApiError({ code: "HTTP_ERROR", message: fallback, status, retryAfterMs });
}

/** Plain-words message for any thrown value (for toasts and inline errors). */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  // viem / wagmi errors carry a one-line `shortMessage` ("User rejected the request.").
  if (typeof error === "object" && error !== null && typeof (error as { shortMessage?: unknown }).shortMessage === "string") return (error as { shortMessage: string }).shortMessage;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}
