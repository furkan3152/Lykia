/**
 * Circle Compliance Engine address screening (needs CIRCLE_API_KEY). A
 * DENIED address becomes a Fence deny for that recipient. Without a key
 * nothing is screened and nothing is claimed.
 * https://developers.circle.com/wallets/compliance-engine/tx-screening-quickstart
 */
import { randomUUID } from "node:crypto";
import type { ArcEnvironment } from "@lykia/core";
import type { FetchLike } from "../health/dependencies.js";

export interface ScreeningResult {
  readonly address: string;
  readonly result: "APPROVED" | "DENIED" | "UNKNOWN";
  readonly ruleName: string | null;
  readonly riskScore: string | null;
  readonly checkedAt: number;
}

const CACHE = new Map<string, ScreeningResult>();
const TTL_MS = 60 * 60_000;

export async function screenAddress(fetchImpl: FetchLike, apiKey: string, environment: ArcEnvironment, address: string, now: number): Promise<ScreeningResult> {
  const key = `${environment}:${address.toLowerCase()}`;
  const hit = CACHE.get(key);
  if (hit && now - hit.checkedAt < TTL_MS) return hit;
  const response = await fetchImpl("https://api.circle.com/v1/w3s/compliance/screening/addresses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: randomUUID(), address, chain: environment === "mainnet" ? "ARC" : "ARC-TESTNET" }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return { address, result: "UNKNOWN", ruleName: null, riskScore: null, checkedAt: now };
  const json = (await response.json()) as { data?: { result?: string; decision?: { ruleName?: string; reasons?: { riskScore?: string }[] } } };
  const data = json.data ?? (json as { result?: string; decision?: { ruleName?: string; reasons?: { riskScore?: string }[] } });
  const result: ScreeningResult = {
    address,
    result: data.result === "DENIED" ? "DENIED" : data.result === "APPROVED" ? "APPROVED" : "UNKNOWN",
    ruleName: data.decision?.ruleName ?? null,
    riskScore: data.decision?.reasons?.[0]?.riskScore ?? null,
    checkedAt: now,
  };
  CACHE.set(key, result);
  return result;
}
