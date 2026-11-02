/**
 * Drafts Lyko hands to the web app when it may not save something itself:
 * an alert or an automation, encoded as base64url JSON in `?draft=` on the
 * page that creates it. The page validates the draft and prefills its form;
 * nothing is saved until the signed-in owner submits it.
 *
 * Decoding never trusts the link: unknown fields are dropped, every value is
 * checked, and anything malformed decodes to null.
 */
import { ALERT_CHANNELS, ALERT_KINDS, ALERT_LIMITS, type AlertChannel, type AlertKind } from "./alerts.js";
import { validateAutomationTrigger, type AutomationTrigger } from "./devflows.js";
import { isSupportedTimeZone, WEEKDAYS, type Weekday } from "./fence.js";

export const DRAFT_PARAM = "draft";
/** Longest encoded draft a page accepts. */
export const DRAFT_MAX_CHARS = 2048;
export const ALERTS_PAGE = "/app/alerts";
export const AUTOMATIONS_PAGE = "/app/automations";

export interface AlertDraft {
  readonly kind: AlertKind;
  readonly token?: string;
  readonly threshold?: string;
  readonly channels?: readonly AlertChannel[];
  readonly cooldownSeconds?: number;
}

export type AutomationDraftAction = { readonly type: "plan"; readonly sentence: string } | { readonly type: "notify"; readonly channel: "webhook" };

export interface AutomationDraft {
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationDraftAction;
  readonly maxFiresPerDay?: number;
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const SYMBOL = /^[A-Za-z0-9]{2,10}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

/** base64url of the UTF-8 JSON, without padding. */
export function encodeDraft(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** The JSON value inside a draft parameter, or null when it is missing, too long or malformed. */
export function decodeDraft(text: string | null | undefined): unknown {
  if (!text || text.length > DRAFT_MAX_CHARS || !BASE64URL.test(text)) return null;
  try {
    const padded = text.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** A checked alert draft (only known fields), or null. */
export function alertDraftOf(value: unknown): AlertDraft | null {
  const v = record(value);
  if (!v || !ALERT_KINDS.includes(v.kind as AlertKind)) return null;
  const kind = v.kind as AlertKind;
  if (v.token !== undefined && (typeof v.token !== "string" || !SYMBOL.test(v.token))) return null;
  if (v.threshold !== undefined && (typeof v.threshold !== "string" || v.threshold.length > 40 || !DECIMAL.test(v.threshold))) return null;
  let channels: AlertChannel[] | undefined;
  if (v.channels !== undefined) {
    if (!Array.isArray(v.channels) || v.channels.length > ALERT_CHANNELS.length || !v.channels.every((c) => ALERT_CHANNELS.includes(c as AlertChannel))) return null;
    channels = [...new Set(v.channels as AlertChannel[])];
  }
  const cooldown = v.cooldownSeconds;
  if (cooldown !== undefined && (typeof cooldown !== "number" || !Number.isInteger(cooldown) || cooldown < ALERT_LIMITS.minCooldownSeconds || cooldown > 7 * 86_400)) return null;
  return {
    kind,
    ...(typeof v.token === "string" ? { token: v.token } : {}),
    ...(typeof v.threshold === "string" ? { threshold: v.threshold } : {}),
    ...(channels && channels.length > 0 ? { channels } : {}),
    ...(typeof cooldown === "number" ? { cooldownSeconds: cooldown } : {}),
  };
}

function triggerOf(value: unknown): AutomationTrigger | null {
  const t = record(value);
  if (!t) return null;
  let trigger: AutomationTrigger;
  if (t.type === "price") trigger = { type: "price", feed: t.feed as never, op: t.op as never, value: t.value as never };
  else if (t.type === "schedule") {
    if (t.weekday !== undefined && !WEEKDAYS.includes(t.weekday as Weekday)) return null;
    if (t.day !== undefined && (typeof t.day !== "number" || !Number.isInteger(t.day) || t.day < 1 || t.day > 28)) return null;
    // Weekly runs need a weekday and monthly runs a day, as standing orders do.
    if ((t.every === "week" && t.weekday === undefined) || (t.every === "month" && t.day === undefined)) return null;
    if (typeof t.timezone !== "string" || t.timezone.length > 64 || !isSupportedTimeZone(t.timezone)) return null;
    trigger = { type: "schedule", every: t.every as never, ...(t.weekday ? { weekday: t.weekday as never } : {}), ...(t.day ? { day: t.day as number } : {}), at: t.at as never, timezone: t.timezone };
  } else if (t.type === "balance") {
    if (typeof t.token !== "string" || !SYMBOL.test(t.token)) return null;
    trigger = { type: "balance", token: t.token, op: t.op as never, value: t.value as never, ...(t.address !== undefined ? { address: t.address as never } : {}) };
  } else if (t.type === "event") trigger = { type: "event", event: t.event as never };
  else return null;
  const amount = (trigger as { value?: unknown }).value;
  if (typeof amount === "string" && amount.length > 40) return null;
  return validateAutomationTrigger(trigger).length === 0 ? trigger : null;
}

/** A checked automation draft (only known fields), or null. */
export function automationDraftOf(value: unknown): AutomationDraft | null {
  const v = record(value);
  if (!v || typeof v.name !== "string" || v.name.trim().length === 0 || v.name.length > 120) return null;
  const trigger = triggerOf(v.trigger);
  const a = record(v.action);
  if (!trigger || !a) return null;
  let action: AutomationDraftAction;
  if (a.type === "plan" && typeof a.sentence === "string" && a.sentence.trim().length >= 3 && a.sentence.length <= 400) action = { type: "plan", sentence: a.sentence };
  else if (a.type === "notify" && a.channel === "webhook") action = { type: "notify", channel: "webhook" };
  else return null;
  const fires = v.maxFiresPerDay;
  if (fires !== undefined && (typeof fires !== "number" || !Number.isInteger(fires) || fires < 1 || fires > 24)) return null;
  return { name: v.name, trigger, action, ...(typeof fires === "number" ? { maxFiresPerDay: fires } : {}) };
}

/** The Alerts page with this draft prefilled. */
export function alertDraftLink(draft: AlertDraft): string {
  return `${ALERTS_PAGE}?${DRAFT_PARAM}=${encodeDraft(draft)}`;
}

/** The Automations page with this draft prefilled. */
export function automationDraftLink(draft: AutomationDraft): string {
  return `${AUTOMATIONS_PAGE}?${DRAFT_PARAM}=${encodeDraft(draft)}`;
}
