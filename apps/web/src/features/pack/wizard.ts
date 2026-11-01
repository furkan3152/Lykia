/**
 * The spawn-a-pup wizard (pure): validates what the owner typed against the
 * parent's free budget before the API is asked, builds the child Fence from
 * the role template, and groups API violations by form field.
 */
import { ROLE_TEMPLATES, type Fence, type PackRole, type SubFenceViolation } from "@lykia/core";

export interface WizardInput {
  readonly name: string;
  readonly role: PackRole;
  readonly perIntentUsd: string;
  readonly dailyUsd: string;
  readonly weeklyUsd: string;
  readonly mission: string;
}

export interface WizardIssue {
  readonly field: keyof WizardInput | "fence";
  readonly message: string;
}

const USD = /^\d{1,12}(?:\.\d{1,2})?$/u;

export function validateWizard(input: WizardInput, parentFree?: { readonly dailyUsd?: string; readonly weeklyUsd?: string; readonly perIntentUsd?: string }): WizardIssue[] {
  const issues: WizardIssue[] = [];
  if (!input.name.trim()) issues.push({ field: "name", message: "Give the pup a name." });
  if (input.name.length > 48) issues.push({ field: "name", message: "At most 48 characters." });
  for (const key of ["perIntentUsd", "dailyUsd", "weeklyUsd"] as const) {
    const v = input[key].trim();
    if (v && !USD.test(v)) issues.push({ field: key, message: 'A USD amount like "250" or "99.50".' });
    const free = parentFree?.[key];
    if (v && free !== undefined && USD.test(v) && Number(v) > Number(free)) issues.push({ field: key, message: `The parent has $${free} free here.` });
  }
  if (input.mission.length > 400) issues.push({ field: "mission", message: "At most 400 characters." });
  return issues;
}

/** The child's Fence: its role template, with the caps the owner set (blank = template). */
export function wizardFence(input: WizardInput): Fence | undefined {
  if (input.role === "custom" || input.role === "orchestrator") return undefined;
  const base = ROLE_TEMPLATES[input.role].fence;
  const caps: { perStepUsd?: string; perIntentUsd?: string; dailyUsd?: string; weeklyUsd?: string } = { ...(base.caps ?? {}) };
  if (input.perIntentUsd.trim()) caps.perIntentUsd = input.perIntentUsd.trim();
  if (input.dailyUsd.trim()) caps.dailyUsd = input.dailyUsd.trim();
  if (input.weeklyUsd.trim()) caps.weeklyUsd = input.weeklyUsd.trim();
  return { ...base, caps };
}

/** API violations ("caps.dailyUsd", "venues.allow.2") grouped under the field they belong to. */
export function groupViolations(violations: readonly SubFenceViolation[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const v of violations) {
    const path = v.path.startsWith("caps.") || v.path.startsWith("budget.") ? v.path.split(".")[1]! : v.path.split(".")[0] || "fence";
    (out[path] ??= []).push(v.message);
  }
  return out;
}
