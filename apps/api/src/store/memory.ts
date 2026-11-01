/**
 * In-process Store (development and tests; restarts lose data). Values are
 * deep-copied through JSON on the way in and out so callers can never mutate
 * stored state, and so behavior matches the Postgres JSONB backend.
 */
import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import {
  assertId,
  assertIncrement,
  assertName,
  assertTtl,
  jsonCopy,
  listLimit,
  type Collection,
  type Counters,
  type JsonValue,
  type ListOptions,
  type Store,
  type StoredDoc,
  type WriteOptions,
} from "./types.js";

interface DocRow {
  readonly json: string;
  readonly version: number;
  readonly updatedAt: number;
  readonly expiresAt: number | null;
}

interface CounterRow {
  value: number;
  expiresAt: number | null;
}

function live(row: { readonly expiresAt: number | null } | undefined, now: number): boolean {
  return row !== undefined && (row.expiresAt === null || row.expiresAt > now);
}

class MemoryCollection<T extends JsonValue> implements Collection<T> {
  constructor(
    readonly name: string,
    private readonly rows: Map<string, DocRow>,
    private readonly clock: Clock,
  ) {}

  private view(id: string, row: DocRow): StoredDoc<T> {
    return { id, value: JSON.parse(row.json) as T, version: row.version, updatedAt: row.updatedAt, expiresAt: row.expiresAt };
  }

  private write(id: string, value: T, version: number, options: WriteOptions | undefined): StoredDoc<T> {
    const ttl = assertTtl(options);
    const now = this.clock.now();
    const row: DocRow = { json: JSON.stringify(jsonCopy(value)), version, updatedAt: now, expiresAt: ttl === null ? null : now + ttl };
    this.rows.set(id, row);
    return this.view(id, row);
  }

  async get(id: string): Promise<StoredDoc<T> | null> {
    assertId(id);
    const row = this.rows.get(id);
    if (!row) return null;
    if (!live(row, this.clock.now())) {
      this.rows.delete(id);
      return null;
    }
    return this.view(id, row);
  }

  async put(id: string, value: T, options?: WriteOptions): Promise<StoredDoc<T>> {
    assertId(id);
    const current = this.rows.get(id);
    const version = live(current, this.clock.now()) && current ? current.version + 1 : 1;
    return this.write(id, value, version, options);
  }

  async delete(id: string): Promise<boolean> {
    assertId(id);
    const row = this.rows.get(id);
    this.rows.delete(id);
    return live(row, this.clock.now());
  }

  async list(options?: ListOptions): Promise<Array<StoredDoc<T>>> {
    const limit = listLimit(options);
    const prefix = options?.prefix ?? "";
    const after = options?.after;
    const now = this.clock.now();
    const ids = [...this.rows.keys()]
      .filter((id) => id.startsWith(prefix) && (after === undefined || id > after))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Array<StoredDoc<T>> = [];
    for (const id of ids) {
      const row = this.rows.get(id);
      if (!row || !live(row, now)) continue;
      out.push(this.view(id, row));
      if (out.length >= limit) break;
    }
    return out;
  }

  async compareAndSet(id: string, expectedVersion: number | null, value: T, options?: WriteOptions): Promise<StoredDoc<T> | null> {
    assertId(id);
    const current = this.rows.get(id);
    const exists = live(current, this.clock.now()) && current !== undefined;
    if (expectedVersion === null) {
      if (exists) return null;
      return this.write(id, value, 1, options);
    }
    if (!exists || current.version !== expectedVersion) return null;
    return this.write(id, value, expectedVersion + 1, options);
  }

  sweep(now: number): number {
    let removed = 0;
    for (const [id, row] of this.rows) {
      if (!live(row, now)) {
        this.rows.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

class MemoryCounters implements Counters {
  constructor(
    readonly name: string,
    private readonly rows: Map<string, CounterRow>,
    private readonly clock: Clock,
  ) {}

  async increment(key: string, by = 1, options?: WriteOptions): Promise<number> {
    assertId(key);
    assertIncrement(by);
    const ttl = assertTtl(options);
    const now = this.clock.now();
    const row = this.rows.get(key);
    if (!row || !live(row, now)) {
      this.rows.set(key, { value: by, expiresAt: ttl === null ? null : now + ttl });
      return by;
    }
    row.value += by;
    return row.value;
  }

  async get(key: string): Promise<number> {
    assertId(key);
    const row = this.rows.get(key);
    return row && live(row, this.clock.now()) ? row.value : 0;
  }

  async reset(key: string): Promise<void> {
    assertId(key);
    this.rows.delete(key);
  }

  sweep(now: number): number {
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (!live(row, now)) {
        this.rows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private readonly docs = new Map<string, Map<string, DocRow>>();
  private readonly counterRows = new Map<string, Map<string, CounterRow>>();
  private readonly collections = new Map<string, MemoryCollection<JsonValue>>();
  private readonly counterSets = new Map<string, MemoryCounters>();

  constructor(private readonly clock: Clock = systemClock) {}

  collection<T extends JsonValue>(name: string): Collection<T> {
    assertName(name);
    let collection = this.collections.get(name);
    if (!collection) {
      const rows = this.docs.get(name) ?? new Map<string, DocRow>();
      this.docs.set(name, rows);
      collection = new MemoryCollection<JsonValue>(name, rows, this.clock);
      this.collections.set(name, collection);
    }
    return collection as unknown as Collection<T>;
  }

  counters(name: string): Counters {
    assertName(name);
    let counters = this.counterSets.get(name);
    if (!counters) {
      const rows = this.counterRows.get(name) ?? new Map<string, CounterRow>();
      this.counterRows.set(name, rows);
      counters = new MemoryCounters(name, rows, this.clock);
      this.counterSets.set(name, counters);
    }
    return counters;
  }

  async sweep(): Promise<number> {
    const now = this.clock.now();
    let removed = 0;
    for (const collection of this.collections.values()) removed += collection.sweep(now);
    for (const counters of this.counterSets.values()) removed += counters.sweep(now);
    return removed;
  }

  async ping(): Promise<void> {}

  async close(): Promise<void> {}
}
