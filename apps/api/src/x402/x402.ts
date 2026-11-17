/**
 * x402 pay-per-call in USDC on Arc. A paid route answers 402 with the
 * payment requirements (scheme "exact": an EIP-3009
 * transferWithAuthorization on USDC, EIP-712 domain "USDC" version "2").
 * The client retries with the signed authorization in `X-PAYMENT` (or
 * `PAYMENT-SIGNATURE`), base64 JSON. The server verifies the signature,
 * recipient, amount, validity window and nonce locally with viem; it
 * settles only when a facilitator is configured (Circle's x402
 * facilitator, for example). Without one it runs verify-only and says so
 * in the PAYMENT-RESPONSE header. The server holds no key for x402: the payer signs.
 *
 * A paid route (`paidRoute`) follows x402's authorization flow:
 *
 *   no payment header, or HEAD -> 402 with the offer, whatever the request holds
 *   payment fails verification -> 402 with the reason
 *   request invalid            -> 400; nothing is claimed or settled
 *   nonce already used         -> 402
 *   the work fails             -> its error; the nonce is freed, nothing is settled
 *   settlement fails           -> 402; the answer is never sent
 *   settled                    -> 200 with PAYMENT-RESPONSE
 *
 * The offer is on the Arc network the request runs on, read from the field
 * the route's own validator reads, so a request never pays on one network
 * for work on the other.
 */
import { contractAddress, networkFor, type Address, type ArcEnvironment } from "@lykia/core";
import type { Request, RequestHandler, Response } from "express";
import { recoverTypedDataAddress, type Hex } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { sendError } from "../http/request.js";
import type { JsonValue } from "../store/types.js";
import { sellerProofHeader } from "../circle/sellerProof.js";
import { currentEnvironmentLock, testKeyMainnetError } from "../platform/requestState.js";

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
    if (typeof parsed?.payload?.signature !== "string" || !a) return null;
    // Addresses and the nonce are strings; amounts and times are unsigned integers (decimal strings, or plain numbers from lenient clients).
    if (![a.from, a.to, a.nonce].every((field) => typeof field === "string")) return null;
    const unsigned = (field: unknown) => (typeof field === "string" ? /^\d{1,78}$/u.test(field) : Number.isSafeInteger(field) && (field as number) >= 0);
    if (![a.value, a.validAfter, a.validBefore].every(unsigned)) return null;
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
  if (!facilitatorUrl && ctx.config.env === "production") return { mode: "off", facilitator: null, note: "Paid routes are refused in production without a facilitator: a payment that is only verified is never settled." };
  if (!facilitatorUrl) return { mode: "verify-only", facilitator: null, note: "Development only: payments are verified locally and not settled on-chain; no USDC moves." };
  const circle = /circle\.com/u.test(facilitatorUrl);
  if (circle && !ctx.config.circle.apiKey) return { mode: "settled", facilitator: facilitatorUrl, note: "Circle's facilitator settles payments; this server has no Circle API key, so settlement is refused and the route keeps answering 402." };
  return { mode: "settled", facilitator: facilitatorUrl, note: circle ? "Circle's facilitator settles every payment on Arc before the answer is sent." : "The configured facilitator settles every payment before the answer is sent." };
}

export interface Settlement {
  readonly success: boolean;
  readonly transaction?: string;
  readonly mode: "settled" | "verify-only";
  readonly error?: string;
}

export type CheckResult = { readonly ok: true; readonly payment: PaymentPayload; readonly payer: Address } | { readonly ok: false; readonly reason: string };

/**
 * Decodes a payment header and verifies it against the requirements. Read
 * only: no nonce is claimed and nothing moves.
 */
export async function checkPayment(ctx: AppContext, header: string, requirements: PaymentRequirements): Promise<CheckResult> {
  // Production never accepts an unsettled payment: without a facilitator, verify-only is refused.
  if (!ctx.config.x402.facilitatorUrl && ctx.config.env === "production") return { ok: false, reason: "This server has no x402 facilitator configured, so it cannot settle payments; paid routes are off." };
  const payment = decodePayment(header);
  if (!payment) return { ok: false, reason: "The payment header is not valid base64 JSON." };
  const verdict = await verifyPayment(payment, requirements, Math.floor(ctx.clock.now() / 1000));
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  return { ok: true, payment, payer: verdict.payer };
}

function nonceKey(environment: ArcEnvironment, payment: PaymentPayload): string {
  return `${environment}:${payment.payload.authorization.from.toLowerCase()}:${payment.payload.authorization.nonce.toLowerCase()}`;
}

/** Claims an authorization's nonce once (7 days); false when it was already used. */
export async function claimNonce(ctx: AppContext, payment: PaymentPayload, environment: ArcEnvironment): Promise<boolean> {
  return (await ctx.store.collection<JsonValue>("x402_nonces").compareAndSet(nonceKey(environment, payment), null, { at: ctx.clock.now() }, { ttlMs: 7 * 24 * 3600_000 })) !== null;
}

/** Frees a claimed nonce whose payment was never settled, so the same authorization can be sent again. */
export async function releaseNonce(ctx: AppContext, payment: PaymentPayload, environment: ArcEnvironment): Promise<void> {
  await ctx.store.collection<JsonValue>("x402_nonces").delete(nonceKey(environment, payment));
}

/** Settles a verified payment through the facilitator; verify-only when none is configured (never in production). */
export async function settlePayment(ctx: AppContext, payment: PaymentPayload, requirements: PaymentRequirements): Promise<Settlement> {
  const { facilitatorUrl } = ctx.config.x402;
  if (!facilitatorUrl) return { success: true, mode: "verify-only" };
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
    return body.success ? { success: true, mode: "settled", ...(body.transaction ? { transaction: body.transaction } : {}) } : { success: false, mode: "settled", error: body.errorReason ?? `facilitator answered ${response.status}` };
  } catch {
    return { success: false, mode: "settled", error: "facilitator unreachable" };
  }
}

export type AcceptResult = { readonly ok: true; readonly payer: Address; readonly settlement: Settlement } | { readonly ok: false; readonly reason: string };

/**
 * Verifies an x402 payment header against requirements, claims its nonce
 * once, and settles it through the facilitator when one is configured.
 * Used where the payment is the purchase itself (API billing: overage and
 * credit top-ups); paid routes use `paidRoute`, which settles after the work.
 */
export async function acceptPayment(ctx: AppContext, header: string, requirements: PaymentRequirements, environment: ArcEnvironment): Promise<AcceptResult> {
  const checked = await checkPayment(ctx, header, requirements);
  if (!checked.ok) return checked;
  if (!(await claimNonce(ctx, checked.payment, environment))) return { ok: false, reason: "That authorization was already used." };
  const settlement = await settlePayment(ctx, checked.payment, requirements);
  if (!settlement.success) return { ok: false, reason: `Settlement failed: ${settlement.error}.` };
  return { ok: true, payer: checked.payer, settlement };
}

/**
 * The x402 v2 PaymentRequired object: `resource` describes what is bought,
 * `accepts` the offers. Each offer also keeps `resource`, `description` and
 * `mimeType`, where x402 v1 clients read them.
 */
export function paymentRequired(requirements: PaymentRequirements, error: string, extensions?: Readonly<Record<string, unknown>>) {
  return {
    x402Version: X402_VERSION,
    error,
    resource: { url: requirements.resource, description: requirements.description, mimeType: requirements.mimeType },
    accepts: [requirements],
    ...(extensions ? { extensions } : {}),
  };
}

/** Answers 402 with the PaymentRequired object in the body and, base64 JSON, in PAYMENT-REQUIRED. */
export function sendPaymentRequired(res: Response, body: ReturnType<typeof paymentRequired>): void {
  res.status(402).setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(body)).toString("base64")).json(body);
}

/**
 * Body errors (malformed, oversized or non-JSON bodies) on paid routes are
 * held back by the router, so an unpaid request still gets its 402; the
 * route raises them once a payment has verified.
 */
const deferredBodyErrors = new WeakMap<Request, unknown>();

/** A paid route's path under /v1. Express matches paths case-insensitively and ignores a trailing slash, so this does too. */
export function isPaidRoutePath(path: string): boolean {
  const normal = path.toLowerCase().replace(/\/+$/u, "");
  return normal.startsWith("/x402/") && normal !== "/x402/health";
}

export function deferBodyError(req: Request, error: unknown): void {
  deferredBodyErrors.set(req, error);
}

export function hasDeferredBodyError(req: Request): boolean {
  return deferredBodyErrors.has(req);
}

export interface PaidRouteOptions<I extends { readonly environment: ArcEnvironment }> {
  /** What the payer buys, as the discovery document describes it. */
  readonly description: string;
  /** The absolute URL of the resource this request buys, exactly as discovery lists it. */
  readonly resource: (req: Request) => string;
  /** x402 extensions sent with every 402 (the bazaar request and response schemas). */
  readonly extensions?: (req: Request) => Readonly<Record<string, unknown>>;
  /**
   * The Arc network the request names, read from the raw request where `parse` reads it (the offer is made
   * before validation). Anything but mainnet or testnet means the server's network; a test key's is testnet.
   */
  readonly environment: (req: Request) => unknown;
  /** Validates the request. It runs only once a payment has verified; when it throws, nothing is claimed or settled. */
  readonly parse: (req: Request) => I;
  /** The paid work, on `input.environment`. Its answer is sent only after the payment settles. */
  readonly run: (input: I, req: Request) => unknown;
}

/**
 * The network a paid request is offered and paid on: the one it names, else the server's (testnet under a
 * test key). The rule of `environmentOf` in modules/common.ts, which this file cannot import (common imports
 * the developer gate, which imports billing, which imports this file).
 */
function offeredEnvironment(ctx: AppContext, asked: unknown): ArcEnvironment {
  const named = asked === "mainnet" || asked === "testnet" ? asked : undefined;
  if (currentEnvironmentLock() === "testnet") {
    if (named === "mainnet") throw testKeyMainnetError();
    return "testnet";
  }
  return named ?? ctx.config.mode;
}

/**
 * A paid route: 402 until a payment verifies, then validate, run, settle,
 * answer (see the order at the top of this file). Disabled (404) when x402
 * is not configured.
 */
export function paidRoute<I extends { readonly environment: ArcEnvironment }>(ctx: AppContext, options: PaidRouteOptions<I>): RequestHandler {
  return async (req, res) => {
    const { payTo, priceUnits } = ctx.config.x402;
    if (!payTo) {
      sendError(req, res, new LykiaHttpError("NOT_FOUND", 404, "Paid routes are not enabled on this server (LYKIA_X402_PAY_TO is unset)."));
      return;
    }
    const environment = offeredEnvironment(ctx, options.environment(req));
    const requirements = requirementsFor(environment, payTo, priceUnits, options.resource(req), options.description);
    const challenge = (error: string) => sendPaymentRequired(res, paymentRequired(requirements, error, options.extensions?.(req)));
    // Express answers HEAD with the GET handler but sends no body: a payment there would buy nothing, so HEAD only sees the offer.
    if (req.method === "HEAD") return challenge("Payment required: USDC on Arc. HEAD is never charged; pay with GET.");
    const header = req.get("x-payment") ?? req.get("payment-signature");
    if (!header) return challenge("Payment required: USDC on Arc.");
    const checked = await checkPayment(ctx, header, requirements);
    if (!checked.ok) return challenge(checked.reason);
    // An invalid request is refused before the nonce is claimed: it costs nothing, and the same authorization can be sent again with a corrected request.
    if (deferredBodyErrors.has(req)) throw deferredBodyErrors.get(req);
    const input = options.parse(req);
    // The payment must be on the network the work runs on.
    if (input.environment !== environment) throw new LykiaHttpError("INVALID_REQUEST", 400, `The payment is on Arc ${environment}, but this request runs on Arc ${input.environment}; nothing was settled.`);
    if (!(await claimNonce(ctx, checked.payment, environment))) return challenge("That authorization was already used.");
    let answer: unknown;
    try {
      answer = await options.run(input, req);
    } catch (error) {
      // Nothing was delivered and nothing settled: free the authorization for a retry.
      await releaseNonce(ctx, checked.payment, environment).catch(() => undefined);
      throw error;
    }
    if (res.destroyed || req.socket?.destroyed === true) {
      // The payer went away: the answer cannot be delivered, so it is not charged.
      await releaseNonce(ctx, checked.payment, environment).catch(() => undefined);
      return;
    }
    // A failed settlement keeps the nonce claimed: the facilitator may have broadcast it before failing.
    const settlement = await settlePayment(ctx, checked.payment, requirements);
    if (!settlement.success) return challenge(`Settlement failed: ${settlement.error}.`);
    res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({ ...settlement, network: requirements.network, payer: checked.payer })).toString("base64"));
    res.json(answer);
  };
}
