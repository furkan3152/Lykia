/**
 * One pass of developer flow background work: payout receipts and Circle
 * transactions, invoice reconciliation, native automations, leash expiry. On Vercel it
 * runs from /cron/standing (and POST /v1/reconcile/tick); on a long-lived
 * server the devflows module also runs it on a timer.
 */
import type { AppContext } from "../context.js";
import { tickAutomations, wireAutomationEvents } from "./automations.js";
import { tickInvoices } from "./invoices.js";
import { tickPayouts } from "./payouts.js";
import { leashService } from "../leash/service.js";

export async function flowTick(ctx: AppContext): Promise<{ payouts: number; invoices: { checked: number; payments: number }; automations: { checked: number; fired: number }; leashes: { expired: number; warned: number } }> {
  wireAutomationEvents(ctx);
  const payouts = await tickPayouts(ctx).catch(() => 0);
  const invoices = await tickInvoices(ctx).catch(() => ({ checked: 0, payments: 0 }));
  const automations = await tickAutomations(ctx).catch(() => ({ checked: 0, fired: 0 }));
  // Leashes past their expiry stop and return their carve; a day before, leash.expiring fires.
  const leashes = await leashService(ctx).tick().catch(() => ({ expired: 0, warned: 0 }));
  return { payouts, invoices, automations, leashes };
}
