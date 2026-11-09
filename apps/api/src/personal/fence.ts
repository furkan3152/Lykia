/**
 * The owner's Fence, on the server. One per owner: the preset their risk
 * profile names (Careful, Balanced or Bold, the same control as Your Lyko's
 * risk profile), or that preset with the owner's own edits on top. Chat,
 * proposals, automations and the Fold read it from here; no client sends a
 * Fence of its own any more.
 *
 * Tightening applies at once. A loosening needs the owner's wallet: a
 * signed message naming every rule it loosens and the new Fence's hash.
 */
import { FENCE_PRESET_LABEL, fenceForProfile, fenceHash, loosenedRules, riskTierOf, validateFence, type Address, type Fence, type FoldRisk } from "@lykia/core";
import { verifyMessage, type Hex } from "viem";
import type { AppContext } from "../context.js";
import { getPreferences, updatePreferences } from "../fold/preferences.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "../platform/typed.js";
import { getProfile } from "./profile.js";

export const OWNER_FENCE_SCHEMA = "lykia.owner-fence/v1";

interface StoredFence {
  readonly schema: typeof OWNER_FENCE_SCHEMA;
  readonly owner: string;
  /** The owner's own edits on top of the preset; null while the preset is used as it is. */
  readonly custom: Fence | null;
  readonly updatedAt: string;
  /** Set once a Fence a browser held from before was proposed and settled (kept or discarded). */
  readonly migratedAt?: string | null;
}

export interface OwnerFenceView {
  readonly owner: Address;
  readonly fence: Fence;
  readonly hash: string;
  /** The preset the Fence is (or is built on): careful, balanced or bold. */
  readonly preset: FoldRisk;
  readonly presetLabel: string;
  /** True when the owner edited it beyond the preset. */
  readonly custom: boolean;
  readonly updatedAt: string | null;
  /** True once a browser-held Fence from before was settled; the web proposes it only until then. */
  readonly migrated: boolean;
}

const store = (ctx: AppContext) => typedCollection<StoredFence>(ctx, "owner_fences");

/** The message a loosening is signed with (the Fold's review step shows the same lines). */
export function looseningMessage(loosened: readonly string[], next: Fence): string {
  return `Lykia: loosen my Fence\n\n${loosened.join("\n")}\n\nNew Fence ${fenceHash(next)}`;
}

async function presetFence(ctx: AppContext, owner: Address, preset?: FoldRisk): Promise<Fence> {
  const profile = await getProfile(ctx, owner);
  return fenceForProfile(preset ? { ...profile, risk: riskTierOf(preset) } : profile);
}

/** The Fence the owner plans under. */
export async function ownerFence(ctx: AppContext, owner: Address): Promise<Fence> {
  const doc = (await store(ctx).get(owner.toLowerCase()).catch(() => null))?.value ?? null;
  return doc?.custom ?? (await presetFence(ctx, owner));
}

export async function ownerFenceView(ctx: AppContext, owner: Address): Promise<OwnerFenceView> {
  const [doc, prefs] = await Promise.all([store(ctx).get(owner.toLowerCase()).catch(() => null), getPreferences(ctx, owner)]);
  const fence = doc?.value.custom ?? (await presetFence(ctx, owner));
  return { owner: owner.toLowerCase() as Address, fence, hash: fenceHash(fence), preset: prefs.risk, presetLabel: FENCE_PRESET_LABEL[riskTierOf(prefs.risk)], custom: Boolean(doc?.value.custom), updatedAt: doc?.value.updatedAt ?? null, migrated: Boolean(doc?.value.migratedAt) };
}

/** Checks the owner's signature on a loosening; throws when a loosening is not signed. */
async function requireSignature(ctx: AppContext, owner: Address, current: Fence, next: Fence, signature: string | undefined): Promise<void> {
  const loosened = loosenedRules(current, next);
  if (loosened.length === 0) return;
  if (!signature || !/^0x[0-9a-fA-F]+$/u.test(signature)) throw new LykiaHttpError("FENCE_SIGNATURE_REQUIRED", 403, "This loosens your Fence: sign the message with your wallet first.", { loosened, message: looseningMessage(loosened, next) });
  const message = looseningMessage(loosened, next);
  let valid = await verifyMessage({ address: owner, message, signature: signature as Hex }).catch(() => false);
  // Smart accounts (LykiaAccount, passkey wallets): ERC-1271 / ERC-6492 through Arc RPC.
  for (const environment of ["mainnet", "testnet"] as const) {
    if (valid) break;
    try {
      valid = await ctx.chains.client(environment).verifyMessage({ address: owner, message, signature: signature as Hex });
    } catch {
      valid = false;
    }
  }
  if (!valid) throw new LykiaHttpError("FENCE_SIGNATURE_INVALID", 403, "The signature does not match your address and this loosening.", { loosened, message });
}

/** Saves an edited Fence. Tightening applies at once; loosening needs the owner's signature. */
export async function setOwnerFence(ctx: AppContext, owner: Address, input: unknown, signature?: string, options: { readonly migrated?: boolean } = {}): Promise<OwnerFenceView> {
  const checked = validateFence(input);
  if (!checked.ok) throw new LykiaHttpError("INVALID_REQUEST", 400, "The Fence is invalid. See details.issues.", { issues: checked.issues });
  const current = await ownerFence(ctx, owner);
  // The Whistle is the server's (POST /v1/whistle); a stored Fence never carries whistle mode.
  const next: Fence = { ...checked.fence, mode: checked.fence.mode === "whistle" ? current.mode ?? "live" : checked.fence.mode ?? "live" };
  await requireSignature(ctx, owner, current, next, signature);
  const prior = (await store(ctx).get(owner.toLowerCase()).catch(() => null))?.value;
  const now = new Date(ctx.clock.now()).toISOString();
  await store(ctx).put(owner.toLowerCase(), { schema: OWNER_FENCE_SCHEMA, owner: owner.toLowerCase(), custom: next, updatedAt: now, migratedAt: options.migrated ? now : prior?.migratedAt ?? null });
  return ownerFenceView(ctx, owner);
}

/** Picks a preset (the risk profile): the Fence becomes that preset, without the owner's edits. */
export async function setFencePreset(ctx: AppContext, owner: Address, preset: FoldRisk, signature?: string): Promise<OwnerFenceView> {
  const current = await ownerFence(ctx, owner);
  const next = await presetFence(ctx, owner, preset);
  await requireSignature(ctx, owner, current, next, signature);
  const prior = (await store(ctx).get(owner.toLowerCase()).catch(() => null))?.value;
  await updatePreferences(ctx, owner, { risk: preset });
  await store(ctx).put(owner.toLowerCase(), { schema: OWNER_FENCE_SCHEMA, owner: owner.toLowerCase(), custom: null, updatedAt: new Date(ctx.clock.now()).toISOString(), migratedAt: prior?.migratedAt ?? null });
  return ownerFenceView(ctx, owner);
}

/** The owner settled a browser-held Fence from before without keeping it. */
export async function markFenceMigrated(ctx: AppContext, owner: Address): Promise<OwnerFenceView> {
  const prior = (await store(ctx).get(owner.toLowerCase()).catch(() => null))?.value;
  const now = new Date(ctx.clock.now()).toISOString();
  await store(ctx).put(owner.toLowerCase(), { schema: OWNER_FENCE_SCHEMA, owner: owner.toLowerCase(), custom: prior?.custom ?? null, updatedAt: prior?.updatedAt ?? now, migratedAt: now });
  return ownerFenceView(ctx, owner);
}
