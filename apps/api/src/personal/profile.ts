/** Owner profiles: stored per SIWE address, validated and versioned in the core. */
import { DEFAULT_PROFILE, FENCE_PRESET_LABEL, fenceForProfile, fromWebProfile, isWebProfile, mergeProfile, validateProfile, type Address, type LykiaProfile, LOCALE_ENGLISH_NAMES } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "../platform/typed.js";
import { mayUsePersonal } from "./guard.js";

import { tx } from "@lykia/core";
const profiles = (ctx: AppContext) => typedCollection<LykiaProfile>(ctx, "owner_profiles");

/** The owner's profile, or the default when the request has not proven control of the owner (personal/guard.ts). */
export async function getProfile(ctx: AppContext, owner: Address | null | undefined): Promise<LykiaProfile> {
  if (!owner || !(await mayUsePersonal(owner))) return DEFAULT_PROFILE;
  const doc = await profiles(ctx).get(owner.toLowerCase()).catch(() => null);
  return doc ? { ...DEFAULT_PROFILE, ...doc.value } : DEFAULT_PROFILE;
}

async function assertPersonal(owner: Address): Promise<void> {
  if (!(await mayUsePersonal(owner))) throw new LykiaHttpError("FORBIDDEN", 403, "Only the owner (or a key the owner consented to) can change this profile.");
}

export async function updateProfile(ctx: AppContext, owner: Address, body: unknown): Promise<LykiaProfile> {
  await assertPersonal(owner);
  const current = await getProfile(ctx, owner);
  // The web app sends its flat local document; translate it to the core profile first.
  const patch = isWebProfile(body) ? fromWebProfile(body as Record<string, unknown>, current) : body;
  const merged = mergeProfile(current, patch) as Record<string, unknown>;
  const candidate = { ...merged, schema: DEFAULT_PROFILE.schema, version: current.version + (current.updatedAt ? 1 : 0), updatedAt: null };
  const result = validateProfile(candidate);
  if (!result.ok) throw new LykiaHttpError("INVALID_REQUEST", 400, "The profile is invalid. See details.issues.", { issues: result.issues });
  const saved: LykiaProfile = { ...result.profile, updatedAt: new Date(ctx.clock.now()).toISOString() };
  await profiles(ctx).put(owner.toLowerCase(), saved);
  return saved;
}

export async function resetProfile(ctx: AppContext, owner: Address): Promise<void> {
  await assertPersonal(owner);
  await profiles(ctx).delete(owner.toLowerCase());
}

/** What a profile changes downstream, in plain words. */
export function profileEffects(profile: LykiaProfile): string[] {
  const fence = fenceForProfile(profile);
  const out = [
    tx("Default Fence: {value} with a {maxSlippageBps} bps slippage ceiling{value2}.", { value: FENCE_PRESET_LABEL[profile.risk], maxSlippageBps: fence.limits?.maxSlippageBps, value2: profile.risk === "low" ? tx(" and verified tokens only") : "" }),
    tx("Routing risk ceiling: {risk}.", { risk: profile.risk }),
    tx("Amounts shown in {displayCurrency}; plans still settle in tokens.", { displayCurrency: profile.displayCurrency }),
    tx("Lyko replies in {value} (it reads any language), {tone} and {verbosity}.", { value: LOCALE_ENGLISH_NAMES[profile.language], tone: profile.persona.tone, verbosity: profile.persona.verbosity }),
  ];
  if (profile.venues.favorites.length) out.push(tx("Favourite venues win ties: {value}.", { value: profile.venues.favorites.join(", ") }));
  if (profile.venues.blocked.length) out.push(tx("Never routed: {value}.", { value: profile.venues.blocked.join(", ") }));
  if (profile.confirmation.mode === "always") out.push(tx("Every plan asks you to confirm."));
  if (profile.confirmation.mode === "above") out.push(tx("Plans above ${aboveUsd} ask you to confirm.", { aboveUsd: profile.confirmation.aboveUsd }));
  if (profile.quietHours) out.push(tx("Quiet hours {from}–{to} ({timezone}): no non-urgent notifications.", { from: profile.quietHours.from, to: profile.quietHours.to, timezone: profile.quietHours.timezone }));
  if (profile.explainLikeNew) out.push(tx("Plan reasons come in plain words, with what each venue is."));
  out.push(profile.memory.enabled ? tx("Memory on: kept {retentionDays} days{value}.", { retentionDays: profile.memory.retentionDays, value: profile.memory.learnContacts ? tx(", contacts learned from confirmed sends") : "" }) : tx("Memory off: nothing new is remembered."));
  if (profile.gas.sponsorship !== "off") out.push(tx("Gas sponsorship: {sponsorship} (needs a Circle Wallets SCA with Gas Station).", { sponsorship: profile.gas.sponsorship }));
  return out;
}
