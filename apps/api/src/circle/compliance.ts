/**
 * Circle Compliance Engine address screening (needs CIRCLE_API_KEY with
 * Compliance Engine access, which Circle grants to eligible customers). A
 * DENIED address becomes a Fence deny for that recipient. Without a key
 * nothing is screened and nothing is claimed; when a screening cannot be
 * completed the result is UNKNOWN with the reason, never APPROVED.
 *
 * Chain code: Circle Wallets name Arc `ARC` / `ARC-TESTNET`, but the
 * Compliance Engine's published chain enum does not list Arc yet
 * (developers.circle.com/api-reference/wallets/compliance/screen-address).
 * Lykia asks for Arc first; if Circle refuses the chain (400), it screens the
 * same EVM address as `ETH` / `ETH-SEPOLIA` (an EVM address is the same
 * account on every EVM chain) and says so in `screenedAs`.
 * https://developers.circle.com/wallets/compliance-engine/tx-screening
 */
import { randomUUID } from "node:crypto";
import type { ArcEnvironment } from "@lykia/core";
import type { FetchLike } from "../health/dependencies.js";

export const COMPLIANCE_URL = "https://api.circle.com/v1/w3s/compliance/screening/addresses";

export interface ScreeningResult {
  readonly address: string;
  readonly result: "APPROVED" | "DENIED" | "UNKNOWN";
  readonly ruleName: string | null;
  readonly riskScore: string | null;
  /** Actions Circle's matched rule asks for (e.g. DENY, REVIEW, FREEZE_WALLET). */
  readonly actions: readonly string[];
  /** The chain code the screening ran under (null when it did not run). */
  readonly screenedAs: string | null;
  /** Why the result is UNKNOWN (no access, upstream error); null otherwise. */
  readonly reason: string | null;
  readonly checkedAt: number;
}

const CACHE = new Map<string, ScreeningResult>();
const TTL_MS = 60 * 60_000;

type Body = { result?: string; decision?: { ruleName?: string; actions?: string[]; reasons?: { riskScore?: string }[] } };

async function screenAs(fetchImpl: FetchLike, apiKey: string, address: string, chain: string): Promise<{ status: number; body: Body | null }> {
  const response = await fetchImpl(COMPLIANCE_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: randomUUID(), address, chain }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return { status: response.status, body: null };
  const json = (await response.json()) as { data?: Body } & Body;
  return { status: response.status, body: json.data ?? json };
}

export function resetScreeningCache(): void {
  CACHE.clear();
}

export async function screenAddress(fetchImpl: FetchLike, apiKey: string, environment: ArcEnvironment, address: string, now: number): Promise<ScreeningResult> {
  const key = `${environment}:${address.toLowerCase()}`;
  const hit = CACHE.get(key);
  if (hit && now - hit.checkedAt < TTL_MS) return hit;
  const unknown = (reason: string, screenedAs: string | null = null): ScreeningResult => ({ address, result: "UNKNOWN", ruleName: null, riskScore: null, actions: [], screenedAs, reason, checkedAt: now });
  const chains = environment === "mainnet" ? ["ARC", "ETH"] : ["ARC-TESTNET", "ETH-SEPOLIA"];
  let last: { status: number; body: Body | null } = { status: 0, body: null };
  let chain: string | null = null;
  for (const candidate of chains) {
    try {
      last = await screenAs(fetchImpl, apiKey, address, candidate);
    } catch (error) {
      return unknown(`Circle Compliance Engine unreachable: ${error instanceof Error ? error.message.slice(0, 80) : "network error"}`);
    }
    chain = candidate;
    // Only an unsupported-chain style refusal (400) moves on to the EVM fallback.
    if (last.status !== 400) break;
  }
  if (!last.body) {
    if (last.status === 401 || last.status === 403) return unknown("CIRCLE_API_KEY has no Compliance Engine access (Circle enables it for eligible customers).", chain);
    return unknown(`Circle Compliance Engine answered ${last.status}.`, chain);
  }
  const data = last.body;
  const result: ScreeningResult = {
    address,
    result: data.result === "DENIED" ? "DENIED" : data.result === "APPROVED" ? "APPROVED" : "UNKNOWN",
    ruleName: data.decision?.ruleName ?? null,
    riskScore: data.decision?.reasons?.[0]?.riskScore ?? null,
    actions: Array.isArray(data.decision?.actions) ? data.decision.actions.filter((a): a is string => typeof a === "string") : [],
    screenedAs: chain,
    reason: data.result === "DENIED" || data.result === "APPROVED" ? null : "Circle returned no screening result.",
    checkedAt: now,
  };
  if (result.result !== "UNKNOWN") CACHE.set(key, result);
  return result;
}
