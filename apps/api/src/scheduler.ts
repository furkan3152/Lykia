/**
 * Background work on serverless hosts, where no timer survives between
 * requests. Three ways in, all idempotent:
 *
 * - Vercel Cron (apps/api/vercel.json): /cron/standing, /cron/orders and
 *   /cron/alerts, once a day each (the Hobby plan allows daily crons only).
 * - Any external pinger: POST /v1/reconcile/tick with `Authorization:
 *   Bearer $CRON_SECRET` runs every pass below; ping it as often as you want
 *   a schedule to hold (every few minutes for standing orders and alerts).
 * - Traffic: an API request starts a pass in the background at most once
 *   every 5 minutes across all instances (a lease in the shared store, so
 *   Postgres sees one compare-and-set per instance per 5 minutes). It is
 *   best effort: without traffic or a pinger nothing runs between crons.
 *
 * On a long-lived server (Render, Docker) the modules' own timers run too.
 */
import type { AppContext } from "./context.js";
import { alertsService } from "./alerts/service.js";
import { flowTick } from "./devflows/tick.js";
import { ordersService } from "./orders/service.js";
import { asSystem } from "./personal/guard.js";
import { drainWebhooks } from "./platform/events.js";
import { services } from "./services.js";

export async function fullTick(ctx: AppContext) {
  const standing = await services(ctx).standing.tick().catch(() => null);
  const orders: Record<string, unknown> = {};
  const alerts: Record<string, unknown> = {};
  for (const env of ["mainnet", "testnet"] as const) {
    orders[env] = await ordersService(ctx).tick(env).catch(() => null);
    alerts[env] = await alertsService(ctx).tick(env).catch(() => null);
  }
  const webhookRetries = await drainWebhooks(ctx).catch(() => 0);
  const flows = await flowTick(ctx).catch(() => null);
  return { standing, orders, alerts, webhookRetries, flows };
}

const TRAFFIC_INTERVAL_MS = 5 * 60_000;
const LOCAL = new WeakMap<AppContext, number>();

/** Starts a full pass in the background if none started in the last 5 minutes on any instance. */
export function tickOnTraffic(ctx: AppContext): void {
  if (ctx.config.env === "test") return;
  const now = ctx.clock.now();
  if (now - (LOCAL.get(ctx) ?? 0) < TRAFFIC_INTERVAL_MS) return;
  LOCAL.set(ctx, now);
  asSystem(() => {
    const lease = ctx.store.collection<{ at: number }>("scheduler_lease");
    void lease
      .compareAndSet("traffic", null, { at: now }, { ttlMs: TRAFFIC_INTERVAL_MS })
      .then((won) => (won ? fullTick(ctx) : null))
      .catch((error: unknown) => ctx.log.warn("traffic tick failed", { error: error instanceof Error ? error.message : String(error) }));
  });
}
