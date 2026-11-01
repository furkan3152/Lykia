import type { Clock } from "../clock.js";
import type { Logger } from "../log.js";
import { MemoryStore } from "./memory.js";
import { PostgresStore } from "./postgres.js";
import type { Store } from "./types.js";

export * from "./types.js";
export { MemoryStore } from "./memory.js";
export { PostgresStore, type PostgresStoreOptions } from "./postgres.js";

/** Postgres when a database URL is configured, otherwise the in-process store. */
export function createStore(options: { readonly databaseUrl: string | null; readonly clock: Clock; readonly log: Logger }): Store {
  if (options.databaseUrl) return new PostgresStore({ url: options.databaseUrl, clock: options.clock, log: options.log });
  return new MemoryStore(options.clock);
}
