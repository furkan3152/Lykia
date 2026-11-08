/**
 * `@lykia/sdk/leashes`: give an agent a budget it cannot exceed.
 *
 * The owner creates, lists, revokes and renews (a session, or a secret key
 * with the agents scope). The leashed agent uses its own leash key
 * (`lk_leash_…`) to plan and submit inside the leash; that key can do
 * nothing else.
 *
 *   const created = await owner.leashes.create({ agent: { name: "Invoice bot", signer: agentAddress }, template: "pay-invoices",
 *     budget: { perStepUsd: "20", perDayUsd: "20", totalUsd: "140" }, expiresAt, recipients: [payee] });
 *   // sign created.transactions once from the owner's wallet; give created.apiKey.secret to the agent.
 *   const agent = new Lykia({ apiKey: created.apiKey.secret });
 *   const plan = await agent.leashes.plan(created.leash.id, { text: "pay 12 USDC to 0x…" });   // LykiaError LEASH_DENIED outside it
 */
import type { Address, ArcEnvironment, LeashBudget, LeashTemplate, LeashTool, PlanAction } from "@lykia/core";
import type { CreateLeashRequest, CreateLeashResponse, LeashPlanResponse, LeashSubmitResponse, LeashTrailResponse, LeashView, RenewLeashResponse, RevokeLeashResponse } from "@lykia/core/api/leash";
import { q, type LykiaTransport } from "./transport.js";

export type { CreateLeashRequest, CreateLeashResponse, LeashPlanResponse, LeashSubmitResponse, LeashTrailResponse, LeashView, RenewLeashResponse, RevokeLeashResponse, LeashDenied } from "@lykia/core/api/leash";

export interface RenewLeashInput {
  readonly expiresAt: string;
  readonly budget?: LeashBudget;
  readonly recipients?: readonly Address[];
  readonly venues?: readonly string[];
  readonly signer?: Address;
}

export interface LeashTemplatesResponse {
  readonly templates: readonly LeashTemplate[];
  readonly enforcement: readonly { readonly limit: string; readonly enforcedBy: "chain" | "api" | "both"; readonly how: string }[];
  readonly limits: Readonly<Record<string, number>>;
}

const id = (value: string) => encodeURIComponent(value);

export function leashesApi(t: LykiaTransport) {
  return {
    /** Templates (pay-invoices, trade-small, earn, custom) and exactly what the chain and the API enforce. */
    templates: () => t.request<LeashTemplatesResponse>("GET", "/v1/leashes/templates"),
    /** Owner: a Pack agent, its carve, the unsigned session transaction(s), the leash key (once) and an MCP config. */
    create: (input: CreateLeashRequest) => t.request<CreateLeashResponse>("POST", "/v1/leashes", { ...input, environment: t.env(input.environment) }),
    /** Owner: every leash with live usage (spendable() on chain is authoritative). */
    list: (owner?: Address, environment?: ArcEnvironment) => t.request<{ leashes: LeashView[] }>("GET", `/v1/leashes${q({ owner, environment: t.env(environment) })}`),
    /** Owner or the leash's own key. */
    get: (leashId: string) => t.request<LeashView>("GET", `/v1/leashes/${id(leashId)}`),
    /** Owner: the key stops at once; sign the returned revokeSession to end the session on chain. */
    revoke: (leashId: string) => t.request<RevokeLeashResponse>("POST", `/v1/leashes/${id(leashId)}/revoke`, {}),
    /** Owner: a new carve, session and key; the old leash is revoked. Never an increase in place. */
    renew: (leashId: string, input: RenewLeashInput) => t.request<RenewLeashResponse>("POST", `/v1/leashes/${id(leashId)}/renew`, input),
    /** Every action, each marked chain-proven or not. */
    trail: (leashId: string) => t.request<LeashTrailResponse>("GET", `/v1/leashes/${id(leashId)}/trail`),
    /** Owner: bind the session once its transaction landed (or let the API find it). */
    bindSession: (leashId: string, txHash?: `0x${string}`) => t.request<LeashView>("POST", `/v1/leashes/${id(leashId)}/session`, txHash ? { txHash } : {}),
    /** Leash key: plan inside the leash; the first step comes back as one transaction for the session key. */
    plan: (leashId: string, input: { readonly text: string; readonly dryRun?: boolean } | { readonly actions: readonly PlanAction[]; readonly dryRun?: boolean }) => t.request<LeashPlanResponse>("POST", `/v1/leashes/${id(leashId)}/plan`, input),
    /** Leash key: report the hash the session key sent; the next step comes back prepared. */
    submit: (leashId: string, input: { readonly intentId: string; readonly stepId: string; readonly hash: `0x${string}` }) => t.request<LeashSubmitResponse>("POST", `/v1/leashes/${id(leashId)}/submit`, input),
  };
}

export type LeashesApi = ReturnType<typeof leashesApi>;
export type { LeashTool };
