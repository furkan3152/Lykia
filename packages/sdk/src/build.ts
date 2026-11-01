/**
 * `@lykia/sdk/build`: one call per action type, the same "quote -> build"
 * shape everywhere. `build.swap({...})` returns ready-to-sign calls,
 * simulated on Arc and checked by the Fence and the security layer.
 */
import type { LykiaTransport } from "./transport.js";
import type { ActionKind, ActionParams, Build, BuildOptions, Quote } from "./aggregator.js";

export function buildApi(t: LykiaTransport) {
  const quote = (kind: ActionKind) => (params: ActionParams) => t.request<Quote>("POST", `/v1/quote/${kind}`, { ...params, environment: t.env(params.environment) });
  const build = (kind: ActionKind) => (params: ActionParams & BuildOptions) => t.request<Build>("POST", `/v1/build/${kind}`, { ...params, environment: t.env(params.environment) });
  const kinds = ["transfer", "swap", "fx", "bridge", "deposit", "withdraw", "supply", "borrow", "repay", "batch"] as const;
  return {
    ...(Object.fromEntries(kinds.map((k) => [k, build(k)])) as Record<(typeof kinds)[number], (params: ActionParams & BuildOptions) => Promise<Build>>),
    /** Quotes per kind: `build.quote.deposit({...})`. */
    quote: Object.fromEntries(kinds.map((k) => [k, quote(k)])) as Record<(typeof kinds)[number], (params: ActionParams) => Promise<Quote>>,
    /** Build from a stored quote. */
    fromQuote: (kind: ActionKind, quoteId: string, options: BuildOptions = {}) => t.request<Build>("POST", `/v1/build/${kind}`, { quoteId, ...options }),
  };
}

export type BuildApi = ReturnType<typeof buildApi>;
export type { ActionKind, ActionParams, Build, BuildOptions, Quote };
