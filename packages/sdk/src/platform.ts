/**
 * `@lykia/sdk/platform`: the API platform itself. Keys (live and test,
 * scopes, rotation, IP allowlists), webhooks (endpoints, deliveries, replay,
 * test events), the event feed, request logs, usage, plans and credits,
 * versions and the OpenAPI document. Account routes take a wallet session
 * or a secret lk_live_/lk_test_ key with the `admin` scope (reads need `read`).
 */
import type {
  ApiKeyMode,
  ApiKeyScope,
  ApiKeyView,
  BillingPlan,
  BillingPlanId,
  BillingUsageView,
  CreatedApiKey,
  RequestLogEntry,
  WebhookDelivery,
  WebhookEndpointView,
  WebhookEnvelope,
} from "@lykia/core/api/platform";
import { q, type LykiaTransport } from "./transport.js";

export interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
}

/** Walks every page of a cursor-paginated list. */
export async function* paginate<T>(fetchPage: (cursor: string | undefined) => Promise<Page<T>>, maxPages = 100): AsyncGenerator<T> {
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor);
    for (const item of result.data) yield item;
    if (!result.nextCursor) return;
    cursor = result.nextCursor;
  }
}

export interface CreateKeyInput {
  readonly label: string;
  readonly kind?: "secret" | "publishable";
  /** live (lk_live_…) or test (lk_test_…, testnet only). */
  readonly mode?: ApiKeyMode;
  readonly scopes?: readonly ApiKeyScope[];
  readonly allowedOrigins?: readonly string[];
  readonly allowedIps?: readonly string[];
  readonly perMinute?: number;
  readonly perDay?: number;
  readonly apiVersion?: string;
}

export type UpdateKeyInput = Partial<Omit<CreateKeyInput, "kind" | "mode">>;

export interface LogQuery {
  readonly keyId?: string;
  readonly projectId?: string;
  readonly status?: number;
  readonly statusClass?: "2xx" | "3xx" | "4xx" | "5xx" | "error";
  readonly method?: string;
  readonly path?: string;
  readonly since?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface WebhookEndpointInput {
  readonly url: string;
  readonly events?: readonly string[];
  readonly owners?: readonly string[];
  readonly projects?: readonly string[];
  readonly description?: string | null;
}

export interface EventCatalogueEntry {
  readonly type: string;
  readonly group: string;
  readonly description: string;
  readonly aliases: readonly string[];
}

export type DeliveryDetail = WebhookDelivery & { readonly payload: WebhookEnvelope };

const str = (n: number | undefined) => (n === undefined ? undefined : String(n));

export function platformApi(t: LykiaTransport) {
  const keys = {
    list: () => t.request<{ keys: ApiKeyView[] }>("GET", "/v1/developers/keys"),
    create: (input: CreateKeyInput) => t.request<CreatedApiKey>("POST", "/v1/developers/keys", input),
    get: (id: string) => t.request<ApiKeyView>("GET", `/v1/developers/keys/${encodeURIComponent(id)}`),
    update: (id: string, patch: UpdateKeyInput) => t.request<ApiKeyView>("PATCH", `/v1/developers/keys/${encodeURIComponent(id)}`, patch),
    /** New secret now; the old one keeps working for `overlapSeconds` (default 86400). */
    rotate: (id: string, overlapSeconds?: number) => t.request<CreatedApiKey>("POST", `/v1/developers/keys/${encodeURIComponent(id)}/rotate`, overlapSeconds === undefined ? {} : { overlapSeconds }),
    revoke: (id: string) => t.request<ApiKeyView>("POST", `/v1/developers/keys/${encodeURIComponent(id)}/revoke`, {}),
  };
  const webhooks = {
    list: () => t.request<{ endpoints: WebhookEndpointView[]; events: string[] }>("GET", "/v1/developers/webhooks"),
    create: (input: WebhookEndpointInput) => t.request<WebhookEndpointView>("POST", "/v1/developers/webhooks", input),
    update: (id: string, patch: { events?: readonly string[]; projects?: readonly string[]; description?: string | null }) => t.request<WebhookEndpointView>("PATCH", `/v1/developers/webhooks/${encodeURIComponent(id)}`, patch),
    disable: (id: string) => t.request<WebhookEndpointView>("POST", `/v1/developers/webhooks/${encodeURIComponent(id)}/disable`, {}),
    enable: (id: string) => t.request<WebhookEndpointView>("POST", `/v1/developers/webhooks/${encodeURIComponent(id)}/enable`, {}),
    rotateSecret: (id: string) => t.request<WebhookEndpointView>("POST", `/v1/developers/webhooks/${encodeURIComponent(id)}/rotate-secret`, {}),
    deliveries: (query: { limit?: number; endpointId?: string; status?: "pending" | "delivered" | "failed"; event?: string } = {}) =>
      t.request<{ deliveries: WebhookDelivery[] }>("GET", `/v1/developers/webhooks/deliveries${q({ limit: str(query.limit), endpointId: query.endpointId, status: query.status, event: query.event })}`),
    delivery: (id: string) => t.request<DeliveryDetail>("GET", `/v1/developers/webhooks/deliveries/${encodeURIComponent(id)}`),
    replay: (id: string) => t.request<WebhookDelivery>("POST", `/v1/developers/webhooks/deliveries/${encodeURIComponent(id)}/replay`, {}),
    test: (input: { endpointId?: string; type?: string } = {}) => t.request<{ sent: number; deliveries: WebhookDelivery[] }>("POST", "/v1/developers/webhooks/test", input),
    catalogue: () => t.request<{ events: EventCatalogueEntry[] }>("GET", "/v1/webhooks/events"),
  };
  const events = {
    list: (query: { limit?: number; cursor?: string; since?: string; type?: string } = {}) => t.request<Page<WebhookEnvelope>>("GET", `/v1/events${q({ limit: str(query.limit), cursor: query.cursor, since: query.since, type: query.type })}`),
    get: (id: string) => t.request<WebhookEnvelope>("GET", `/v1/events/${encodeURIComponent(id)}`),
    all: (query: { type?: string; since?: string } = {}) => paginate((cursor) => events.list({ ...query, ...(cursor ? { cursor } : {}), limit: 200 })),
  };
  const logs = {
    list: (query: LogQuery = {}) =>
      t.request<Page<RequestLogEntry>>(
        "GET",
        `/v1/logs${q({ keyId: query.keyId, projectId: query.projectId, status: str(query.status), statusClass: query.statusClass, method: query.method, path: query.path, since: query.since, limit: str(query.limit), cursor: query.cursor })}`,
      ),
    get: (requestId: string) => t.request<RequestLogEntry>("GET", `/v1/logs/${encodeURIComponent(requestId)}`),
    all: (query: Omit<LogQuery, "cursor"> = {}) => paginate((cursor) => logs.list({ ...query, ...(cursor ? { cursor } : {}) })),
    /** Polls for new entries and yields them oldest first, until the signal aborts. */
    async *tail(query: Omit<LogQuery, "cursor" | "since"> = {}, options: { intervalMs?: number; signal?: AbortSignal; since?: string } = {}): AsyncGenerator<RequestLogEntry> {
      let since = options.since ?? new Date().toISOString();
      while (!options.signal?.aborted) {
        const page = await logs.list({ ...query, since, limit: 200 });
        const fresh = [...page.data].reverse();
        for (const entry of fresh) yield entry;
        if (fresh.length > 0) since = fresh[fresh.length - 1]?.at ?? since;
        await new Promise((r) => setTimeout(r, options.intervalMs ?? 2_000));
      }
    },
  };
  const billing = {
    plans: () => t.request<{ plans: BillingPlan[] }>("GET", "/v1/billing/plans"),
    plan: () => t.request<{ plan: BillingPlan; creditsUnits: string; plans: BillingPlan[] }>("GET", "/v1/billing/plan"),
    setPlan: (plan: BillingPlanId) => t.request<{ plan: BillingPlan }>("PUT", "/v1/billing/plan", { plan }),
    usage: (days?: number) => t.request<BillingUsageView>("GET", `/v1/billing/usage${q({ days: str(days) })}`),
    /** Answers 402 with x402 requirements until you retry with an X-PAYMENT header (pass it in `headers`). */
    buyCredits: (amountUsdc: string, payment?: string) => t.request<{ creditsUnits: string; bought: string; payer: string; settlement: string }>("POST", "/v1/billing/credits", { amountUsdc }, payment ? { headers: { "X-PAYMENT": payment } } : {}),
    ledger: () => t.request<{ entries: unknown[] }>("GET", "/v1/billing/ledger"),
  };
  return {
    keys,
    webhooks,
    events,
    logs,
    billing,
    versions: () => t.request<{ latest: string; versions: string[]; header: "Lykia-Version" }>("GET", "/v1/versions"),
    openapi: () => t.request<Record<string, unknown>>("GET", "/v1/openapi.json"),
  };
}

export type PlatformApi = ReturnType<typeof platformApi>;
