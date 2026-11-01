/**
 * Document store used by every feature module: named collections of JSON
 * documents with versions (compare-and-set), optional TTLs and simple
 * counters. Two backends share these semantics exactly (one contract test
 * suite runs against both): MemoryStore for development and tests,
 * PostgresStore when LYKIA_DATABASE_URL is set.
 *
 * Semantics:
 * - Ids are 1-256 characters; listing is ordered by id in code-unit order.
 * - Every write bumps `version` (a new or expired document starts at 1).
 * - An expired document or counter behaves exactly as if absent.
 * - Values are JSON: `undefined` properties are dropped, like JSONB does.
 * - Counter TTLs are fixed windows: set when the counter is (re)created and
 *   not extended by later increments.
 */

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue | undefined };

export type StoreKind = "memory" | "postgres";

export interface StoredDoc<T> {
  readonly id: string;
  readonly value: T;
  readonly version: number;
  readonly updatedAt: number;
  /** Epoch ms after which the document no longer exists, or null. */
  readonly expiresAt: number | null;
}

export interface WriteOptions {
  /** Time to live in ms from now (positive integer). */
  readonly ttlMs?: number;
}

export interface ListOptions {
  readonly prefix?: string;
  /** Exclusive lower bound on id (pagination cursor: the last id of the previous page). */
  readonly after?: string;
  /** Default 100, at most 1000. */
  readonly limit?: number;
}

export interface Collection<T> {
  readonly name: string;
  get(id: string): Promise<StoredDoc<T> | null>;
  /** Unconditional upsert. */
  put(id: string, value: T, options?: WriteOptions): Promise<StoredDoc<T>>;
  delete(id: string): Promise<boolean>;
  list(options?: ListOptions): Promise<Array<StoredDoc<T>>>;
  /**
   * Writes only when the current version equals `expectedVersion`
   * (`null` = the document must not exist). Returns the new document, or null
   * when another writer got there first.
   */
  compareAndSet(id: string, expectedVersion: number | null, value: T, options?: WriteOptions): Promise<StoredDoc<T> | null>;
}

export interface Counters {
  readonly name: string;
  /** Adds `by` (default 1) and returns the new value. */
  increment(key: string, by?: number, options?: WriteOptions): Promise<number>;
  get(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

export interface Store {
  readonly kind: StoreKind;
  collection<T extends JsonValue>(name: string): Collection<T>;
  counters(name: string): Counters;
  /** Removes expired rows; returns how many were removed. */
  sweep(): Promise<number>;
  /** Cheap liveness probe (health checks). */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export const MAX_ID_LENGTH = 256;
export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 1_000;
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/u;

export function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) throw new TypeError(`store name "${name}" must match ${NAME_PATTERN}`);
}

export function assertId(id: string): void {
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) {
    throw new TypeError(`store ids must be 1-${MAX_ID_LENGTH} characters`);
  }
}

export function assertTtl(options: WriteOptions | undefined): number | null {
  const ttl = options?.ttlMs;
  if (ttl === undefined) return null;
  if (!Number.isInteger(ttl) || ttl <= 0) throw new TypeError("ttlMs must be a positive integer");
  return ttl;
}

export function assertIncrement(by: number): void {
  if (!Number.isSafeInteger(by)) throw new TypeError("counter increments must be safe integers");
}

export function listLimit(options: ListOptions | undefined): number {
  const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
  return Math.min(limit, MAX_LIST_LIMIT);
}

/** JSON round trip: the value the store will hand back (and a defensive copy). */
export function jsonCopy<T>(value: T): T {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("store values must be JSON-serializable");
  return JSON.parse(json) as T;
}
