/**
 * API plans and billing (separate from Lykia's on-chain transaction fee,
 * which is untouched and lives in @lykia/core/fee).
 *
 *   free        100k live requests a month, then 429 QUOTA_EXCEEDED
 *   payg        the same free quota, then each live request costs a few
 *               USDC micro-units: taken from prepaid credits, or paid per call
 *               over x402 (X-PAYMENT), else 402 PAYMENT_REQUIRED
 *   enterprise  custom limits, set by a Lykia admin
 *
 * Test-key (sandbox) requests are never billed; they only count against the
 * key's own per-minute and per-day limits. Counters are atomic store
 * counters, so the hot path needs no compare-and-set. Credits are bought
 * with an x402 payment in USDC on Arc (POST /v1/billing/credits).
 */
import type { Request } from "express";
import { BILLING_PLANS, type BillingPlan, type BillingPlanId, type BillingUsageView } from "@lykia/core/api/platform";
import type { Address } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { acceptPayment, requirementsFor, X402_VERSION } from "../x402/x402.js";
import { typedCollection } from "./typed.js";
import { randomHex } from "./crypto.js";
import { usageByDay } from "./metering.js";

export const MAX_CREDIT_PURCHASE_UNITS = 10_000_000_000; // 10,000 USDC
export const MIN_CREDIT_PURCHASE_UNITS = 1_000_000; // 1 USDC

interface Account {
  readonly owner: string;
  readonly plan: BillingPlanId;
  readonly updatedAt: string;
}

interface LedgerEntry {
  readonly at: string;
  readonly kind: "credit" | "overage-x402";
  readonly units: number;
  readonly payer: string | null;
  readonly transaction: string | null;
}

const accounts = (ctx: AppContext) => typedCollection<Account>(ctx, "billing_accounts");
const ledger = (ctx: AppContext) => typedCollection<LedgerEntry>(ctx, "billing_ledger");

export function monthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function planById(id: BillingPlanId): BillingPlan {
  return BILLING_PLANS.find((p) => p.id === id) ?? (BILLING_PLANS[0] as BillingPlan);
}

export async function planOf(ctx: AppContext, owner: string): Promise<BillingPlan> {
  const doc = await accounts(ctx).get(owner.toLowerCase());
  return planById(doc?.value.plan ?? "free");
}

export async function setPlan(ctx: AppContext, owner: string, plan: BillingPlanId, byAdmin = false): Promise<BillingPlan> {
  if (plan === "enterprise" && !byAdmin) throw new LykiaHttpError("FORBIDDEN", 403, "Enterprise plans are set up by the Lykia team.");
  await accounts(ctx).put(owner.toLowerCase(), { owner: owner.toLowerCase(), plan, updatedAt: new Date(ctx.clock.now()).toISOString() });
  return planById(plan);
}

const INVERT = 9_999_999_999_999;
const inverted = (now: number) => String(INVERT - now).padStart(13, "0");

export async function creditsOf(ctx: AppContext, owner: string): Promise<number> {
  const c = ctx.store.counters("billing_credits");
  const who = owner.toLowerCase();
  return Math.max(0, (await c.get(`bought:${who}`)) - (await c.get(`spent:${who}`)));
}

async function record(ctx: AppContext, owner: string, entry: LedgerEntry): Promise<void> {
  await ledger(ctx).put(`${owner}:${inverted(ctx.clock.now())}:${randomHex(4)}`, entry, { ttlMs: 400 * 86_400_000 });
}

export interface ChargeOutcome {
  /** Requests used this month (live keys). */
  readonly used: number;
  readonly included: number;
  readonly paidWith: "included" | "credits" | "x402" | "unbilled";
}

function paymentRequired(ctx: AppContext, req: Request, units: string, message: string): LykiaHttpError {
  const payTo = ctx.config.x402.payTo as Address;
  const requirements = requirementsFor(ctx.config.mode, payTo, units, `${req.baseUrl}${req.path}`, "Lykia API usage above the monthly free quota");
  const body = { x402Version: X402_VERSION, error: message, accepts: [requirements] };
  return new LykiaHttpError("PAYMENT_REQUIRED", 402, message, { ...body, topUp: "/v1/billing/credits" }, { headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(body)).toString("base64") } });
}

/**
 * Counts one live request against the owner's plan. Throws 429 on a free plan
 * past its quota, 402 on pay-as-you-go without credits or an x402 payment.
 */
export async function chargeRequest(ctx: AppContext, req: Request, owner: string, plan: BillingPlan): Promise<ChargeOutcome> {
  const who = owner.toLowerCase();
  const month = monthKey(ctx.clock.now());
  const used = await ctx.store.counters("bill_month").increment(`${who}:${month}`, 1, { ttlMs: 70 * 86_400_000 });
  if (used <= plan.includedRequests) return { used, included: plan.includedRequests, paidWith: "included" };
  if (plan.overageUnitsPerRequest === null) {
    throw new LykiaHttpError("QUOTA_EXCEEDED", 429, `The ${plan.name} plan includes ${plan.includedRequests.toLocaleString("en-US")} requests a month. Switch to pay as you go (PUT /v1/billing/plan) to keep going.`, { plan: plan.id, used, included: plan.includedRequests });
  }
  const price = Number(plan.overageUnitsPerRequest);
  const overage = ctx.store.counters("bill_overage");
  const credits = ctx.store.counters("billing_credits");
  const spent = await credits.increment(`spent:${who}`, price);
  if (spent <= (await credits.get(`bought:${who}`))) {
    await overage.increment(`${who}:${month}`, price, { ttlMs: 400 * 86_400_000 });
    return { used, included: plan.includedRequests, paidWith: "credits" };
  }
  await credits.increment(`spent:${who}`, -price);
  if (!ctx.config.x402.payTo) {
    // No pay-to wallet on this server: usage is recorded as owed, not collected.
    await overage.increment(`${who}:${month}`, price, { ttlMs: 400 * 86_400_000 });
    return { used, included: plan.includedRequests, paidWith: "unbilled" };
  }
  const header = req.get("x-payment") ?? req.get("payment-signature");
  if (!header) throw paymentRequired(ctx, req, String(price), "Monthly free quota used: buy credits or pay this call over x402 (X-PAYMENT).");
  const requirements = requirementsFor(ctx.config.mode, ctx.config.x402.payTo, String(price), `${req.baseUrl}${req.path}`, "Lykia API usage above the monthly free quota");
  const accepted = await acceptPayment(ctx, header, requirements, ctx.config.mode);
  if (!accepted.ok) throw paymentRequired(ctx, req, String(price), accepted.reason);
  await overage.increment(`${who}:${month}`, price, { ttlMs: 400 * 86_400_000 });
  await record(ctx, who, { at: new Date(ctx.clock.now()).toISOString(), kind: "overage-x402", units: price, payer: accepted.payer, transaction: accepted.settlement.transaction ?? null });
  return { used, included: plan.includedRequests, paidWith: "x402" };
}

/** Buys prepaid credits with an x402 payment of exactly `units` USDC units (402 with the requirements until paid). */
export async function buyCredits(ctx: AppContext, req: Request, owner: string, units: number): Promise<{ readonly creditsUnits: string; readonly bought: string; readonly payer: string; readonly settlement: string }> {
  if (!Number.isSafeInteger(units) || units < MIN_CREDIT_PURCHASE_UNITS || units > MAX_CREDIT_PURCHASE_UNITS) throw new LykiaHttpError("INVALID_REQUEST", 400, "Buy between 1 and 10,000 USDC of credits.");
  if (!ctx.config.x402.payTo) throw new LykiaHttpError("BILLING_UNAVAILABLE", 503, "Credits need LYKIA_X402_PAY_TO on this server.");
  const header = req.get("x-payment") ?? req.get("payment-signature");
  if (!header) throw paymentRequired(ctx, req, String(units), `Pay ${units / 1_000_000} USDC on Arc to add credits.`);
  const requirements = requirementsFor(ctx.config.mode, ctx.config.x402.payTo, String(units), `${req.baseUrl}${req.path}`, "Lykia API credits");
  const accepted = await acceptPayment(ctx, header, requirements, ctx.config.mode);
  if (!accepted.ok) throw paymentRequired(ctx, req, String(units), accepted.reason);
  const who = owner.toLowerCase();
  await ctx.store.counters("billing_credits").increment(`bought:${who}`, units);
  await record(ctx, who, { at: new Date(ctx.clock.now()).toISOString(), kind: "credit", units, payer: accepted.payer, transaction: accepted.settlement.transaction ?? null });
  return { creditsUnits: String(await creditsOf(ctx, who)), bought: String(units), payer: accepted.payer, settlement: accepted.settlement.mode };
}

export async function ledgerOf(ctx: AppContext, owner: string, limit = 50): Promise<LedgerEntry[]> {
  return (await ledger(ctx).list({ prefix: `${owner.toLowerCase()}:`, limit })).map((d) => d.value);
}

export async function billingUsage(ctx: AppContext, owner: string, days = 30): Promise<BillingUsageView> {
  const who = owner.toLowerCase();
  const now = ctx.clock.now();
  const plan = await planOf(ctx, who);
  const month = monthKey(now);
  const requests = await ctx.store.counters("bill_month").get(`${who}:${month}`);
  const overageUnits = await ctx.store.counters("bill_overage").get(`${who}:${month}`);
  const byDay = await usageByDay(ctx, who, Math.min(Math.max(days, 1), 90));
  return {
    plan: plan.id,
    month,
    requests,
    includedRequests: plan.includedRequests,
    overageRequests: Math.max(0, requests - plan.includedRequests),
    overageUnits: String(overageUnits),
    creditsUnits: String(await creditsOf(ctx, who)),
    days: byDay.days,
    endpoints: byDay.endpoints,
  };
}

