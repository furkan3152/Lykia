/**
 * The Lykia client: every module of the SDK on one transport. Typed with
 * the API's own contract types from @lykia/core. Retries rate limits and
 * transient failures with backoff (GETs always; POSTs only when the server
 * never processed them: 429, 502, 503, 504, or a network error before a
 * response), sends an Idempotency-Key on every POST, streams SSE as async
 * iterators and emits typed client events (`client.on("plan-created", ...)`).
 *
 * Apps that need one part import it alone: `@lykia/sdk/intents`,
 * `/fence`, `/agents`, `/circle`, `/ecosystem`, `/projects`.
 */
import type { Address } from "@lykia/core";
import type { ApiKeyView, CreatedApiKey, SessionView, SiweNonceResponse, WebhookEndpointView, WebhookEvent } from "@lykia/core/api/platform";
import type { Contact, LykiaProfile } from "@lykia/core";
import type { ContactsResponse, MemoryExport, MemoryIntentsResponse, MemoryView } from "@lykia/core/api/memory";
import type { ProfileResponse } from "@lykia/core/api/profile";
import { agentApi, agentsApi, ordersApi, packApi, standingApi, type PackAccountResponse } from "./agents.js";
import { leashesApi } from "./leashes.js";
import { automationsApi } from "./automations.js";
import { invoicesApi } from "./invoices.js";
import { payoutsApi } from "./payouts.js";
import { circleApi } from "./circle.js";
import { ecosystemApi } from "./ecosystem.js";
import { fenceApi } from "./fence.js";
import { intentsApi } from "./intents.js";
import { projectsApi } from "./projects.js";
import { aggregatorApi } from "./aggregator.js";
import { buildApi } from "./build.js";
import { integrationsApi } from "./integrations.js";
import { dataApi } from "./data.js";
import { platformApi } from "./platform.js";
import { LykiaTransport, q, type FetchLike, type LykiaOptions, type RequestOptions } from "./transport.js";

export type { FetchLike, LykiaOptions, RequestOptions, PackAccountResponse };

/** GET /v1/fees. */
export interface FeesResponse {
  readonly bps: number;
  readonly percent: string;
  readonly recipient: Address;
  readonly maxBps: number;
  readonly policy: string;
  readonly exempt: readonly string[];
}

export class Lykia extends LykiaTransport {
  constructor(options: LykiaOptions = {}) {
    super(options);
  }

  /** Lykia's protocol fee: bps, recipient, policy and the exempt step kinds. */
  fees(): Promise<FeesResponse> {
    return this.request<FeesResponse>("GET", "/v1/fees");
  }

  /** Reads: networks, venues, the Flock and Scent. */
  readonly arc = (() => {
    const e = ecosystemApi(this);
    return { networks: e.networks, venues: e.venues, flock: e.flock, scent: e.scent };
  })();
  readonly ecosystem = ecosystemApi(this);
  readonly fence = fenceApi(this);
  readonly intents = intentsApi(this);
  readonly agent = agentApi(this);
  readonly pack = packApi(this);
  /** Leashes: a budget an outside agent cannot exceed (create, list, get, revoke, renew, trail; plan and submit with the leash key). */
  readonly leashes = leashesApi(this);
  readonly standing = standingApi(this);
  readonly orders = ordersApi(this);
  readonly circle = circleApi(this);
  readonly projects = projectsApi(this);
  /** Best execution on Arc: quote any action, then build ready-to-sign calls. */
  readonly aggregator = aggregatorApi(this);
  /** One builder per action type: build.swap, build.deposit, build.bridge, ... */
  readonly build = buildApi(this);
  /** Adapter manifests, generic contracts and AI routing. */
  readonly integrations = integrationsApi(this);
  /** Tokens, prices, protocols, portfolios, screening and transaction explanations. */
  readonly data = dataApi(this);
  /** Developer flows: batch payouts, invoices and payment links, agents over the API and unified automations. */
  readonly payouts = payoutsApi(this);
  readonly invoices = invoicesApi(this);
  readonly agents = agentsApi(this);
  readonly automations = automationsApi(this);
  /** Keys, webhooks, events, logs, usage, billing and versions. */
  readonly platform = platformApi(this);

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
