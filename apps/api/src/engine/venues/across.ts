/**
 * Across out of Arc: USDC deposited into Across's SpokePool on Arc, filled
 * on the destination chain by an Across relayer. Cross-chain: the money
 * arrives on the other chain, not on Arc.
 *
 * The quote comes from Across's official API (app.across.to/api:
 * /available-routes and /suggested-fees). Lykia checks every field it uses
 * before encoding anything itself: the SpokePool must be the registry's,
 * the input token Arc's USDC, the output token the USDC Across lists for
 * that route, the amount within Across's limits, the output at most the
 * input and equal to the input minus the quoted fee, and the quote time
 * and fill deadline sane. Lykia then encodes depositV3(depositor = the
 * account, recipient, USDC, output USDC, amount, outputAmount, chain,
 * exclusiveRelayer, quoteTimestamp, fillDeadline, exclusivityDeadline,
 * "0x") from those checked fields. The batch [USDC.approve(SpokePool),
 * Memo(depositV3)] runs through Multicall3From like every other step.
 */
import { getProtocol, sameAddress, type Address, type ArcEnvironment } from "@lykia/core";
import { encodeFunctionData, type Hex } from "viem";
import type { FetchLike } from "../../health/dependencies.js";
import { ACROSS_SPOKE_POOL_ABI } from "../abis.js";
import type { RawCall } from "../calls.js";

export const ACROSS_API = "https://app.across.to/api";
const ARC_CHAIN_ID = 5042;
const ZERO = "0x0000000000000000000000000000000000000000";
/** A quote older than this (seconds, against the server clock) is refused. */
const MAX_QUOTE_AGE_S = 600;

export interface AcrossQuote {
  readonly spokePool: Address;
  readonly outputToken: Address;
  readonly amountIn: bigint;
  /** What the relayer must deliver to the recipient on the destination chain (base units). */
  readonly amountOut: bigint;
  /** Across's total relay fee in USDC base units. */
  readonly feeUnits: bigint;
  readonly quoteTimestamp: number;
  readonly fillDeadline: number;
  readonly exclusiveRelayer: Address;
  readonly exclusivityDeadline: number;
  readonly timeEstimateSeconds: number | null;
}

export function acrossSpokePool(environment: ArcEnvironment): Address | null {
  return (getProtocol("across")?.deployments[environment]?.contracts.spokePool as Address | undefined) ?? null;
}

/** The destination chain's USDC on the Arc route, from Across's own route list. */
async function routeOutput(fetchImpl: FetchLike, usdc: Address, destinationChainId: number): Promise<Address | null> {
  const response = await fetchImpl(`${ACROSS_API}/available-routes?originChainId=${ARC_CHAIN_ID}&destinationChainId=${destinationChainId}`, { signal: AbortSignal.timeout(6_000) });
  if (!response.ok) return null;
  const body = (await response.json()) as Array<{ originChainId?: number; originToken?: string; destinationChainId?: number; destinationToken?: string; destinationTokenSymbol?: string; isNative?: boolean }>;
  if (!Array.isArray(body)) return null;
  const route = body.find((r) => r.originChainId === ARC_CHAIN_ID && r.destinationChainId === destinationChainId && r.originToken && sameAddress(r.originToken, usdc) && r.destinationTokenSymbol === "USDC" && r.isNative !== true);
  return (route?.destinationToken as Address | undefined) ?? null;
}

const uint = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,78}$/u.test(v) ? BigInt(v) : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);

/**
 * Across's quote for bridging `amount` USDC from Arc to
 * `destinationChainId`, checked field by field; null when the API does not
 * answer or anything does not match.
 */
export async function quoteAcross(fetchImpl: FetchLike, environment: ArcEnvironment, input: { readonly user: Address; readonly recipient: Address; readonly usdc: Address; readonly amount: bigint; readonly destinationChainId: number }, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<AcrossQuote | null> {
  const spokePool = acrossSpokePool(environment);
  if (environment !== "mainnet" || !spokePool || input.amount <= 0n) return null;
  try {
    const outputToken = await routeOutput(fetchImpl, input.usdc, input.destinationChainId);
    if (!outputToken) return null;
    const query = new URLSearchParams({ inputToken: input.usdc, outputToken, originChainId: String(ARC_CHAIN_ID), destinationChainId: String(input.destinationChainId), amount: input.amount.toString(), depositor: input.user, recipient: input.recipient });
    const response = await fetchImpl(`${ACROSS_API}/suggested-fees?${query.toString()}`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      spokePoolAddress?: string;
      outputAmount?: string;
      totalRelayFee?: { total?: string };
      timestamp?: string;
      fillDeadline?: string;
      exclusiveRelayer?: string;
      exclusivityDeadline?: number | string;
      isAmountTooLow?: boolean;
      estimatedFillTimeSec?: number;
      limits?: { minDeposit?: string; maxDeposit?: string };
      inputToken?: { address?: string; chainId?: number };
      outputToken?: { address?: string; chainId?: number };
    };
    if (!body.spokePoolAddress || !sameAddress(body.spokePoolAddress, spokePool)) return null;
    if (!body.inputToken?.address || body.inputToken.chainId !== ARC_CHAIN_ID || !sameAddress(body.inputToken.address, input.usdc)) return null;
    if (!body.outputToken?.address || body.outputToken.chainId !== input.destinationChainId || !sameAddress(body.outputToken.address, outputToken)) return null;
    if (body.isAmountTooLow !== false) return null;
    const amountOut = uint(body.outputAmount);
    const fee = uint(body.totalRelayFee?.total);
    const min = uint(body.limits?.minDeposit);
    const max = uint(body.limits?.maxDeposit);
    const quoteTimestamp = Number(body.timestamp);
    const fillDeadline = Number(body.fillDeadline);
    const exclusivityDeadline = Number(body.exclusivityDeadline ?? 0);
    const exclusiveRelayer = (body.exclusiveRelayer ?? ZERO) as Address;
    if (amountOut === null || fee === null || amountOut <= 0n || amountOut > input.amount || amountOut !== input.amount - fee) return null;
    if ((min !== null && input.amount < min) || (max !== null && input.amount > max)) return null;
    if (!Number.isSafeInteger(quoteTimestamp) || Math.abs(nowSeconds - quoteTimestamp) > MAX_QUOTE_AGE_S) return null;
    if (!Number.isSafeInteger(fillDeadline) || fillDeadline <= nowSeconds || fillDeadline > nowSeconds + 86_400) return null;
    if (!Number.isSafeInteger(exclusivityDeadline) || exclusivityDeadline < 0 || !/^0x[0-9a-fA-F]{40}$/u.test(exclusiveRelayer)) return null;
    return { spokePool, outputToken, amountIn: input.amount, amountOut, feeUnits: fee, quoteTimestamp, fillDeadline, exclusiveRelayer, exclusivityDeadline, timeEstimateSeconds: typeof body.estimatedFillTimeSec === "number" ? body.estimatedFillTimeSec : null };
  } catch {
    return null;
  }
}

export const acrossCalls = {
  /** depositV3 from the account: the relayer pays `outputAmount` of `outputToken` to `recipient` on the destination chain. */
  deposit(q: AcrossQuote, account: Address, recipient: Address, inputToken: Address, destinationChainId: number, label: string): RawCall {
    return {
      to: q.spokePool,
      data: encodeFunctionData({ abi: ACROSS_SPOKE_POOL_ABI, functionName: "depositV3", args: [account, recipient, inputToken, q.outputToken, q.amountIn, q.amountOut, BigInt(destinationChainId), q.exclusiveRelayer, q.quoteTimestamp, q.fillDeadline, q.exclusivityDeadline, "0x" as Hex] }),
      label,
    };
  },
};

/** Across's status for a deposit by its Arc transaction ("filled", "pending", "expired", "refunded"); null when unreadable. */
export async function acrossStatus(fetchImpl: FetchLike, depositTxHash: string): Promise<{ status: string; fillTx: string | null; destinationChainId: number | null } | null> {
  try {
    const response = await fetchImpl(`${ACROSS_API}/deposit/status?originChainId=${ARC_CHAIN_ID}&depositTxnRef=${depositTxHash}`, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { status?: string; fillTx?: string | null; destinationChainId?: number };
    return typeof body.status === "string" ? { status: body.status, fillTx: body.fillTx ?? null, destinationChainId: typeof body.destinationChainId === "number" ? body.destinationChainId : null } : null;
  } catch {
    return null;
  }
}
