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

export const X402_VERSION = 2;
export const USDC_DOMAIN = { name: "USDC", version: "2" } as const;
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

/** Express middleware: free when x402 is not configured, otherwise 402 until a valid payment arrives. */
export function paid(ctx: AppContext, description: string): RequestHandler {
  return async (req, res, next) => {
    const { payTo, priceUnits, facilitatorUrl } = ctx.config.x402;
    if (!payTo) {
      sendError(req, res, new LykiaHttpError("NOT_FOUND", 404, "Paid routes are not enabled on this server (LYKIA_X402_PAY_TO is unset)."));
      return;
    }
    const environment: ArcEnvironment = req.query.environment === "mainnet" ? "mainnet" : req.query.environment === "testnet" ? "testnet" : ctx.config.mode;
    const requirements = requirementsFor(environment, payTo, priceUnits, `${req.baseUrl}${req.path}`, description);
    const header = req.get("x-payment") ?? req.get("payment-signature");
    const challenge = (error: string) => {
      const body = { x402Version: X402_VERSION, error, accepts: [requirements] };
      res.status(402).setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(body)).toString("base64")).json(body);
    };
    if (!header) return challenge("Payment required: USDC on Arc.");
    const payment = decodePayment(header);
    if (!payment) return challenge("The payment header is not valid base64 JSON.");
    const verdict = await verifyPayment(payment, requirements, Math.floor(ctx.clock.now() / 1000));
    if (!verdict.ok) return challenge(verdict.reason);
    const nonceKey = `${environment}:${payment.payload.authorization.from.toLowerCase()}:${payment.payload.authorization.nonce.toLowerCase()}`;
    const claimed = await ctx.store.collection<JsonValue>("x402_nonces").compareAndSet(nonceKey, null, { at: ctx.clock.now() }, { ttlMs: 7 * 24 * 3600_000 });
    if (!claimed) return challenge("That authorization was already used.");
    let settlement: { success: boolean; transaction?: string; mode: "settled" | "verify-only"; error?: string } = { success: true, mode: "verify-only" };
    if (facilitatorUrl) {
      try {
        const response = await ctx.fetch(`${facilitatorUrl.replace(/\/$/u, "")}/settle`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload: payment, paymentRequirements: requirements }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await response.json().catch(() => ({}))) as { success?: boolean; transaction?: string; errorReason?: string };
        settlement = body.success ? { success: true, mode: "settled", ...(body.transaction ? { transaction: body.transaction } : {}) } : { success: false, mode: "settled", error: body.errorReason ?? `facilitator answered ${response.status}` };
      } catch {
        settlement = { success: false, mode: "settled", error: "facilitator unreachable" };
      }
      if (!settlement.success) return challenge(`Settlement failed: ${settlement.error}.`);
    }
    res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({ ...settlement, network: requirements.network, payer: verdict.payer })).toString("base64"));
    next();
  };
}
