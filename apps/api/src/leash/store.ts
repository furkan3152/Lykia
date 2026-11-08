/**
 * Leash records and the gate's rule for leash keys.
 *
 *   leashes          lsh_<12 hex> -> Leash
 *   leash_owners     <owner>:<id> -> { id }            (an owner's leashes in one prefix scan)
 *   leash_actions    <id>:<inverted ms>:<rand> -> LeashAction   (newest first)
 *   leash_steps      <id>:<intentId>:<stepId> -> the prepared session transaction
 *   leash_marks      webhook de-duplication (thresholds, expiring)
 *   leash_spend      counters: <id>:d:<UTC day> and <id>:t, USD micro-dollars
 *   leash_stiles     <environment>:<owner> -> the owner's LykiaStile (Gateway leashes)
 */
import type { Address, Leash, LeashDenyReason, UnsignedTransaction } from "@lykia/core";
import type { Hex } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "../platform/typed.js";

export const LEASH_RECORD_TTL_MS = 400 * 86_400_000;

export const leashes = (ctx: AppContext) => typedCollection<Leash>(ctx, "leashes");
export const leashOwners = (ctx: AppContext) => typedCollection<{ readonly id: string }>(ctx, "leash_owners");
export const leashActions = (ctx: AppContext) => typedCollection<LeashAction>(ctx, "leash_actions");
export const leashSteps = (ctx: AppContext) => typedCollection<LeashStep>(ctx, "leash_steps");
export const leashMarks = (ctx: AppContext) => ctx.store.collection<{ readonly at: number }>("leash_marks");
export const leashSpend = (ctx: AppContext) => ctx.store.counters("leash_spend");
/** The owner's LykiaStile per environment: `<environment>:<owner>` -> its address (predicted until bound). */
export const typedStiles = (ctx: AppContext) => typedCollection<{ readonly address: Address; readonly predicted: boolean; readonly at: string }>(ctx, "leash_stiles");

export interface LeashAction {
  readonly at: string;
  readonly kind: "planned" | "denied" | "submitted" | "settled" | "failed";
  readonly summary: string;
  readonly intentId?: string;
  readonly stepId?: string;
  readonly verdictDigest?: string;
  readonly decision?: "allow" | "confirm" | "deny";
  readonly reasons?: readonly LeashDenyReason[];
  readonly usd?: string | null;
  readonly txHash?: `0x${string}`;
}

export interface LeashStep {
  readonly leashId: string;
  readonly intentId: string;
  readonly stepId: string;
  readonly transaction: UnsignedTransaction;
  readonly verdictDigest: string;
  readonly usd: string | null;
  readonly summary: string;
  readonly preparedAt: string;
  readonly txHash?: `0x${string}`;
  /** reserved: a Gateway leash's reservation is on chain, Gateway has not attested it yet. */
  readonly status: "prepared" | "submitted" | "reserved" | "settled" | "failed";
  /** Gateway leashes: the burn intents reserved on the Stile and what Gateway answered. */
  readonly gateway?: {
    readonly intents: readonly { readonly maxBlockHeight: string; readonly maxFee: string; readonly spec: import("./stile.js").SpecMessage }[];
    readonly digest: Hex;
    readonly signature: Hex;
    readonly transferSpecHash: Hex;
    readonly destination: string;
    readonly forward: boolean;
    readonly transferId?: string | null;
    readonly attestation?: Hex | null;
  };
}

export const LEASH_ID = /^lsh_[a-f0-9]{12}$/u;

/** What a leash key may call, relative to /v1. */
function allowedRoute(leashId: string, method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (path === "/mcp") return m === "POST" || m === "GET" || m === "DELETE";
  const own = `/leashes/${leashId}`;
  if (m === "GET" || m === "HEAD") return path === own || path === `${own}/trail`;
  if (m === "POST") return path === `${own}/plan` || path === `${own}/submit`;
  return false;
}

/**
 * The gate's check for a leash key: the leash must exist and be alive, and
 * the route must be one of its own. Anything else is refused, whatever
 * scopes the key's record lists.
 */
export async function assertLeashKeyAllowed(ctx: AppContext, leashId: string, method: string, path: string): Promise<void> {
  const leash = (await leashes(ctx).get(leashId))?.value;
  if (!leash) throw new LykiaHttpError("UNAUTHORIZED", 401, "This leash key belongs to no leash.");
  if (leash.status === "revoked") throw new LykiaHttpError("LEASH_REVOKED", 403, "This leash was revoked; its key no longer works.", { leashId });
  if (leash.status === "expired" || Date.parse(leash.expiresAt) <= ctx.clock.now()) throw new LykiaHttpError("LEASH_EXPIRED", 403, "This leash has expired; its key no longer works.", { leashId, expiresAt: leash.expiresAt });
  if (!allowedRoute(leashId, method, path)) throw new LykiaHttpError("LEASH_KEY_SCOPE", 403, "A leash key can only plan, submit and read inside its own leash (and use MCP with the leash's tools).", { leashId, allowed: [`GET /v1/leashes/${leashId}`, `GET /v1/leashes/${leashId}/trail`, `POST /v1/leashes/${leashId}/plan`, `POST /v1/leashes/${leashId}/submit`, "POST /v1/mcp"] });
}
