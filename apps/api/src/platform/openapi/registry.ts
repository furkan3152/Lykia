/**
 * The shared catalogue of documented API operations. Every module that wants
 * its routes in the OpenAPI document calls `documentRoutes` once at import
 * time with zod schemas for the request and the response. The OpenAPI
 * builder reads `documentedRoutes()`; nothing here touches Express.
 */
import type { ZodTypeAny } from "zod";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface DocumentedRoute {
  readonly method: HttpMethod;
  /** Express-style path, e.g. `/v1/aggregator/quote` or `/v1/payouts/:id`. */
  readonly path: string;
  /** Grouping in the reference, e.g. "Aggregator", "Payouts". */
  readonly tag: string;
  readonly summary: string;
  readonly description?: string;
  /** Key scope the gate requires, when the route is reachable with a Lykia-Key. */
  readonly scope?: string;
  /** True when the route also needs a SIWE session or a secret key. */
  readonly auth?: "public" | "key" | "secret" | "session";
  readonly query?: ZodTypeAny;
  readonly params?: ZodTypeAny;
  readonly body?: ZodTypeAny;
  readonly response?: ZodTypeAny;
  /** True when an `Idempotency-Key` header is honoured. */
  readonly idempotent?: boolean;
  /** Paid with x402 instead of (or as well as) a key. */
  readonly x402?: boolean;
  /** Optional additions read by the OpenAPI builder (all optional, so existing calls stay valid). */
  readonly operationId?: string;
  readonly deprecated?: boolean;
  /** Success status (default 200, or 201 for creating POSTs that say so). */
  readonly status?: number;
  readonly example?: unknown;
}

const routes = new Map<string, DocumentedRoute>();

export function documentRoutes(list: readonly DocumentedRoute[]): void {
  for (const route of list) routes.set(`${route.method} ${route.path}`, route);
}

export function documentedRoutes(): readonly DocumentedRoute[] {
  return [...routes.values()].sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
