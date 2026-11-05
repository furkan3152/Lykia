/**
 * Usage metering and request logs for keyed requests.
 *
 * Every request made with a Lykia-Key is written once, when the response
 * finishes, as
 *   - one request-log document (method, path, route, status, latency,
 *     request id, error code, key, project, mode, API version), kept for the
 *     plan's retention (7 days on Free) and listed newest first;
 *   - atomic counters per owner and per project, per day and per endpoint
 *     (requests, errors, total latency), with a small per-day index of the
 *     endpoints seen so usage can be read back without scanning logs.
 */
import type { EndpointUsage, RequestLogEntry } from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { typedCollection } from "./typed.js";

const INVERT = 9_999_999_999_999;
const DAY_MS = 86_400_000;
const USAGE_TTL_MS = 100 * DAY_MS;
const MAX_ENDPOINTS_PER_DAY = 300;

const logs = (ctx: AppContext) => typedCollection<RequestLogEntry & { readonly owner: string }>(ctx, "request_logs");
const index = (ctx: AppContext) => ctx.store.collection<{ endpoints: string[] }>("usage_index");
const KNOWN = new WeakMap<AppContext, Set<string>>();

function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** "GET /v1/intents/:id": the route template when Express matched one, else the raw path. */
function endpointName(method: string, route: string | null, path: string): string {
  return `${method.toUpperCase()} ${route ?? path}`.slice(0, 160);
}

async function indexEndpoint(ctx: AppContext, scope: string, day: string, endpoint: string): Promise<void> {
  let known = KNOWN.get(ctx);
  if (!known) {
    known = new Set();
    KNOWN.set(ctx, known);
  }
  const cacheKey = `${scope}|${day}|${endpoint}`;
  if (known.has(cacheKey)) return;
  const col = index(ctx);
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await col.get(`${scope}:${day}`);
    const endpoints = doc?.value.endpoints ?? [];
    if (endpoints.includes(endpoint) || endpoints.length >= MAX_ENDPOINTS_PER_DAY) break;
    const written = await col.compareAndSet(`${scope}:${day}`, doc?.version ?? null, { endpoints: [...endpoints, endpoint] }, { ttlMs: USAGE_TTL_MS });
    if (written) break;
  }
  if (known.size > 50_000) known.clear();
  known.add(cacheKey);
}

async function count(ctx: AppContext, scope: string, day: string, endpoint: string, failed: boolean, latencyMs: number): Promise<void> {
  const opts = { ttlMs: USAGE_TTL_MS };
  await Promise.all([
    ctx.store.counters("usage_req").increment(`${scope}:${day}`, 1, opts),
    failed ? ctx.store.counters("usage_err").increment(`${scope}:${day}`, 1, opts) : Promise.resolve(0),
    ctx.store.counters("usage_ep").increment(`${scope}:${day}:${endpoint}`, 1, opts),
    failed ? ctx.store.counters("usage_ep_err").increment(`${scope}:${day}:${endpoint}`, 1, opts) : Promise.resolve(0),
    ctx.store.counters("usage_ep_ms").increment(`${scope}:${day}:${endpoint}`, Math.max(0, Math.round(latencyMs)), opts),
    indexEndpoint(ctx, scope, day, endpoint),
  ]);
}

export interface RecordOptions {
  readonly owner: string;
  readonly retentionDays: number;
}

/** Writes the log entry and the usage counters (owner, and project when there is one). */
export async function recordRequest(ctx: AppContext, entry: RequestLogEntry, options: RecordOptions): Promise<void> {
  const owner = options.owner.toLowerCase();
  const now = Date.parse(entry.at);
  const id = `${owner}:${String(INVERT - now).padStart(13, "0")}:${entry.requestId}`.slice(0, 256);
  const day = dayOf(now);
  const endpoint = endpointName(entry.method, entry.route, entry.path);
  const failed = entry.status >= 400;
  await Promise.all([
    logs(ctx).put(id, { ...entry, owner }, { ttlMs: Math.max(1, options.retentionDays) * DAY_MS }),
    count(ctx, owner, day, endpoint, failed, entry.latencyMs),
    entry.projectId ? count(ctx, entry.projectId, day, endpoint, failed, entry.latencyMs) : Promise.resolve(),
  ]);
}

export interface LogQuery {
  readonly keyId?: string;
  readonly projectId?: string;
  readonly status?: number;
  /** "2xx", "4xx", "5xx" or "error" (>= 400). */
  readonly statusClass?: "2xx" | "3xx" | "4xx" | "5xx" | "error";
  readonly method?: string;
  /** Substring of the path. */
  readonly path?: string;
  readonly requestId?: string;
  /** Only entries strictly newer than this ISO time. */
  readonly since?: string;
  readonly limit?: number;
  /** Opaque cursor from the previous page. */
  readonly cursor?: string;
}

export interface LogPage {
  readonly data: RequestLogEntry[];
  readonly nextCursor: string | null;
}

function matches(entry: RequestLogEntry, q: LogQuery): boolean {
  if (q.keyId && entry.keyId !== q.keyId) return false;
  if (q.projectId && entry.projectId !== q.projectId) return false;
  if (q.status !== undefined && entry.status !== q.status) return false;
  if (q.statusClass) {
    if (q.statusClass === "error" ? entry.status < 400 : Math.floor(entry.status / 100) !== Number(q.statusClass[0])) return false;
  }
  if (q.method && entry.method !== q.method.toUpperCase()) return false;
  if (q.path && !entry.path.includes(q.path)) return false;
  if (q.requestId && entry.requestId !== q.requestId) return false;
  return true;
}

/** Newest first, filtered, cursor-paginated. */
export async function listLogs(ctx: AppContext, owner: string, q: LogQuery = {}): Promise<LogPage> {
  const who = owner.toLowerCase();
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const out: RequestLogEntry[] = [];
  let after = q.cursor ? `${who}:${q.cursor}` : undefined;
  const sinceMs = q.since ? Date.parse(q.since) : NaN;
  let lastId: string | null = null;
  for (let page = 0; page < 10 && out.length < limit; page++) {
    const docs = await logs(ctx).list({ prefix: `${who}:`, limit: 500, ...(after ? { after } : {}) });
    if (docs.length === 0) {
      lastId = null;
      break;
    }
    let stop = false;
    for (const doc of docs) {
      lastId = doc.id;
      const { owner: _owner, ...entry } = doc.value;
      if (Number.isFinite(sinceMs) && Date.parse(entry.at) <= sinceMs) {
        stop = true;
        lastId = null;
        break;
      }
      if (matches(entry, q)) out.push(entry);
      if (out.length >= limit) break;
    }
    if (stop || out.length >= limit) break;
    if (docs.length < 500) {
      lastId = null;
      break;
    }
    after = docs[docs.length - 1]?.id;
  }
  return { data: out, nextCursor: out.length >= limit && lastId ? lastId.slice(who.length + 1) : null };
}

export async function getLog(ctx: AppContext, owner: string, requestId: string): Promise<RequestLogEntry | null> {
  const page = await listLogs(ctx, owner, { requestId, limit: 1 });
  return page.data[0] ?? null;
}

export interface UsageByDay {
  readonly days: { readonly day: string; readonly requests: number; readonly errors: number }[];
  readonly endpoints: (EndpointUsage & { readonly day: string })[];
}

/** Requests and errors per day and per endpoint for an owner address or a project id. */
export async function usageByDay(ctx: AppContext, scope: string, days: number): Promise<UsageByDay> {
  const now = ctx.clock.now();
  const out: UsageByDay = { days: [], endpoints: [] };
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(now - i * DAY_MS);
    const [requests, errors, idx] = await Promise.all([ctx.store.counters("usage_req").get(`${scope}:${day}`), ctx.store.counters("usage_err").get(`${scope}:${day}`), index(ctx).get(`${scope}:${day}`)]);
    out.days.push({ day, requests, errors });
    for (const endpoint of idx?.value.endpoints ?? []) {
      const key = `${scope}:${day}:${endpoint}`;
      const [n, e, ms] = await Promise.all([ctx.store.counters("usage_ep").get(key), ctx.store.counters("usage_ep_err").get(key), ctx.store.counters("usage_ep_ms").get(key)]);
      out.endpoints.push({ day, endpoint, requests: n, errors: e, avgLatencyMs: n > 0 ? Math.round(ms / n) : 0 });
    }
  }
  return out;
}
