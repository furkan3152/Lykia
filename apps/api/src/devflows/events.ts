/**
 * Developer flow events: payout.created / .settled / .failed, invoice.created /
 * .paid, automation.fired. Each one is kept briefly (a short local feed), handed to event-triggered automations and forwarded to the
 * developer's webhooks.
 */
import type { AutomationEvent } from "@lykia/core";
import type { AppContext } from "../context.js";
import { randomHex } from "../platform/crypto.js";
import { emitEvent, registerEventTypes } from "../platform/events.js";
import { typedCollection } from "../platform/typed.js";
import type { JsonValue } from "../store/types.js";

export type BusinessEventType = AutomationEvent | "automation.fired";

export interface BusinessEvent {
  readonly id: string;
  readonly type: BusinessEventType;
  readonly developer: string;
  readonly projectId: string | null;
  readonly owner: string | null;
  readonly at: string;
  readonly data: JsonValue;
}

// payout.created, payout.failed, invoice.created and invoice.paid are in the platform catalogue already.
registerEventTypes([
  { type: "payout.settled", group: "payouts", description: "Every row of a payout batch settled on Arc (proved by its Memo events)." },
  { type: "automation.fired", group: "automation", description: "A unified automation fired: it planned an intent or notified." },
]);

const EVENT_TTL_MS = 30 * 86_400_000;
const events = (ctx: AppContext) => typedCollection<BusinessEvent>(ctx, "business_events");

type Listener = (event: BusinessEvent) => Promise<void>;
const LISTENERS = new WeakMap<AppContext, Listener[]>();

export function onBusinessEvent(ctx: AppContext, listener: Listener): void {
  LISTENERS.set(ctx, [...(LISTENERS.get(ctx) ?? []), listener]);
}

export async function businessEvent(ctx: AppContext, type: BusinessEventType, data: JsonValue, scope: { readonly developer: string; readonly projectId?: string | null; readonly owner?: string | null }): Promise<BusinessEvent> {
  const now = ctx.clock.now();
  const event: BusinessEvent = { id: `bev_${now.toString(36)}_${randomHex(4)}`, type, developer: scope.developer, projectId: scope.projectId ?? null, owner: scope.owner ?? null, at: new Date(now).toISOString(), data };
  await events(ctx).put(`${scope.developer}:${event.id}`, event, { ttlMs: EVENT_TTL_MS }).catch(() => undefined);
  // Webhook delivery and the developer's event feed (platform/events.ts). Never throws.
  if (scope.owner || scope.projectId) await emitEvent(type, data, { ctx, ...(scope.owner ? { owner: scope.owner } : {}), ...(scope.projectId ? { project: scope.projectId } : {}) });
  for (const listener of LISTENERS.get(ctx) ?? []) await listener(event).catch((error: unknown) => ctx.log.debug("flow event listener failed", { type, error: error instanceof Error ? error.message : String(error) }));
  return event;
}

export async function recentBusinessEvents(ctx: AppContext, developer: string, limit = 50): Promise<BusinessEvent[]> {
  return (await events(ctx).list({ prefix: `${developer}:`, limit: 500 })).map((d) => d.value).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
