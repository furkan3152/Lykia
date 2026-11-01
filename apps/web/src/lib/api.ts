/**
 * Fetch wrapper for the Lykia API: base URL from VITE_API_URL, JSON in and
 * out, a timeout, abort support, and the API's error envelope parsed into
 * `ApiError` (see apiErrors.ts). Feature code calls `apiGet` / `apiPost` or
 * wraps them in react-query.
 */
import { ApiError, errorFromResponse } from "./apiErrors";
import { API_BASE } from "./env";
import { sessionToken } from "./session";

export { ApiError, describeError } from "./apiErrors";

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** Default 10 s. */
  readonly timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Absolute URL for an API path ("/v1/markets") with query parameters (null/undefined dropped). */
export function apiUrl(path: string, query?: Readonly<Record<string, QueryValue>>): string {
  if (!path.startsWith("/")) throw new Error(`API paths start with "/": ${path}`);
  const url = new URL(path, API_BASE);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(apiUrl(path, options.query), {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(sessionToken() ? { "Lykia-Session": sessionToken() as string } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: "omit",
    });
  } catch {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    if (timedOut) throw new ApiError({ code: "TIMEOUT", message: `The Lykia API did not answer within ${Math.round(timeoutMs / 1000)} s.` });
    if (options.signal?.aborted) throw new ApiError({ code: "ABORTED", message: "The request was cancelled." });
    throw new ApiError({ code: "NETWORK_ERROR", message: "Could not reach the Lykia API. Check your connection, or that the API is running." });
  }
  clearTimeout(timer);
  options.signal?.removeEventListener("abort", onAbort);

  const text = await response.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) throw errorFromResponse(response.status, body, response.headers.get("retry-after"));
  if (text && typeof body === "string") throw new ApiError({ code: "INVALID_RESPONSE", message: "The Lykia API sent a response Lykia could not read.", status: response.status });
  return body as T;
}

export function apiGet<T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "GET" });
}

export function apiPost<T>(path: string, body: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "POST", body });
}

export function apiPut<T>(path: string, body: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "PUT", body });
}

export function apiDelete<T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "DELETE" });
}
