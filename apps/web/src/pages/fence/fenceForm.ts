/**
 * The Fence editor's form model (pure): flat strings and booleans for the
 * inputs, mapped to and from a `lykia.fence/v1` document. Empty strings
 * mean "no limit" and are dropped; lists are trimmed and de-duplicated.
 */
import { CCTP_DESTINATIONS, FENCE_SCHEMA, STEP_KINDS, type ConfirmTrigger, type Fence, type FenceMode, type RecipientMode, type ScentRequirement, type StepKind, type Weekday } from "@lykia/core";

export interface FenceForm {
  readonly label: string;
  readonly mode: FenceMode;
  readonly perStepUsd: string;
  readonly perIntentUsd: string;
  readonly dailyUsd: string;
  readonly weeklyUsd: string;
  readonly maxSteps: string;
  readonly maxSlippageBps: string;
  readonly minHealthFactor: string;
  readonly fxMaxDeviationBps: string;
  readonly scent: ScentRequirement;
  readonly recipientsMode: RecipientMode;
  readonly recipientsAllow: string;
  readonly recipientsDeny: string;
  readonly venuesAllow: string;
  readonly venuesDeny: string;
  readonly tokensAllow: readonly string[];
  readonly tokensUnlisted: "deny" | "allow";
  readonly kinds: readonly StepKind[];
  readonly bridges: readonly string[];
  readonly signers: readonly ("wallet" | "agent")[];
  readonly confirmAboveUsd: string;
  readonly confirmWhen: readonly ConfirmTrigger[];
  readonly scheduleOn: boolean;
  readonly timezone: string;
  readonly days: readonly Weekday[];
  readonly from: string;
  readonly to: string;
}

const lines = (text: string): string[] => [...new Set(text.split(/[\s,]+/u).map((s) => s.trim()).filter(Boolean))];
const opt = (value: string): string | undefined => (value.trim() === "" ? undefined : value.trim());
const optInt = (value: string): number | undefined => (value.trim() === "" ? undefined : Number(value.trim()));

function compact<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T);
}

export function fromFence(fence: Fence): FenceForm {
  const window = fence.schedule?.windows[0];
  return {
    label: fence.label ?? "",
    mode: fence.mode ?? "live",
    perStepUsd: fence.caps?.perStepUsd ?? "",
    perIntentUsd: fence.caps?.perIntentUsd ?? "",
    dailyUsd: fence.caps?.dailyUsd ?? "",
    weeklyUsd: fence.caps?.weeklyUsd ?? "",
    maxSteps: fence.limits?.maxSteps?.toString() ?? "",
    maxSlippageBps: fence.limits?.maxSlippageBps?.toString() ?? "",
    minHealthFactor: fence.lending?.minHealthFactor ?? "",
    fxMaxDeviationBps: fence.fx?.maxDeviationBps?.toString() ?? "",
    scent: fence.scent?.require ?? "no-red-flags",
    recipientsMode: fence.recipients?.mode ?? "own",
    recipientsAllow: (fence.recipients?.allow ?? []).join("\n"),
    recipientsDeny: (fence.recipients?.deny ?? []).join("\n"),
    venuesAllow: (fence.venues?.allow ?? []).join(", "),
    venuesDeny: (fence.venues?.deny ?? []).join(", "),
    tokensAllow: fence.tokens?.allow ?? [],
    tokensUnlisted: fence.tokens?.unlisted ?? "deny",
    kinds: fence.kinds?.allow ?? [],
    bridges: fence.bridges?.destinations ?? [],
    signers: (fence.signers ?? ["wallet", "agent"]).filter((s): s is "wallet" | "agent" => s === "wallet" || s === "agent"),
    confirmAboveUsd: fence.confirm?.aboveUsd ?? "",
    confirmWhen: fence.confirm?.when ?? [],
    scheduleOn: Boolean(fence.schedule),
    timezone: fence.schedule?.timezone ?? "Europe/Istanbul",
    days: window?.days ?? ["mon", "tue", "wed", "thu", "fri"],
    from: window?.from ?? "09:00",
    to: window?.to ?? "18:00",
  };
}

export function toFence(form: FenceForm): Fence {
  const venuesAllow = lines(form.venuesAllow);
  const venuesDeny = lines(form.venuesDeny);
  const recipientsAllow = lines(form.recipientsAllow) as `0x${string}`[];
  const recipientsDeny = lines(form.recipientsDeny) as `0x${string}`[];
  const venues = compact({ allow: venuesAllow.length ? venuesAllow : undefined, deny: venuesDeny.length ? venuesDeny : undefined });
  const caps = compact({ perStepUsd: opt(form.perStepUsd), perIntentUsd: opt(form.perIntentUsd), dailyUsd: opt(form.dailyUsd), weeklyUsd: opt(form.weeklyUsd) });
  const limits = compact({ maxSteps: optInt(form.maxSteps), maxSlippageBps: optInt(form.maxSlippageBps) });
  const confirm = compact({ aboveUsd: opt(form.confirmAboveUsd), when: form.confirmWhen.length > 0 ? [...form.confirmWhen] : undefined });
  const fx = optInt(form.fxMaxDeviationBps);
  const label = opt(form.label);
  const health = opt(form.minHealthFactor);
  return {
    schema: FENCE_SCHEMA,
    ...(label ? { label } : {}),
    mode: form.mode,
    ...(form.kinds.length > 0 && form.kinds.length < STEP_KINDS.length ? { kinds: { allow: [...form.kinds] } } : {}),
    ...(venues ? { venues } : {}),
    tokens: { ...(form.tokensAllow.length > 0 ? { allow: [...form.tokensAllow] } : {}), unlisted: form.tokensUnlisted },
    recipients: { mode: form.recipientsMode, ...(recipientsAllow.length || form.recipientsMode === "allowlist" ? { allow: recipientsAllow } : {}), ...(recipientsDeny.length ? { deny: recipientsDeny } : {}) },
    ...(form.bridges.length > 0 && form.bridges.length < CCTP_DESTINATIONS.length ? { bridges: { destinations: [...form.bridges] } } : {}),
    ...(caps ? { caps } : {}),
    ...(limits ? { limits } : {}),
    ...(health ? { lending: { minHealthFactor: health } } : {}),
    ...(fx !== undefined ? { fx: { maxDeviationBps: fx } } : {}),
    scent: { require: form.scent },
    ...(confirm ? { confirm } : {}),
    ...(form.scheduleOn ? { schedule: { timezone: form.timezone, windows: [{ days: [...form.days], from: form.from, to: form.to }] } } : {}),
    signers: [...form.signers],
  };
}
