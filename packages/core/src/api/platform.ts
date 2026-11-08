/** Contract types: sign-in, developer keys, webhooks and the admin console. */

export const SESSION_HEADER = "Lykia-Session" as const;
export const API_KEY_HEADER = "Lykia-Key" as const;
export const WEBHOOK_SIGNATURE_HEADER = "Lykia-Signature" as const;

export type SessionRole = "user" | "developer" | "admin";

export interface SiweNonceResponse {
  readonly nonce: string;
  readonly expiresAt: string;
  readonly domain: string;
  readonly uri: string;
  readonly chainIds: readonly number[];
  readonly statement: string;
  /** A ready EIP-4361 message when address and chainId were given. */
  readonly message: string | null;
}

export interface SessionView {
  readonly token: string;
  readonly address: string;
  readonly roles: readonly SessionRole[];
  readonly expiresAt: string;
}

export const API_VERSION_HEADER = "Lykia-Version" as const;
export const IDEMPOTENCY_HEADER = "Idempotency-Key" as const;

/**
 * Key scopes. The first four are the original (legacy) scopes and keep
 * working exactly as before; the fine-grained ones below are what new keys
 * use. Legacy scopes imply fine-grained ones (see LEGACY_SCOPE_IMPLIES).
 */
export type LegacyApiKeyScope = "read" | "plan" | "agents" | "webhooks";
export type FineApiKeyScope = "read" | "quote" | "build" | "execute" | "agents" | "automation" | "payouts" | "admin";
export type ApiKeyScope = LegacyApiKeyScope | FineApiKeyScope;
/** The legacy scope list (the default of keys created before fine-grained scopes). */
export const API_KEY_SCOPES: readonly LegacyApiKeyScope[] = ["read", "plan", "agents", "webhooks"];
export const FINE_API_KEY_SCOPES: readonly FineApiKeyScope[] = ["read", "quote", "build", "execute", "agents", "automation", "payouts", "admin"];
/** Every scope a key may be created with. */
export const ALL_API_KEY_SCOPES: readonly ApiKeyScope[] = ["read", "quote", "build", "execute", "agents", "automation", "payouts", "admin", "plan", "webhooks"];
export const SCOPE_DESCRIPTIONS: Readonly<Record<ApiKeyScope, string>> = {
  read: "Every GET: networks, venues, the Flock, Scent, intents, logs and usage.",
  quote: "Quotes and checks that move nothing: route search, quotes, Fence evaluate and validate, sentence parsing.",
  build: "Plans and unsigned transactions: create intents, prepare steps, Tag drafts, MCP.",
  execute: "Record signed transactions and control running plans: submit, stop.",
  agents: "The Pack and Lyko's agent: spawn, revoke, chat.",
  automation: "Standing orders, limit orders, alerts and agent automations.",
  payouts: "Business money movement: payouts, invoices and treasury flows.",
  admin: "Account settings: keys, webhooks, projects, billing.",
  plan: "Legacy: implies quote, build and execute.",
  webhooks: "Legacy: manage webhook endpoints.",
};
/** What a legacy scope grants in fine-grained terms. */
export const LEGACY_SCOPE_IMPLIES: Readonly<Record<LegacyApiKeyScope, readonly ApiKeyScope[]>> = {
  read: ["read"],
  plan: ["plan", "quote", "build", "execute"],
  agents: ["agents", "automation"],
  webhooks: ["webhooks"],
};
/** Secret keys created without explicit scopes get these. */
export const DEFAULT_SECRET_SCOPES: readonly FineApiKeyScope[] = ["read", "quote", "build", "execute", "agents", "automation"];
/** Publishable (browser) keys may never hold more than these. */
export const PUBLISHABLE_SCOPES: readonly FineApiKeyScope[] = ["read", "quote", "build"];

/** live keys may use mainnet and testnet; test keys are locked to testnet. */
export type ApiKeyMode = "live" | "test";

export interface ApiKeyView {
  readonly id: string;
  readonly label: string;
  /** "lk_live_ab12…" style prefix; the secret itself is shown once at creation. */
  readonly prefix: string;
  readonly kind: "secret" | "publishable";
  readonly scopes: readonly ApiKeyScope[];
  readonly allowedOrigins: readonly string[];
  readonly perMinute: number;
  readonly perDay: number;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
  /** The project a publishable key belongs to; its origins come from the project's verified origins. */
  readonly projectId?: string;
  /** "test" keys (lk_test_…) can never touch mainnet. Absent on legacy keys (lk_sk_…), which behave as live. */
  readonly mode?: ApiKeyMode;
  /** Exact IPs or CIDR ranges the key may be used from; empty means any. */
  readonly allowedIps?: readonly string[];
  /** The API version this key is pinned to (overridable per request with Lykia-Version). */
  readonly apiVersion?: string;
  /** During a rotation overlap, the old secret keeps working until this time. */
  readonly previousSecretExpiresAt?: string | null;
  /** Leash keys (lk_leash_…): the one leash the key acts in. */
  readonly leashId?: string;
}

export interface CreatedApiKey extends ApiKeyView {
  /** The full key; returned once. */
  readonly secret: string;
}

/** Event names from before the catalogue; each is an alias of a catalogue event. */
export type LegacyWebhookEvent = "intent.step.settled" | "intent.settled" | "pack.agent.spawned" | "pack.agent.revoked" | "whistle.blown" | "standing_order.fired" | "alert.fired" | "order.executed";
export type CatalogueWebhookEvent =
  | "intent.planned"
  | "intent.settled"
  | "step.prepared"
  | "step.settled"
  | "step.failed"
  | "agent.spawned"
  | "agent.revoked"
  | "agent.whistle"
  | "standing.fired"
  | "order.filled"
  | "alert.fired"
  | "payout.created"
  | "payout.sent"
  | "payout.failed"
  | "invoice.created"
  | "invoice.paid"
  | "security.blocked"
  | "key.rotated"
  | "leash.budget.threshold"
  | "leash.expiring"
  | "leash.revoked"
  | "leash.denied"
  | "test.ping";
export type WebhookEvent = LegacyWebhookEvent | CatalogueWebhookEvent;

export interface WebhookEventInfo {
  readonly type: CatalogueWebhookEvent;
  readonly group: "intents" | "agents" | "automation" | "payouts" | "security" | "platform";
  readonly description: string;
  /** Older names that subscribe to the same event. */
  readonly aliases: readonly LegacyWebhookEvent[];
}

export const WEBHOOK_EVENT_CATALOGUE: readonly WebhookEventInfo[] = [
  { type: "intent.planned", group: "intents", description: "A plan was created and checked against the Fence.", aliases: [] },
  { type: "intent.settled", group: "intents", description: "Every step of a plan is final on chain.", aliases: [] },
  { type: "step.prepared", group: "intents", description: "A step's unsigned transactions are ready to sign.", aliases: [] },
  { type: "step.settled", group: "intents", description: "A step's transactions are final on chain.", aliases: ["intent.step.settled"] },
  { type: "step.failed", group: "intents", description: "A step reverted or could not be completed.", aliases: [] },
  { type: "agent.spawned", group: "agents", description: "An agent joined the Pack.", aliases: ["pack.agent.spawned"] },
  { type: "agent.revoked", group: "agents", description: "An agent (and its sub-agents) was revoked.", aliases: ["pack.agent.revoked"] },
  { type: "agent.whistle", group: "agents", description: "The Whistle was blown: all new risk is stopped.", aliases: ["whistle.blown"] },
  { type: "standing.fired", group: "automation", description: "A standing order or automation produced a plan.", aliases: ["standing_order.fired"] },
  { type: "order.filled", group: "automation", description: "A limit order was executed.", aliases: ["order.executed"] },
  { type: "alert.fired", group: "automation", description: "An alert rule matched.", aliases: [] },
  { type: "payout.created", group: "payouts", description: "A payout was created.", aliases: [] },
  { type: "payout.sent", group: "payouts", description: "A payout settled on chain.", aliases: [] },
  { type: "payout.failed", group: "payouts", description: "A payout failed.", aliases: [] },
  { type: "invoice.created", group: "payouts", description: "An invoice was issued.", aliases: [] },
  { type: "invoice.paid", group: "payouts", description: "An invoice was paid in full.", aliases: [] },
  { type: "security.blocked", group: "security", description: "The Fence or the security layer denied a move.", aliases: [] },
  { type: "leash.budget.threshold", group: "agents", description: "A leash used 50, 80 or 100% of its daily or total budget.", aliases: [] },
  { type: "leash.expiring", group: "agents", description: "A leash expires within 24 hours.", aliases: [] },
  { type: "leash.revoked", group: "agents", description: "A leash was revoked: its key stopped working at once.", aliases: [] },
  { type: "leash.denied", group: "agents", description: "A leashed agent asked for something outside its leash; the reasons and the remaining budget are included.", aliases: [] },
  { type: "key.rotated", group: "platform", description: "An API key was rotated.", aliases: [] },
  { type: "test.ping", group: "platform", description: "A test event sent from the portal, the CLI or the API.", aliases: [] },
];

/** Every event name an endpoint may subscribe to (catalogue names and legacy aliases). */
export const WEBHOOK_EVENTS: readonly WebhookEvent[] = [
  ...WEBHOOK_EVENT_CATALOGUE.map((e) => e.type),
  ...WEBHOOK_EVENT_CATALOGUE.flatMap((e) => e.aliases),
];

export interface WebhookEndpointView {
  readonly id: string;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  readonly createdAt: string;
  readonly disabled: boolean;
  /** Shown once at creation; later views omit it. */
  readonly secret?: string;
}

export interface WebhookAttempt {
  readonly at: string;
  readonly statusCode: number | null;
  readonly durationMs: number;
  readonly error: string | null;
}

export interface WebhookDelivery {
  readonly id: string;
  readonly endpointId: string;
  readonly event: WebhookEvent;
  readonly attempts: number;
  readonly status: "pending" | "delivered" | "failed";
  readonly lastStatusCode: number | null;
  readonly nextAttemptAt: string | null;
  readonly createdAt: string;
  /** The event id (evt_…); a replay keeps it so receivers can deduplicate. */
  readonly eventId?: string;
  /** Set on replays: the delivery this one repeats. */
  readonly replayOf?: string | null;
  readonly attemptLog?: readonly WebhookAttempt[];
}

/** The JSON body of every webhook delivery. */
export interface WebhookEnvelope<T = unknown> {
  readonly id: string;
  /** The catalogue name. */
  readonly type: CatalogueWebhookEvent | string;
  /** The name the endpoint subscribed to (equals type unless a legacy alias was used). */
  readonly event: string;
  readonly createdAt: string;
  readonly owner: string | null;
  readonly project: string | null;
  readonly livemode: boolean;
  readonly apiVersion: string;
  readonly data: T;
}

/* ------------------------------------------------------------ versions */

/** Dated API versions, oldest first. Send `Lykia-Version: <date>`; keys are pinned to the latest at creation. */
export const API_VERSIONS: readonly string[] = ["2026-06-01", "2026-11-01"];
export const LATEST_API_VERSION = "2026-11-01" as const;

/* --------------------------------------------------------- plans/billing */

export type BillingPlanId = "free" | "payg" | "enterprise";

export interface BillingPlan {
  readonly id: BillingPlanId;
  readonly name: string;
  readonly summary: string;
  /** Requests per calendar month included at no cost. */
  readonly includedRequests: number;
  /** USDC (6-decimal units, as a string) per request above the included amount; null when usage stops at the quota. */
  readonly overageUnitsPerRequest: string | null;
  readonly perMinute: number;
  readonly perDay: number;
  readonly logRetentionDays: number;
  readonly webhookEndpoints: number;
}

export const BILLING_PLANS: readonly BillingPlan[] = [
  { id: "free", name: "Free", summary: "Sandbox and small apps. Stops at the monthly quota.", includedRequests: 100_000, overageUnitsPerRequest: null, perMinute: 120, perDay: 20_000, logRetentionDays: 7, webhookEndpoints: 10 },
  { id: "payg", name: "Pay as you go", summary: "Production. Usage above the free quota is paid in USDC on Arc, per call over x402 or from prepaid credits.", includedRequests: 100_000, overageUnitsPerRequest: "200", perMinute: 600, perDay: 500_000, logRetentionDays: 30, webhookEndpoints: 25 },
  { id: "enterprise", name: "Enterprise", summary: "Custom limits, retention and support; set up with the Lykia team.", includedRequests: 10_000_000, overageUnitsPerRequest: "100", perMinute: 6_000, perDay: 5_000_000, logRetentionDays: 90, webhookEndpoints: 100 },
];

export interface RequestLogEntry {
  readonly requestId: string;
  readonly at: string;
  readonly method: string;
  readonly path: string;
  /** The route template, e.g. /v1/intents/:id. */
  readonly route: string | null;
  readonly status: number;
  readonly latencyMs: number;
  readonly errorCode: string | null;
  readonly keyId: string | null;
  readonly projectId: string | null;
  readonly mode: ApiKeyMode | null;
  readonly apiVersion: string;
  readonly idempotentReplay: boolean;
}

export interface EndpointUsage {
  readonly endpoint: string;
  readonly requests: number;
  readonly errors: number;
  readonly avgLatencyMs: number;
}

export interface BillingUsageView {
  readonly plan: BillingPlanId;
  readonly month: string;
  readonly requests: number;
  readonly includedRequests: number;
  readonly overageRequests: number;
  /** USDC units charged this month for overage. */
  readonly overageUnits: string;
  readonly creditsUnits: string;
  readonly days: readonly { readonly day: string; readonly requests: number; readonly errors: number }[];
  readonly endpoints: readonly (EndpointUsage & { readonly day: string })[];
}

export interface DeveloperSettings {
  /** Integrator fee in basis points, at most MAX_INTEGRATOR_FEE_BPS. */
  readonly integratorFeeBps: number;
  readonly feeRecipient: string | null;
}

export { MAX_INTEGRATOR_FEE_BPS } from "../fee.js";

export interface UsageView {
  readonly today: number;
  readonly last7Days: readonly { readonly day: string; readonly requests: number }[];
  readonly byKey: readonly { readonly keyId: string; readonly today: number }[];
}

export interface DeploymentRecord {
  readonly id: string;
  readonly environment: "mainnet" | "testnet";
  /** Artifact name. */
  readonly contract: string;
  /** Plan step name (PracticeVaultUSDC); equals the contract when it is deployed once. */
  readonly name: string;
  readonly address: string;
  readonly txHash: string;
  readonly blockNumber: string;
  /** The wallet that sent the creation transaction (shown as the creator on explorers). */
  readonly creator: string;
  /** Keccak of the runtime code read from the chain. */
  readonly codeHash: string;
  /** Keccak of the artifact's runtime code with immutables zeroed, or null without an artifact. */
  readonly expectedCodeHash: string | null;
  readonly verified: boolean;
  readonly recordedBy: string;
  readonly recordedAt: string;
}

export type FeatureFlag = "agents.llm" | "agents.keeper" | "pack.onchain" | "x402" | "developer.signup" | "routing.halt";
export const FEATURE_FLAGS: readonly FeatureFlag[] = ["agents.llm", "agents.keeper", "pack.onchain", "x402", "developer.signup", "routing.halt"];
