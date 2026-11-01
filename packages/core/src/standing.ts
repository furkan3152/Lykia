/**
 * Standing orders: conditional and scheduled intents ("if EURC/USD goes
 * above 1.12 convert 1000 EURC", "every friday pay 200 USDC for rent",
 * "if my health factor drops below 1.5 repay 500 USDC"). The server keeps
 * them and checks them; when one fires it PLANS a new intent for the owner
 * or the agent to sign. A standing order never signs anything.
 *
 * Pure: types, validation and trigger evaluation, no I/O.
 */
import { validateActions, type PlanAction } from "./actions.js";
import type { Address } from "./contracts.js";
import { isSupportedTimeZone, RATIO_PATTERN, timeMinutes, WEEKDAYS, type Weekday } from "./fence.js";
import type { ArcEnvironment } from "./networks.js";

export const STANDING_SCHEMA = "lykia.standing/v1" as const;

/** Chainlink feeds on Arc mainnet a price trigger can watch. */
export const PRICE_FEEDS = ["EURC/USD", "BTC/USD", "ETH/USD", "EUR/USD", "USDC/USD", "JPY/USD", "BRL/USD", "MXN/USD", "PAXG/USD"] as const;
export type PriceFeed = (typeof PRICE_FEEDS)[number];

export type StandingTrigger =
  | { readonly kind: "price"; readonly feed: PriceFeed; readonly op: "above" | "below"; readonly value: string }
  | { readonly kind: "schedule"; readonly every: "day" | "week" | "month"; readonly weekday?: Weekday; readonly day?: number; readonly at: string; readonly timezone: string }
  | { readonly kind: "health"; readonly below: string; readonly venue?: string };

export type StandingStatus = "active" | "paused" | "done" | "cancelled";

export interface StandingOrderDraft {
  readonly trigger: StandingTrigger;
  readonly actions: readonly PlanAction[];
  /** The sentence it came from, for the owner's list. */
  readonly text: string;
  /** How many times it may fire; null = until cancelled. Defaults: price and health 1, schedule unlimited. */
  readonly maxFires?: number | null;
  readonly expiresAt?: string;
}

export interface StandingOrder extends StandingOrderDraft {
  readonly schema: typeof STANDING_SCHEMA;
  readonly id: string;
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly signer: "wallet" | "agent";
  readonly agent?: { readonly address: Address; readonly agentId?: string };
  readonly status: StandingStatus;
  readonly createdAt: string;
  readonly fired: number;
  readonly lastCheckedAt?: string;
  readonly lastFiredAt?: string;
  /** The plan created when it last fired: the owner (or agent) signs it from the deck. */
  readonly lastIntentId?: string;
  readonly lastObservation?: string;
  /** Next scheduled run (schedule triggers), ISO 8601. */
  readonly nextRunAt?: string;
}

export interface StandingIssue {
  readonly path: string;
  readonly message: string;
}

export function defaultMaxFires(trigger: StandingTrigger): number | null {
  return trigger.kind === "schedule" ? null : 1;
}

export function validateStandingDraft(input: unknown): StandingIssue[] {
  const issues: StandingIssue[] = [];
  if (typeof input !== "object" || input === null) return [{ path: "", message: "A standing order is an object." }];
  const d = input as Record<string, unknown>;
  const t = d.trigger as Record<string, unknown> | undefined;
  if (typeof t !== "object" || t === null) issues.push({ path: "trigger", message: "trigger is required." });
  else if (t.kind === "price") {
    if (!PRICE_FEEDS.includes(t.feed as PriceFeed)) issues.push({ path: "trigger.feed", message: `feed must be one of ${PRICE_FEEDS.join(", ")}.` });
    if (t.op !== "above" && t.op !== "below") issues.push({ path: "trigger.op", message: "op must be above or below." });
    if (typeof t.value !== "string" || !/^\d{1,12}(?:\.\d{1,8})?$/u.test(t.value)) issues.push({ path: "trigger.value", message: 'value must be a price string, e.g. "1.12".' });
  } else if (t.kind === "schedule") {
    if (t.every !== "day" && t.every !== "week" && t.every !== "month") issues.push({ path: "trigger.every", message: "every must be day, week or month." });
    if (t.every === "week" && !WEEKDAYS.includes(t.weekday as Weekday)) issues.push({ path: "trigger.weekday", message: "weekly orders need a weekday (mon..sun)." });
    if (t.every === "month" && !(Number.isInteger(t.day) && (t.day as number) >= 1 && (t.day as number) <= 28)) issues.push({ path: "trigger.day", message: "monthly orders need a day from 1 to 28." });
    const at = typeof t.at === "string" ? timeMinutes(t.at) : null;
    if (at === null || at >= 1440) issues.push({ path: "trigger.at", message: 'at must be "HH:MM".' });
    if (!isSupportedTimeZone(t.timezone)) issues.push({ path: "trigger.timezone", message: "timezone must be an IANA zone, e.g. Europe/Istanbul." });
  } else if (t.kind === "health") {
    if (typeof t.below !== "string" || !RATIO_PATTERN.test(t.below) || Number(t.below) < 1) issues.push({ path: "trigger.below", message: 'below must be a health factor of at least "1.0".' });
  } else issues.push({ path: "trigger.kind", message: "kind must be price, schedule or health." });
  for (const issue of validateActions(d.actions)) issues.push({ path: `actions${issue.index >= 0 ? `.${issue.index}` : ""}`, message: issue.message });
  if (d.maxFires !== undefined && d.maxFires !== null && !(Number.isInteger(d.maxFires) && (d.maxFires as number) >= 1 && (d.maxFires as number) <= 1000)) issues.push({ path: "maxFires", message: "maxFires must be 1 to 1000, or null." });
  if (typeof d.text !== "string" || d.text.length === 0 || d.text.length > 500) issues.push({ path: "text", message: "text is required (up to 500 characters)." });
  return issues;
}

/* ------------------------------------------------------------ evaluation */

function zonedParts(ms: number, timezone: string): { y: number; m: number; d: number; weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday: get("weekday").slice(0, 3).toLowerCase(), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * The first scheduled run strictly after `after` (UTC ms). Walks minute
 * boundaries of local days, so daylight-saving shifts are respected.
 */
export function nextScheduleRun(trigger: Extract<StandingTrigger, { kind: "schedule" }>, after: number): number {
  const at = timeMinutes(trigger.at) ?? 0;
  // Candidate days: up to 62 days ahead covers every monthly schedule.
  const start = Math.floor(after / 60_000) * 60_000;
  for (let dayOffset = 0; dayOffset <= 62; dayOffset++) {
    const probe = start + dayOffset * 86_400_000;
    const p = zonedParts(probe, trigger.timezone);
    const matchesDay = trigger.every === "day" || (trigger.every === "week" && p.weekday === trigger.weekday) || (trigger.every === "month" && p.d === trigger.day);
    if (!matchesDay) continue;
    // Shift the probe to the local `at` minute of that day.
    const candidate = probe + (at - p.minutes) * 60_000;
    const check = zonedParts(candidate, trigger.timezone);
    const exact = candidate + (at - check.minutes) * 60_000;
    if (exact > after) return exact;
  }
  return after + 7 * 86_400_000;
}

export interface TriggerFacts {
  readonly now: number;
  /** Latest Chainlink prices by feed; null = stale or unreadable. */
  readonly prices: Readonly<Partial<Record<PriceFeed, string | null>>>;
  /** Health factors by venue ("aave-v4", "morpho-blue"); null = unreadable. */
  readonly health?: Readonly<Record<string, string | null>>;
}

export interface TriggerCheck {
  readonly due: boolean;
  /** What was observed, in one line ("EURC/USD 1.1234 > 1.12"). */
  readonly observation: string;
}

function compareDecimals(a: string, b: string): number {
  const scale = 8;
  const units = (v: string) => {
    const [w = "0", f = ""] = v.split(".");
    return BigInt(w) * 10n ** BigInt(scale) + BigInt(f.padEnd(scale, "0").slice(0, scale) || "0");
  };
  const x = units(a);
  const y = units(b);
  return x === y ? 0 : x > y ? 1 : -1;
}

/** Is the order due now? Unknown facts never fire an order (fail closed). */
export function checkTrigger(order: Pick<StandingOrder, "trigger" | "status" | "fired" | "maxFires" | "expiresAt" | "nextRunAt" | "createdAt">, facts: TriggerFacts): TriggerCheck {
  if (order.status !== "active") return { due: false, observation: `Order is ${order.status}.` };
  if (order.expiresAt && Date.parse(order.expiresAt) <= facts.now) return { due: false, observation: "Order has expired." };
  const max = order.maxFires === undefined ? defaultMaxFires(order.trigger) : order.maxFires;
  if (max !== null && order.fired >= max) return { due: false, observation: "Order has fired its last time." };
  const t = order.trigger;
  switch (t.kind) {
    case "price": {
      const price = facts.prices[t.feed];
      if (price === null || price === undefined) return { due: false, observation: `${t.feed} is unreadable or stale; waiting.` };
      const cmp = compareDecimals(price, t.value);
      const due = t.op === "above" ? cmp > 0 : cmp < 0;
      return { due, observation: `${t.feed} ${price} ${due ? (t.op === "above" ? ">" : "<") : t.op === "above" ? "≤" : "≥"} ${t.value}` };
    }
    case "schedule": {
      const next = order.nextRunAt ? Date.parse(order.nextRunAt) : nextScheduleRun(t, Date.parse(order.createdAt));
      return { due: facts.now >= next, observation: facts.now >= next ? `Scheduled run at ${new Date(next).toISOString()} reached.` : `Next run ${new Date(next).toISOString()}.` };
    }
    case "health": {
      const entries = Object.entries(facts.health ?? {}).filter(([venue]) => !t.venue || venue === t.venue);
      if (entries.length === 0) return { due: false, observation: "No lending position to watch." };
      const low = entries.find(([, hf]) => hf !== null && compareDecimals(hf, t.below) < 0);
      if (low) return { due: true, observation: `${low[0]} health factor ${low[1]} < ${t.below}` };
      if (entries.some(([, hf]) => hf === null)) return { due: false, observation: "A health factor is unreadable; waiting." };
      return { due: false, observation: `Health factors ${entries.map(([v, hf]) => `${v} ${hf}`).join(", ")} ≥ ${t.below}` };
    }
  }
}

export function describeTrigger(t: StandingTrigger): string {
  switch (t.kind) {
    case "price":
      return `when ${t.feed} goes ${t.op} ${t.value}`;
    case "schedule":
      return t.every === "day" ? `every day at ${t.at} (${t.timezone})` : t.every === "week" ? `every ${t.weekday} at ${t.at} (${t.timezone})` : `on day ${t.day} of every month at ${t.at} (${t.timezone})`;
    case "health":
      return `when ${t.venue ?? "any"} health factor drops below ${t.below}`;
  }
}
