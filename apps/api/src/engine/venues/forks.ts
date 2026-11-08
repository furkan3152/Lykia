/**
 * Uniswap v3-family forks on Arc that Lykia executes, each with its own
 * factory, quoter and router from the protocol's own address book:
 *
 * - Archery (archery.wtf/docs/security): Slipstream-style pools keyed by
 *   tick spacing. QuoterV2.quoteExactInputSingle((tokenIn, tokenOut,
 *   amountIn, tickSpacing, 0)) and SwapRouter.exactInputSingle((tokenIn,
 *   tokenOut, tickSpacing, recipient, deadline, amountIn, minOut, 0)).
 * - Unitflow Finance V3 (docs.unitflow.finance/docs/dev/contracts): the
 *   original Uniswap v3 periphery, Quoter v1 and SwapRouter v1 (deadline in
 *   the struct), pools keyed by fee.
 *
 * Every router pulls exactly amountIn from the signer (the account, through
 * Multicall3From) and reverts below amountOutMinimum.
 */
import { getProtocol, type Address, type ArcEnvironment } from "@lykia/core";
import { encodeFunctionData } from "viem";
import type { ArcChains } from "../../chains/arc.js";
import { QUOTER_V1_ABI, SLIPSTREAM_FACTORY_ABI, SLIPSTREAM_QUOTER_ABI, SLIPSTREAM_ROUTER_ABI, SWAP_ROUTER_V1_ABI, V3_FACTORY_ABI } from "../abis.js";
import type { RawCall } from "../calls.js";

const ZERO = "0x0000000000000000000000000000000000000000";
/** Archery's tick spacings (its pools on Arc use 1, 10 and 50; the rest are the Slipstream defaults). */
const ARCHERY_TICK_SPACINGS = [1, 10, 50, 100, 200, 2000] as const;
const UNITFLOW_FEES = [100, 500, 3000, 10000] as const;

export interface ForkQuote {
  readonly pool: Address;
  /** Tick spacing (Archery) or fee in hundredths of a bip (Unitflow). */
  readonly key: number;
  readonly amountOut: bigint;
  readonly gasEstimate: bigint;
}

function contracts(id: string, environment: ArcEnvironment): Readonly<Record<string, Address>> | null {
  return getProtocol(id)?.deployments[environment]?.contracts ?? null;
}

export function archeryContracts(environment: ArcEnvironment) {
  const c = contracts("archery", environment);
  return c?.v3SwapRouter && c.v3QuoterV2 && c.v3Factory ? { router: c.v3SwapRouter, quoter: c.v3QuoterV2, factory: c.v3Factory, positionManager: c.v3PositionManager ?? null } : null;
}

export function unitflowContracts(environment: ArcEnvironment) {
  const c = contracts("unitflow-finance-v3", environment);
  return c?.v3Router && c.quoter && c.v3Factory ? { router: c.v3Router, quoter: c.quoter, factory: c.v3Factory, positionManager: c.positionManager ?? null } : null;
}

/** Archery pools between the two tokens, each quoted exact-in with Archery's QuoterV2. */
export async function quoteArchery(chains: ArcChains, environment: ArcEnvironment, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<ForkQuote[]> {
  const c = archeryContracts(environment);
  if (!c || amountIn <= 0n) return [];
  const client = chains.client(environment);
  const quotes = await Promise.all(
    ARCHERY_TICK_SPACINGS.map(async (tickSpacing): Promise<ForkQuote | null> => {
      try {
        const pool = await client.readContract({ address: c.factory, abi: SLIPSTREAM_FACTORY_ABI, functionName: "getPool", args: [tokenIn, tokenOut, tickSpacing] });
        if (pool === ZERO) return null;
        const { result } = await client.simulateContract({ address: c.quoter, abi: SLIPSTREAM_QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, tickSpacing, sqrtPriceLimitX96: 0n }] });
        return result[0] > 0n ? { pool, key: tickSpacing, amountOut: result[0], gasEstimate: result[3] } : null;
      } catch {
        return null;
      }
    }),
  );
  return quotes.filter((q): q is ForkQuote => q !== null);
}

/** Unitflow V3 pools between the two tokens, quoted with its Quoter (v1 interface: no gas estimate). */
export async function quoteUnitflow(chains: ArcChains, environment: ArcEnvironment, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<ForkQuote[]> {
  const c = unitflowContracts(environment);
  if (!c || amountIn <= 0n) return [];
  const client = chains.client(environment);
  const quotes = await Promise.all(
    UNITFLOW_FEES.map(async (fee): Promise<ForkQuote | null> => {
      try {
        const pool = await client.readContract({ address: c.factory, abi: V3_FACTORY_ABI, functionName: "getPool", args: [tokenIn, tokenOut, fee] });
        if (pool === ZERO) return null;
        const { result } = await client.simulateContract({ address: c.quoter, abi: QUOTER_V1_ABI, functionName: "quoteExactInputSingle", args: [tokenIn, tokenOut, fee, amountIn, 0n] });
        return result > 0n ? { pool, key: fee, amountOut: result, gasEstimate: 0n } : null;
      } catch {
        return null;
      }
    }),
  );
  return quotes.filter((q): q is ForkQuote => q !== null);
}

export const forkCalls = {
  archerySingle(router: Address, tokenIn: Address, tokenOut: Address, tickSpacing: number, recipient: Address, deadline: bigint, amountIn: bigint, minOut: bigint, label: string): RawCall {
    return { to: router, data: encodeFunctionData({ abi: SLIPSTREAM_ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn, tokenOut, tickSpacing, recipient, deadline, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] }), label };
  },
  unitflowSingle(router: Address, tokenIn: Address, tokenOut: Address, fee: number, recipient: Address, deadline: bigint, amountIn: bigint, minOut: bigint, label: string): RawCall {
    return { to: router, data: encodeFunctionData({ abi: SWAP_ROUTER_V1_ABI, functionName: "exactInputSingle", args: [{ tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] }), label };
  },
};
