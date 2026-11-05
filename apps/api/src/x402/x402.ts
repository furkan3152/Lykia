/**
 * x402 pay-per-call in USDC on Arc. A paid route answers 402 with the
 * payment requirements (scheme "exact": an EIP-3009
 * transferWithAuthorization on USDC, EIP-712 domain "USDC" version "2").
 * The client retries with the signed authorization in `X-PAYMENT` (or
 * `PAYMENT-SIGNATURE`), base64 JSON. The server verifies the signature,
 * recipient, amount, validity window and nonce locally with viem; it
 * settles only when a facilitator is configured (Circle's x402
 * facilitator, for example). Without one it runs verify-only and says so
 * in the PAYMENT-RESPONSE header. The server never holds a key.
 */
import { contractAddress, networkFor, type Address, type ArcEnvironment } from "@lykia/core";
import type { RequestHandler } from "express";
import { recoverTypedDataAddress, type Hex } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { sendError } from "../http/request.js";
import type { JsonValue } from "../store/types.js";
import { sellerProofHeader } from "../circle/sellerProof.js";

export const X402_VERSION = 2;
const USDC_DOMAIN = { name: "USDC", version: "2" } as const;
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface PaymentRequirements {
  readonly scheme: "exact";
  readonly network: `eip155:${number}`;
  readonly amount: string;
  readonly asset: Address;
  readonly payTo: Address;
  readonly maxTimeoutSeconds: number;
  readonly resource: string;
  readonly description: string;
  readonly mimeType: "application/json";
  readonly extra: { readonly name: string; readonly version: string };
}

export interface Authorization {
  readonly from: Address;
  readonly to: Address;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly nonce: Hex;
}

export interface PaymentPayload {
  readonly x402Version: number;
  readonly scheme?: string;
  readonly network?: string;
  readonly accepted?: { readonly scheme?: string; readonly network?: string };
  readonly payload: { readonly signature: Hex; readonly authorization: Authorization };
}

export function requirementsFor(environment: ArcEnvironment, payTo: Address, amount: string, resource: string, description: string): PaymentRequirements {
  const network = networkFor(environment);
  return {
    scheme: "exact",
    network: network.caip2,
    amount,
    asset: contractAddress("usdc", environment) as Address,
    payTo,
    maxTimeoutSeconds: 60,
    resource,
    description,
    mimeType: "application/json",
    extra: { name: USDC_DOMAIN.name, version: USDC_DOMAIN.version },
  };
}

export function decodePayment(header: string): PaymentPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
    const a = parsed?.payload?.authorization;
    if (!parsed?.payload?.signature || !a || typeof a.from !== "string" || typeof a.nonce !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export type VerifyResult = { readonly ok: true; readonly payer: Address } | { readonly ok: false; readonly reason: string };

/** Local verification of an exact-scheme payment against requirements (nonce reuse is checked by the caller). */
export async function verifyPayment(payment: PaymentPayload, req: PaymentRequirements, nowSeconds: number): Promise<VerifyResult> {
  const scheme = payment.accepted?.scheme ?? payment.scheme ?? "exact";
  const network = payment.accepted?.network ?? payment.network ?? req.network;
  if (scheme !== "exact") return { ok: false, reason: "Only the exact scheme is accepted." };
  if (network !== req.network && network !== (req.network === "eip155:5042" ? "arc" : "arc-testnet")) return { ok: false, reason: `Pay on ${req.network}.` };
  const a = payment.payload.authorization;
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return { ok: false, reason: "The authorization pays someone else." };
  let value: bigint;
  try {
    value = BigInt(a.value);
  } catch {
    return { ok: false, reason: "Malformed value." };
  }
  if (value < BigInt(req.amount)) return { ok: false, reason: `The authorization pays ${a.value}; the price is ${req.amount}.` };
  if (BigInt(a.validAfter) > BigInt(nowSeconds)) return { ok: false, reason: "The authorization is not valid yet." };
  if (BigInt(a.validBefore) <= BigInt(nowSeconds)) return { ok: false, reason: "The authorization has expired." };
  if (!/^0x[0-9a-fA-F]{64}$/u.test(a.nonce)) return { ok: false, reason: "Malformed nonce." };
  const chainId = Number(req.network.split(":")[1]);
  try {
    const signer = await recoverTypedDataAddress({
      domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: { from: a.from, to: a.to, value, validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
      signature: payment.payload.signature,
    });
    if (signer.toLowerCase() !== a.from.toLowerCase()) return { ok: false, reason: "The signature is not from the payer." };
    return { ok: true, payer: a.from };
  } catch {
    return { ok: false, reason: "The signature could not be verified." };
  }
}

/** Circle's facilitator takes the account's API key as a bearer token; other facilitators get none. */
function facilitatorHeaders(facilitatorUrl: string, circleApiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (circleApiKey && /^https:\/\/api(?:-sandbox)?\.circle\.com\//u.test(facilitatorUrl)) headers.authorization = `Bearer ${circleApiKey}`;
  return headers;
}

/** How paid routes settle on this server, in words a client can trust. */
export function settlementMode(ctx: AppContext): { readonly mode: "settled" | "verify-only" | "off"; readonly facilitator: string | null; readonly note: string } {
  const { payTo, facilitatorUrl } = ctx.config.x402;
  if (!payTo) return { mode: "off", facilitator: null, note: "Paid routes are disabled on this server." };
  if (!facilitatorUrl) return { mode: "verify-only", facilitator: null, note: "Payments are verified locally and not settled on-chain; no USDC moves." };
  const circle = /circle\.com/u.test(facilitatorUrl);
  if (circle && !ctx.config.circle.apiKey) return { mode: "settled", facilitator: facilitatorUrl, note: "Circle's facilitator settles payments; this server has no Circle API key, so settlement is refused and the route keeps answering 402." };
  return { mode: "settled", facilitator: facilitatorUrl, note: circle ? "Circle's facilitator settles every payment on Arc before the answer is sent." : "The configured facilitator settles every payment before the answer is sent." };
}

export type AcceptResult =
  | { readonly ok: true; readonly payer: Address; readonly settlement: { readonly success: boolean; readonly transaction?: string; readonly mode: "settled" | "verify-only"; readonly error?: string } }
  | { readonly ok: false; readonly reason: string };

/**
 * Verifies an x402 payment header against requirements, claims its nonce
 * once, and settles it through the facilitator when one is configured.
 * Shared by paid routes and by API billing (overage and credit top-ups).
 */
export async function acceptPayment(ctx: AppContext, header: string, requirements: PaymentRequirements, environment: ArcEnvironment): Promise<AcceptResult> {
  const payment = decodePayment(header);
  if (!payment) return { ok: false, reason: "The payment header is not valid base64 JSON." };
  const verdict = await verifyPayment(payment, requirements, Math.floor(ctx.clock.now() / 1000));
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const nonceKey = `${environment}:${payment.payload.authorization.from.toLowerCase()}:${payment.payload.authorization.nonce.toLowerCase()}`;
  const claimed = await ctx.store.collection<JsonValue>("x402_nonces").compareAndSet(nonceKey, null, { at: ctx.clock.now() }, { ttlMs: 7 * 24 * 3600_000 });
  if (!claimed) return { ok: false, reason: "That authorization was already used." };
  const { facilitatorUrl } = ctx.config.x402;
  let settlement: { success: boolean; transaction?: string; mode: "settled" | "verify-only"; error?: string } = { success: true, mode: "verify-only" };
  if (facilitatorUrl) {
    try {
      const settleBody = JSON.stringify({ x402Version: X402_VERSION, paymentPayload: payment, paymentRequirements: requirements });
      // Circle's hosted facilitator also wants a seller proof (signed by a Circle wallet when one is configured).
      const proof = await sellerProofHeader(ctx, { purpose: "settle", body: settleBody, network: requirements.network, payTo: requirements.payTo });
      const response = await ctx.fetch(`${facilitatorUrl.replace(/\/$/u, "")}/settle`, {
        method: "POST",
        headers: { ...facilitatorHeaders(facilitatorUrl, ctx.config.circle.apiKey), ...proof },
        body: settleBody,
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json().catch(() => ({}))) as { success?: boolean; transaction?: string; errorReason?: string };
      settlement = body.success ? { success: true, mode: "settled", ...(body.transaction ? { transaction: body.transaction } : {}) } : { success: false, mode: "settled", error: body.errorReason ?? `facilitator answered ${response.status}` };
    } catch {
      settlement = { success: false, mode: "settled", error: "facilitator unreachable" };
    }
    if (!settlement.success) return { ok: false, reason: `Settlement failed: ${settlement.error}.` };
  }
  return { ok: true, payer: verdict.payer, settlement };
}

/** Express middleware: free when x402 is not configured, otherwise 402 until a valid payment arrives. */
export function paid(ctx: AppContext, description: string): RequestHandler {
  return async (req, res, next) => {
    const { payTo, priceUnits } = ctx.config.x402;
    if (!payTo) {
      sendError(req, res, new LykiaHttpError("NOT_FOUND", 404, "Paid routes are not enabled on this server (LYKIA_X402_PAY_TO is unset)."));
      return;
    }
    const asked = req.query.environment ?? (req.body as { environment?: unknown } | undefined)?.environment;
    const environment: ArcEnvironment = asked === "mainnet" ? "mainnet" : asked === "testnet" ? "testnet" : ctx.config.mode;
    const requirements = requirementsFor(environment, payTo, priceUnits, `${req.baseUrl}${req.path}`, description);
    const header = req.get("x-payment") ?? req.get("payment-signature");
    const challenge = (error: string) => {
      const body = { x402Version: X402_VERSION, error, accepts: [requirements] };
      res.status(402).setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(body)).toString("base64")).json(body);
    };
    if (!header) return challenge("Payment required: USDC on Arc.");
    const accepted = await acceptPayment(ctx, header, requirements, environment);
    if (!accepted.ok) return challenge(accepted.reason);
    res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({ ...accepted.settlement, network: requirements.network, payer: accepted.payer })).toString("base64"));
    next();
  };
}
