/** A typed view over a store collection for plain JSON documents (the store keeps JsonValue). */
import type { AppContext } from "../context.js";
import type { Collection, JsonValue, ListOptions, StoredDoc, WriteOptions } from "../store/types.js";

export interface TypedCollection<T> {
  get(id: string): Promise<StoredDoc<T> | null>;
  put(id: string, value: T, options?: WriteOptions): Promise<StoredDoc<T>>;
  delete(id: string): Promise<boolean>;
  list(options?: ListOptions): Promise<Array<StoredDoc<T>>>;
}

export function typedCollection<T>(ctx: AppContext, name: string): TypedCollection<T> {
  const raw: Collection<JsonValue> = ctx.store.collection<JsonValue>(name);
  return {
    get: (id) => raw.get(id) as unknown as Promise<StoredDoc<T> | null>,
    put: (id, value, options) => raw.put(id, value as unknown as JsonValue, options) as unknown as Promise<StoredDoc<T>>,
    delete: (id) => raw.delete(id),
    list: (options) => raw.list(options) as unknown as Promise<Array<StoredDoc<T>>>,
  };
}
