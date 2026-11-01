/**
 * Signed webhooks.
 *
 * A developer registers an https endpoint for some events. Every delivery
 * is a JSON POST with
 *
 *   Lykia-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * Receivers verify with the endpoint secret (shown once) and reject
 * timestamps older than five minutes. A failed delivery is retried with
 * backoff (30 s, 2 min, 10 min, 1 h, 6 h) and marked failed after the last
 * attempt. Secrets are kept encrypted at rest (AES-256-GCM, key derived from
 * LYKIA_SESSION_SECRET). Endpoints must resolve to public addresses.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { WEBHOOK_EVENTS, WEBHOOK_SIGNATURE_HEADER, type WebhookDelivery, type WebhookEndpointView, type WebhookEvent } from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { assertPublicUrl, type HostResolver } from "../http/netguard.js";
import type { JsonValue } from "../store/types.js";
import { typedCollection } from "./typed.js";
import { hmacHex, purposeKey, randomHex, randomToken, safeEqual } from "./crypto.js";

export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;
export const MAX_ENDPOINTS = 10;
export const SIGNATURE_TOLERANCE_S = 300;
const DELIVERY_TTL_MS = 7 * 86_400_000;

export interface WebhookPayload {
  readonly id: string;
  readonly event: WebhookEvent;
  readonly createdAt: string;
  /** The owner address the event concerns. */
  readonly owner: string;
  readonly data: JsonValue;
}

interface StoredEndpoint {
  readonly id: string;
  readonly developer: string;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  /** Owner addresses whose events this endpoint receives (the developer's own address is always included). */
  readonly owners: readonly string[];
  readonly secretBox: string;
  readonly createdAt: string;
  readonly disabled: boolean;
}

interface StoredDelivery extends WebhookDelivery {
  readonly payload: WebhookPayload;
}

/** `t=…,v1=…` for a raw body. */
export function signWebhook(secret: string, body: string, timestampS: number): string {
  return `t=${timestampS},v1=${hmacHex(secret, `${timestampS}.${body}`)}`;
}

/** Receiver-side check (also exported by @lykia/sdk). */
export function verifyWebhookSignature(secret: string, body: string, header: string, nowS: number, toleranceS = SIGNATURE_TOLERANCE_S): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(nowS - t) > toleranceS) return false;
  return safeEqual(parts.v1, hmacHex(secret, `${t}.${body}`));
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

function view(e: StoredEndpoint, secret?: string): WebhookEndpointView {
  return { id: e.id, url: e.url, events: e.events, createdAt: e.createdAt, disabled: e.disabled, ...(secret ? { secret } : {}) };
}

export interface WebhookServiceDeps {
  readonly resolve?: HostResolver;
}

export class WebhookService {
  constructor(private readonly ctx: AppContext, private readonly deps: WebhookServiceDeps = {}) {}

  private endpoints() {
    return typedCollection<StoredEndpoint>(this.ctx, "webhook_endpoints");
  }

  private deliveries() {
    return typedCollection<StoredDelivery>(this.ctx, "webhook_deliveries");
  }

  async create(developer: string, input: { readonly url: string; readonly events?: readonly WebhookEvent[]; readonly owners?: readonly string[] }): Promise<WebhookEndpointView> {
    const dev = developer.toLowerCase();
    const mine = (await this.endpoints().list({ limit: 1000 })).filter((d) => d.value.developer === dev && !d.value.disabled);
    if (mine.length >= MAX_ENDPOINTS) throw new LykiaHttpError("WEBHOOK_LIMIT", 409, `At most ${MAX_ENDPOINTS} endpoints per developer.`);
    const url = await assertPublicUrl(input.url, "url", this.deps.resolve);
    if (url.protocol !== "https:") throw new LykiaHttpError("INVALID_REQUEST", 400, "Webhook endpoints must use https.");
    const events = input.events && input.events.length > 0 ? input.events : WEBHOOK_EVENTS;
    const secret = `whsec_${randomToken(24)}`;
    const endpoint: StoredEndpoint = {
      id: `whe_${randomHex(8)}`,
      developer: dev,
      url: url.toString(),
      events,
      owners: [...new Set([dev, ...(input.owners ?? []).map((o) => o.toLowerCase())])],
      secretBox: seal(this.ctx, secret),
      createdAt: new Date(this.ctx.clock.now()).toISOString(),
      disabled: false,
    };
    await this.endpoints().put(endpoint.id, endpoint);
    return view(endpoint, secret);
  }

  async list(developer: string): Promise<WebhookEndpointView[]> {
    return (await this.endpoints().list({ limit: 1000 })).filter((d) => d.value.developer === developer.toLowerCase()).map((d) => view(d.value));
  }

  async disable(developer: string, id: string): Promise<WebhookEndpointView> {
    const doc = await this.endpoints().get(id);
    if (!doc || doc.value.developer !== developer.toLowerCase()) throw new LykiaHttpError("NOT_FOUND", 404, "No such endpoint.");
    const next = { ...doc.value, disabled: true };
    await this.endpoints().put(id, next);
    return view(next);
  }

  /** Subscribes an endpoint to one more owner's events (project webhooks follow the project's users). */
  async addOwner(developer: string, id: string, owner: string): Promise<boolean> {
    const doc = await this.endpoints().get(id);
    if (!doc || doc.value.developer !== developer.toLowerCase() || doc.value.disabled) return false;
    const who = owner.toLowerCase();
    if (doc.value.owners.includes(who) || doc.value.owners.length >= 1_000) return false;
    await this.endpoints().put(id, { ...doc.value, owners: [...doc.value.owners, who] });
    return true;
  }

  async recentDeliveries(developer: string, limit = 50): Promise<WebhookDelivery[]> {
    const mine = new Set((await this.endpoints().list({ limit: 1000 })).filter((d) => d.value.developer === developer.toLowerCase()).map((d) => d.id));
    return (await this.deliveries().list({ limit: 1000 }))
      .filter((d) => mine.has(d.value.endpointId))
      .slice(-limit)
      .map(({ value: { payload: _payload, ...rest } }) => rest);
  }

  /** Queues the event for every subscribed endpoint and attempts delivery at once. */
  async emit(event: WebhookEvent, owner: string, data: JsonValue): Promise<number> {
    const who = owner.toLowerCase();
    const targets = (await this.endpoints().list({ limit: 1000 })).filter((d) => !d.value.disabled && d.value.events.includes(event) && d.value.owners.includes(who));
    const now = this.ctx.clock.now();
    for (const target of targets) {
      const payload: WebhookPayload = { id: `evt_${randomHex(10)}`, event, createdAt: new Date(now).toISOString(), owner: who, data };
      const delivery: StoredDelivery = { id: `whd_${now.toString(36)}_${randomHex(6)}`, endpointId: target.id, event, attempts: 0, status: "pending", lastStatusCode: null, nextAttemptAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), payload };
      await this.deliveries().put(delivery.id, delivery, { ttlMs: DELIVERY_TTL_MS });
      await this.attempt(delivery.id);
    }
    return targets.length;
  }

  /** One delivery attempt; schedules the next one on failure. */
  async attempt(id: string): Promise<StoredDelivery | null> {
    const doc = await this.deliveries().get(id);
    if (!doc || doc.value.status !== "pending") return doc?.value ?? null;
    const endpoint = (await this.endpoints().get(doc.value.endpointId))?.value;
    const now = this.ctx.clock.now();
    let status: number | null = null;
    if (endpoint && !endpoint.disabled) {
      const body = JSON.stringify(doc.value.payload);
      try {
        await assertPublicUrl(endpoint.url, "url", this.deps.resolve);
        const response = await this.ctx.publicFetch(endpoint.url, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "Lykia-Webhooks/1", [WEBHOOK_SIGNATURE_HEADER]: signWebhook(open(this.ctx, endpoint.secretBox), body, Math.floor(now / 1000)), "Lykia-Event": doc.value.event },
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        } as RequestInit);
        status = response.status;
      } catch {
        status = null;
      }
    }
    const attempts = doc.value.attempts + 1;
    const ok = status !== null && status >= 200 && status < 300;
    const delay = RETRY_DELAYS_MS[attempts - 1];
    const next: StoredDelivery = {
      ...doc.value,
      attempts,
      lastStatusCode: status,
      status: ok ? "delivered" : !endpoint || endpoint.disabled || delay === undefined ? "failed" : "pending",
      nextAttemptAt: ok || delay === undefined ? null : new Date(now + delay).toISOString(),
    };
    await this.deliveries().put(id, next, { ttlMs: DELIVERY_TTL_MS });
    return next;
  }

  /** Retries every pending delivery that is due. */
  async retryDue(): Promise<number> {
    const now = this.ctx.clock.now();
    const due = (await this.deliveries().list({ limit: 1000 })).filter((d) => d.value.status === "pending" && d.value.nextAttemptAt !== null && Date.parse(d.value.nextAttemptAt) <= now);
    for (const d of due) await this.attempt(d.id);
    return due.length;
  }
}
