/**
 * Circle Gateway transfers out of the unified balance. Lykia builds the
 * EIP-712 burn intent for the depositor's wallet to sign (the server never
 * signs), asks Gateway's estimate endpoint for the authoritative maxFee,
 * forwards the signed intent to Gateway's public API for an attestation,
 * and returns the unsigned gatewayMint call for the destination chain, or,
 * with the Forwarding Service, lets Circle submit that mint (the recipient
 * needs no gas on the destination). Keyless: Gateway's API needs no key.
 * https://developers.circle.com/gateway/references/technical-guide
 * https://developers.circle.com/gateway/references/forwarding-service
 */
import { randomBytes } from "node:crypto";
import { encodeFunctionData, maxUint256, pad, parseAbi, type Hex } from "viem";
import type { Address, ArcEnvironment } from "@lykia/core";
import type { GatewayTransferDraft, GatewayTransferResult } from "@lykia/core/api/circle";
import type { FetchLike } from "../health/dependencies.js";
import { circleFetch, upstreamReason } from "./http.js";
import { LykiaHttpError } from "../http/errors.js";
import { GATEWAY_API } from "../flock/flock.js";
import { GATEWAY_CHAINS, GATEWAY_MINTER, GATEWAY_TRANSFER_FEE_BPS, GATEWAY_WALLET, gatewayChain } from "./chains.js";

export const GATEWAY_MINTER_ABI = parseAbi(["function gatewayMint(bytes attestationPayload, bytes signature)"]);

const BURN_INTENT_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
  ],
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

const b32 = (a: string): Hex => pad(a.toLowerCase() as Hex, { size: 32 });

/** Max fee in USDC base units: the crosschain transfer fee plus twice the source gas fee (Circle charges at most this). */
export function gatewayMaxFee(valueUnits: bigint, crossChain: boolean, gasFeeUsdc: string): bigint {
  const transfer = crossChain ? (valueUnits * BigInt(Math.round(GATEWAY_TRANSFER_FEE_BPS * 100)) + 999_999n) / 1_000_000n : 0n;
  const [w = "0", f = ""] = gasFeeUsdc.split(".");
  const gas = BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6) || "0");
  return transfer + gas * 2n;
}

export interface GatewayDraftInput {
  readonly environment: ArcEnvironment;
  readonly depositor: Address;
  readonly recipient?: Address;
  readonly destination: string;
  readonly valueUnits: bigint;
  readonly salt?: Hex;
  /** Ask Circle's Forwarding Service to submit the destination mint. */
  readonly forward?: boolean;
}

function buildIntent(input: GatewayDraftInput) {
  const source = GATEWAY_CHAINS[0]!;
  const dest = gatewayChain(input.destination);
  if (!dest) throw new LykiaHttpError("INVALID_REQUEST", 400, `Gateway does not reach ${input.destination}. Destinations: ${GATEWAY_CHAINS.map((c) => c.key).join(", ")}.`);
  if (input.valueUnits <= 0n) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send a positive amount.");
  const env = input.environment;
  const spec = {
    version: 1,
    sourceDomain: source.domain,
    destinationDomain: dest.domain,
    sourceContract: b32(GATEWAY_WALLET[env]),
    destinationContract: b32(GATEWAY_MINTER[env]),
    sourceToken: b32(source.usdc[env]),
    destinationToken: b32(dest.usdc[env]),
    sourceDepositor: b32(input.depositor),
    destinationRecipient: b32(input.recipient ?? input.depositor),
    sourceSigner: b32(input.depositor),
    destinationCaller: b32("0x0000000000000000000000000000000000000000"),
    value: input.valueUnits.toString(),
    salt: input.salt ?? (`0x${randomBytes(32).toString("hex")}` as Hex),
    hookData: "0x" as Hex,
  };
  return { source, dest, spec, formulaFee: gatewayMaxFee(input.valueUnits, dest.key !== "arc", source.gasFeeUsdc) };
}

function asDraft(input: GatewayDraftInput, built: ReturnType<typeof buildIntent>, fee: { maxFee: bigint; maxBlockHeight: string; source: "estimate" | "formula"; forwardingFeeUsdc: string | null }): GatewayTransferDraft {
  const message = { maxBlockHeight: fee.maxBlockHeight, maxFee: fee.maxFee.toString(), spec: built.spec };
  const typedData = { types: BURN_INTENT_TYPES, domain: { name: "GatewayWallet", version: "1" }, primaryType: "BurnIntent", message };
  return {
    typedData: [typedData],
    burnIntents: [message],
    fee: { maxFee: fee.maxFee.toString(), transferFeeBps: built.dest.key === "arc" ? 0 : GATEWAY_TRANSFER_FEE_BPS, gasFeeUsdc: built.source.gasFeeUsdc, source: fee.source, forwardingFeeUsdc: fee.forwardingFeeUsdc },
    ...(input.forward ? { forward: true } : {}),
    submit: `POST /v1/circle/gateway/transfer with { environment, destination, burnIntents, signatures${input.forward ? ", forward: true" : ""} }`,
  };
}

/** A draft from Circle's published formula alone (no network). Forwarded transfers need the estimate: use draftGatewayTransferEstimated. */
export function draftGatewayTransfer(input: GatewayDraftInput): GatewayTransferDraft {
  if (input.forward) throw new LykiaHttpError("INVALID_REQUEST", 400, "A forwarded Gateway transfer needs Gateway's fee estimate.");
  const built = buildIntent(input);
  return asDraft(input, built, { maxFee: built.formulaFee, maxBlockHeight: maxUint256.toString(), source: "formula", forwardingFeeUsdc: null });
}

export interface GatewayEstimate {
  readonly maxFee: bigint;
  readonly maxBlockHeight: string;
  readonly totalFeeUsdc: string | null;
  readonly forwardingFeeUsdc: string | null;
}

/**
 * Gateway's POST /v1/estimate (keyless) for one burn intent: the maxFee and
 * expiry block height Circle will accept, with the Forwarding Service fee
 * when `forward` is set (the estimate bumps maxFee to cover it).
 * https://developers.circle.com/api-reference/gateway/all/estimate-transfer
 */
export async function estimateGatewayTransfer(fetchImpl: FetchLike, environment: ArcEnvironment, spec: unknown, forward: boolean): Promise<GatewayEstimate> {
  const url = `${GATEWAY_API[environment]}/v1/estimate${forward ? "?enableForwarder=true" : ""}`;
  const response = await circleFetch(fetchImpl, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ spec }]), signal: AbortSignal.timeout(8_000) }, "Circle Gateway");
  const text = await response.text();
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Gateway's estimate answered ${response.status}.`, { gateway: upstreamReason(text) });
  // Two shapes in the wild: { body: [{ burnIntent }], fees } (documented) and a bare [{ burnIntent }] array.
  const json = JSON.parse(text) as { body?: { burnIntent?: { maxFee?: string; maxBlockHeight?: string } }[]; fees?: { total?: string; forwardingFee?: string } } | { burnIntent?: { maxFee?: string; maxBlockHeight?: string } }[];
  const rows = Array.isArray(json) ? json : (json.body ?? []);
  const intent = rows[0]?.burnIntent;
  if (!intent?.maxFee || !/^\d+$/u.test(intent.maxFee) || !intent.maxBlockHeight || !/^\d+$/u.test(intent.maxBlockHeight)) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Gateway's estimate returned no fee.");
  const fees = Array.isArray(json) ? undefined : json.fees;
  return { maxFee: BigInt(intent.maxFee), maxBlockHeight: intent.maxBlockHeight, totalFeeUsdc: fees?.total ?? null, forwardingFeeUsdc: fees?.forwardingFee ?? null };
}

/**
 * The draft with Gateway's own estimate setting maxFee and the expiry block.
 * If the estimate cannot be read, a plain transfer falls back to Circle's
 * published formula (fee.source says which); a forwarded transfer refuses,
 * because its fee is only known from the estimate.
 */
export async function draftGatewayTransferEstimated(fetchImpl: FetchLike, input: GatewayDraftInput): Promise<GatewayTransferDraft> {
  const built = buildIntent(input);
  try {
    const estimate = await estimateGatewayTransfer(fetchImpl, input.environment, built.spec, input.forward === true);
    // Circle advises a buffer over the estimate: plain transfers keep the formula's 2x gas fee when it is higher;
    // forwarded ones add one more source gas fee on top of the estimate (which already includes the forwarding fee).
    const gasBuffer = gatewayMaxFee(0n, false, built.source.gasFeeUsdc) / 2n;
    const maxFee = input.forward ? estimate.maxFee + gasBuffer : estimate.maxFee > built.formulaFee ? estimate.maxFee : built.formulaFee;
    return asDraft(input, built, { maxFee, maxBlockHeight: estimate.maxBlockHeight, source: "estimate", forwardingFeeUsdc: estimate.forwardingFeeUsdc });
  } catch (error) {
    if (input.forward) throw error;
    return asDraft(input, built, { maxFee: built.formulaFee, maxBlockHeight: maxUint256.toString(), source: "formula", forwardingFeeUsdc: null });
  }
}

/** Sends signed burn intents to Gateway and returns the attestation plus the unsigned mint on the destination (or, forwarded, the transfer id). */
export async function submitGatewayTransfer(fetchImpl: FetchLike, input: { environment: ArcEnvironment; destination: string; burnIntents: readonly unknown[]; signatures: readonly Hex[]; forward?: boolean }): Promise<GatewayTransferResult> {
  const dest = gatewayChain(input.destination);
  if (!dest) throw new LykiaHttpError("INVALID_REQUEST", 400, `Gateway does not reach ${input.destination}.`);
  if (input.burnIntents.length === 0 || input.burnIntents.length !== input.signatures.length) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send one signature per burn intent.");
  if (input.burnIntents.length > 16) throw new LykiaHttpError("INVALID_REQUEST", 400, "Gateway takes at most 16 burn intents per transfer.");
  const body = input.burnIntents.map((burnIntent, i) => ({ burnIntent, signature: input.signatures[i] }));
  const url = `${GATEWAY_API[input.environment]}/v1/transfer${input.forward ? "?enableForwarder=true" : ""}`;
  const response = await circleFetch(fetchImpl, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }, "Circle Gateway");
  const text = await response.text();
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Gateway refused the transfer (${response.status}).`, { gateway: upstreamReason(text) });
  const json = JSON.parse(text) as { attestation?: Hex; signature?: Hex; transferId?: string; id?: string };
  const transferId = json.transferId ?? json.id ?? null;
  if (input.forward) {
    // Forwarded: Circle submits gatewayMint; the response may omit attestation and signature (GET /v1/transfer/{id} has the record).
    if (!transferId && !json.attestation) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Gateway returned neither a transfer id nor an attestation.", { gateway: upstreamReason(text) });
    return { attestation: json.attestation ?? null, signature: json.signature ?? null, transferId, mint: null, forwarded: true };
  }
  if (!json.attestation || !json.signature) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Gateway returned no attestation.", { gateway: upstreamReason(text) });
  return {
    attestation: json.attestation,
    signature: json.signature,
    transferId,
    mint: { chainId: dest.chainId[input.environment], to: GATEWAY_MINTER[input.environment], data: encodeFunctionData({ abi: GATEWAY_MINTER_ABI, functionName: "gatewayMint", args: [json.attestation, json.signature] }), value: "0" },
  };
}

/**
 * A Gateway transfer's record (GET /v1/transfer/{id}, keyless): status and,
 * for forwarded transfers, the destination mint. Fields are passed through
 * as Circle returns them; Lykia adds nothing.
 * https://developers.circle.com/api-reference/gateway/all/get-transfer-by-id
 */
export async function gatewayTransferStatus(fetchImpl: FetchLike, environment: ArcEnvironment, transferId: string): Promise<Record<string, unknown>> {
  if (!/^[A-Za-z0-9-]{8,80}$/u.test(transferId)) throw new LykiaHttpError("INVALID_REQUEST", 400, "Not a Gateway transfer id.");
  const response = await circleFetch(fetchImpl, `${GATEWAY_API[environment]}/v1/transfer/${transferId}`, { signal: AbortSignal.timeout(8_000) }, "Circle Gateway");
  if (response.status === 404) throw new LykiaHttpError("NOT_FOUND", 404, "Gateway has no transfer with that id.");
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Gateway answered ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}
