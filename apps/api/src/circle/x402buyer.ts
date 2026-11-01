/**
 * Paying for x402 services from Arc (the buyer side). Lykia fetches the
 * resource, reads its 402 payment requirements, checks the price and payee
 * against the owner's Fence, and hands back EIP-3009 typed data for the
 * owner's (or agent's) wallet to sign. With the signature, Lykia retries the
 * request with the payment header and returns what the service answered.
 * Lykia never signs and never pays on its own.
 */
import { randomBytes } from "node:crypto";
import { contractAddress, type Address, type ArcEnvironment } from "@lykia/core";
import type { Hex } from "viem";
import type { FetchLike } from "../health/dependencies.js";
import { LykiaHttpError } from "../http/errors.js";
import { assertPublicUrl, type HostResolver } from "../http/netguard.js";
import { ARC_NETWORKS } from "./discovery.js";

export interface PaymentRequirement {
  readonly scheme: string;
  readonly network: string;
  readonly asset: string;
  readonly payTo: Address;
  readonly amount: string;
  readonly maxTimeoutSeconds: number;
  readonly extra?: Record<string, unknown>;
}

export interface ParsedChallenge {
  readonly x402Version: number;
  readonly accepts: readonly PaymentRequirement[];
  readonly resource: string;
}

function decodeB64Json(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

/** Reads a 402 answer: v2 carries requirements in the PAYMENT-REQUIRED header, v1 in the JSON body. */
export async function readChallenge(response: Response, resource: string): Promise<ParsedChallenge> {
  const header = response.headers.get("payment-required");
  const raw: unknown = header ? decodeB64Json(header) : await response.json().catch(() => null);
  const obj = (raw ?? {}) as { x402Version?: number; accepts?: Record<string, unknown>[] };
  const accepts = (obj.accepts ?? []).map((a) => ({
    scheme: String(a.scheme ?? ""),
    network: String(a.network ?? ""),
    asset: String(a.asset ?? ""),
    payTo: String(a.payTo ?? "") as Address,
    amount: String(a.amount ?? a.maxAmountRequired ?? "0"),
    maxTimeoutSeconds: Number(a.maxTimeoutSeconds ?? 60),
    ...(a.extra && typeof a.extra === "object" ? { extra: a.extra as Record<string, unknown> } : {}),
  }));
  return { x402Version: obj.x402Version ?? (header ? 2 : 1), accepts, resource };
}

/** The Arc "exact" USDC option, if the service offers one on this environment. */
export function arcRequirement(challenge: ParsedChallenge, environment: ArcEnvironment): PaymentRequirement | null {
  const usdc = (contractAddress("usdc", environment) as string).toLowerCase();
  return challenge.accepts.find((a) => a.scheme === "exact" && a.network === ARC_NETWORKS[environment] && a.asset.toLowerCase() === usdc && /^\d+$/u.test(a.amount)) ?? null;
}

export function authorizationTypedData(input: { environment: ArcEnvironment; from: Address; requirement: PaymentRequirement; now: number; nonce?: Hex }) {
  const chainId = input.environment === "mainnet" ? 5042 : 5042002;
  const validAfter = Math.floor(input.now / 1000) - 30;
  const validBefore = Math.floor(input.now / 1000) + Math.min(Math.max(input.requirement.maxTimeoutSeconds, 30), 600);
  const message = { from: input.from, to: input.requirement.payTo, value: input.requirement.amount, validAfter: String(validAfter), validBefore: String(validBefore), nonce: input.nonce ?? (`0x${randomBytes(32).toString("hex")}` as Hex) };
  return {
    domain: { name: String(input.requirement.extra?.name ?? "USDC"), version: String(input.requirement.extra?.version ?? "2"), chainId, verifyingContract: contractAddress("usdc", input.environment) as Address },
    types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization" as const,
    message,
  };
}

/** The payment header for a signed authorization (x402 v2 PAYMENT-SIGNATURE, v1 X-PAYMENT). */
export function paymentHeader(version: number, requirement: PaymentRequirement, authorization: Record<string, string>, signature: Hex): { name: string; value: string } {
  const payload = { signature, authorization };
  const body = version >= 2 ? { x402Version: 2, accepted: requirement, payload } : { x402Version: 1, scheme: requirement.scheme, network: requirement.network, payload };
  return { name: version >= 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT", value: Buffer.from(JSON.stringify(body)).toString("base64") };
}

export async function fetchChallenge(fetchImpl: FetchLike, resource: string, method: "GET" | "POST", resolve?: HostResolver): Promise<{ status: number; challenge: ParsedChallenge | null; preview: string | null }> {
  await assertPublicUrl(resource, "resource", resolve);
  const response = await fetchImpl(resource, { method, redirect: "error", signal: AbortSignal.timeout(10_000), ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) });
  if (response.status !== 402) return { status: response.status, challenge: null, preview: (await response.text().catch(() => "")).slice(0, 2_000) };
  return { status: 402, challenge: await readChallenge(response, resource), preview: null };
}

export async function payAndFetch(fetchImpl: FetchLike, input: { resource: string; method: "GET" | "POST"; header: { name: string; value: string }; body?: string }, resolve?: HostResolver): Promise<{ status: number; settlement: unknown; contentType: string | null; body: string }> {
  await assertPublicUrl(input.resource, "resource", resolve);
  const response = await fetchImpl(input.resource, {
    method: input.method,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { [input.header.name]: input.header.value, ...(input.method === "POST" ? { "content-type": "application/json" } : {}) },
    ...(input.method === "POST" ? { body: input.body ?? "{}" } : {}),
  });
  const settle = response.headers.get("payment-response") ?? response.headers.get("x-payment-response");
  let settlement: unknown = null;
  if (settle) {
    try {
      settlement = decodeB64Json(settle);
    } catch {
      settlement = settle.slice(0, 500);
    }
  }
  const text = await response.text();
  if (text.length > 65_536) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "The service answered with more than 64 KB; Lykia does not relay that much.");
  return { status: response.status, settlement, contentType: response.headers.get("content-type"), body: text };
}
