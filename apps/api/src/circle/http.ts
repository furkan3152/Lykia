/** Outbound calls to Circle: a network failure becomes a clear 502, never a 500 or a guess. */
import type { FetchLike } from "../health/dependencies.js";
import { LykiaHttpError } from "../http/errors.js";

export async function circleFetch(fetchImpl: FetchLike, url: string, init: RequestInit | undefined, product: string): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `${product} is unreachable right now. Try again shortly.`, { reason: error instanceof Error ? error.message.slice(0, 120) : "network error" });
  }
}

/**
 * A short, safe reason from an upstream error body: only Circle's own
 * `code` and `message` fields (truncated), never the raw body, which can
 * echo request details back to the caller.
 */
export function upstreamReason(text: string): { code?: string | number; message?: string } {
  try {
    const json = JSON.parse(text) as { code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } };
    const code = json.code ?? json.error?.code;
    const message = json.message ?? json.error?.message;
    return { ...(typeof code === "string" || typeof code === "number" ? { code: typeof code === "string" ? code.slice(0, 40) : code } : {}), ...(typeof message === "string" ? { message: message.replace(/[^\x20-\x7E]/gu, " ").slice(0, 160) } : {}) };
  } catch {
    return {};
  }
}
