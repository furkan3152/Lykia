/**
 * Developer API keys.
 *
 *   live secret keys        lk_live_<id>_<secret>      mainnet and testnet, server-to-server
 *   test secret keys        lk_test_<id>_<secret>      testnet only (the sandbox); can never touch mainnet
 *   publishable keys        lk_pk_live_<id>_<secret>   browser-safe: read, quote and build, bound to origins
 *                           lk_pk_test_<id>_<secret>
 *   legacy keys             lk_sk_<id>_<secret>, lk_pk_<id>_<secret>   keep working exactly as before
 *
 * Only an HMAC of the secret is stored (k_api-key derived from
 * LYKIA_SESSION_SECRET); the full key is shown once. Rotation issues a new
 * secret under the same id and settings; the old secret keeps working for an
 * overlap window (default 24 h, 0 for immediate). Revocation is immediate.
 * A key may carry an IP allowlist (exact addresses or CIDR ranges) and is
 * pinned to an API version at creation.
 */
import { BlockList, isIP } from "node:net";
import {
  API_KEY_SCOPES,
  API_VERSIONS,
  DEFAULT_SECRET_SCOPES,
  FINE_API_KEY_SCOPES,
  LATEST_API_VERSION,
  PUBLISHABLE_SCOPES,
  type ApiKeyMode,
  type ApiKeyScope,
  type ApiKeyView,
  type CreatedApiKey,
} from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "./typed.js";
import { hmacHex, purposeKey, randomHex, randomToken, safeEqual } from "./crypto.js";
import { listAll } from "../store/types.js";

const MAX_KEYS_PER_DEVELOPER = 20;
export const DEFAULT_PER_MINUTE = 120;
export const DEFAULT_PER_DAY = 20_000;
const DEFAULT_ROTATION_OVERLAP_S = 24 * 3600;
export const MAX_ROTATION_OVERLAP_S = 7 * 24 * 3600;
const MAX_ALLOWED_IPS = 20;
/** lk_(sk|pk)_<id>_<secret> (legacy) or lk_(live|test)_<id>_<secret> or lk_pk_(live|test)_<id>_<secret>. */
const KEY_PATTERN = /^lk_(?:(live|test)|(sk)|(pk)(?:_(live|test))?)_([a-z0-9]{12})_([A-Za-z0-9_-]{32})$/u;

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
  /** Set on lk_live_ / lk_test_ keys (fine-grained scopes). Absent on legacy keys. */
  readonly mode?: ApiKeyMode;
  readonly allowedIps?: readonly string[];
  readonly apiVersion?: string;
  /** The secret before the last rotation, accepted until previousExpiresAt. */
  readonly previousHash?: string | null;
  readonly previousExpiresAt?: string | null;
}

export function hashSecret(ctx: AppContext, secret: string): string {
  return hmacHex(purposeKey(ctx, "api-key"), secret);
}

function keyPrefix(key: Pick<StoredKey, "id" | "kind" | "mode">): string {
  if (!key.mode) return `lk_${key.kind === "secret" ? "sk" : "pk"}_${key.id}_`;
  return key.kind === "secret" ? `lk_${key.mode}_${key.id}_` : `lk_pk_${key.mode}_${key.id}_`;
}

function fullKey(key: Pick<StoredKey, "id" | "kind" | "mode">): string {
  return `${keyPrefix(key)}${randomToken(24)}`;
}

function viewOf(key: StoredKey): ApiKeyView {
  return {
    id: key.id,
    label: key.label,
    prefix: `${keyPrefix(key)}…`,
    kind: key.kind,
    scopes: key.scopes,
    allowedOrigins: key.allowedOrigins,
    perMinute: key.perMinute,
    perDay: key.perDay,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
    lastUsedAt: key.lastUsedAt,
    ...(key.projectId ? { projectId: key.projectId } : {}),
    ...(key.mode ? { mode: key.mode } : {}),
    allowedIps: key.allowedIps ?? [],
    apiVersion: key.apiVersion ?? LATEST_API_VERSION,
    previousSecretExpiresAt: key.previousExpiresAt ?? null,
  };
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
  /** "live" or "test" gives a lk_live_ / lk_test_ key with fine-grained scopes; omitted gives a legacy key. */
  readonly mode?: ApiKeyMode;
  readonly allowedIps?: readonly string[];
  readonly apiVersion?: string;
}

/** Validates an IP allowlist entry: an IPv4/IPv6 address or a CIDR range. */
export function validIpEntry(entry: string): boolean {
  const [address, bits, extra] = entry.split("/");
  if (extra !== undefined || !address) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/u.test(bits)) return false;
  return Number(bits) <= (family === 4 ? 32 : 128);
}

/** True when `ip` is allowed by the list (an empty list allows every address). */
export function ipAllowed(list: readonly string[] | undefined, ip: string | undefined): boolean {
  if (!list || list.length === 0) return true;
  if (!ip) return false;
  const candidate = ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const family = isIP(candidate);
  if (family === 0) return false;
  const block = new BlockList();
  for (const entry of list) {
    const [address, bits] = entry.split("/") as [string, string | undefined];
    const type = isIP(address) === 6 ? "ipv6" : "ipv4";
    if (bits === undefined) block.addAddress(address, type);
    else block.addSubnet(address, Number(bits), type);
  }
  return block.check(candidate, family === 6 ? "ipv6" : "ipv4");
}

function checkVersion(version: string | undefined): string {
  if (version === undefined) return LATEST_API_VERSION;
  if (!API_VERSIONS.includes(version)) throw new LykiaHttpError("INVALID_API_VERSION", 400, `Unknown API version ${version}. Known: ${API_VERSIONS.join(", ")}.`);
  return version;
}

function scopesFor(input: CreateKeyInput): readonly ApiKeyScope[] {
  if (!input.mode) {
    // Legacy keys keep the legacy scope set and route mapping.
    const legacy = input.scopes ?? API_KEY_SCOPES;
    const unknown = legacy.filter((s) => !(API_KEY_SCOPES as readonly string[]).includes(s));
    if (unknown.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `Fine-grained scopes (${unknown.join(", ")}) need a live or test key: pass mode.`);
    return input.kind === "publishable" ? (input.scopes ?? ["read", "plan"]).filter((s) => s === "read" || s === "plan") : legacy;
  }
  const asked = input.scopes ?? (input.kind === "publishable" ? PUBLISHABLE_SCOPES : DEFAULT_SECRET_SCOPES);
  const fine = asked.filter((s) => (FINE_API_KEY_SCOPES as readonly string[]).includes(s) || s === "plan" || s === "webhooks");
  if (input.kind === "publishable") {
    const allowed = fine.filter((s) => (PUBLISHABLE_SCOPES as readonly string[]).includes(s));
    return allowed.length > 0 ? allowed : ["read"];
  }
  return [...new Set(fine)];
}

export async function createKey(ctx: AppContext, input: CreateKeyInput): Promise<CreatedApiKey> {
  const owner = input.owner.toLowerCase();
  const mine = (await listAll(keys(ctx))).filter((d) => d.value.owner === owner && !d.value.revokedAt);
  if (mine.length >= MAX_KEYS_PER_DEVELOPER) throw new LykiaHttpError("KEY_LIMIT", 409, `At most ${MAX_KEYS_PER_DEVELOPER} active keys per developer.`);
  if (input.kind === "publishable" && !input.projectId && (input.allowedOrigins ?? []).length === 0) throw new LykiaHttpError("INVALID_REQUEST", 400, "A publishable key needs at least one allowed origin.");
  const allowedIps = input.allowedIps ?? [];
  if (allowedIps.length > MAX_ALLOWED_IPS || !allowedIps.every(validIpEntry)) throw new LykiaHttpError("INVALID_REQUEST", 400, `allowedIps takes up to ${MAX_ALLOWED_IPS} IP addresses or CIDR ranges.`);
  const scopes = scopesFor(input);
  const id = randomHex(6);
  const shape = { id, kind: input.kind, ...(input.mode ? { mode: input.mode } : {}) } as const;
  const full = fullKey(shape);
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
    ...(input.mode ? { mode: input.mode } : {}),
    allowedIps,
    apiVersion: checkVersion(input.apiVersion),
  };
  await keys(ctx).put(id, stored);
  return { ...viewOf(stored), secret: full };
}

export async function listKeys(ctx: AppContext, owner: string): Promise<ApiKeyView[]> {
  return (await listAll(keys(ctx))).filter((d) => d.value.owner === owner.toLowerCase()).map((d) => viewOf(d.value));
}

async function ownKey(ctx: AppContext, owner: string, id: string): Promise<StoredKey> {
  const doc = await keys(ctx).get(id);
  if (!doc || doc.value.owner !== owner.toLowerCase()) throw new LykiaHttpError("NOT_FOUND", 404, "No such key.");
  return doc.value;
}

export async function getOwnKey(ctx: AppContext, owner: string, id: string): Promise<ApiKeyView> {
  return viewOf(await ownKey(ctx, owner, id));
}

export async function revokeKey(ctx: AppContext, owner: string, id: string): Promise<ApiKeyView> {
  const key = await ownKey(ctx, owner, id);
  const next = { ...key, revokedAt: key.revokedAt ?? new Date(ctx.clock.now()).toISOString(), previousHash: null, previousExpiresAt: null };
  await keys(ctx).put(id, next);
  return viewOf(next);
}

/**
 * New secret under the same id and settings. The old secret keeps working for
 * `overlapSeconds` (default 24 h) so deployments can roll over without downtime.
 */
export async function rotateKey(ctx: AppContext, owner: string, id: string, overlapSeconds = DEFAULT_ROTATION_OVERLAP_S): Promise<CreatedApiKey> {
  const key = await ownKey(ctx, owner, id);
  if (key.revokedAt) throw new LykiaHttpError("CONFLICT", 409, "A revoked key cannot be rotated.");
  if (!Number.isInteger(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > MAX_ROTATION_OVERLAP_S) throw new LykiaHttpError("INVALID_REQUEST", 400, `overlapSeconds must be 0 to ${MAX_ROTATION_OVERLAP_S}.`);
  const full = fullKey(key);
  const now = ctx.clock.now();
  const next: StoredKey = { ...key, hash: hashSecret(ctx, full), previousHash: overlapSeconds > 0 ? key.hash : null, previousExpiresAt: overlapSeconds > 0 ? new Date(now + overlapSeconds * 1000).toISOString() : null };
  await keys(ctx).put(id, next);
  return { ...viewOf(next), secret: full };
}

export interface UpdateKeyInput {
  readonly label?: string;
  readonly scopes?: readonly ApiKeyScope[];
  readonly allowedIps?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly perMinute?: number;
  readonly perDay?: number;
  readonly apiVersion?: string;
}

/** Changes a key's label, scopes, IP allowlist, origins, limits or version pin. The secret stays the same. */
export async function updateKey(ctx: AppContext, owner: string, id: string, patch: UpdateKeyInput): Promise<ApiKeyView> {
  const key = await ownKey(ctx, owner, id);
  if (key.revokedAt) throw new LykiaHttpError("CONFLICT", 409, "A revoked key cannot be changed.");
  if (patch.allowedIps && (patch.allowedIps.length > MAX_ALLOWED_IPS || !patch.allowedIps.every(validIpEntry))) throw new LykiaHttpError("INVALID_REQUEST", 400, `allowedIps takes up to ${MAX_ALLOWED_IPS} IP addresses or CIDR ranges.`);
  const scopes = patch.scopes ? scopesFor({ owner, label: key.label, kind: key.kind, scopes: patch.scopes, ...(key.mode ? { mode: key.mode } : {}) }) : key.scopes;
  const next: StoredKey = {
    ...key,
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    scopes,
    ...(patch.allowedIps !== undefined ? { allowedIps: patch.allowedIps } : {}),
    ...(patch.allowedOrigins !== undefined ? { allowedOrigins: patch.allowedOrigins } : {}),
    ...(patch.perMinute !== undefined ? { perMinute: patch.perMinute } : {}),
    ...(patch.perDay !== undefined ? { perDay: patch.perDay } : {}),
    ...(patch.apiVersion !== undefined ? { apiVersion: checkVersion(patch.apiVersion) } : {}),
  };
  await keys(ctx).put(id, next);
  return viewOf(next);
}

export interface ParsedKey {
  readonly id: string;
  readonly kind: "secret" | "publishable";
  readonly mode: ApiKeyMode | null;
}

/** The shape of a presented key, or null when it is not a Lykia key. */
export function parseKey(presented: string): ParsedKey | null {
  const match = KEY_PATTERN.exec(presented.trim());
  if (!match) return null;
  const [, secretMode, legacySecret, pub, pubMode, id] = match;
  if (secretMode) return { id: id as string, kind: "secret", mode: secretMode as ApiKeyMode };
  if (legacySecret) return { id: id as string, kind: "secret", mode: null };
  if (pub) return { id: id as string, kind: "publishable", mode: (pubMode as ApiKeyMode | undefined) ?? null };
  return null;
}

/** The stored key for a presented secret, or null (malformed, unknown, revoked, wrong secret). */
export async function lookupKey(ctx: AppContext, presented: string): Promise<StoredKey | null> {
  const parsed = parseKey(presented);
  if (!parsed) return null;
  const doc = await keys(ctx).get(parsed.id);
  if (!doc || doc.value.revokedAt) return null;
  const key = doc.value;
  if (key.kind !== parsed.kind || (key.mode ?? null) !== parsed.mode) return null;
  const hash = hashSecret(ctx, presented.trim());
  if (safeEqual(key.hash, hash)) return key;
  // The previous secret works until its overlap window ends.
  if (key.previousHash && key.previousExpiresAt && Date.parse(key.previousExpiresAt) > ctx.clock.now() && safeEqual(key.previousHash, hash)) return key;
  return null;
}

export async function touchKey(ctx: AppContext, key: StoredKey): Promise<void> {
  const current = (await keys(ctx).get(key.id))?.value ?? key;
  await keys(ctx).put(key.id, { ...current, lastUsedAt: new Date(ctx.clock.now()).toISOString() });
}
