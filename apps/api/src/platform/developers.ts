/** Developer profiles, integrator fee settings and usage. */
import { MAX_INTEGRATOR_FEE_BPS, type DeveloperSettings, type UsageView } from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "./typed.js";
import { dayKey } from "./gate.js";
import { listKeys } from "./keys.js";

interface Profile {
  readonly address: string;
  readonly name: string;
  readonly website: string | null;
  readonly createdAt: string;
  readonly settings: DeveloperSettings;
}

const profiles = (ctx: AppContext) => typedCollection<Profile>(ctx, "developers");

export async function registerDeveloper(ctx: AppContext, address: string, input: { readonly name: string; readonly website?: string | null }): Promise<Profile> {
  const id = address.toLowerCase();
  const existing = await profiles(ctx).get(id);
  const profile: Profile = {
    address: id,
    name: input.name,
    website: input.website ?? null,
    createdAt: existing?.value.createdAt ?? new Date(ctx.clock.now()).toISOString(),
    settings: existing?.value.settings ?? { integratorFeeBps: 0, feeRecipient: null },
  };
  await profiles(ctx).put(id, profile);
  return profile;
}

export async function developerProfile(ctx: AppContext, address: string): Promise<Profile | null> {
  return (await profiles(ctx).get(address.toLowerCase()))?.value ?? null;
}

export async function updateSettings(ctx: AppContext, address: string, settings: DeveloperSettings): Promise<DeveloperSettings> {
  if (!Number.isInteger(settings.integratorFeeBps) || settings.integratorFeeBps < 0 || settings.integratorFeeBps > MAX_INTEGRATOR_FEE_BPS) {
    throw new LykiaHttpError("INVALID_REQUEST", 400, `integratorFeeBps must be 0 to ${MAX_INTEGRATOR_FEE_BPS}.`);
  }
  if (settings.integratorFeeBps > 0 && !settings.feeRecipient) throw new LykiaHttpError("INVALID_REQUEST", 400, "A fee needs a feeRecipient address.");
  const profile = await developerProfile(ctx, address);
  if (!profile) throw new LykiaHttpError("NOT_FOUND", 404, "Register as a developer first.");
  await profiles(ctx).put(profile.address, { ...profile, settings });
  return settings;
}

export async function usageOf(ctx: AppContext, address: string): Promise<UsageView> {
  const now = ctx.clock.now();
  const owner = address.toLowerCase();
  const usage = ctx.store.counters("usage_day");
  const perKey = ctx.store.counters("key_day");
  const days: { day: string; requests: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = dayKey(now - i * 86_400_000);
    days.push({ day, requests: await usage.get(`${owner}:${day}`) });
  }
  const today = dayKey(now);
  const keys = await listKeys(ctx, owner);
  const byKey = await Promise.all(keys.map(async (k) => ({ keyId: k.id, today: await perKey.get(`${k.id}:${today}`) })));
  return { today: days[days.length - 1]?.requests ?? 0, last7Days: days, byKey };
}
