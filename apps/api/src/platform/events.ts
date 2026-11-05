/**
 * The event bus for developers: one call for any module that wants to tell
 * integrators something happened.
 *
 *   import { emitEvent } from "../platform/events.js";
 *   await emitEvent("payout.sent", { payoutId, amount }, { owner, ctx });
 *   await emitEvent("invoice.paid", { invoiceId }, { project: "prj_…", ctx });
 *
 * The event is stored in the owner's feed (GET /v1/events), then signed and
 * delivered to every subscribed webhook endpoint, with retries. It never
 * throws: a failure is logged and reported as `{ delivered: 0 }`. `ctx` may be
 * left out in code that runs inside the API process: the context of the
 * last app built is used. New event types are added with
 * `registerEventTypes` (re-exported here).
 */
import type { AppContext } from "../context.js";
import type { JsonValue } from "../store/types.js";
import { agentServices } from "../agents/index.js";
import { getProject } from "./projects.js";
import { canonicalEvent, registerEventTypes, eventCatalogue, subscribableEvents, type EmitTarget } from "./webhooks.js";

export { registerEventTypes, eventCatalogue, subscribableEvents };

let defaultContext: AppContext | null = null;

/** Called when an app is built (developers module); `emitEvent` falls back to it. */
export function setDefaultEventContext(ctx: AppContext): void {
  defaultContext = ctx;
}

export interface EventTarget extends EmitTarget {
  readonly ctx?: AppContext;
}

export interface EmitResult {
  readonly eventId: string | null;
  readonly delivered: number;
}

/** Emits a catalogue event for an owner address and/or a project. Never throws. */
export async function emitEvent(type: string, payload: JsonValue, target: EventTarget): Promise<EmitResult> {
  const ctx = target.ctx ?? defaultContext;
  if (!ctx) return { eventId: null, delivered: 0 };
  try {
    if (!canonicalEvent(type)) throw new Error(`unknown event type ${type}`);
    if (!target.owner && !target.project) throw new Error("emitEvent needs an owner or a project");
    const project = target.project ? await getProject(ctx, target.project) : null;
    return await agentServices(ctx).webhooks.emitEvent(type, payload, {
      ...(target.owner ? { owner: target.owner } : {}),
      ...(target.project ? { project: target.project } : {}),
      ...(target.livemode !== undefined ? { livemode: target.livemode } : {}),
      projectOwner: project?.owner ?? null,
      projectWebhookId: project?.webhookId ?? null,
    });
  } catch (error) {
    ctx.log.warn("event emit failed", { type, error: error instanceof Error ? error.message : String(error) });
    return { eventId: null, delivered: 0 };
  }
}

const LAST_DRAIN = new WeakMap<AppContext, number>();
const DRAIN_INTERVAL_MS = 15_000;

/**
 * Starts a bounded webhook retry pass in the background if none ran in the
 * last 15 s on this instance. Called on traffic, so retries keep moving on
 * serverless hosts where no timer survives between requests.
 */
export function drainWebhooksSoon(ctx: AppContext): void {
  const now = ctx.clock.now();
  const last = LAST_DRAIN.get(ctx) ?? 0;
  if (now - last < DRAIN_INTERVAL_MS) return;
  LAST_DRAIN.set(ctx, now);
  void agentServices(ctx)
    .webhooks.retryDue(25)
    .catch((error: unknown) => ctx.log.warn("webhook drain failed", { error: error instanceof Error ? error.message : String(error) }));
}

/** One full retry pass (the cron and the timer use this). */
export async function drainWebhooks(ctx: AppContext, max = 200): Promise<number> {
  LAST_DRAIN.set(ctx, ctx.clock.now());
  return agentServices(ctx).webhooks.retryDue(max);
}
