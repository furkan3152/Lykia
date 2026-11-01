/**
 * `@lykia/sdk/operations`: call any documented route by its OpenAPI
 * operationId, typed from the generated table (src/generated/openapi.ts).
 *
 *   const ops = operations(createTransport({ apiKey }));
 *   const venues = await ops.call("getVenues", { query: { environment: "testnet" } });
 *   const plan = await ops.call("postIntents", { body: { owner, text: "send 5 USDC to alice" } });
 */
import { LYKIA_OPERATIONS, type LykiaOperationId, type LykiaOperations } from "./generated/openapi.js";
import type { LykiaTransport, RequestOptions } from "./transport.js";

type Part<T> = [T] extends [never] ? undefined : T;

export interface OperationArgs<K extends LykiaOperationId> {
  readonly params?: Part<LykiaOperations[K]["params"]>;
  readonly query?: Part<LykiaOperations[K]["query"]>;
  readonly body?: Part<LykiaOperations[K]["body"]>;
  readonly options?: RequestOptions;
}

/** The concrete path for an operation: {name} placeholders filled and the query appended. */
export function operationPath(path: string, params: Record<string, unknown> = {}, query: Record<string, unknown> = {}): string {
  const filled = path.replace(/\{([A-Za-z0-9_]+)\}/gu, (_m, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) throw new Error(`Missing path parameter ${name}.`);
    return encodeURIComponent(String(value));
  });
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)] as [string, string]);
  return entries.length === 0 ? filled : `${filled}?${new URLSearchParams(entries).toString()}`;
}

export function operations(t: LykiaTransport) {
  return {
    call<K extends LykiaOperationId>(operationId: K, args: OperationArgs<K> = {}): Promise<LykiaOperations[K]["response"]> {
      const info = LYKIA_OPERATIONS[operationId];
      if (!info) throw new Error(`Unknown operation ${String(operationId)}.`);
      const path = operationPath(info.path, (args.params ?? {}) as Record<string, unknown>, (args.query ?? {}) as Record<string, unknown>);
      const body = args.body ?? (info.method === "GET" || info.method === "DELETE" ? undefined : {});
      return t.request<LykiaOperations[K]["response"]>(info.method, path, body, args.options ?? {});
    },
    list: () => LYKIA_OPERATIONS,
  };
}
