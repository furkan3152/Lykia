/**
 * Circle Gateway transfers out of the unified balance. Lykia builds the
 * EIP-712 burn intent for the depositor's wallet to sign (the server never
 * signs), forwards the signed intent to Gateway's public API for an
 * attestation, and returns the unsigned gatewayMint call for the
 * destination chain. Keyless: Gateway's transfer API needs no API key.
 */
import { randomBytes } from "node:crypto";
import { encodeFunctionData, maxUint256, pad, parseAbi, type Hex } from "viem";
import type { Address, ArcEnvironment } from "@lykia/core";
import type { GatewayTransferDraft, GatewayTransferResult } from "@lykia/core/api/circle";
import type { FetchLike } from "../health/dependencies.js";
import { circleFetch } from "./http.js";
import { LykiaHttpError } from "../http/errors.js";
import { GATEWAY_API } from "../flock/flock.js";
import { GATEWAY_CHAINS, GATEWAY_MINTER, GATEWAY_TRANSFER_FEE_BPS, GATEWAY_WALLET, gatewayChain } from "./chains.js";

export const GATEWAY_MINTER_ABI = parseAbi(["function gatewayMint(bytes attestationPayload, bytes signature)"]);

export const BURN_INTENT_TYPES = {
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

export function draftGatewayTransfer(input: { environment: ArcEnvironment; depositor: Address; recipient?: Address; destination: string; valueUnits: bigint; salt?: Hex }): GatewayTransferDraft {
  const source = GATEWAY_CHAINS[0]!;
  const dest = gatewayChain(input.destination);
  if (!dest) throw new LykiaHttpError("INVALID_REQUEST", 400, `Gateway does not reach ${input.destination}. Destinations: ${GATEWAY_CHAINS.map((c) => c.key).join(", ")}.`);
  if (input.valueUnits <= 0n) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send a positive amount.");
  const env = input.environment;
  const maxFee = gatewayMaxFee(input.valueUnits, dest.key !== "arc", source.gasFeeUsdc);
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
  const message = { maxBlockHeight: maxUint256.toString(), maxFee: maxFee.toString(), spec };
  const typedData = { types: BURN_INTENT_TYPES, domain: { name: "GatewayWallet", version: "1" }, primaryType: "BurnIntent", message };
  return {
    typedData: [typedData],
    burnIntents: [message],
    fee: { maxFee: maxFee.toString(), transferFeeBps: dest.key === "arc" ? 0 : GATEWAY_TRANSFER_FEE_BPS, gasFeeUsdc: source.gasFeeUsdc },
    submit: "POST /v1/circle/gateway/transfer with { environment, destination, burnIntents, signatures }",
  };
}

/** Sends signed burn intents to Gateway and returns the attestation plus the unsigned mint on the destination. */
export async function submitGatewayTransfer(fetchImpl: FetchLike, input: { environment: ArcEnvironment; destination: string; burnIntents: readonly unknown[]; signatures: readonly Hex[] }): Promise<GatewayTransferResult> {
  const dest = gatewayChain(input.destination);
  if (!dest) throw new LykiaHttpError("INVALID_REQUEST", 400, `Gateway does not reach ${input.destination}.`);
  if (input.burnIntents.length === 0 || input.burnIntents.length !== input.signatures.length) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send one signature per burn intent.");
  const body = input.burnIntents.map((burnIntent, i) => ({ burnIntent, signature: input.signatures[i] }));
  const response = await circleFetch(fetchImpl, `${GATEWAY_API[input.environment]}/v1/transfer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }, "Circle Gateway");
  const text = await response.text();
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Gateway refused the transfer (${response.status}).`, { gateway: text.slice(0, 500) });
  const json = JSON.parse(text) as { attestation?: Hex; signature?: Hex; transferId?: string; id?: string };
  if (!json.attestation || !json.signature) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Gateway returned no attestation.", { gateway: text.slice(0, 500) });
  return {
    attestation: json.attestation,
    signature: json.signature,
    transferId: json.transferId ?? json.id ?? null,
    mint: { chainId: dest.chainId[input.environment], to: GATEWAY_MINTER[input.environment], data: encodeFunctionData({ abi: GATEWAY_MINTER_ABI, functionName: "gatewayMint", args: [json.attestation, json.signature] }), value: "0" },
  };
}
