/**
 * Uniswap on Arc: v3 single-pool quotes on every fee tier, v3 two-hop paths
 * through USDC, and v4 pools through V4Quoter / UniversalRouter. v4 swaps
 * pay through Permit2; the batch [token.approve(Permit2), Permit2.approve(
 * UniversalRouter), UniversalRouter.execute(V4_SWAP)] was simulated through
 * Multicall3From on 2026-11-01 (UniversalRouter v2.1.2 takes the
 * ExactInputSingleParams with `minHopPriceX36`).
 */
import { getProtocol, type Address, type ArcEnvironment } from "@lykia/core";
import { concat, encodeAbiParameters, encodeFunctionData, keccak256, numberToHex, pad, type Hex } from "viem";
import type { ArcChains } from "../../chains/arc.js";
import { PERMIT2_ABI, QUOTER_V2_ABI, QUOTER_V2_PATH_ABI, SWAP_ROUTER_02_ABI, SWAP_ROUTER_02_PATH_ABI, UNIVERSAL_ROUTER_ABI, V4_QUOTER_ABI, V4_STATE_VIEW_ABI } from "../abis.js";
import type { RawCall } from "../calls.js";

const V3_FEE_TIERS = [100, 500, 3000, 10000] as const;
const ZERO: Address = "0x0000000000000000000000000000000000000000";

export interface V3Quote {
  readonly kind: "v3";
  readonly fee: number;
  readonly amountOut: bigint;
  readonly gasEstimate: bigint;
}

export interface V3PathQuote {
  readonly kind: "v3-path";
  readonly path: Hex;
  readonly hops: readonly { readonly tokenIn: Address; readonly tokenOut: Address; readonly fee: number }[];
  readonly amountOut: bigint;
  readonly gasEstimate: bigint;
}

export interface V4PoolKey {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: Address;
}

export interface V4Quote {
  readonly kind: "v4";
  readonly key: V4PoolKey;
  readonly zeroForOne: boolean;
  readonly amountOut: bigint;
  readonly gasEstimate: bigint;
}

/** v4 fee tiers and their standard tick spacings (hookless pools). */
const V4_TIERS: readonly { readonly fee: number; readonly tickSpacing: number }[] = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
];

function contracts(environment: ArcEnvironment, id: "uniswap-v3" | "uniswap-v4"): Readonly<Record<string, Address>> | null {
  return getProtocol(id)?.deployments[environment]?.contracts ?? null;
}

export function v3Contracts(environment: ArcEnvironment) {
  const c = contracts(environment, "uniswap-v3");
  return c ? { quoter: c.quoterV2 as Address, router: c.swapRouter02 as Address } : null;
}

export function v4Contracts(environment: ArcEnvironment) {
  const c = contracts(environment, "uniswap-v4");
  return c ? { quoter: c.v4Quoter as Address, stateView: c.stateView as Address, router: c.universalRouter as Address, permit2: c.permit2 as Address } : null;
}

export async function quoteV3Single(chains: ArcChains, environment: ArcEnvironment, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<V3Quote[]> {
  const c = v3Contracts(environment);
  if (!c || amountIn <= 0n) return [];
  const client = chains.client(environment);
  const quotes = await Promise.all(
    V3_FEE_TIERS.map(async (fee): Promise<V3Quote | null> => {
      try {
        const { result } = await client.simulateContract({ address: c.quoter, abi: QUOTER_V2_ABI, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }] });
        return result[0] > 0n ? { kind: "v3", fee, amountOut: result[0], gasEstimate: (result as readonly unknown[])[3] as bigint ?? 0n } : null;
      } catch {
        return null;
      }
    }),
  );
  return quotes.filter((q): q is V3Quote => q !== null);
}

/** Uniswap v3 path encoding: token(20) | fee(3) | token(20) | ... */
export function encodeV3Path(hops: readonly { tokenIn: Address; tokenOut: Address; fee: number }[]): Hex {
  const parts: Hex[] = [hops[0]!.tokenIn];
  for (const hop of hops) parts.push(pad(numberToHex(hop.fee), { size: 3 }), hop.tokenOut);
  return concat(parts);
}

/** Two-hop quotes through `via` (USDC): every fee-tier pair that answers. */
export async function quoteV3TwoHop(chains: ArcChains, environment: ArcEnvironment, tokenIn: Address, via: Address, tokenOut: Address, amountIn: bigint): Promise<V3PathQuote[]> {
  const c = v3Contracts(environment);
  if (!c || amountIn <= 0n) return [];
  const client = chains.client(environment);
  const firsts = await quoteV3Single(chains, environment, tokenIn, via, amountIn);
  const lasts = firsts.length === 0 ? [] : await quoteV3Single(chains, environment, via, tokenOut, firsts.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))[0]!.amountOut);
  const candidates = firsts.flatMap((f) => lasts.map((l) => [f.fee, l.fee] as const));
  const quotes = await Promise.all(
    candidates.slice(0, 4).map(async ([f1, f2]): Promise<V3PathQuote | null> => {
      const hops = [{ tokenIn, tokenOut: via, fee: f1 }, { tokenIn: via, tokenOut, fee: f2 }];
      const path = encodeV3Path(hops);
      try {
        const { result } = await client.simulateContract({ address: c.quoter, abi: QUOTER_V2_PATH_ABI, functionName: "quoteExactInput", args: [path, amountIn] });
        return result[0] > 0n ? { kind: "v3-path", path, hops, amountOut: result[0], gasEstimate: result[3] } : null;
      } catch {
        return null;
      }
    }),
  );
  return quotes.filter((q): q is V3PathQuote => q !== null);
}

function v4PoolId(key: V4PoolKey): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}

export function v4Key(tokenA: Address, tokenB: Address, fee: number, tickSpacing: number): { key: V4PoolKey; zeroForOne: (tokenIn: Address) => boolean } {
  const [currency0, currency1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  return { key: { currency0, currency1, fee, tickSpacing, hooks: ZERO }, zeroForOne: (tokenIn) => tokenIn.toLowerCase() === currency0.toLowerCase() };
}

/** Hookless v4 pools with liquidity between the two tokens, quoted exact-in. */
export async function quoteV4(chains: ArcChains, environment: ArcEnvironment, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<V4Quote[]> {
  const c = v4Contracts(environment);
  if (!c || amountIn <= 0n || amountIn >= 2n ** 128n) return [];
  const client = chains.client(environment);
  const quotes = await Promise.all(
    V4_TIERS.map(async ({ fee, tickSpacing }): Promise<V4Quote | null> => {
      const { key, zeroForOne } = v4Key(tokenIn, tokenOut, fee, tickSpacing);
      try {
        const liquidity = await client.readContract({ address: c.stateView, abi: V4_STATE_VIEW_ABI, functionName: "getLiquidity", args: [v4PoolId(key)] });
        if (liquidity === 0n) return null;
        const z = zeroForOne(tokenIn);
        const { result } = await client.simulateContract({ address: c.quoter, abi: V4_QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: z, exactAmount: amountIn, hookData: "0x" }] });
        return result[0] > 0n ? { kind: "v4", key, zeroForOne: z, amountOut: result[0], gasEstimate: result[1] } : null;
      } catch {
        return null;
      }
    }),
  );
  return quotes.filter((q): q is V4Quote => q !== null);
}

export const uniswapCalls = {
  v3Single(router: Address, tokenIn: Address, tokenOut: Address, fee: number, recipient: Address, amountIn: bigint, minOut: bigint, label: string): RawCall {
    return { to: router, data: encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: "exactInputSingle", args: [{ tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] }), label };
  },
  v3Path(router: Address, path: Hex, recipient: Address, amountIn: bigint, minOut: bigint, label: string): RawCall {
    return { to: router, data: encodeFunctionData({ abi: SWAP_ROUTER_02_PATH_ABI, functionName: "exactInput", args: [{ path, recipient, amountIn, amountOutMinimum: minOut }] }), label };
  },
  /** Permit2 allowance for the UniversalRouter (the token itself must be approved to Permit2 first). */
  permit2Approve(permit2: Address, token: Address, spender: Address, amount: bigint, expiration: number, label: string): RawCall {
    return { to: permit2, data: encodeFunctionData({ abi: PERMIT2_ABI, functionName: "approve", args: [token, spender, amount, expiration] }), label };
  },
  /** UniversalRouter V4_SWAP: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL. */
  v4Single(router: Address, key: V4PoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint, deadline: bigint, label: string): RawCall {
    const keyType = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
    const swap = encodeAbiParameters(
      [{ type: "tuple", components: [{ ...keyType, name: "poolKey" }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" }] }],
      [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: "0x" }],
    );
    const currencyIn = zeroForOne ? key.currency0 : key.currency1;
    const currencyOut = zeroForOne ? key.currency1 : key.currency0;
    const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyIn, amountIn]);
    const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyOut, minOut]);
    const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x060c0f", [swap, settle, take]]);
    return { to: router, data: encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: "execute", args: ["0x10", [input], deadline] }), label };
  },
};
