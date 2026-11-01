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
