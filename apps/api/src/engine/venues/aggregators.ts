/**
 * Swap aggregators on Arc whose official APIs return calldata: Sushi (public
 * API, settles through RedSnwapper) and 0x (keyed API, settles through
 * AllowanceHolder; off until ZEROX_API_KEY is set).
 *
 * Lykia never signs API calldata blindly. At build time it re-fetches the
 * route for the account, checks the target contract against the registry,
 * decodes the call and checks the function, tokens, amount and recipient.
 * Sushi's snwap is re-encoded with Lykia's own minimum output (RedSnwapper
 * enforces it on the recipient's balance). 0x's settler data cannot be
 * re-encoded, so the build refuses unless the API's own minBuyAmount is at
 * least Lykia's minimum.
 */
import { getProtocol, sameAddress, type Address, type ArcEnvironment } from "@lykia/core";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import type { FetchLike } from "../../health/dependencies.js";
import { ALLOWANCE_HOLDER_ABI, RED_SNWAPPER_ABI } from "../abis.js";
import type { RawCall } from "../calls.js";

const SUSHI_API = "https://api.sushi.com/swap/v7";
const ZEROX_API = "https://api.0x.org/swap/allowance-holder/quote";
const ARC_CHAIN_ID = 5042;
/** Quotes need a sender; Multicall3From (public Arc infrastructure, holds nothing) stands in until the account is known. */
const QUOTE_SENDER: Address = "0x522fAf9A91c41c443c66765030741e4AaCe147D0";

export interface AggregatorQuote {
  readonly amountOut: bigint;
  readonly gas: bigint;
  readonly to: Address;
  readonly data: Hex;
}

function redSnwapper(environment: ArcEnvironment): Address | null {
  return (getProtocol("sushiswap")?.deployments[environment]?.contracts.redSnwapper as Address | undefined) ?? null;
}

function allowanceHolder(environment: ArcEnvironment): Address | null {
  return (getProtocol("zerox")?.deployments[environment]?.contracts.allowanceHolder as Address | undefined) ?? null;
}

/** Sushi's route for `amountIn`; null when the API does not answer or the calldata is not a snwap to RedSnwapper. */
export async function quoteSushi(fetchImpl: FetchLike, environment: ArcEnvironment, tokenIn: Address, tokenOut: Address, amountIn: bigint, sender: Address = QUOTE_SENDER, slippageBps = 50): Promise<AggregatorQuote | null> {
  const target = redSnwapper(environment);
  if (environment !== "mainnet" || !target || amountIn <= 0n) return null;
  try {
    const url = `${SUSHI_API}/${ARC_CHAIN_ID}?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amount=${amountIn}&maxSlippage=${slippageBps / 10_000}&sender=${sender}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { status?: string; assumedAmountOut?: string; gasSpent?: number; tx?: { to?: string; data?: string; value?: string | number } };
    if (body.status !== "Success" || !body.tx?.to || !body.tx.data || !body.assumedAmountOut) return null;
    if (!sameAddress(body.tx.to, target) || BigInt(body.tx.value ?? 0) !== 0n) return null;
    const call = checkSnwap(body.tx.data as Hex, { tokenIn, tokenOut, amountIn, recipient: sender });
    if (!call) return null;
    return { amountOut: BigInt(body.assumedAmountOut), gas: BigInt(Math.max(0, Math.round(body.gasSpent ?? 0))), to: target, data: body.tx.data as Hex };
  } catch {
    return null;
  }
}

/** The decoded snwap when it moves exactly what was asked to whom it should; null otherwise. */
export function checkSnwap(data: Hex, expect: { tokenIn: Address; tokenOut: Address; amountIn: bigint; recipient: Address }) {
  try {
    const decoded = decodeFunctionData({ abi: RED_SNWAPPER_ABI, data });
    if (decoded.functionName !== "snwap") return null;
    const [tokenIn, amountIn, recipient, tokenOut, amountOutMin, executor, executorData] = decoded.args;
    if (!sameAddress(tokenIn, expect.tokenIn) || !sameAddress(tokenOut, expect.tokenOut) || amountIn !== expect.amountIn || !sameAddress(recipient, expect.recipient)) return null;
    return { tokenIn, amountIn, recipient, tokenOut, amountOutMin, executor, executorData };
  } catch {
    return null;
  }
}

/** Sushi's snwap for the account, re-encoded with Lykia's minimum output. */
export async function sushiCall(fetchImpl: FetchLike, environment: ArcEnvironment, tokenIn: Address, tokenOut: Address, amountIn: bigint, account: Address, minOut: bigint, label: string): Promise<{ call: RawCall; quoted: bigint } | null> {
  const quote = await quoteSushi(fetchImpl, environment, tokenIn, tokenOut, amountIn, account);
  if (!quote) return null;
  const s = checkSnwap(quote.data, { tokenIn, tokenOut, amountIn, recipient: account });
  if (!s) return null;
  const data = encodeFunctionData({ abi: RED_SNWAPPER_ABI, functionName: "snwap", args: [s.tokenIn, s.amountIn, s.recipient, s.tokenOut, minOut, s.executor, s.executorData] });
  return { call: { to: quote.to, data, label }, quoted: quote.amountOut };
}

/** 0x's quote for the taker (needs the key); null without a key, on any API error, or when the transaction is not AllowanceHolder.exec for the sell token. */
export async function quoteZeroX(fetchImpl: FetchLike, apiKey: string | null, environment: ArcEnvironment, tokenIn: Address, tokenOut: Address, amountIn: bigint, taker: Address = QUOTE_SENDER, slippageBps = 50): Promise<(AggregatorQuote & { readonly minOut: bigint }) | null> {
  const holder = allowanceHolder(environment);
  if (!apiKey || environment !== "mainnet" || !holder || amountIn <= 0n) return null;
  try {
    const url = `${ZEROX_API}?chainId=${ARC_CHAIN_ID}&sellToken=${tokenIn}&buyToken=${tokenOut}&sellAmount=${amountIn}&taker=${taker}&slippageBps=${slippageBps}`;
    const response = await fetchImpl(url, { headers: { "0x-api-key": apiKey, "0x-version": "v2" }, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { liquidityAvailable?: boolean; buyAmount?: string; minBuyAmount?: string; transaction?: { to?: string; data?: string; value?: string; gas?: string } };
    const tx = body.transaction;
    if (body.liquidityAvailable === false || !tx?.to || !tx.data || !body.buyAmount || !body.minBuyAmount) return null;
    if (!sameAddress(tx.to, holder) || BigInt(tx.value ?? "0") !== 0n) return null;
    const decoded = decodeFunctionData({ abi: ALLOWANCE_HOLDER_ABI, data: tx.data as Hex });
    if (decoded.functionName !== "exec" || !sameAddress(decoded.args[1], tokenIn) || decoded.args[2] !== amountIn) return null;
    return { amountOut: BigInt(body.buyAmount), minOut: BigInt(body.minBuyAmount), gas: BigInt(tx.gas ?? "0"), to: holder, data: tx.data as Hex };
  } catch {
    return null;
  }
}

export function zeroXConfigured(): boolean {
  return typeof process.env.ZEROX_API_KEY === "string" && process.env.ZEROX_API_KEY.trim().length > 0;
}

export function zeroXKey(): string | null {
  return zeroXConfigured() ? process.env.ZEROX_API_KEY!.trim() : null;
}
