/**
 * The error catalog: stable codes, HTTP status, whether a retry can help,
 * and a plain message with the fix. The API, SDK and UI all speak it.
 */

export interface ErrorInfo {
  readonly status: number;
  readonly retryable: boolean;
  readonly message: string;
}

export const ERRORS = Object.freeze({
  INVALID_REQUEST: { status: 400, retryable: false, message: "The request is malformed. See details.issues." },
  INVALID_FENCE: { status: 400, retryable: false, message: "The Fence document is invalid. See details.issues." },
  INVALID_ACTIONS: { status: 400, retryable: false, message: "The plan actions are invalid. See details.issues." },
  NOT_UNDERSTOOD: { status: 422, retryable: false, message: "Lyko did not understand that. Try “send 20 USDC to 0x… for invoice 12”." },
  FENCE_DENIED: { status: 403, retryable: false, message: "The Fence denies this plan. See verdict.reasons." },
  CONFIRMATION_REQUIRED: { status: 409, retryable: false, message: "The Fence asks the owner to confirm this plan." },
  NOT_SIGNABLE: { status: 409, retryable: false, message: "This plan is a dry run or denied; nothing can be signed." },
  STEP_NOT_READY: { status: 409, retryable: false, message: "That step is not ready yet; its dependencies have not settled." },
  BINDING_MISMATCH: { status: 409, retryable: false, message: "The submitted transaction does not match the prepared one." },
  REFERENCE_CLAIMED: { status: 409, retryable: false, message: "That transaction hash is already attached to another step." },
  RECEIPT_REVERTED: { status: 422, retryable: false, message: "The transaction reverted on Arc." },
  NO_ROUTE: { status: 422, retryable: false, message: "No live venue on Arc can do that right now." },
  INSUFFICIENT_BALANCE: { status: 422, retryable: false, message: "The balance is too small for this plan." },
  UNPRICED: { status: 422, retryable: false, message: "No USD price for this token; Lykia does not guess." },
  NOT_FOUND: { status: 404, retryable: false, message: "Not found." },
  RATE_LIMITED: { status: 429, retryable: true, message: "Too many requests. Slow down a little." },
  PAYMENT_REQUIRED: { status: 402, retryable: true, message: "This endpoint is paid per call in USDC on Arc (x402)." },
  UPSTREAM_UNAVAILABLE: { status: 503, retryable: true, message: "An upstream (RPC, Circle API) is unavailable. Try again shortly." },
  NETWORK_UNAVAILABLE: { status: 503, retryable: true, message: "Arc RPC is unreachable right now." },
  INTERNAL: { status: 500, retryable: true, message: "Something broke on our side." },
} satisfies Record<string, ErrorInfo>);

export type ErrorCode = keyof typeof ERRORS;

export interface ErrorEnvelope {
  readonly error: { readonly code: ErrorCode; readonly message: string; readonly details?: unknown; readonly requestId?: string };
}

export function errorEnvelope(code: ErrorCode, message?: string, details?: unknown, requestId?: string): ErrorEnvelope {
  return { error: { code, message: message ?? ERRORS[code].message, ...(details === undefined ? {} : { details }), ...(requestId ? { requestId } : {}) } };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERRORS;
}
