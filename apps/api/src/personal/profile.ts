/** Owner profiles: stored per SIWE address, validated and versioned in the core. */
import { DEFAULT_PROFILE, fenceForProfile, fromWebProfile, isWebProfile, mergeProfile, validateProfile, type Address, type LykiaProfile } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "../platform/typed.js";

const profiles = (ctx: AppContext) => typedCollection<LykiaProfile>(ctx, "owner_profiles");

export async function getProfile(ctx: AppContext, owner: Address | null | undefined): Promise<LykiaProfile> {
  if (!owner) return DEFAULT_PROFILE;
  const doc = await profiles(ctx).get(owner.toLowerCase()).catch(() => null);
  return doc ? { ...DEFAULT_PROFILE, ...doc.value } : DEFAULT_PROFILE;
}

export async function updateProfile(ctx: AppContext, owner: Address, body: unknown): Promise<LykiaProfile> {
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
  await profiles(ctx).delete(owner.toLowerCase());
}

/** What a profile changes downstream, in plain words. */
export function profileEffects(profile: LykiaProfile): string[] {
  const fence = fenceForProfile(profile);
  const out = [
    `Default Fence: Shepherd with a ${fence.limits?.maxSlippageBps} bps slippage ceiling${profile.risk === "low" ? " and verified tokens only" : ""}.`,
    `Routing risk ceiling: ${profile.risk}.`,
    `Amounts shown in ${profile.displayCurrency}; plans still settle in tokens.`,
    `Lyko speaks ${profile.language === "auto" ? "your language" : profile.language === "tr" ? "Turkish" : "English"}, ${profile.persona.tone} and ${profile.persona.verbosity}.`,
  ];
  if (profile.venues.favorites.length) out.push(`Favourite venues win ties: ${profile.venues.favorites.join(", ")}.`);
  if (profile.venues.blocked.length) out.push(`Never routed: ${profile.venues.blocked.join(", ")}.`);
  if (profile.confirmation.mode === "always") out.push("Every plan asks you to confirm.");
  if (profile.confirmation.mode === "above") out.push(`Plans above $${profile.confirmation.aboveUsd} ask you to confirm.`);
  if (profile.quietHours) out.push(`Quiet hours ${profile.quietHours.from}–${profile.quietHours.to} (${profile.quietHours.timezone}): no non-urgent notifications.`);
  if (profile.explainLikeNew) out.push("Plan reasons come in plain words, with what each venue is.");
  out.push(profile.memory.enabled ? `Memory on: kept ${profile.memory.retentionDays} days${profile.memory.learnContacts ? ", contacts learned from confirmed sends" : ""}.` : "Memory off: nothing new is remembered.");
  if (profile.gas.sponsorship !== "off") out.push(`Gas sponsorship: ${profile.gas.sponsorship} (needs a Circle Wallets SCA with Gas Station).`);
  return out;
}
