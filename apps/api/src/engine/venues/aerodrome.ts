/**
 * Concentrated-liquidity pools quoted exactly, and Aerodrome Slipstream
 * executed through its Metarouter.
 *
 * Quotes: core's LykiaClQuoter runtime code is placed at a throwaway
 * address through an eth_call state override; it asks the pool to swap and
 * reverts inside `uniswapV3SwapCallback` with the deltas, so the quote is
 * the pool's own math at the current state and nothing moves. Works for any
 * Uniswap V3 style pool (Aerodrome Slipstream, Synthra, SushiSwap V3).
 *
 * Execution: the Metarouter's verified source (Etherscan chain 5042,
 * V3/src/metarouter/Metarouter.sol, solc 0.8.36) takes
 * `execute(bytes commands, bytes[] inputs, uint256 deadline)`. Command 0x00
 * is CL_SWAP_EXACT_IN with an ABI-encoded
 * `SwapExactInParams(address[] pools, address tokenIn, BalanceSpend(uint8
 * mode, uint256 value) amountIn, bool payerIsUser, uint256 minAmountOut,
 * address recipient)`. With `payerIsUser` and `mode = Amount` the router
 * pulls exactly `amountIn` from the logical sender through `transferFrom`
 * inside the pool callback and reverts below `minAmountOut`. The batch
 * [USDC.approve(Metarouter), Memo(Metarouter.execute(...))] through
 * Multicall3From was simulated on Arc mainnet on 2026-11-01: 1000 USDC into
 * the USDC/EURC tick-spacing-1 pool passed with a 890 EURC minimum (quote
 * 895.97) and reverted with a 897 minimum.
 */
import { getProtocol, lykiaContracts, type Address, type ArcEnvironment } from "@lykia/core";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from "viem";
import type { ArcChains } from "../../chains/arc.js";
import { CL_POOL_ABI } from "../abis.js";
import type { RawCall } from "../calls.js";

/** Throwaway address the quoter code is overridden onto (never holds anything). */
const CL_QUOTER_ADDRESS: Address = "0x00000000000000000000000000006c796b696151";
const QUOTER = lykiaContracts.lykiaClQuoterArtifact;

export const METAROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const CL_SWAP_EXACT_IN = "0x00" as const;
const SWAP_EXACT_IN_PARAMS = [
  {
    type: "tuple",
    components: [
      { name: "pools", type: "address[]" },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "tuple", components: [{ name: "mode", type: "uint8" }, { name: "value", type: "uint256" }] },
      { name: "payerIsUser", type: "bool" },
      { name: "minAmountOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
  },
] as const;

export interface ClPoolInfo {
  readonly venue: string;
  readonly label: string;
  readonly pool: Address;
  readonly pair: readonly [string, string];
  /** True when Lykia can execute swaps in this pool. */
  readonly executable: boolean;
  readonly note: string;
}

/** Pools quoted with the CL quoter, per environment. */
export const CL_POOLS: Readonly<Record<ArcEnvironment, readonly ClPoolInfo[]>> = {
  mainnet: [
    { venue: "aerodrome-slipstream", label: "Aerodrome Slipstream USDC/EURC", pool: "0x6F57B4C22155ceF09F17184c954f227FF0493742", pair: ["USDC", "EURC"], executable: true, note: "Exact quote; swaps through the Aerodrome Metarouter." },
    { venue: "aerodrome-slipstream", label: "Aerodrome Slipstream USDC/cirBTC", pool: "0x86A68d86465bCf19779454e1b4d31368740503c7", pair: ["USDC", "cirBTC"], executable: true, note: "Exact quote; swaps through the Aerodrome Metarouter." },
    { venue: "synthra", label: "Synthra USDC/EURC 1%", pool: "0xA22a60ef44780f6BA5fb3F70914C55F88766b5FD", pair: ["USDC", "EURC"], executable: false, note: "Exact quote. No verified Synthra router on Arc, and no swaps in its pools in the last ~300k blocks: not executable." },
    { venue: "synthra", label: "Synthra USDC/EURC 0.3%", pool: "0x7Eb79EdB12953Eda674D0B66Ecd97CC1a4036B6C", pair: ["USDC", "EURC"], executable: false, note: "Exact quote. No verified Synthra router on Arc: not executable." },
    { venue: "sushiswap-v3", label: "SushiSwap V3 USDC/EURC 1%", pool: "0xB50D2ed03F5922863Ae072A017d9583d6D9ED764", pair: ["USDC", "EURC"], executable: false, note: "Exact quote. The router that swaps here (0x09AD…4Afa) has no verified source: not executable." },
  ],
  testnet: [],
};

export function metarouter(environment: ArcEnvironment): Address | null {
  return (getProtocol("aerodrome-slipstream")?.deployments[environment]?.contracts.metarouter as Address | undefined) ?? null;
}

export interface ClQuote {
  readonly amountOut: bigint;
  readonly zeroForOne: boolean;
}

/** Exact-input quote for `pool` (null when the pool or the override is unavailable). */
export async function quoteCl(chains: ArcChains, environment: ArcEnvironment, pool: Address, tokenIn: Address, amountIn: bigint): Promise<ClQuote | null> {
  try {
    const client = chains.client(environment);
    const token0 = await client.readContract({ address: pool, abi: CL_POOL_ABI, functionName: "token0" });
    const zeroForOne = token0.toLowerCase() === tokenIn.toLowerCase();
    const data = encodeFunctionData({ abi: QUOTER.abi, functionName: "quoteExactIn", args: [pool, zeroForOne, amountIn] });
    const result = await client.call({ to: CL_QUOTER_ADDRESS, data, stateOverride: [{ address: CL_QUOTER_ADDRESS, code: QUOTER.deployedBytecode as Hex }] });
    if (!result.data) return null;
    const amountOut = decodeFunctionResult({ abi: QUOTER.abi, functionName: "quoteExactIn", data: result.data }) as bigint;
    return amountOut > 0n ? { amountOut, zeroForOne } : null;
  } catch {
    return null;
  }
}

export const aerodromeCalls = {
  /** Metarouter CL_SWAP_EXACT_IN: the signer pays `amountIn` itself and receives at least `minOut`. */
  swapExactIn(router: Address, pool: Address, tokenIn: Address, amountIn: bigint, minOut: bigint, recipient: Address, deadline: bigint, label: string): RawCall {
    const input = encodeAbiParameters(SWAP_EXACT_IN_PARAMS, [{ pools: [pool], tokenIn, amountIn: { mode: 0, value: amountIn }, payerIsUser: true, minAmountOut: minOut, recipient }]);
    return { to: router, data: encodeFunctionData({ abi: METAROUTER_ABI, functionName: "execute", args: [CL_SWAP_EXACT_IN, [input], deadline] }), label };
  },
};
