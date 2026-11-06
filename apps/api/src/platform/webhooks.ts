/**
 * Signed webhooks.
 *
 * A developer registers an https endpoint for some events (catalogue names
 * such as `step.settled`, or the older aliases such as `intent.step.settled`).
 * Every delivery is a JSON POST with
 *
 *   Lykia-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *   Lykia-Event: <the name the endpoint subscribed to>
 *   Lykia-Event-Id: evt_…      Lykia-Delivery-Id: whd_…      Lykia-Webhook-Attempt: <n>
 *
 * Receivers verify with the endpoint secret (shown once) and reject
 * timestamps older than five minutes. A failed delivery is retried with
 * exponential backoff (30 s, 2 min, 10 min, 1 h, 6 h) and marked failed after
 * the last attempt; every attempt is logged. Retries are driven by a store
 * queue that any instance can drain (the cron, a timer on long-running
 * servers, or ordinary traffic on serverless), so nothing depends on a
 * long-lived process. Deliveries can be replayed and test events sent.
 * Secrets are kept encrypted at rest (AES-256-GCM, key derived from
 * LYKIA_SESSION_SECRET). Endpoints must resolve to public addresses.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  LATEST_API_VERSION,
  WEBHOOK_EVENT_CATALOGUE,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookAttempt,
  type WebhookDelivery,
  type WebhookEndpointView,
  type WebhookEvent,
} from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { assertPublicUrl, type HostResolver } from "../http/netguard.js";
import type { JsonValue } from "../store/types.js";
import { typedCollection } from "./typed.js";
import { listConsents } from "./consent.js";
import { getProject } from "./projects.js";
import { hmacHex, purposeKey, randomHex, randomToken, safeEqual } from "./crypto.js";

export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;
const MAX_ENDPOINTS = 10;
const SIGNATURE_TOLERANCE_S = 300;
const DELIVERY_TTL_MS = 7 * 86_400_000;
const EVENT_TTL_MS = 30 * 86_400_000;
const MAX_ATTEMPT_LOG = 10;
const INVERT = 9_999_999_999_999;
const inverted = (ms: number) => String(INVERT - ms).padStart(13, "0");
const padded = (ms: number) => String(ms).padStart(13, "0");

/** The body of every delivery (see WebhookEnvelope in @lykia/core/api/platform). */
export interface WebhookPayload {
  readonly id: string;
  readonly type: string;
  readonly event: string;
  readonly createdAt: string;
  readonly owner: string | null;
  readonly project: string | null;
  readonly livemode: boolean;
  readonly apiVersion: string;
  readonly data: JsonValue;
}

interface StoredEndpoint {
  readonly id: string;
  readonly developer: string;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  /**
   * Legacy: owner addresses this endpoint once listed. Only the developer's
   * own address is honoured; another owner's events reach an endpoint only
   * through that owner's consent to one of the developer's projects.
   */
  readonly owners: readonly string[];
  /** Projects whose events this endpoint receives. */
  readonly projects?: readonly string[];
  readonly secretBox: string;
  readonly createdAt: string;
  readonly disabled: boolean;
  readonly description?: string | null;
}

interface StoredDelivery extends WebhookDelivery {
  readonly developer?: string;
  readonly payload: WebhookPayload;
}

interface StoredEvent {
  readonly owner: string;
  readonly payload: WebhookPayload;
  readonly deliveries: readonly string[];
}

/* ------------------------------------------------------------ catalogue */

const CANONICAL = new Map<string, string>();
for (const entry of WEBHOOK_EVENT_CATALOGUE) {
  CANONICAL.set(entry.type, entry.type);
  for (const alias of entry.aliases) CANONICAL.set(alias, entry.type);
}
const EXTRA_EVENTS = new Map<string, { readonly description: string; readonly group: string }>();

/** Lets other modules add event types to the catalogue (for example `treasury.rebalanced`). */
export function registerEventTypes(list: readonly { readonly type: string; readonly description: string; readonly group?: string }[]): void {
  for (const e of list) {
    if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u.test(e.type)) throw new Error(`Invalid event type ${e.type}`);
    if (!CANONICAL.has(e.type)) {
      CANONICAL.set(e.type, e.type);
      EXTRA_EVENTS.set(e.type, { description: e.description, group: e.group ?? "other" });
    }
  }
}

/** The full catalogue: built-in events with their aliases, then registered ones. */
export function eventCatalogue(): { type: string; group: string; description: string; aliases: readonly string[] }[] {
  return [...WEBHOOK_EVENT_CATALOGUE.map((e) => ({ type: e.type, group: e.group, description: e.description, aliases: e.aliases })), ...[...EXTRA_EVENTS].map(([type, e]) => ({ type, group: e.group, description: e.description, aliases: [] }))];
}

/** Every name an endpoint may subscribe to. */
export function subscribableEvents(): string[] {
  return [...CANONICAL.keys()];
}

export function canonicalEvent(name: string): string | null {
  return CANONICAL.get(name) ?? null;
}

/** The names that subscribe to a canonical event (itself and its aliases). */
function namesFor(canonical: string): string[] {
  return [...CANONICAL].filter(([, c]) => c === canonical).map(([name]) => name);
}

/* ------------------------------------------------------------ signing */

/** `t=…,v1=…` for a raw body. */
export function signWebhook(secret: string, body: string, timestampS: number): string {
  return `t=${timestampS},v1=${hmacHex(secret, `${timestampS}.${body}`)}`;
}

/** Receiver-side check (also exported by @lykia/sdk and the Python SDK). Accepts several v1 entries (secret rotation). */
export function verifyWebhookSignature(secret: string, body: string, header: string, nowS: number, toleranceS = SIGNATURE_TOLERANCE_S): boolean {
  const pairs = header.split(",").map((p) => p.trim().split("=", 2) as [string, string | undefined]);
  const t = Number(pairs.find(([k]) => k === "t")?.[1]);
  const signatures = pairs.filter(([k, v]) => k === "v1" && v).map(([, v]) => v as string);
  if (!Number.isInteger(t) || signatures.length === 0 || Math.abs(nowS - t) > toleranceS) return false;
  const expected = hmacHex(secret, `${t}.${body}`);
  return signatures.some((s) => safeEqual(s, expected));
}

function seal(ctx: AppContext, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", purposeKey(ctx, "webhook"), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

function open(ctx: AppContext, box: string): string {
  const [iv, tag, data] = box.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", purposeKey(ctx, "webhook"), iv as Buffer);
  decipher.setAuthTag(tag as Buffer);
  return Buffer.concat([decipher.update(data as Buffer), decipher.final()]).toString("utf8");
}

function view(e: StoredEndpoint, secret?: string): WebhookEndpointView & { projects: readonly string[]; description: string | null } {
  return { id: e.id, url: e.url, events: e.events, createdAt: e.createdAt, disabled: e.disabled, projects: e.projects ?? [], description: e.description ?? null, ...(secret ? { secret } : {}) };
}

function publicDelivery({ payload: _payload, developer: _developer, ...rest }: StoredDelivery): WebhookDelivery {
  return rest;
}

export interface WebhookServiceDeps {
  readonly resolve?: HostResolver;
}

export interface EmitTarget {
  readonly owner?: string | null;
  readonly project?: string | null;
  /** Defaults to true unless the data says `environment: "testnet"`. */
  readonly livemode?: boolean;
}

export interface DeliveryQuery {
  readonly limit?: number;
  readonly endpointId?: string;
  readonly status?: "pending" | "delivered" | "failed";
  readonly event?: string;
}

export class WebhookService {
  constructor(private readonly ctx: AppContext, private readonly deps: WebhookServiceDeps = {}) {}

  private endpoints() {
    return typedCollection<StoredEndpoint>(this.ctx, "webhook_endpoints");
  }

  private deliveries() {
    return typedCollection<StoredDelivery>(this.ctx, "webhook_deliveries");
  }

  /** `<developer>:<inverted time>:<delivery id>`: newest first per developer. */
  private deliveryIndex() {
    return typedCollection<{ readonly id: string }>(this.ctx, "webhook_delivery_index");
  }

  /** `<due ms>:<delivery id>`: the retry queue, oldest due first. */
  private queue() {
    return typedCollection<{ readonly id: string }>(this.ctx, "webhook_queue");
  }

  /** Every endpoint, page by page (the store returns at most 1,000 per call; nothing is cut off). */
  private async allEndpoints() {
    const out: Awaited<ReturnType<ReturnType<WebhookService["endpoints"]>["list"]>> = [];
    let after: string | undefined;
    for (;;) {
      const page = await this.endpoints().list({ limit: 1000, ...(after ? { after } : {}) });
      out.push(...page);
      if (page.length < 1000) return out;
      after = page[page.length - 1]!.id;
    }
  }

  /** `<owner>:<inverted time>:<event id>`: the event feed (GET /v1/events, `lykia webhooks listen`). */
  private events() {
    return typedCollection<StoredEvent>(this.ctx, "webhook_events");
  }

  async create(developer: string, input: { readonly url: string; readonly events?: readonly WebhookEvent[] | readonly string[]; readonly projects?: readonly string[]; readonly description?: string | null; readonly maxEndpoints?: number }): Promise<WebhookEndpointView> {
    const dev = developer.toLowerCase();
    const mine = (await this.allEndpoints()).filter((d) => d.value.developer === dev && !d.value.disabled);
    const max = input.maxEndpoints ?? MAX_ENDPOINTS;
    if (mine.length >= max) throw new LykiaHttpError("WEBHOOK_LIMIT", 409, `At most ${max} endpoints per developer.`);
    const url = await assertPublicUrl(input.url, "url", this.deps.resolve);
    if (url.protocol !== "https:") throw new LykiaHttpError("INVALID_REQUEST", 400, "Webhook endpoints must use https.");
    const unknown = (input.events ?? []).filter((e) => !CANONICAL.has(e));
    if (unknown.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `Unknown events: ${unknown.join(", ")}. See GET /v1/webhooks/events.`);
    // Without a list an endpoint receives every catalogue event (not the aliases, which would double up).
    const events = (input.events && input.events.length > 0 ? input.events : eventCatalogue().map((e) => e.type)) as readonly WebhookEvent[];
    const secret = `whsec_${randomToken(24)}`;
    const endpoint: StoredEndpoint = {
      id: `whe_${randomHex(8)}`,
      developer: dev,
      url: url.toString(),
      events,
      owners: [dev],
      projects: [...new Set(input.projects ?? [])],
      secretBox: seal(this.ctx, secret),
      createdAt: new Date(this.ctx.clock.now()).toISOString(),
      disabled: false,
      description: input.description ?? null,
    };
    await this.endpoints().put(endpoint.id, endpoint);
    return view(endpoint, secret);
  }

  async list(developer: string): Promise<WebhookEndpointView[]> {
    return (await this.allEndpoints()).filter((d) => d.value.developer === developer.toLowerCase()).map((d) => view(d.value));
  }

  private async own(developer: string, id: string): Promise<StoredEndpoint> {
    const doc = await this.endpoints().get(id);
    if (!doc || doc.value.developer !== developer.toLowerCase()) throw new LykiaHttpError("NOT_FOUND", 404, "No such endpoint.");
    return doc.value;
  }

  async disable(developer: string, id: string): Promise<WebhookEndpointView> {
    const next = { ...(await this.own(developer, id)), disabled: true };
    await this.endpoints().put(id, next);
    return view(next);
  }

  async enable(developer: string, id: string): Promise<WebhookEndpointView> {
    const next = { ...(await this.own(developer, id)), disabled: false };
    await this.endpoints().put(id, next);
    return view(next);
  }

  /** Changes the events, projects or description of an endpoint. */
  async update(developer: string, id: string, patch: { readonly events?: readonly string[]; readonly projects?: readonly string[]; readonly description?: string | null }): Promise<WebhookEndpointView> {
    const current = await this.own(developer, id);
    const unknown = (patch.events ?? []).filter((e) => !CANONICAL.has(e));
    if (unknown.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `Unknown events: ${unknown.join(", ")}.`);
    const next: StoredEndpoint = {
      ...current,
      ...(patch.events && patch.events.length > 0 ? { events: patch.events as readonly WebhookEvent[] } : {}),
      ...(patch.projects ? { projects: [...new Set(patch.projects)] } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    };
    await this.endpoints().put(id, next);
    return view(next);
  }

  /** A new signing secret, shown once. */
  async rotateSecret(developer: string, id: string): Promise<WebhookEndpointView> {
    const secret = `whsec_${randomToken(24)}`;
    const next = { ...(await this.own(developer, id)), secretBox: seal(this.ctx, secret) };
    await this.endpoints().put(id, next);
    return view(next, secret);
  }

  /** Newest first. */
  async recentDeliveries(developer: string, limitOrQuery: number | DeliveryQuery = 50): Promise<WebhookDelivery[]> {
    const q: DeliveryQuery = typeof limitOrQuery === "number" ? { limit: limitOrQuery } : limitOrQuery;
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const dev = developer.toLowerCase();
    const out: WebhookDelivery[] = [];
    let after: string | undefined;
    for (let page = 0; page < 5 && out.length < limit; page++) {
      const refs = await this.deliveryIndex().list({ prefix: `${dev}:`, limit: 200, ...(after ? { after } : {}) });
      if (refs.length === 0) break;
      for (const ref of refs) {
        const doc = await this.deliveries().get(ref.value.id);
        if (!doc) continue;
        const d = doc.value;
        if (q.endpointId && d.endpointId !== q.endpointId) continue;
        if (q.status && d.status !== q.status) continue;
        if (q.event && d.event !== q.event && d.payload.type !== q.event) continue;
        out.push(publicDelivery(d));
        if (out.length >= limit) break;
      }
      after = refs[refs.length - 1]?.id;
      if (refs.length < 200) break;
    }
    return out;
  }

  async delivery(developer: string, id: string): Promise<WebhookDelivery & { readonly payload: WebhookPayload }> {
    const doc = await this.deliveries().get(id);
    if (!doc || (doc.value.developer ?? "") !== developer.toLowerCase()) throw new LykiaHttpError("NOT_FOUND", 404, "No such delivery.");
    const { developer: _developer, ...rest } = doc.value;
    return rest;
  }

  /** Events concerning an owner, newest first (the feed `lykia webhooks listen` polls). */
  async listEvents(owner: string, q: { readonly limit?: number; readonly after?: string; readonly since?: string; readonly type?: string } = {}): Promise<{ data: WebhookPayload[]; nextCursor: string | null }> {
    const who = owner.toLowerCase();
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const sinceMs = q.since ? Date.parse(q.since) : NaN;
    const docs = await this.events().list({ prefix: `${who}:`, limit: 1000, ...(q.after ? { after: `${who}:${q.after}` } : {}) });
    const data: WebhookPayload[] = [];
    let last: string | null = null;
    for (const doc of docs) {
      const p = doc.value.payload;
      if (Number.isFinite(sinceMs) && Date.parse(p.createdAt) <= sinceMs) break;
      if (q.type && p.type !== q.type) continue;
      data.push(p);
      last = doc.id;
      if (data.length >= limit) break;
    }
    return { data, nextCursor: data.length >= limit && last ? last.slice(who.length + 1) : null };
  }

  async getEvent(owner: string, id: string): Promise<WebhookPayload | null> {
    const prefix = `${owner.toLowerCase()}:`;
    let after: string | undefined;
    for (;;) {
      const docs = await this.events().list({ prefix, limit: 1000, ...(after ? { after } : {}) });
      const hit = docs.find((d) => d.value.payload.id === id);
      if (hit) return hit.value.payload;
      if (docs.length < 1000) return null;
      after = docs[docs.length - 1]!.id;
    }
  }

  /** Legacy entry point: `emit(event, owner, data)`. Prefer `emitEvent` from platform/events.ts. */
  async emit(event: WebhookEvent | string, owner: string, data: JsonValue): Promise<number> {
    return (await this.emitEvent(event, data, { owner })).delivered;
  }

  /**
   * Records the event, then queues and attempts one delivery per subscribed
   * endpoint: endpoints following the owner, endpoints following the
   * project, and the project's own webhook.
   */
  async emitEvent(type: string, data: JsonValue, target: EmitTarget & { readonly projectOwner?: string | null; readonly projectWebhookId?: string | null }): Promise<{ readonly eventId: string; readonly delivered: number }> {
    const canonical = canonicalEvent(type);
    if (!canonical) throw new Error(`Unknown webhook event type ${type}; add it with registerEventTypes().`);
    const owner = target.owner ? target.owner.toLowerCase() : null;
    const project = target.project ?? null;
    const names = namesFor(canonical);
    // Who may hear about this owner: the owner's own endpoints, and the endpoints of projects the owner consented to.
    const consented = owner !== null ? await listConsents(this.ctx, owner).catch(() => []) : [];
    const consentProjects = new Set(consented.map((c) => c.projectId));
    const consentDevelopers = new Map(consented.map((c) => [c.projectId, c.developer]));
    const consentHooks = new Set<string>();
    for (const c of consented) {
      const p = await getProject(this.ctx, c.projectId).catch(() => null);
      if (p?.webhookId && p.owner.toLowerCase() === c.developer) consentHooks.add(p.webhookId);
    }
    const projectOwner = project !== null ? (target.projectOwner?.toLowerCase() ?? (await getProject(this.ctx, project).catch(() => null))?.owner.toLowerCase() ?? null) : null;
    const targets = (await this.allEndpoints()).filter((d) => {
      const e = d.value;
      if (e.disabled || !e.events.some((name) => names.includes(name))) return false;
      if (owner !== null) {
        if (e.developer === owner) return true;
        if (consentHooks.has(e.id)) return true;
        if ((e.projects ?? []).some((p) => consentProjects.has(p) && consentDevelopers.get(p) === e.developer)) return true;
      }
      // Project events go only to the project owner's own endpoints.
      if (project !== null && projectOwner !== null && e.developer === projectOwner) return (e.projects ?? []).includes(project) || e.id === target.projectWebhookId;
      return false;
    });
    const now = this.ctx.clock.now();
    const livemode = target.livemode ?? !(typeof data === "object" && data !== null && !Array.isArray(data) && (data as Record<string, unknown>).environment === "testnet");
    const eventId = `evt_${randomHex(10)}`;
    const base: Omit<WebhookPayload, "event"> = { id: eventId, type: canonical, createdAt: new Date(now).toISOString(), owner, project, livemode, apiVersion: LATEST_API_VERSION, data };
    const deliveryIds: string[] = [];
    for (const t of targets) {
      // Endpoints that subscribed with a legacy name see that name in `event`.
      const event = t.value.events.includes(canonical as WebhookEvent) ? canonical : (t.value.events.find((n) => names.includes(n)) ?? canonical);
      const id = await this.queueDelivery(t.value, { ...base, event }, null);
      deliveryIds.push(id);
    }
    const feedOwner = owner ?? (target.projectOwner ? target.projectOwner.toLowerCase() : null);
    if (feedOwner) await this.events().put(`${feedOwner}:${inverted(now)}:${eventId}`, { owner: feedOwner, payload: { ...base, event: canonical }, deliveries: deliveryIds }, { ttlMs: EVENT_TTL_MS });
    for (const id of deliveryIds) await this.attempt(id);
    return { eventId, delivered: targets.length };
  }

  private async queueDelivery(endpoint: StoredEndpoint, payload: WebhookPayload, replayOf: string | null): Promise<string> {
    const now = this.ctx.clock.now();
    const delivery: StoredDelivery = {
      id: `whd_${now.toString(36)}_${randomHex(6)}`,
      endpointId: endpoint.id,
      event: payload.event as WebhookEvent,
      eventId: payload.id,
      replayOf,
      attempts: 0,
      status: "pending",
      lastStatusCode: null,
      nextAttemptAt: new Date(now).toISOString(),
      createdAt: new Date(now).toISOString(),
      attemptLog: [],
      developer: endpoint.developer,
      payload,
    };
    await this.deliveries().put(delivery.id, delivery, { ttlMs: DELIVERY_TTL_MS });
    await this.deliveryIndex().put(`${endpoint.developer}:${inverted(now)}:${delivery.id}`, { id: delivery.id }, { ttlMs: DELIVERY_TTL_MS });
    return delivery.id;
  }

  /** Sends a delivery again (a new delivery with the same event id and body). */
  async replay(developer: string, id: string): Promise<WebhookDelivery> {
    const original = await this.delivery(developer, id);
    const endpoint = await this.own(developer, original.endpointId);
    if (endpoint.disabled) throw new LykiaHttpError("CONFLICT", 409, "That endpoint is disabled. Enable it first.");
    const replayId = await this.queueDelivery(endpoint, original.payload, original.id);
    return publicDelivery((await this.attempt(replayId)) as StoredDelivery);
  }

  /**
   * A test event to one endpoint (or every enabled endpoint of the
   * developer), whatever it subscribed to. `type` picks a catalogue event to
   * imitate; the body is marked `data.test = true`.
   */
  async sendTest(developer: string, input: { readonly endpointId?: string; readonly type?: string } = {}): Promise<{ readonly sent: number; readonly deliveries: readonly WebhookDelivery[] }> {
    const dev = developer.toLowerCase();
    const canonical = input.type ? canonicalEvent(input.type) : "test.ping";
    if (!canonical) throw new LykiaHttpError("INVALID_REQUEST", 400, `Unknown event type ${input.type}.`);
    const endpoints = input.endpointId ? [await this.own(dev, input.endpointId)] : (await this.allEndpoints()).map((d) => d.value).filter((e) => e.developer === dev && !e.disabled);
    const now = this.ctx.clock.now();
    const eventId = `evt_${randomHex(10)}`;
    const out: WebhookDelivery[] = [];
    for (const endpoint of endpoints) {
      const payload: WebhookPayload = { id: eventId, type: canonical, event: canonical, createdAt: new Date(now).toISOString(), owner: dev, project: null, livemode: false, apiVersion: LATEST_API_VERSION, data: { test: true, message: "A test event from Lykia.", sample: sampleData(canonical) } };
      const id = await this.queueDelivery(endpoint, payload, null);
      out.push(publicDelivery((await this.attempt(id)) as StoredDelivery));
    }
    return { sent: out.length, deliveries: out };
  }

  /** One delivery attempt; schedules the next one on failure. */
  async attempt(id: string): Promise<StoredDelivery | null> {
    const doc = await this.deliveries().get(id);
    if (!doc || doc.value.status !== "pending") return doc?.value ?? null;
    const endpoint = (await this.endpoints().get(doc.value.endpointId))?.value;
    const now = this.ctx.clock.now();
    let status: number | null = null;
    let error: string | null = null;
    const attempts = doc.value.attempts + 1;
    if (endpoint && !endpoint.disabled) {
      const body = JSON.stringify(doc.value.payload);
      try {
        await assertPublicUrl(endpoint.url, "url", this.deps.resolve);
        const response = await this.ctx.publicFetch(endpoint.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Lykia-Webhooks/1",
            [WEBHOOK_SIGNATURE_HEADER]: signWebhook(open(this.ctx, endpoint.secretBox), body, Math.floor(now / 1000)),
            "Lykia-Event": doc.value.event,
            "Lykia-Event-Id": doc.value.payload.id,
            "Lykia-Delivery-Id": doc.value.id,
            "Lykia-Webhook-Attempt": String(attempts),
          },
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        } as RequestInit);
        status = response.status;
        if (status < 200 || status >= 300) error = `HTTP ${status}`;
      } catch (e) {
        status = null;
        error = e instanceof LykiaHttpError ? e.code : e instanceof Error && e.name === "TimeoutError" ? "TIMEOUT" : "UNREACHABLE";
      }
    } else {
      error = "ENDPOINT_DISABLED";
    }
    const ok = status !== null && status >= 200 && status < 300;
    const delay = RETRY_DELAYS_MS[attempts - 1];
    const finished = this.ctx.clock.now();
    const entry: WebhookAttempt = { at: new Date(now).toISOString(), statusCode: status, durationMs: Math.max(0, finished - now), error };
    const next: StoredDelivery = {
      ...doc.value,
      attempts,
      lastStatusCode: status,
      status: ok ? "delivered" : !endpoint || endpoint.disabled || delay === undefined ? "failed" : "pending",
      nextAttemptAt: ok || delay === undefined || !endpoint || endpoint.disabled ? null : new Date(now + delay).toISOString(),
      attemptLog: [...(doc.value.attemptLog ?? []), entry].slice(-MAX_ATTEMPT_LOG),
    };
    await this.deliveries().put(id, next, { ttlMs: DELIVERY_TTL_MS });
    if (next.status === "pending" && next.nextAttemptAt) await this.queue().put(`${padded(Date.parse(next.nextAttemptAt))}:${id}`, { id }, { ttlMs: DELIVERY_TTL_MS });
    return next;
  }

  /**
   * Retries pending deliveries that are due, oldest first, at most `max` per
   * call. Each queue entry is claimed by deleting it, so two instances never
   * send the same retry twice.
   */
  async retryDue(max = 50): Promise<number> {
    const now = this.ctx.clock.now();
    const entries = await this.queue().list({ limit: Math.min(max, 1000) });
    let count = 0;
    for (const entry of entries) {
      const due = Number(entry.id.slice(0, 13));
      if (due > now) break;
      if (!(await this.queue().delete(entry.id))) continue;
      count++;
      await this.attempt(entry.value.id);
    }
    return count;
  }
}

/** Example data for test events, by type. */
function sampleData(type: string): JsonValue {
  switch (type) {
    case "intent.planned":
      return { intentId: "out_test0000", decision: "allow", steps: 2, environment: "testnet" };
    case "intent.settled":
      return { intentId: "out_test0000", fold: ["1 USDC"], verdictDigest: `0x${"0".repeat(64)}` };
    case "step.prepared":
    case "step.settled":
    case "step.failed":
      return { intentId: "out_test0000", stepId: "s1", kind: "transfer", references: [] };
    case "agent.whistle":
      return { by: "owner", reason: "test", environment: "testnet" };
    case "order.filled":
      return { orderHash: `0x${"0".repeat(64)}`, filled: "100" };
    case "alert.fired":
      return { ruleId: "alr_test", message: "USDC/EURC crossed 0.90" };
    case "payout.created":
    case "payout.sent":
    case "payout.failed":
      return { payoutId: "po_test0000", amount: "250", token: "USDC" };
    case "invoice.created":
    case "invoice.paid":
      return { invoiceId: "inv_test0000", amount: "1200", token: "USDC" };
    case "security.blocked":
      return { reason: "Fence denied the move", rule: "caps.perStepUsd" };
    default:
      return {};
  }
}
