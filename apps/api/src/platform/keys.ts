/**
 * Developer API keys.
 *
 *   secret keys       lk_sk_<id>_<secret>   server-to-server, every scope it was given
 *   publishable keys  lk_pk_<id>_<secret>   browser-safe: read + plan only, bound to allowed origins
 *
 * Only an HMAC of the secret is stored (k_api-key derived from
 * LYKIA_SESSION_SECRET); the full key is shown once. Rotation issues a new
 * secret under the same id and settings; revocation is immediate.
 */
import { API_KEY_SCOPES, type ApiKeyScope, type ApiKeyView, type CreatedApiKey } from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "./typed.js";
import { hmacHex, purposeKey, randomHex, randomToken, safeEqual } from "./crypto.js";

export const MAX_KEYS_PER_DEVELOPER = 20;
export const DEFAULT_PER_MINUTE = 120;
export const DEFAULT_PER_DAY = 20_000;
const KEY_PATTERN = /^lk_(sk|pk)_([a-z0-9]{12})_([A-Za-z0-9_-]{32})$/u;

export interface StoredKey {
  readonly id: string;
  readonly owner: string;
  readonly label: string;
  readonly kind: "secret" | "publishable";
  readonly hash: string;
  readonly scopes: readonly ApiKeyScope[];
  readonly allowedOrigins: readonly string[];
  readonly perMinute: number;
  readonly perDay: number;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
  /** Set for project keys: the gate checks the project's verified origins and counts usage per project. */
  readonly projectId?: string;
}

export function hashSecret(ctx: AppContext, secret: string): string {
  return hmacHex(purposeKey(ctx, "api-key"), secret);
}

export function viewOf(key: StoredKey): ApiKeyView {
  return { id: key.id, label: key.label, prefix: `lk_${key.kind === "secret" ? "sk" : "pk"}_${key.id}_…`, kind: key.kind, scopes: key.scopes, allowedOrigins: key.allowedOrigins, perMinute: key.perMinute, perDay: key.perDay, createdAt: key.createdAt, revokedAt: key.revokedAt, lastUsedAt: key.lastUsedAt, ...(key.projectId ? { projectId: key.projectId } : {}) };
}

const keys = (ctx: AppContext) => typedCollection<StoredKey>(ctx, "api_keys");

export interface CreateKeyInput {
  readonly owner: string;
  readonly label: string;
  readonly kind: "secret" | "publishable";
  readonly scopes?: readonly ApiKeyScope[];
  readonly allowedOrigins?: readonly string[];
  readonly perMinute?: number;
  readonly perDay?: number;
  readonly projectId?: string;
}

export async function createKey(ctx: AppContext, input: CreateKeyInput): Promise<CreatedApiKey> {
  const owner = input.owner.toLowerCase();
  const mine = (await keys(ctx).list({ limit: 1000 })).filter((d) => d.value.owner === owner && !d.value.revokedAt);
  if (mine.length >= MAX_KEYS_PER_DEVELOPER) throw new LykiaHttpError("KEY_LIMIT", 409, `At most ${MAX_KEYS_PER_DEVELOPER} active keys per developer.`);
  const scopes = input.kind === "publishable" ? (input.scopes ?? ["read", "plan"]).filter((s) => s === "read" || s === "plan") : (input.scopes ?? API_KEY_SCOPES);
  if (input.kind === "publishable" && !input.projectId && (input.allowedOrigins ?? []).length === 0) throw new LykiaHttpError("INVALID_REQUEST", 400, "A publishable key needs at least one allowed origin.");
  const id = randomHex(6);
  const secret = randomToken(24);
  const full = `lk_${input.kind === "secret" ? "sk" : "pk"}_${id}_${secret}`;
  const stored: StoredKey = {
    id,
    owner,
    label: input.label,
    kind: input.kind,
    hash: hashSecret(ctx, full),
    scopes,
    allowedOrigins: input.allowedOrigins ?? [],
    perMinute: input.perMinute ?? DEFAULT_PER_MINUTE,
    perDay: input.perDay ?? DEFAULT_PER_DAY,
    createdAt: new Date(ctx.clock.now()).toISOString(),
    revokedAt: null,
    lastUsedAt: null,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  };
  await keys(ctx).put(id, stored);
  return { ...viewOf(stored), secret: full };
}

export async function listKeys(ctx: AppContext, owner: string): Promise<ApiKeyView[]> {
  return (await keys(ctx).list({ limit: 1000 })).filter((d) => d.value.owner === owner.toLowerCase()).map((d) => viewOf(d.value));
}

async function ownKey(ctx: AppContext, owner: string, id: string): Promise<StoredKey> {
  const doc = await keys(ctx).get(id);
  if (!doc || doc.value.owner !== owner.toLowerCase()) throw new LykiaHttpError("NOT_FOUND", 404, "No such key.");
  return doc.value;
}

export async function revokeKey(ctx: AppContext, owner: string, id: string): Promise<ApiKeyView> {
  const key = await ownKey(ctx, owner, id);
  const next = { ...key, revokedAt: key.revokedAt ?? new Date(ctx.clock.now()).toISOString() };
  await keys(ctx).put(id, next);
  return viewOf(next);
}

export async function rotateKey(ctx: AppContext, owner: string, id: string): Promise<CreatedApiKey> {
  const key = await ownKey(ctx, owner, id);
  if (key.revokedAt) throw new LykiaHttpError("CONFLICT", 409, "A revoked key cannot be rotated.");
  const full = `lk_${key.kind === "secret" ? "sk" : "pk"}_${id}_${randomToken(24)}`;
  const next = { ...key, hash: hashSecret(ctx, full) };
  await keys(ctx).put(id, next);
  return { ...viewOf(next), secret: full };
}

/** The stored key for a presented secret, or null (malformed, unknown, revoked, wrong secret). */
export async function lookupKey(ctx: AppContext, presented: string): Promise<StoredKey | null> {
  const match = KEY_PATTERN.exec(presented.trim());
  if (!match) return null;
  const doc = await keys(ctx).get(match[2] as string);
  if (!doc || doc.value.revokedAt) return null;
  const kind = match[1] === "sk" ? "secret" : "publishable";
  if (doc.value.kind !== kind || !safeEqual(doc.value.hash, hashSecret(ctx, presented.trim()))) return null;
  return doc.value;
}

export async function touchKey(ctx: AppContext, key: StoredKey): Promise<void> {
  await keys(ctx).put(key.id, { ...key, lastUsedAt: new Date(ctx.clock.now()).toISOString() });
}
