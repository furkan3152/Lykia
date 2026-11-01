/** `@lykia/sdk/automations`: price, schedule, balance and event triggers that plan an intent or notify a webhook. */
import type { Address, ArcEnvironment, AutomationAction, AutomationListEntry, AutomationTrigger, Fence, UnifiedAutomation } from "@lykia/core";
import { q, type LykiaTransport } from "./transport.js";

export interface AutomationInput {
  readonly owner: Address;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly projectId?: string;
  readonly environment?: ArcEnvironment;
  readonly fence?: Fence;
  readonly maxFiresPerDay?: number;
}

export function automationsApi(t: LykiaTransport) {
  const id = (value: string) => encodeURIComponent(value);
  return {
    create: (input: AutomationInput) => t.request<UnifiedAutomation>("POST", "/v1/automations", { ...input, environment: t.env(input.environment) }),
    /** Unified automations; with `owner`, also that owner's standing orders, alerts, agent automations and orders. */
    list: (owner?: Address) => t.request<{ automations: UnifiedAutomation[]; entries: AutomationListEntry[] }>("GET", `/v1/automations${q({ owner })}`),
    get: (automationId: string) => t.request<UnifiedAutomation>("GET", `/v1/automations/${id(automationId)}`),
    pause: (automationId: string, owner?: Address) => t.request<unknown>("POST", `/v1/automations/${id(automationId)}/pause${q({ owner })}`, {}),
    resume: (automationId: string, owner?: Address) => t.request<unknown>("POST", `/v1/automations/${id(automationId)}/resume${q({ owner })}`, {}),
    remove: (automationId: string, owner?: Address) => t.request<unknown>("DELETE", `/v1/automations/${id(automationId)}${q({ owner })}`),
  };
}

export type AutomationsApi = ReturnType<typeof automationsApi>;
export type { UnifiedAutomation, AutomationTrigger, AutomationAction };
