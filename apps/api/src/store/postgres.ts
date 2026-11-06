/**
 * Postgres Store (LYKIA_DATABASE_URL). Two tables, created lazily on first
 * use with CREATE TABLE IF NOT EXISTS under an advisory lock (replicas that
 * boot together do not race), retried after a failure:
 *
 *   <prefix>_docs     (collection, id) -> jsonb doc, version, updated_at, expires_at
 *   <prefix>_counters (name, key)      -> value, expires_at
 *
 * Times are epoch milliseconds from the application clock (not the database
 * clock), so TTL semantics match MemoryStore exactly. Ids use the "C"
 * collation so ordering matches JavaScript string comparison. Database
 * failures become 503 STORE_UNAVAILABLE; connection details never leave the
 * log line.
 */
import pg from "pg";
import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import { storeUnavailable } from "../http/errors.js";
import type { Logger } from "../log.js";
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

export interface PostgresStoreOptions {
  readonly url: string;
  readonly clock?: Clock;
  readonly log?: Logger;
  /** Table name prefix (default "lykia"); tests use a unique one. */
  readonly tablePrefix?: string;
  readonly poolSize?: number;
}

const PREFIX_PATTERN = /^[a-z][a-z0-9_]{0,30}$/u;

interface DocRecord {
  readonly id: string;
  readonly doc: unknown;
  readonly version: string | number;
  readonly updated_at: string | number;
  readonly expires_at: string | number | null;
}

function ddl(docs: string, counters: string): string {
  return `
CREATE TABLE IF NOT EXISTS ${docs} (
  collection text COLLATE "C" NOT NULL,
  id text COLLATE "C" NOT NULL,
  doc jsonb NOT NULL,
  version bigint NOT NULL,
  updated_at bigint NOT NULL,
  expires_at bigint,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS ${docs}_expiry ON ${docs} (expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS ${counters} (
  name text COLLATE "C" NOT NULL,
  key text COLLATE "C" NOT NULL,
  value bigint NOT NULL,
  expires_at bigint,
  PRIMARY KEY (name, key)
);
CREATE INDEX IF NOT EXISTS ${counters}_expiry ON ${counters} (expires_at) WHERE expires_at IS NOT NULL;`;
}

function escapeLike(prefix: string): string {
  return prefix.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

function toNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

const DOC_COLUMNS = "id, doc, version, updated_at, expires_at";

const QUERY_RETRIES = 2;

/** The client never reached the database: safe to retry any statement. */
export function isConnectFailure(message: string): boolean {
  return /timeout exceeded when trying to connect|Connection terminated due to connection timeout|ECONNREFUSED|ECONNRESET.*connect|getaddrinfo/iu.test(message);
}

/** The connection died while a statement was in flight: retried only for reads. */
export function isDroppedConnection(message: string): boolean {
  return /Connection terminated unexpectedly|Client has encountered a connection error|ECONNRESET/iu.test(message);
}

export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  readonly pool: pg.Pool;
  readonly docsTable: string;
  readonly countersTable: string;
  private readonly clock: Clock;
  private readonly log: Logger | undefined;
  private schema: Promise<void> | null = null;
  private closed = false;

  constructor(options: PostgresStoreOptions) {
    const prefix = options.tablePrefix ?? "lykia";
    if (!PREFIX_PATTERN.test(prefix)) throw new TypeError(`tablePrefix must match ${PREFIX_PATTERN}`);
    this.docsTable = `${prefix}_docs`;
    this.countersTable = `${prefix}_counters`;
    this.clock = options.clock ?? systemClock;
    this.log = options.log;
    this.pool = new pg.Pool({
      connectionString: options.url,
      max: options.poolSize ?? 5,
      // Serverless Postgres drops idle connections and can take seconds to wake from suspend:
      // release idle clients early, keep sockets alive, and give a cold start time to answer.
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
    });
    this.pool.on("error", (error) => {
      this.log?.error("postgres pool error", { error: error.message });
    });
  }

  private ensureSchema(): Promise<void> {
    if (!this.schema) {
      const attempt = (async () => {
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${this.docsTable}:schema`]);
          await client.query(ddl(this.docsTable, this.countersTable));
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      })();
      this.schema = attempt;
      // A failed attempt is forgotten so the next call retries.
      attempt.catch(() => {
        if (this.schema === attempt) this.schema = null;
      });
    }
    return this.schema;
  }

  /**
   * Query with lazy schema creation; database errors map to 503 STORE_UNAVAILABLE.
   * A connection that could not be opened is retried (nothing reached the database); a connection
   * dropped mid-flight is retried only for reads, so a write is never applied twice.
   */
  async query<R extends pg.QueryResultRow>(text: string, values: readonly unknown[]): Promise<pg.QueryResult<R>> {
    const read = /^\s*select\b/iu.test(text);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.ensureSchema();
        return await this.pool.query<R>(text, [...values]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retry = attempt < QUERY_RETRIES && (isConnectFailure(message) || (read && isDroppedConnection(message)));
        if (retry) {
          this.log?.warn("postgres connection retry", { attempt: attempt + 1, error: message });
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }
        this.log?.error("postgres query failed", { error: message });
        throw storeUnavailable();
      }
    }
  }

  collection<T extends JsonValue>(name: string): Collection<T> {
    assertName(name);
    return new PostgresCollection<T>(name, this, this.clock);
  }

  counters(name: string): Counters {
    assertName(name);
    return new PostgresCounters(name, this, this.clock);
  }

  async sweep(): Promise<number> {
    const now = this.clock.now();
    const docs = await this.query(`DELETE FROM ${this.docsTable} WHERE expires_at IS NOT NULL AND expires_at <= $1`, [now]);
    const counters = await this.query(`DELETE FROM ${this.countersTable} WHERE expires_at IS NOT NULL AND expires_at <= $1`, [now]);
    return (docs.rowCount ?? 0) + (counters.rowCount ?? 0);
  }

  async ping(): Promise<void> {
    await this.query("SELECT 1", []);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  /** Drops this store's tables (tests only). */
  async dropTables(): Promise<void> {
    await this.pool.query(`DROP TABLE IF EXISTS ${this.docsTable}; DROP TABLE IF EXISTS ${this.countersTable};`);
    this.schema = null;
  }
}

class PostgresCollection<T extends JsonValue> implements Collection<T> {
  private readonly table: string;

  constructor(
    readonly name: string,
    private readonly store: PostgresStore,
    private readonly clock: Clock,
  ) {
    this.table = store.docsTable;
  }

  private view(row: DocRecord): StoredDoc<T> {
    return {
      id: row.id,
      value: row.doc as T,
      version: Number(row.version),
      updatedAt: Number(row.updated_at),
      expiresAt: toNumber(row.expires_at),
    };
  }

  async get(id: string): Promise<StoredDoc<T> | null> {
    assertId(id);
    const result = await this.store.query<DocRecord>(
      `SELECT ${DOC_COLUMNS} FROM ${this.table} WHERE collection = $1 AND id = $2 AND (expires_at IS NULL OR expires_at > $3)`,
      [this.name, id, this.clock.now()],
    );
    const row = result.rows[0];
    return row ? this.view(row) : null;
  }

  async put(id: string, value: T, options?: WriteOptions): Promise<StoredDoc<T>> {
    assertId(id);
    const ttl = assertTtl(options);
    const now = this.clock.now();
    const result = await this.store.query<DocRecord>(
      `INSERT INTO ${this.table} AS d (collection, id, doc, version, updated_at, expires_at)
       VALUES ($1, $2, $3::jsonb, 1, $4, $5)
       ON CONFLICT (collection, id) DO UPDATE SET
         doc = EXCLUDED.doc,
         version = CASE WHEN d.expires_at IS NOT NULL AND d.expires_at <= $4 THEN 1 ELSE d.version + 1 END,
         updated_at = EXCLUDED.updated_at,
         expires_at = EXCLUDED.expires_at
       RETURNING ${DOC_COLUMNS}`,
      [this.name, id, JSON.stringify(jsonCopy(value)), now, ttl === null ? null : now + ttl],
    );
    const row = result.rows[0];
    if (!row) throw storeUnavailable();
    return this.view(row);
  }

  async delete(id: string): Promise<boolean> {
    assertId(id);
    const result = await this.store.query<{ live: boolean }>(
      `DELETE FROM ${this.table} WHERE collection = $1 AND id = $2 RETURNING (expires_at IS NULL OR expires_at > $3) AS live`,
      [this.name, id, this.clock.now()],
    );
    return result.rows[0]?.live === true;
  }

  async list(options?: ListOptions): Promise<Array<StoredDoc<T>>> {
    const limit = listLimit(options);
    const result = await this.store.query<DocRecord>(
      `SELECT ${DOC_COLUMNS} FROM ${this.table}
       WHERE collection = $1 AND (expires_at IS NULL OR expires_at > $2)
         AND id LIKE $3 ESCAPE '\\' AND ($4::text IS NULL OR id > $4::text)
       ORDER BY id LIMIT $5`,
      [this.name, this.clock.now(), `${escapeLike(options?.prefix ?? "")}%`, options?.after ?? null, limit],
    );
    return result.rows.map((row) => this.view(row));
  }

  async compareAndSet(id: string, expectedVersion: number | null, value: T, options?: WriteOptions): Promise<StoredDoc<T> | null> {
    assertId(id);
    const ttl = assertTtl(options);
    const now = this.clock.now();
    const expiresAt = ttl === null ? null : now + ttl;
    const json = JSON.stringify(jsonCopy(value));
    if (expectedVersion === null) {
      const result = await this.store.query<DocRecord>(
        `INSERT INTO ${this.table} AS d (collection, id, doc, version, updated_at, expires_at)
         VALUES ($1, $2, $3::jsonb, 1, $4, $5)
         ON CONFLICT (collection, id) DO UPDATE SET
           doc = EXCLUDED.doc, version = 1, updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at
         WHERE d.expires_at IS NOT NULL AND d.expires_at <= $4
         RETURNING ${DOC_COLUMNS}`,
        [this.name, id, json, now, expiresAt],
      );
      const row = result.rows[0];
      return row ? this.view(row) : null;
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return null;
    const result = await this.store.query<DocRecord>(
      `UPDATE ${this.table} SET doc = $3::jsonb, version = version + 1, updated_at = $4, expires_at = $5
       WHERE collection = $1 AND id = $2 AND version = $6 AND (expires_at IS NULL OR expires_at > $4)
       RETURNING ${DOC_COLUMNS}`,
      [this.name, id, json, now, expiresAt, expectedVersion],
    );
    const row = result.rows[0];
    return row ? this.view(row) : null;
  }
}

class PostgresCounters implements Counters {
  private readonly table: string;

  constructor(
    readonly name: string,
    private readonly store: PostgresStore,
    private readonly clock: Clock,
  ) {
    this.table = store.countersTable;
  }

  async increment(key: string, by = 1, options?: WriteOptions): Promise<number> {
    assertId(key);
    assertIncrement(by);
    const ttl = assertTtl(options);
    const now = this.clock.now();
    const result = await this.store.query<{ value: string | number }>(
      `INSERT INTO ${this.table} AS c (name, key, value, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (name, key) DO UPDATE SET
         value = CASE WHEN c.expires_at IS NOT NULL AND c.expires_at <= $5 THEN EXCLUDED.value ELSE c.value + EXCLUDED.value END,
         expires_at = CASE WHEN c.expires_at IS NOT NULL AND c.expires_at <= $5 THEN EXCLUDED.expires_at ELSE c.expires_at END
       RETURNING value`,
      [this.name, key, by, ttl === null ? null : now + ttl, now],
    );
    const row = result.rows[0];
    if (!row) throw storeUnavailable();
    return Number(row.value);
  }

  async get(key: string): Promise<number> {
    assertId(key);
    const result = await this.store.query<{ value: string | number }>(
      `SELECT value FROM ${this.table} WHERE name = $1 AND key = $2 AND (expires_at IS NULL OR expires_at > $3)`,
      [this.name, key, this.clock.now()],
    );
    const row = result.rows[0];
    return row ? Number(row.value) : 0;
  }

  async reset(key: string): Promise<void> {
    assertId(key);
    await this.store.query(`DELETE FROM ${this.table} WHERE name = $1 AND key = $2`, [this.name, key]);
  }
}
