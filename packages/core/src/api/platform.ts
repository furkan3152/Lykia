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

export type ApiKeyScope = "read" | "plan" | "agents" | "webhooks";
export const API_KEY_SCOPES: readonly ApiKeyScope[] = ["read", "plan", "agents", "webhooks"];

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
}

export interface CreatedApiKey extends ApiKeyView {
  /** The full key; returned once. */
  readonly secret: string;
}

export type WebhookEvent = "intent.step.settled" | "intent.settled" | "pack.agent.spawned" | "pack.agent.revoked" | "whistle.blown" | "standing_order.fired";
export const WEBHOOK_EVENTS: readonly WebhookEvent[] = ["intent.step.settled", "intent.settled", "pack.agent.spawned", "pack.agent.revoked", "whistle.blown", "standing_order.fired"];

export interface WebhookEndpointView {
  readonly id: string;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  readonly createdAt: string;
  readonly disabled: boolean;
  /** Shown once at creation; later views omit it. */
  readonly secret?: string;
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
}

export interface DeveloperSettings {
  /** Integrator fee in basis points, at most MAX_INTEGRATOR_FEE_BPS. */
  readonly integratorFeeBps: number;
  readonly feeRecipient: string | null;
}

export const MAX_INTEGRATOR_FEE_BPS = 50;

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

export type FeatureFlag = "agents.llm" | "agents.keeper" | "pack.onchain" | "x402" | "developer.signup";
export const FEATURE_FLAGS: readonly FeatureFlag[] = ["agents.llm", "agents.keeper", "pack.onchain", "x402", "developer.signup"];
