/**
 * Fence <-> form (pure). Empty inputs mean "no rule" and are dropped from
 * the document, so a round trip never invents limits.
 */
import { FENCE_SCHEMA, type Fence, type FenceMode, type RecipientMode, type ScentRequirement, type Weekday } from "@lykia/core";

export interface FenceForm {
  readonly label: string;
  readonly mode: FenceMode;
  readonly perStepUsd: string;
  readonly perIntentUsd: string;
  readonly dailyUsd: string;
  readonly weeklyUsd: string;
  readonly maxSlippageBps: string;
  readonly minHealthFactor: string;
  readonly fxBandBps: string;
  readonly scent: ScentRequirement;
  readonly recipients: RecipientMode;
  readonly allowlist: string;
  readonly venues: string;
  readonly tokens: readonly string[];
  readonly unlisted: "deny" | "allow";
  readonly signers: readonly ("wallet" | "agent")[];
  readonly confirmAboveUsd: string;
  readonly scheduleOn: boolean;
  readonly timezone: string;
  readonly days: readonly Weekday[];
  readonly from: string;
  readonly to: string;
}

const lines = (s: string) => s.split(/[\s,]+/u).map((x) => x.trim()).filter(Boolean);

export function fenceToForm(f: Fence): FenceForm {
  const w = f.schedule?.windows[0];
  return {
    label: f.label ?? "",
    mode: f.mode ?? "live",
    perStepUsd: f.caps?.perStepUsd ?? "",
    perIntentUsd: f.caps?.perIntentUsd ?? "",
    dailyUsd: f.caps?.dailyUsd ?? "",
    weeklyUsd: f.caps?.weeklyUsd ?? "",
    maxSlippageBps: f.limits?.maxSlippageBps !== undefined ? String(f.limits.maxSlippageBps) : "",
    minHealthFactor: f.lending?.minHealthFactor ?? "",
    fxBandBps: f.fx?.maxDeviationBps !== undefined ? String(f.fx.maxDeviationBps) : "",
    scent: f.scent?.require ?? "no-red-flags",
    recipients: f.recipients?.mode ?? "own",
    allowlist: (f.recipients?.allow ?? []).join("\n"),
    venues: (f.venues?.allow ?? []).join(", "),
    tokens: f.tokens?.allow ?? [],
    unlisted: f.tokens?.unlisted ?? "deny",
    signers: (f.signers ?? ["wallet", "agent"]).filter((s): s is "wallet" | "agent" => s === "wallet" || s === "agent"),
    confirmAboveUsd: f.confirm?.aboveUsd ?? "",
    scheduleOn: Boolean(f.schedule),
    timezone: f.schedule?.timezone ?? "Europe/Istanbul",
    days: w?.days ?? ["mon", "tue", "wed", "thu", "fri"],
    from: w?.from ?? "09:00",
    to: w?.to ?? "18:00",
  };
}

export function formToFence(form: FenceForm, base?: Fence): Fence {
  const caps = { ...(form.perStepUsd ? { perStepUsd: form.perStepUsd } : {}), ...(form.perIntentUsd ? { perIntentUsd: form.perIntentUsd } : {}), ...(form.dailyUsd ? { dailyUsd: form.dailyUsd } : {}), ...(form.weeklyUsd ? { weeklyUsd: form.weeklyUsd } : {}) };
  const allow = lines(form.allowlist) as `0x${string}`[];
  const venues = lines(form.venues);
  const fence: Fence = {
    schema: FENCE_SCHEMA,
    ...(form.label ? { label: form.label } : {}),
    mode: form.mode,
    ...(base?.kinds ? { kinds: base.kinds } : {}),
    ...(base?.bridges ? { bridges: base.bridges } : {}),
    ...(base?.environments ? { environments: base.environments } : {}),
    ...(venues.length ? { venues: { allow: venues, ...(base?.venues?.deny ? { deny: base.venues.deny } : {}) } } : base?.venues?.deny ? { venues: { deny: base.venues.deny } } : {}),
    tokens: { ...(form.tokens.length ? { allow: [...form.tokens] } : {}), unlisted: form.unlisted },
    recipients: { mode: form.recipients, ...(allow.length || form.recipients === "allowlist" ? { allow } : {}), ...(base?.recipients?.deny ? { deny: base.recipients.deny } : {}) },
    ...(Object.keys(caps).length ? { caps } : {}),
    ...(form.maxSlippageBps ? { limits: { ...(base?.limits?.maxSteps ? { maxSteps: base.limits.maxSteps } : {}), maxSlippageBps: Number(form.maxSlippageBps) } } : base?.limits?.maxSteps ? { limits: { maxSteps: base.limits.maxSteps } } : {}),
    ...(form.minHealthFactor ? { lending: { minHealthFactor: form.minHealthFactor } } : {}),
    ...(form.fxBandBps ? { fx: { maxDeviationBps: Number(form.fxBandBps) } } : {}),
    scent: { require: form.scent },
    ...(form.confirmAboveUsd || base?.confirm?.when ? { confirm: { ...(form.confirmAboveUsd ? { aboveUsd: form.confirmAboveUsd } : {}), ...(base?.confirm?.when ? { when: base.confirm.when } : {}) } } : {}),
    ...(form.scheduleOn ? { schedule: { timezone: form.timezone, windows: [{ days: [...form.days], from: form.from, to: form.to }] } } : {}),
    signers: [...form.signers],
  };
  return fence;
}
