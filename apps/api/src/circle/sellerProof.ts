/**
 * Seller proofs for Circle's hosted x402 facilitator
 * (https://api.circle.com/v1/facilitator/x402). Every /verify, /settle and
 * /status call carries a `Facilitator-Seller-Proof` header: a base64url JSON
 * envelope with an EIP-712 `SellerRequest` signature proving the caller
 * controls `payTo` and binding the purpose and request body.
 * https://developers.circle.com/facilitator-service/quickstart
 *
 * Lykia's server holds no keys. The proof is signed by a Circle
 * developer-controlled wallet that is the x402 payTo
 * (`CIRCLE_X402_SELLER_WALLET_ID`, an EOA wallet), through Circle's
 * `POST /v1/w3s/developer/sign/typedData`. Without that wallet no header is
 * sent and Circle's facilitator answers with its own error, which the paid
 * route reports.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { keccak256, toHex, type Hex } from "viem";
import type { AppContext } from "../context.js";
import { circleFetch } from "./http.js";
import { entitySecretCiphertext } from "./wallets.js";

export type SellerProofPurpose = "verify" | "settle" | "status";

export const SELLER_PROOF_DOMAIN_NAME = "Circle Facilitator Seller Request";
export const SELLER_REQUEST_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
  ],
  SellerRequest: [
    { name: "purpose", type: "string" },
    { name: "method", type: "string" },
    { name: "bodyHash", type: "bytes32" },
    { name: "network", type: "string" },
    { name: "payTo", type: "address" },
    { name: "nonce", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

/** True when the facilitator is Circle's hosted one. */
export function isCircleFacilitator(url: string | null): boolean {
  return url !== null && /^https:\/\/api(?:-sandbox)?\.circle\.com\/v1\/facilitator\//u.test(url);
}

/** The typed data a seller signs for one facilitator call (valid five minutes). */
export function sellerRequestTypedData(input: { purpose: SellerProofPurpose; method: string; body: string; network: string; payTo: string; nowSeconds: number; nonce?: Hex }) {
  const chainId = Number(input.network.split(":")[1]);
  const issuedAt = input.nowSeconds;
  const message = {
    purpose: input.purpose,
    method: input.method.toUpperCase(),
    bodyHash: keccak256(toHex(input.body)),
    network: input.network,
    payTo: input.payTo,
    nonce: input.nonce ?? (`0x${randomBytes(32).toString("hex")}` as Hex),
    issuedAt: String(issuedAt),
    expiresAt: String(issuedAt + 300),
  };
  return { types: SELLER_REQUEST_TYPES, domain: { name: SELLER_PROOF_DOMAIN_NAME, version: "1", chainId }, primaryType: "SellerRequest" as const, message };
}

/** The header value: base64url of { version, signature, network, payTo, nonce, issuedAt, expiresAt }. */
export function sellerProofEnvelope(typed: ReturnType<typeof sellerRequestTypedData>, signature: Hex): string {
  const m = typed.message;
  const envelope = { version: 1, signature, network: m.network, payTo: m.payTo, nonce: m.nonce, issuedAt: Number(m.issuedAt), expiresAt: Number(m.expiresAt) };
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

/**
 * The `Facilitator-Seller-Proof` header for a Circle facilitator call, or {}
 * when the facilitator is not Circle's or no seller wallet is configured.
 * Never throws: a missing proof is Circle's to refuse, not a crash here.
 */
export async function sellerProofHeader(ctx: AppContext, input: { purpose: SellerProofPurpose; body: string; network: string; payTo: string }): Promise<Record<string, string>> {
  const { facilitatorUrl } = ctx.config.x402;
  const { apiKey, entitySecret, walletSetId, sellerWalletId } = ctx.config.circle;
  if (!isCircleFacilitator(facilitatorUrl) || !apiKey || !entitySecret || !sellerWalletId) return {};
  try {
    const typed = sellerRequestTypedData({ purpose: input.purpose, method: "POST", body: input.body, network: input.network, payTo: input.payTo, nowSeconds: Math.floor(ctx.clock.now() / 1000) });
    const response = await circleFetch(
      ctx.fetch,
      "https://api.circle.com/v1/w3s/developer/sign/typedData",
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-request-id": randomUUID() },
        body: JSON.stringify({ walletId: sellerWalletId, data: JSON.stringify(typed), entitySecretCiphertext: await entitySecretCiphertext(ctx.fetch, { apiKey, entitySecret, walletSetId }, ctx.clock.now()), memo: `x402 ${input.purpose}` }),
        signal: AbortSignal.timeout(8_000),
      },
      "Circle Wallets",
    );
    if (!response.ok) return {};
    const signature = ((await response.json()) as { data?: { signature?: string } }).data?.signature;
    if (!signature || !/^0x[0-9a-fA-F]+$/u.test(signature)) return {};
    return { "Facilitator-Seller-Proof": sellerProofEnvelope(typed, signature as Hex) };
  } catch {
    return {};
  }
}
