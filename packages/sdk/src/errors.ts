/** The API's error envelope as an exception. */
export class LykiaError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | null;
  readonly retryable: boolean;

  constructor(input: { code: string; status: number; message: string; details?: unknown; requestId?: string | null }) {
    super(input.message);
    this.name = "LykiaError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.requestId = input.requestId ?? null;
    this.retryable = input.status === 429 || input.status >= 500 || input.status === 0;
  }
}

export async function errorFrom(response: Response): Promise<LykiaError> {
  let body: { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    /* not JSON */
  }
  return new LykiaError({
    code: body.error?.code ?? (response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR"),
    status: response.status,
    message: body.error?.message ?? `HTTP ${response.status}`,
    details: body.error?.details,
    requestId: body.error?.requestId ?? response.headers.get("x-request-id"),
  });
}
