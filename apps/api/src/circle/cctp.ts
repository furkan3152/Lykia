/**
 * CCTP V2 extras: live fees per route (keyless Iris API) and transfers that
 * use Circle's Forwarding Service, so the destination mint happens without
 * the user holding gas there. Lykia returns unsigned calls only.
 */
import { contractAddress, CCTP_DESTINATIONS, type Address, type ArcEnvironment, type UnsignedTransaction } from "@lykia/core";
import { encodeFunctionData, pad, parseAbi, type Hex } from "viem";
import { IRIS_API } from "../engine/adapters.js";
import type { FetchLike } from "../health/dependencies.js";
import { circleFetch } from "./http.js";
import { LykiaHttpError } from "../http/errors.js";

export const TOKEN_MESSENGER_HOOK_ABI = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);
const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

/** Forwarding Service hook: magic "cctp-forward" in 24 bytes, version 0, no extra data (developers.circle.com/cctp/concepts/forwarding-service). */
export const FORWARDING_HOOK_DATA: Hex = "0x636374702d666f72776172640000000000000000000000000000000000000000";

export interface CctpFee {
  readonly finalityThreshold: number;
  /** Protocol fee rate in basis points. */
  readonly minimumFeeBps: number;
  readonly forwardFee: { readonly low: string; readonly med: string; readonly high: string } | null;
}

export async function cctpFees(fetchImpl: FetchLike, environment: ArcEnvironment, destinationDomain: number, forward: boolean): Promise<CctpFee[]> {
  const url = `${IRIS_API[environment]}/v2/burn/USDC/fees/26/${destinationDomain}${forward ? "?forward=true" : ""}`;
  const response = await circleFetch(fetchImpl, url, { signal: AbortSignal.timeout(6_000) }, "Circle's CCTP API");
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Circle's CCTP fee API answered ${response.status}.`);
  const rows = (await response.json()) as { finalityThreshold: number; minimumFee: number; forwardFee?: { low: number; med: number; high: number } }[];
  return rows.map((r) => ({ finalityThreshold: r.finalityThreshold, minimumFeeBps: r.minimumFee, forwardFee: r.forwardFee ? { low: String(r.forwardFee.low), med: String(r.forwardFee.med), high: String(r.forwardFee.high) } : null }));
}

/**
 * approve + depositForBurnWithHook with the forwarding hook. `maxFee` covers
 * the protocol fee and the `med` forwarding fee; the recipient receives
 * `amountUnits` and the burn is `amountUnits + maxFee`.
 */
export async function forwardedBridge(fetchImpl: FetchLike, input: { environment: ArcEnvironment; owner: Address; recipient: Address; destination: string; amountUnits: bigint; fast: boolean }): Promise<{ transactions: UnsignedTransaction[]; maxFee: string; burn: string; fee: CctpFee }> {
  const dest = CCTP_DESTINATIONS.find((d) => d.key === input.destination);
  if (!dest || dest.vm !== "evm") throw new LykiaHttpError("INVALID_REQUEST", 400, `Forwarded CCTP transfers go to EVM destinations: ${CCTP_DESTINATIONS.filter((d) => d.vm === "evm").map((d) => d.key).join(", ")}.`);
  const fees = await cctpFees(fetchImpl, input.environment, dest.domain, true);
  const fee = fees.find((f) => f.finalityThreshold === (input.fast ? 1000 : 2000)) ?? fees[0];
  if (!fee || !fee.forwardFee) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Circle returned no forwarding fee for this route.");
  const protocol = (input.amountUnits * BigInt(Math.round(fee.minimumFeeBps * 100)) + 999_999n) / 1_000_000n;
  const maxFee = protocol + BigInt(fee.forwardFee.med);
  const burn = input.amountUnits + maxFee;
  const usdc = contractAddress("usdc", input.environment) as Address;
  const messenger = contractAddress("tokenMessengerV2", input.environment) as Address;
  const chainId = input.environment === "mainnet" ? 5042 : 5042002;
  return {
    maxFee: maxFee.toString(),
    burn: burn.toString(),
    fee,
    transactions: [
      { chainId, from: input.owner, to: usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [messenger, burn] }), value: "0", label: `Approve ${burn} USDC units to CCTP` },
      {
        chainId,
        from: input.owner,
        to: messenger,
        data: encodeFunctionData({ abi: TOKEN_MESSENGER_HOOK_ABI, functionName: "depositForBurnWithHook", args: [burn, dest.domain, pad(input.recipient.toLowerCase() as Hex, { size: 32 }), usdc, pad("0x0000000000000000000000000000000000000000", { size: 32 }), maxFee, input.fast ? 1000 : 2000, FORWARDING_HOOK_DATA] }),
        value: "0",
        label: `Bridge to ${dest.name} with Circle forwarding (mint paid on arrival)`,
      },
    ],
  };
}
