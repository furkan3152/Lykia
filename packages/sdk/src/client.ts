/**
 * The Lykia client. One class, grouped methods, typed with the API's own
 * contract types from @lykia/core. Retries rate limits and transient
 * failures with backoff (GETs always; POSTs only when the server never
 * processed them: 429, 502, 503, 504, or a network error before a response),
 * sends an Idempotency-Key on every POST, and streams SSE as async
 * iterators.
 */
import type { Address, ArcEnvironment, Fence, FenceFacts, FenceVerdict, PlanAction, UnsignedTransaction } from "@lykia/core";
import type { AgentProposal, Automation, ChatEvent, InsightsResponse, PackAgentView, SessionTxResponse, ThreadView } from "@lykia/core/api/agents";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { CreateIntentResponse, PrepareStepResponse, SubmitStepResponse, VenueRow } from "@lykia/core/api/intents";
import type { ParseResponse } from "@lykia/core/api/language";
import type { ApiKeyView, CreatedApiKey, SessionView, SiweNonceResponse, WebhookEndpointView, WebhookEvent } from "@lykia/core/api/platform";
import type { ScentReport } from "@lykia/core/api/scent";
import type { Contact, IntentGraph, LykiaProfile, Outrun, PackRole } from "@lykia/core";
import type { CircleStatusResponse, GatewayTransferDraft, GatewayTransferResult, X402DiscoveryResponse } from "@lykia/core/api/circle";
import type { ContactsResponse, MemoryExport, MemoryIntentsResponse, MemoryView } from "@lykia/core/api/memory";
import type { ProfileResponse } from "@lykia/core/api/profile";
import { errorFrom, LykiaError } from "./errors.js";
import { readSse, type SseMessage } from "./sse.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LykiaOptions {
  /** API origin, e.g. https://api.lykia.xyz (default http://localhost:3002). */
  readonly baseUrl?: string;
  /** A secret (server) or publishable (browser) API key. */
  readonly apiKey?: string;
  /** A Lykia-Session token from sign-in (owner actions). */
  readonly session?: string;
  readonly environment?: ArcEnvironment;
  readonly fetch?: FetchLike;
  /** Extra attempts for retryable failures (default 2). */
  readonly retries?: number;
  readonly timeoutMs?: number;
}

export interface RequestOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Lykia {
  readonly baseUrl: string;
  readonly environment: ArcEnvironment | undefined;
  private apiKey: string | undefined;
  private session: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly retries: number;
  private readonly timeoutMs: number;

  constructor(options: LykiaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:3002").replace(/\/+$/u, "");
    this.apiKey = options.apiKey;
    this.session = options.session;
    this.environment = options.environment;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.retries = options.retries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Use a session token from now on (after sign-in). */
  setSession(token: string | undefined): void {
    this.session = token;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      accept: "application/json",
      ...(this.apiKey ? { "Lykia-Key": this.apiKey } : {}),
      ...(this.session ? { "Lykia-Session": this.session } : {}),
      ...(extra ?? {}),
    };
  }

  private env(environment?: ArcEnvironment): ArcEnvironment | undefined {
    return environment ?? this.environment;
  }

  async request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const idempotencyKey = method === "GET" ? undefined : (options.idempotencyKey ?? randomKey());
    let attempt = 0;
    for (;;) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: this.headers({ ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), ...(options.headers ?? {}) }),
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal,
        });
      } catch (error) {
        if (options.signal?.aborted || attempt >= this.retries) throw new LykiaError({ code: "NETWORK_ERROR", status: 0, message: error instanceof Error ? error.message : "Network error" });
        await sleep(backoff(attempt++));
        continue;
      }
      if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T;
      if (RETRY_STATUSES.has(response.status) && attempt < this.retries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : backoff(attempt));
        attempt++;
        continue;
      }
      throw await errorFrom(response);
    }
  }

  private async *stream<T>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<SseMessage<T>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: this.headers({ accept: "text/event-stream", ...(body !== undefined ? { "content-type": "application/json" } : {}) }),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok || !response.body) throw await errorFrom(response);
    yield* readSse<T>(response.body);
  }

  /* ------------------------------------------------------------- reads */

  readonly arc = {
    networks: () => this.request<unknown>("GET", "/v1/networks"),
    venues: (environment?: ArcEnvironment) => this.request<{ venues: VenueRow[] }>("GET", `/v1/venues${q({ environment: this.env(environment) })}`),
    flock: (address: Address, environment?: ArcEnvironment) => this.request<FlockSnapshot>("GET", `/v1/flock/${address}${q({ environment: this.env(environment) })}`),
    scent: (token: Address, environment?: ArcEnvironment) => this.request<ScentReport>("GET", `/v1/scent/${token}${q({ environment: this.env(environment) })}`),
  };

  /* ------------------------------------------------------------- fence */

  readonly fence = {
    validate: (fence: Fence, previous?: Fence) => this.request<{ ok: boolean; issues?: unknown[]; hash?: string; loosened?: string[] }>("POST", "/v1/fence/validate", { fence, ...(previous ? { previous } : {}) }),
    evaluate: (facts: Omit<FenceFacts, "now"> & { now?: number }, fence?: Fence) => this.request<FenceVerdict>("POST", "/v1/fence/evaluate", { facts, ...(fence ? { fence } : {}) }),
  };

  /* ----------------------------------------------------------- intents */

  readonly intents = {
    parse: (text: string, environment?: ArcEnvironment) => this.request<ParseResponse>("POST", "/v1/language/parse", { text, environment: this.env(environment) }),
    create: (input: { owner: Address; text?: string; actions?: readonly PlanAction[]; fence?: Fence; signer?: "wallet" | "agent"; dryRun?: boolean; environment?: ArcEnvironment }, options?: RequestOptions) =>
      this.request<CreateIntentResponse>("POST", "/v1/intents", { ...input, environment: this.env(input.environment) }, options),
    get: (id: string) => this.request<{ intent: IntentGraph; outrun: Outrun }>("GET", `/v1/intents/${id}`),
    outrun: (id: string) => this.request<Outrun>("GET", `/v1/intents/${id}/outrun`),
    prepare: (id: string, stepId: string, options: { confirm?: boolean } = {}) => this.request<PrepareStepResponse>("POST", `/v1/intents/${id}/steps/${stepId}/prepare`, options),
    submit: (id: string, stepId: string, hashes: readonly `0x${string}`[]) => this.request<SubmitStepResponse>("POST", `/v1/intents/${id}/steps/${stepId}/submit`, { hashes }),
    /** Smart accounts (ERC-4337): the step's calls ran inside one UserOperation. */
    submitUserOp: (id: string, stepId: string, userOpHash: `0x${string}`) => this.request<SubmitStepResponse>("POST", `/v1/intents/${id}/steps/${stepId}/submit`, { userOpHash }),
    stop: (id: string) => this.request<unknown>("POST", `/v1/intents/${id}/stop`, {}),
    /** Live updates of one intent (events: step, outrun). */
    follow: (id: string, signal?: AbortSignal) => this.stream<unknown>(`/v1/intents/${id}/stream`, undefined, signal),
  };

  /* ------------------------------------------------------------- agent */

  readonly agent = {
    /** Lyko's turn as a stream of ChatEvents (thread, task, tool, proposal, clarify, text, done). */
    chat: (input: { message: string; owner?: Address; threadId?: string; fence?: Fence; environment?: ArcEnvironment }, signal?: AbortSignal) =>
      this.stream<ChatEvent["data"]>("/v1/agent/chat", { ...input, environment: this.env(input.environment) }, signal) as AsyncGenerator<SseMessage<ChatEvent["data"]>>,
    /** The same turn, collected: reply, proposals and every event. */
    ask: (input: { message: string; owner?: Address; threadId?: string; fence?: Fence; environment?: ArcEnvironment }) =>
      this.request<{ threadId: string; mode: "llm" | "reader"; reply: string; proposals: AgentProposal[]; stopReason: string; events: { event: string; data: unknown }[] }>("POST", "/v1/agent/chat", { ...input, environment: this.env(input.environment) }),
    threads: (owner: Address) => this.request<{ threads: Omit<ThreadView, "messages">[] }>("GET", `/v1/agent/threads${q({ owner })}`),
    thread: (owner: Address, id: string) => this.request<ThreadView>("GET", `/v1/agent/threads/${encodeURIComponent(id)}${q({ owner })}`),
    insights: (owner: Address, environment?: ArcEnvironment) => this.request<InsightsResponse>("GET", `/v1/agent/insights${q({ owner, environment: this.env(environment) })}`),
    automations: (owner: Address) => this.request<{ automations: Automation[] }>("GET", `/v1/agent/automations${q({ owner })}`),
    createAutomation: (input: { owner: Address; sentence: string; when: Automation["when"]; mode?: Automation["mode"]; agentId?: string | null; environment?: ArcEnvironment; maxRunsPerDay?: number }) =>
      this.request<Automation>("POST", "/v1/agent/automations", { ...input, environment: this.env(input.environment) }),
  };

  /* -------------------------------------------------------------- pack */

  readonly pack = {
    list: (owner: Address, environment?: ArcEnvironment) => this.request<{ agents: PackAgentView[] }>("GET", `/v1/pack${q({ owner, environment: this.env(environment) })}`),
    get: (id: string) => this.request<PackAgentView>("GET", `/v1/pack/${encodeURIComponent(id)}`),
    create: (input: { owner: Address; name: string; role: PackRole; fence?: Fence; mission?: string; signer?: Address; agentId?: string; environment?: ArcEnvironment }) =>
      this.request<PackAgentView>("POST", "/v1/pack", { ...input, environment: this.env(input.environment) }),
    /** A sub-agent: its Fence must sit inside the parent's and its caps are carved from the parent's budget. */
    spawn: (parentId: string, input: { name: string; role: PackRole; fence?: Fence; mission?: string; signer?: Address }) => this.request<PackAgentView>("POST", `/v1/pack/${encodeURIComponent(parentId)}/spawn`, input),
    revoke: (id: string) => this.request<{ revoked: string[] }>("POST", `/v1/pack/${encodeURIComponent(id)}/revoke`, {}),
    budget: (id: string) => this.request<PackAgentView["budget"]>("GET", `/v1/pack/${encodeURIComponent(id)}/budget`),
    sessionTx: (id: string, input: { account: Address; key?: Address; validDays?: number; maxCalls?: number }) => this.request<SessionTxResponse & { transaction: UnsignedTransaction }>("POST", `/v1/pack/${encodeURIComponent(id)}/session-tx`, input),
    bindSession: (id: string, input: { account: Address; sessionId: `0x${string}`; txHash?: `0x${string}` }) => this.request<PackAgentView>("POST", `/v1/pack/${encodeURIComponent(id)}/session`, input),
  };

  /* ------------------------------------------- profile, memory, contacts (need a session) */

  readonly profile = {
    get: () => this.request<ProfileResponse>("GET", "/v1/profile"),
    /** Partial update; validated and versioned by the API. A profile only ever tightens a Fence. */
    update: (patch: Partial<Omit<LykiaProfile, "schema" | "version" | "updatedAt">> & Record<string, unknown>) => this.request<ProfileResponse>("PUT", "/v1/profile", patch),
    reset: () => this.request<ProfileResponse>("DELETE", "/v1/profile"),
  };

  readonly memory = {
    view: () => this.request<MemoryView>("GET", "/v1/memory"),
    intents: (limit?: number) => this.request<MemoryIntentsResponse>("GET", `/v1/memory/intents${q({ limit: limit === undefined ? undefined : String(limit) })}`),
    export: () => this.request<MemoryExport>("GET", "/v1/memory/export"),
    forget: (what: "intents" | "contacts" | "all" = "all") => this.request<{ forgotten: { intents: number; contacts: number } }>("POST", "/v1/memory/forget", { what }),
    forgetItem: (id: string) => this.request<{ forgotten: string }>("DELETE", `/v1/memory/${encodeURIComponent(id)}`),
  };

  readonly contacts = {
    list: () => this.request<ContactsResponse>("GET", "/v1/contacts"),
    add: (input: { name: string; address: Address; aliases?: string[]; note?: string }) => this.request<{ contact: Contact }>("POST", "/v1/contacts", input),
    update: (id: string, input: { name: string; address: Address; aliases?: string[]; note?: string }) => this.request<{ contact: Contact }>("PUT", `/v1/contacts/${encodeURIComponent(id)}`, input),
    remove: (id: string) => this.request<{ deleted: string }>("DELETE", `/v1/contacts/${encodeURIComponent(id)}`),
  };

  /* ------------------------------------------------------------ Circle */

  readonly circle = {
    status: () => this.request<CircleStatusResponse>("GET", "/v1/circle/status"),
    services: (input: { query?: string; category?: string; maxUsdPrice?: number; environment?: ArcEnvironment } = {}) =>
      this.request<X402DiscoveryResponse>("GET", `/v1/circle/services${q({ query: input.query, category: input.category, maxUsdPrice: input.maxUsdPrice === undefined ? undefined : String(input.maxUsdPrice), environment: this.env(input.environment) })}`),
    cctpFees: (destination: string, forward = false, environment?: ArcEnvironment) => this.request<unknown>("GET", `/v1/circle/cctp/fees${q({ destination, forward: forward ? "true" : undefined, environment: this.env(environment) })}`),
    cctpForward: (input: { owner: Address; destination: string; amount: string; recipient?: Address; fast?: boolean; environment?: ArcEnvironment }) => this.request<{ transactions: UnsignedTransaction[]; maxFee: string; burn: string }>("POST", "/v1/circle/cctp/forward", { ...input, environment: this.env(input.environment) }),
    gatewayDraft: (input: { owner: Address; destination: string; amount: string; recipient?: Address; environment?: ArcEnvironment }) => this.request<GatewayTransferDraft>("POST", "/v1/circle/gateway/transfer/draft", { ...input, environment: this.env(input.environment) }),
    gatewayTransfer: (input: { destination: string; burnIntents: readonly unknown[]; signatures: readonly `0x${string}`[]; environment?: ArcEnvironment }) => this.request<GatewayTransferResult>("POST", "/v1/circle/gateway/transfer", { ...input, environment: this.env(input.environment) }),
    /** Reads a service's 402, checks the price and payee against the Fence and returns EIP-3009 typed data to sign. */
    x402Prepare: (input: { resource: string; owner: Address; method?: "GET" | "POST"; signer?: "wallet" | "agent"; fence?: Fence; environment?: ArcEnvironment }) => this.request<{ paymentId: string | null; priceUsdc: string; verdict: FenceVerdict; typedData: unknown }>("POST", "/v1/circle/x402/prepare", { ...input, environment: this.env(input.environment) }),
    x402Pay: (paymentId: string, signature: `0x${string}`, body?: string) => this.request<{ paid: boolean; status: number; settlement: unknown; body: string }>("POST", "/v1/circle/x402/pay", { paymentId, signature, ...(body ? { body } : {}) }),
    screen: (address: Address, environment?: ArcEnvironment) => this.request<unknown>("POST", "/v1/circle/screen", { address, environment: this.env(environment) }),
  };

  /* ------------------------------------------------------ auth + devs */

  readonly auth = {
    nonce: (address?: Address, chainId?: number) => this.request<SiweNonceResponse>("POST", "/v1/auth/nonce", { ...(address ? { address } : {}), ...(chainId ? { chainId } : {}) }),
    /** Verifies a signed EIP-4361 message and keeps the session on this client. */
    verify: async (message: string, signature: `0x${string}`) => {
      const view = await this.request<SessionView>("POST", "/v1/auth/verify", { message, signature });
      this.session = view.token;
      return view;
    },
    logout: async () => {
      await this.request<unknown>("POST", "/v1/auth/logout", {});
      this.session = undefined;
    },
  };

  readonly developers = {
    register: (name: string, website?: string) => this.request<unknown>("POST", "/v1/developers/register", { name, ...(website ? { website } : {}) }),
    keys: () => this.request<{ keys: ApiKeyView[] }>("GET", "/v1/developers/keys"),
    createKey: (input: { label: string; kind?: "secret" | "publishable"; scopes?: string[]; allowedOrigins?: string[] }) => this.request<CreatedApiKey>("POST", "/v1/developers/keys", input),
    revokeKey: (id: string) => this.request<ApiKeyView>("POST", `/v1/developers/keys/${id}/revoke`, {}),
    createWebhook: (url: string, events?: readonly WebhookEvent[]) => this.request<WebhookEndpointView>("POST", "/v1/developers/webhooks", { url, ...(events ? { events } : {}) }),
  };
}

function backoff(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 4_000) + Math.floor(Math.random() * 100);
}

function q(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined);
  return entries.length === 0 ? "" : `?${new URLSearchParams(entries).toString()}`;
}
