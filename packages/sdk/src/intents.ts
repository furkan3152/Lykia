/** `@lykia/sdk/intents`: plan a sentence or actions, prepare and submit steps, follow an intent. */
import type { Address, ArcEnvironment, Fence, IntentGraph, Outrun, PlanAction } from "@lykia/core";
import type { CreateIntentResponse, PrepareStepResponse, SubmitStepResponse } from "@lykia/core/api/intents";
import type { ParseResponse } from "@lykia/core/api/language";
import type { LykiaTransport, RequestOptions } from "./transport.js";

export interface CreateIntentInput {
  readonly owner: Address;
  readonly text?: string;
  readonly actions?: readonly PlanAction[];
  readonly fence?: Fence;
  readonly signer?: "wallet" | "agent";
  readonly dryRun?: boolean;
  readonly environment?: ArcEnvironment;
}

export function intentsApi(t: LykiaTransport) {
  return {
    parse: (text: string, environment?: ArcEnvironment) => t.request<ParseResponse>("POST", "/v1/language/parse", { text, environment: t.env(environment) }),
    create: async (input: CreateIntentInput, options?: RequestOptions) => {
      const created = await t.request<CreateIntentResponse>("POST", "/v1/intents", { ...input, environment: t.env(input.environment) }, options);
      if (created?.intent) t.emit("plan-created", { intentId: created.intent.id, steps: created.intent.steps.length, decision: created.intent.verdict.decision });
      return created;
    },
    get: (id: string) => t.request<{ intent: IntentGraph; outrun: Outrun }>("GET", `/v1/intents/${id}`),
    outrun: (id: string) => t.request<Outrun>("GET", `/v1/intents/${id}/outrun`),
    prepare: (id: string, stepId: string, options: { confirm?: boolean } = {}) => t.request<PrepareStepResponse>("POST", `/v1/intents/${id}/steps/${stepId}/prepare`, options),
    submit: async (id: string, stepId: string, hashes: readonly `0x${string}`[]) => {
      t.emit("step-signed", { intentId: id, stepId, hashes });
      const result = await t.request<SubmitStepResponse>("POST", `/v1/intents/${id}/steps/${stepId}/submit`, { hashes });
      const status = result?.step?.status;
      if (status === "settled" || status === "failed") t.emit("settled", { intentId: id, stepId, status });
      return result;
    },
    /** Smart accounts (ERC-4337): the step's calls ran inside one UserOperation. */
    submitUserOp: (id: string, stepId: string, userOpHash: `0x${string}`) => t.request<SubmitStepResponse>("POST", `/v1/intents/${id}/steps/${stepId}/submit`, { userOpHash }),
    stop: (id: string) => t.request<unknown>("POST", `/v1/intents/${id}/stop`, {}),
    /** Live updates of one intent (events: step, outrun). */
    follow: (id: string, signal?: AbortSignal) => t.stream<unknown>(`/v1/intents/${id}/stream`, undefined, signal),
  };
}

export type IntentsApi = ReturnType<typeof intentsApi>;
export type { CreateIntentResponse, PrepareStepResponse, SubmitStepResponse };
