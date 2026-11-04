/**
 * "Your Lyko": the owner's Fold preferences (`lykia.fold-preferences/v1`),
 * kept beside the profile and the memory for the signed-in owner. The risk
 * profile is written through to the profile, so the default Fence and the
 * routing ceiling follow it everywhere (chat, automations, the Fold).
 */
import { DEFAULT_FOLD_PREFERENCES, foldRiskOf, mergeFoldPreferences, riskTierOf, validateFoldPreferences, type Address, type FoldPreferences } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { getProfile, updateProfile } from "../personal/profile.js";
import { typedCollection } from "../platform/typed.js";

const store = (ctx: AppContext) => typedCollection<FoldPreferences>(ctx, "fold_preferences");

export async function getPreferences(ctx: AppContext, owner: Address | null | undefined): Promise<FoldPreferences> {
  if (!owner) return DEFAULT_FOLD_PREFERENCES;
  const [doc, profile] = await Promise.all([store(ctx).get(owner.toLowerCase()).catch(() => null), getProfile(ctx, owner)]);
  const base = doc ? { ...DEFAULT_FOLD_PREFERENCES, ...doc.value } : DEFAULT_FOLD_PREFERENCES;
  // The profile owns the risk tier; a profile edit made elsewhere shows up here.
  return { ...base, risk: doc ? base.risk : foldRiskOf(profile.risk) };
}

export async function updatePreferences(ctx: AppContext, owner: Address, patch: unknown): Promise<FoldPreferences> {
  const current = await getPreferences(ctx, owner);
  const merged = mergeFoldPreferences(current, patch) as Record<string, unknown>;
  const result = validateFoldPreferences({ ...merged, schema: DEFAULT_FOLD_PREFERENCES.schema, updatedAt: null });
  if (!result.ok) throw new LykiaHttpError("INVALID_REQUEST", 400, "The preferences are invalid. See details.issues.", { issues: result.issues });
  const saved: FoldPreferences = { ...result.preferences, updatedAt: new Date(ctx.clock.now()).toISOString() };
  await store(ctx).put(owner.toLowerCase(), saved);
  const profile = await getProfile(ctx, owner);
  if (profile.risk !== riskTierOf(saved.risk)) await updateProfile(ctx, owner, { risk: riskTierOf(saved.risk) });
  return saved;
}

export async function resetPreferences(ctx: AppContext, owner: Address): Promise<void> {
  await store(ctx).delete(owner.toLowerCase());
}
