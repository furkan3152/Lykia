/** `@lykia/sdk/agents`: Lyko's chat turn, threads, insights, automations and the Pack (sub-agents with their own Fence and Tag). */
import type { Address, ArcEnvironment, Fence, PackRole, UnsignedTransaction } from "@lykia/core";
import type { AgentProposal, Automation, ChatEvent, InsightsResponse, PackAgentView, SessionTxResponse, ThreadView } from "@lykia/core/api/agents";
import type { SseMessage } from "./sse.js";
import { q, type LykiaTransport } from "./transport.js";

export interface ChatInput {
  readonly message: string;
  readonly owner?: Address;
  readonly threadId?: string;
  readonly fence?: Fence;
  readonly environment?: ArcEnvironment;
}

export interface AskResult {
  readonly threadId: string;
  readonly mode: "llm" | "reader";
  readonly reply: string;
  readonly proposals: AgentProposal[];
  readonly stopReason: string;
  readonly events: { event: string; data: unknown }[];
}

/** GET /v1/pack/account. */
export interface PackAccountResponse {
  readonly factory: Address;
  readonly address: Address;
  readonly deployed: boolean;
  readonly guardian: Address;
  /** The unsigned createAccount call while the account does not exist yet. */
  readonly transaction: UnsignedTransaction | null;
}

export function agentApi(t: LykiaTransport) {
  return {
    /** Lyko's turn as a stream of ChatEvents (thread, task, tool, proposal, clarify, text, done). */
    chat: (input: ChatInput, signal?: AbortSignal) => t.stream<ChatEvent["data"]>("/v1/agent/chat", { ...input, environment: t.env(input.environment) }, signal) as AsyncGenerator<SseMessage<ChatEvent["data"]>>,
    /** The same turn, collected: reply, proposals and every event. */
    ask: (input: ChatInput) => t.request<AskResult>("POST", "/v1/agent/chat", { ...input, environment: t.env(input.environment) }),
    threads: (owner: Address) => t.request<{ threads: Omit<ThreadView, "messages">[] }>("GET", `/v1/agent/threads${q({ owner })}`),
    thread: (owner: Address, id: string) => t.request<ThreadView>("GET", `/v1/agent/threads/${encodeURIComponent(id)}${q({ owner })}`),
    insights: (owner: Address, environment?: ArcEnvironment) => t.request<InsightsResponse>("GET", `/v1/agent/insights${q({ owner, environment: t.env(environment) })}`),
    automations: (owner: Address) => t.request<{ automations: Automation[] }>("GET", `/v1/agent/automations${q({ owner })}`),
    createAutomation: (input: { owner: Address; sentence: string; when: Automation["when"]; mode?: Automation["mode"]; agentId?: string | null; environment?: ArcEnvironment; maxRunsPerDay?: number }) =>
      t.request<Automation>("POST", "/v1/agent/automations", { ...input, environment: t.env(input.environment) }),
  };
}

export function packApi(t: LykiaTransport) {
  return {
    list: (owner: Address, environment?: ArcEnvironment) => t.request<{ agents: PackAgentView[] }>("GET", `/v1/pack${q({ owner, environment: t.env(environment) })}`),
    get: (id: string) => t.request<PackAgentView>("GET", `/v1/pack/${encodeURIComponent(id)}`),
    create: (input: { owner: Address; name: string; role: PackRole; fence?: Fence; mission?: string; signer?: Address; agentId?: string; environment?: ArcEnvironment }) =>
      t.request<PackAgentView>("POST", "/v1/pack", { ...input, environment: t.env(input.environment) }),
    /** A sub-agent: its Fence must sit inside the parent's and its caps are carved from the parent's budget. */
    spawn: (parentId: string, input: { name: string; role: PackRole; fence?: Fence; mission?: string; signer?: Address }) => t.request<PackAgentView>("POST", `/v1/pack/${encodeURIComponent(parentId)}/spawn`, input),
    revoke: (id: string) => t.request<{ revoked: string[] }>("POST", `/v1/pack/${encodeURIComponent(id)}/revoke`, {}),
    budget: (id: string) => t.request<PackAgentView["budget"]>("GET", `/v1/pack/${encodeURIComponent(id)}/budget`),
    /** The owner's LykiaAccount (factory-predicted address) and, if it is not deployed yet, the createAccount transaction. */
    account: (owner: Address, environment?: ArcEnvironment) => t.request<PackAccountResponse>("GET", `/v1/pack/account${q({ owner, environment: t.env(environment) })}`),
    sessionTx: (id: string, input: { account?: Address; key?: Address; validDays?: number; maxCalls?: number }) =>
      t.request<SessionTxResponse & { transaction: UnsignedTransaction; account?: PackAccountResponse; accountTransaction?: UnsignedTransaction | null }>("POST", `/v1/pack/${encodeURIComponent(id)}/session-tx`, input),
    bindSession: (id: string, input: { account: Address; sessionId: `0x${string}`; txHash?: `0x${string}` }) => t.request<PackAgentView>("POST", `/v1/pack/${encodeURIComponent(id)}/session`, input),
  };
}

/** Standing orders: a sentence with a condition or a schedule ("every Friday send 50 USDC to ..."). */
export function standingApi(t: LykiaTransport) {
  return {
    create: (input: { owner: Address; text?: string; draft?: unknown; fence?: Fence; timezone?: string; environment?: ArcEnvironment }) => t.request<unknown>("POST", "/v1/standing", { ...input, environment: t.env(input.environment) }),
    list: (owner: Address) => t.request<unknown>("GET", `/v1/standing${q({ owner })}`),
    get: (id: string) => t.request<unknown>("GET", `/v1/standing/${encodeURIComponent(id)}`),
    check: (id: string) => t.request<unknown>("POST", `/v1/standing/${encodeURIComponent(id)}/check`, {}),
    pause: (id: string) => t.request<unknown>("POST", `/v1/standing/${encodeURIComponent(id)}/pause`, {}),
    resume: (id: string) => t.request<unknown>("POST", `/v1/standing/${encodeURIComponent(id)}/resume`, {}),
  };
}

/** Signed limit and DCA orders kept by the keeper. */
export function ordersApi(t: LykiaTransport) {
  return {
    config: (environment?: ArcEnvironment) => t.request<unknown>("GET", `/v1/orders/config${q({ environment: t.env(environment) })}`),
    draft: (input: Record<string, unknown> & { owner: Address; environment?: ArcEnvironment }) => t.request<unknown>("POST", "/v1/orders/draft", { ...input, environment: t.env(input.environment) }),
    submit: (input: { order: unknown; signature: `0x${string}`; kind?: string; summary?: string; environment?: ArcEnvironment }) => t.request<unknown>("POST", "/v1/orders", { ...input, environment: t.env(input.environment) }),
    list: (owner: Address, environment?: ArcEnvironment) => t.request<unknown>("GET", `/v1/orders${q({ owner, environment: t.env(environment) })}`),
  };
}

export type AgentApi = ReturnType<typeof agentApi>;
export type PackApi = ReturnType<typeof packApi>;
export type { AgentProposal, Automation, ChatEvent, InsightsResponse, PackAgentView, SessionTxResponse, ThreadView };
