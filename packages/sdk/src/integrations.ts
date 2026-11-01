/**
 * `@lykia/sdk/integrations`: put your protocol on Lykia with a
 * `lykia.adapter/v1` manifest, and work with any contract on Arc (encode,
 * read, simulate, decode). Also AI routing.
 */
import type { AdapterManifest, AdapterRecord, AdapterStatus, Address, ArcEnvironment, Fence } from "@lykia/core";
import { q, type LykiaTransport } from "./transport.js";
import type { BuildOptions } from "./aggregator.js";

export type AbiInput = readonly string[] | readonly Record<string, unknown>[];

export function integrationsApi(t: LykiaTransport) {
  return {
    adapters: {
      /** Submit (or re-submit) a manifest; validate: true runs the on-chain checks right away. Needs a secret key or a session. */
      submit: (manifest: AdapterManifest, options: { validate?: boolean; environment?: ArcEnvironment } = {}) => t.request<AdapterRecord>("POST", "/v1/integrations/adapters", { manifest, ...options }),
      list: (options: { mine?: boolean; status?: AdapterStatus } = {}) => t.request<{ adapters: AdapterRecord[] }>("GET", `/v1/integrations/adapters${q({ mine: options.mine ? "true" : undefined, status: options.status })}`),
      get: (id: string) => t.request<AdapterRecord>("GET", `/v1/integrations/adapters/${encodeURIComponent(id)}`),
      status: (id: string) => t.request<{ id: string; status: AdapterStatus; validation: unknown; history: unknown[] }>("GET", `/v1/integrations/adapters/${encodeURIComponent(id)}/status`),
      validate: (id: string, environment?: ArcEnvironment) => t.request<AdapterRecord>("POST", `/v1/integrations/adapters/${encodeURIComponent(id)}/validate`, { ...(environment ? { environment } : {}) }),
      /** Lykia admins only. */
      review: (id: string, decision: "approve" | "reject" | "route" | "suspend", note?: string) => t.request<AdapterRecord>("POST", `/v1/integrations/adapters/${encodeURIComponent(id)}/review`, { decision, ...(note ? { note } : {}) }),
      spec: () => t.request<{ schema: string; verbs: string[]; templates: string[]; statuses: string[]; example: AdapterManifest }>("GET", "/v1/integrations/manifest"),
    },
    contracts: {
      encode: (input: { abi: AbiInput; function: string; args?: readonly unknown[] }) => t.request<{ data: `0x${string}`; selector: `0x${string}`; signature: string }>("POST", "/v1/contracts/encode", input),
      read: (calls: readonly { address: Address; abi: AbiInput; function: string; args?: readonly unknown[] }[], environment?: ArcEnvironment) => t.request<{ block: string | null; results: { ok: boolean; result?: unknown; error?: string }[] }>("POST", "/v1/contracts/read", { calls, environment: t.env(environment) }),
      simulate: (input: { from: Address; calls: readonly ({ to: Address; data: `0x${string}`; value?: string } | { to: Address; abi: AbiInput; function: string; args?: readonly unknown[]; value?: string })[]; tokens?: readonly Address[]; environment?: ArcEnvironment }) =>
        t.request<{ ok: boolean; reason?: string; balanceChanges: { token: Address; symbol: string | null; diff: string }[]; lines: string[]; events: unknown[]; security: { decision: string; findings: unknown[] } }>("POST", "/v1/contracts/simulate", { ...input, environment: t.env(input.environment) }),
      decode: (input: { to?: Address; data?: `0x${string}`; logs?: readonly { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}` }[]; abi?: AbiInput; environment?: ArcEnvironment }) => t.request<{ calls: unknown[]; lines: string[]; events: unknown[] }>("POST", "/v1/contracts/decode", { ...input, environment: t.env(input.environment) }),
    },
    ai: {
      /** A request in any language -> actions -> the best route, with an explanation. */
      route: (input: { text: string; owner: Address; environment?: ArcEnvironment; constraints?: { fence?: Fence; venues?: { allow?: string[]; deny?: string[] }; appetite?: "low" | "medium" | "high"; maxSteps?: number; maxCandidates?: number; horizonDays?: number }; build?: boolean; buildOptions?: BuildOptions }) =>
        t.request<{ status: "routed" | "no-route" | "clarify"; understood: { actions: unknown[]; clarify: string[]; source: "llm" | "deterministic" }; best: unknown; explain: unknown; build: unknown }>("POST", "/v1/ai/route", { ...input, environment: t.env(input.environment) }),
      explain: (input: { route: unknown; language?: string } | { quoteId: string; language?: string }) => t.request<{ text: string; source: "llm" | "deterministic" }>("POST", "/v1/ai/explain-route", input),
    },
  };
}

export type IntegrationsApi = ReturnType<typeof integrationsApi>;
