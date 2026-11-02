/**
 * Prefill from Lyko's drafts. When chat could not save an alert or an
 * automation (the owner had not signed in), it links here with `?draft=`:
 * these helpers decode and validate that draft into form state. Pages only
 * prefill their forms; the owner always presses the save button themselves.
 */
import {
  alertDraftOf,
  automationDraftOf,
  decodeDraft,
  DRAFT_PARAM,
  type AlertChannel,
  type AlertKind,
  type ArcEnvironment,
  type AutomationTrigger,
} from "@lykia/core";

/** Tokens the Alerts form offers per kind. */
export const ALERT_TOKENS: Partial<Record<AlertKind, readonly string[]>> = { "price-above": ["cirBTC", "EURC"], "price-below": ["cirBTC", "EURC"], "transfer-in": ["USDC", "EURC"], "transfer-out": ["USDC", "EURC"] };

export interface AlertForm {
  readonly kind: AlertKind;
  readonly token: string;
  readonly threshold: string;
  readonly channels: AlertChannel[];
  readonly cooldownSeconds: number | null;
}

function draftParam(search: string): string | null {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(DRAFT_PARAM);
}

/** The Alerts form prefilled from `?draft=`, or null when there is none or it does not check out. */
export function alertFormFromSearch(search: string): AlertForm | null {
  const draft = alertDraftOf(decodeDraft(draftParam(search)));
  if (!draft) return null;
  const tokens = ALERT_TOKENS[draft.kind];
  const token = tokens ? tokens.find((t) => t.toLowerCase() === (draft.token ?? "").toLowerCase()) : undefined;
  if (tokens && !token) return null;
  return { kind: draft.kind, token: token ?? "cirBTC", threshold: draft.threshold ?? "", channels: draft.channels ? [...draft.channels] : ["inbox"], cooldownSeconds: draft.cooldownSeconds ?? null };
}

export type TriggerType = AutomationTrigger["type"];

/** Flat form state for the Automations page; every field is a string so inputs stay controlled. */
export interface AutomationForm {
  name: string;
  triggerType: TriggerType;
  feed: string;
  op: "above" | "below";
  value: string;
  every: "day" | "week" | "month";
  weekday: string;
  day: string;
  at: string;
  timezone: string;
  token: string;
  event: string;
  actionType: "plan" | "notify";
  sentence: string;
  maxFiresPerDay: string;
}

export function emptyAutomationForm(timezone = "UTC"): AutomationForm {
  return { name: "", triggerType: "schedule", feed: "EURC/USD", op: "above", value: "", every: "week", weekday: "fri", day: "1", at: "17:00", timezone, token: "USDC", event: "invoice.paid", actionType: "plan", sentence: "", maxFiresPerDay: "1" };
}

/** The Automations form prefilled from `?draft=`, or null when there is none or it does not check out. */
export function automationFormFromSearch(search: string, timezone = "UTC"): AutomationForm | null {
  const draft = automationDraftOf(decodeDraft(draftParam(search)));
  if (!draft) return null;
  const form = emptyAutomationForm(timezone);
  form.name = draft.name;
  form.maxFiresPerDay = String(draft.maxFiresPerDay ?? 1);
  const t = draft.trigger;
  form.triggerType = t.type;
  if (t.type === "price") Object.assign(form, { feed: t.feed, op: t.op, value: t.value });
  else if (t.type === "schedule") Object.assign(form, { every: t.every, weekday: t.weekday ?? form.weekday, day: String(t.day ?? 1), at: t.at, timezone: t.timezone });
  else if (t.type === "balance") Object.assign(form, { token: t.token, op: t.op, value: t.value });
  else form.event = t.event;
  if (draft.action.type === "plan") {
    form.actionType = "plan";
    form.sentence = draft.action.sentence;
  } else form.actionType = "notify";
  return form;
}

/** The POST /v1/automations body for a form. */
export function automationRequest(form: AutomationForm, owner: string, environment: ArcEnvironment): Record<string, unknown> {
  const trigger =
    form.triggerType === "price"
      ? { type: "price", feed: form.feed, op: form.op, value: form.value.trim() }
      : form.triggerType === "schedule"
        ? { type: "schedule", every: form.every, ...(form.every === "week" ? { weekday: form.weekday } : {}), ...(form.every === "month" ? { day: Number(form.day) } : {}), at: form.at, timezone: form.timezone.trim() }
        : form.triggerType === "balance"
          ? { type: "balance", token: form.token.trim(), op: form.op, value: form.value.trim() }
          : { type: "event", event: form.event };
  const action = form.actionType === "plan" ? { type: "plan", sentence: form.sentence.trim() } : { type: "notify", channel: "webhook" };
  return { owner, environment, name: form.name.trim(), trigger, action, maxFiresPerDay: Math.min(Math.max(Number(form.maxFiresPerDay) || 1, 1), 24) };
}
