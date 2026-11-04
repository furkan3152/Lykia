/**
 * CCTP V2 extras: live fees per route (keyless Iris API), transfers that
 * use Circle's Forwarding Service, so the destination mint happens without
 * the user holding gas there, and the transfer's status (attestation and
 * forwarded mint). Lykia returns unsigned calls only.
 *
 * Arc as the source: Arc attests after one block (~0.5 s), so Circle lists
 * Fast Transfer as "N/A" from Arc and a Standard Transfer costs 0 bps
 * (developers.circle.com/cctp/concepts/supported-chains-and-domains, /fees).
 * Lykia therefore burns from Arc with minFinalityThreshold 2000; the only fee
 * on a forwarded transfer out of Arc is the Forwarding Service fee.
 */
import { contractAddress, CCTP_DESTINATIONS, type Address, type ArcEnvironment, type UnsignedTransaction } from "@lykia/core";
import { encodeFunctionData, pad, parseAbi, type Hex } from "viem";
import { IRIS_API } from "../engine/adapters.js";
import { CCTP_FORWARDING_HOOK_DATA, TOKEN_MESSENGER_HOOK_ABI } from "../engine/abis.js";
import type { FetchLike } from "../health/dependencies.js";
import { circleFetch } from "./http.js";
import { LykiaHttpError } from "../http/errors.js";

export { TOKEN_MESSENGER_HOOK_ABI };
const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

/** Forwarding Service hook: magic "cctp-forward" in 24 bytes, version 0, no extra data (developers.circle.com/cctp/concepts/forwarding-service). */
export const FORWARDING_HOOK_DATA: Hex = CCTP_FORWARDING_HOOK_DATA;

/** CCTP V2 finality thresholds: 1000 = Fast Transfer, 2000 = Standard (finalized). */
export const CCTP_FAST = 1000;
export const CCTP_STANDARD = 2000;

export interface CctpFee {
  readonly finalityThreshold: number;
  /** Protocol fee rate in basis points. */
  readonly minimumFeeBps: number;
  /** Forwarding Service fee (destination gas + service fee) in USDC base units, per gas level. */
  readonly forwardFee: { readonly low: string; readonly med: string; readonly high: string } | null;
}

type RawForwardFee = { low?: number; med?: number; medium?: number; high?: number };

/** The API reference names the middle level `medium`; the live API answers `med`. Both are read. */
function forwardFeeOf(raw: RawForwardFee | undefined): CctpFee["forwardFee"] {
  if (!raw) return null;
  const med = raw.med ?? raw.medium;
  if (typeof raw.low !== "number" || typeof med !== "number" || typeof raw.high !== "number") return null;
  return { low: String(raw.low), med: String(med), high: String(raw.high) };
}

export async function cctpFees(fetchImpl: FetchLike, environment: ArcEnvironment, destinationDomain: number, forward: boolean): Promise<CctpFee[]> {
  const url = `${IRIS_API[environment]}/v2/burn/USDC/fees/26/${destinationDomain}${forward ? "?forward=true" : ""}`;
  const response = await circleFetch(fetchImpl, url, { signal: AbortSignal.timeout(6_000) }, "Circle's CCTP API");
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Circle's CCTP fee API answered ${response.status}.`);
  const rows = (await response.json()) as { finalityThreshold: number; minimumFee: number; forwardFee?: RawForwardFee }[];
  if (!Array.isArray(rows)) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Circle's CCTP fee API returned an unexpected shape.");
  return rows.map((r) => ({ finalityThreshold: r.finalityThreshold, minimumFeeBps: r.minimumFee, forwardFee: forwardFeeOf(r.forwardFee) }));
}

/** Protocol fee for `units` at `bps`, rounded up (Circle's formula: units * bps / 10_000). */
export function cctpProtocolFee(units: bigint, bps: number): bigint {
  return (units * BigInt(Math.round(bps * 100)) + 999_999n) / 1_000_000n;
}

/**
 * The fee for a forwarded Standard Transfer out of Arc, for the planner:
 * protocol fee at the standard threshold plus the `med` forwarding fee
 * (Circle recommends `med` or higher). Null when the fee cannot be read or
 * the route has no forwarding fee; the caller then falls back to a plain
 * burn and says so. Never throws.
 */
export async function forwardedRouteFee(fetchImpl: FetchLike, environment: ArcEnvironment, destinationDomain: number, units: bigint): Promise<{ maxFee: bigint; protocol: bigint; forward: bigint } | null> {
  try {
    const fees = await cctpFees(fetchImpl, environment, destinationDomain, true);
    const standard = fees.find((f) => f.finalityThreshold === CCTP_STANDARD);
    if (!standard?.forwardFee) return null;
    const protocol = cctpProtocolFee(units, standard.minimumFeeBps);
    const forward = BigInt(standard.forwardFee.med);
    return { maxFee: protocol + forward, protocol, forward };
  } catch {
    return null;
  }
}

/**
 * approve + depositForBurnWithHook with the forwarding hook. `maxFee` covers
 * the protocol fee and the `med` forwarding fee; the recipient receives
 * `amountUnits` and the burn is `amountUnits + maxFee`. Burns from Arc use
 * the standard threshold (Fast Transfer is not applicable from Arc); `fast`
 * is accepted for compatibility and reported as not applicable.
 */
export async function forwardedBridge(fetchImpl: FetchLike, input: { environment: ArcEnvironment; owner: Address; recipient: Address; destination: string; amountUnits: bigint; fast: boolean }): Promise<{ transactions: UnsignedTransaction[]; maxFee: string; burn: string; fee: CctpFee; finalityThreshold: number; notes: string[] }> {
  const dest = CCTP_DESTINATIONS.find((d) => d.key === input.destination);
  if (!dest || dest.vm !== "evm" || !dest.forwarding) throw new LykiaHttpError("INVALID_REQUEST", 400, `Forwarded CCTP transfers go to EVM destinations: ${CCTP_DESTINATIONS.filter((d) => d.vm === "evm" && d.forwarding).map((d) => d.key).join(", ")}.`);
  if (input.amountUnits <= 0n) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send a positive amount.");
  const fees = await cctpFees(fetchImpl, input.environment, dest.domain, true);
  const fee = fees.find((f) => f.finalityThreshold === CCTP_STANDARD) ?? fees[0];
  if (!fee || !fee.forwardFee) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Circle returned no forwarding fee for this route.");
  const protocol = cctpProtocolFee(input.amountUnits, fee.minimumFeeBps);
  const maxFee = protocol + BigInt(fee.forwardFee.med);
  const burn = input.amountUnits + maxFee;
  const usdc = contractAddress("usdc", input.environment) as Address;
  const messenger = contractAddress("tokenMessengerV2", input.environment) as Address;
  const chainId = input.environment === "mainnet" ? 5042 : 5042002;
  const notes = ["Arc attests in about half a second, so this is a Standard Transfer (0 bps protocol fee); Circle's Forwarding Service submits the mint on the destination.", "Track it with GET /v1/circle/cctp/status?txHash=… (attestation, forwardState, destination mint hash)."];
  if (input.fast) notes.unshift("Fast Transfer is not applicable from Arc (Circle lists it as N/A); the standard path is already sub-second to attest.");
  return {
    maxFee: maxFee.toString(),
    burn: burn.toString(),
    fee,
    finalityThreshold: CCTP_STANDARD,
    notes,
    transactions: [
      { chainId, from: input.owner, to: usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [messenger, burn] }), value: "0", label: `Approve ${burn} USDC units to CCTP` },
      {
        chainId,
        from: input.owner,
        to: messenger,
        data: encodeFunctionData({ abi: TOKEN_MESSENGER_HOOK_ABI, functionName: "depositForBurnWithHook", args: [burn, dest.domain, pad(input.recipient.toLowerCase() as Hex, { size: 32 }), usdc, pad("0x0000000000000000000000000000000000000000", { size: 32 }), maxFee, CCTP_STANDARD, FORWARDING_HOOK_DATA] }),
        value: "0",
        label: `Bridge to ${dest.name} with Circle forwarding (mint paid on arrival)`,
      },
    ],
  };
}

export interface CctpTransferStatus {
  readonly found: boolean;
  /** Iris attestation status: "complete" or "pending_confirmations". */
  readonly status: string | null;
  readonly delayReason: string | null;
  /** Forwarding Service state (e.g. PENDING, COMPLETE) when the burn carried the forwarding hook. */
  readonly forwardState: string | null;
  readonly forwardTxHash: string | null;
  readonly destinationMintTxHash: string | null;
  readonly destinationDomain: number | null;
  readonly attestation: string | null;
  readonly message: string | null;
}

/**
 * Status of a CCTP burn sent from Arc (GET /v2/messages/26?transactionHash=,
 * keyless). A 404 means Iris has not seen the burn yet.
 * https://developers.circle.com/api-reference/cctp/all/get-messages-v2
 */
export async function cctpTransferStatus(fetchImpl: FetchLike, environment: ArcEnvironment, transactionHash: string): Promise<CctpTransferStatus> {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(transactionHash)) throw new LykiaHttpError("INVALID_REQUEST", 400, "Not a transaction hash.");
  const response = await circleFetch(fetchImpl, `${IRIS_API[environment]}/v2/messages/26?transactionHash=${transactionHash}`, { signal: AbortSignal.timeout(6_000) }, "Circle's CCTP API");
  const none: CctpTransferStatus = { found: false, status: null, delayReason: null, forwardState: null, forwardTxHash: null, destinationMintTxHash: null, destinationDomain: null, attestation: null, message: null };
  if (response.status === 404) return none;
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Circle's CCTP API answered ${response.status}.`);
  const body = (await response.json()) as { messages?: Array<{ status?: string; delayReason?: string | null; forwardState?: string; forwardTxHash?: string; destinationMintTxHash?: string; attestation?: string; message?: string; decodedMessage?: { destinationDomain?: string } | null }> };
  const m = body.messages?.[0];
  if (!m) return none;
  const hex = (v: string | undefined): string | null => (v && v.startsWith("0x") && v !== "0x" ? v : null);
  return {
    found: true,
    status: m.status ?? null,
    delayReason: m.delayReason ?? null,
    forwardState: m.forwardState ?? null,
    forwardTxHash: hex(m.forwardTxHash),
    destinationMintTxHash: hex(m.destinationMintTxHash),
    destinationDomain: m.decodedMessage?.destinationDomain !== undefined ? Number(m.decodedMessage.destinationDomain) : null,
    attestation: hex(m.attestation),
    message: hex(m.message),
  };
}
