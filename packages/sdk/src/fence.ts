/** `@lykia/sdk/fence`: validate a Fence (with loosened-rule lines) and evaluate facts against it. */
import type { Fence, FenceFacts, FenceVerdict } from "@lykia/core";
import type { LykiaTransport } from "./transport.js";

export interface FenceValidation {
  readonly ok: boolean;
  readonly issues?: unknown[];
  readonly hash?: string;
  readonly loosened?: string[];
}

export function fenceApi(t: LykiaTransport) {
  return {
    validate: (fence: Fence, previous?: Fence) => t.request<FenceValidation>("POST", "/v1/fence/validate", { fence, ...(previous ? { previous } : {}) }),
    evaluate: (facts: Omit<FenceFacts, "now"> & { now?: number }, fence?: Fence) => t.request<FenceVerdict>("POST", "/v1/fence/evaluate", { facts, ...(fence ? { fence } : {}) }),
    templates: () => t.request<unknown>("GET", "/v1/fence/templates"),
  };
}

export type FenceApi = ReturnType<typeof fenceApi>;
