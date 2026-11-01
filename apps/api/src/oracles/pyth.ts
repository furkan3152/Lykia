/**
 * Pyth prices read on chain from the Pyth contract on Arc mainnet, as a
 * second opinion next to Chainlink: a large gap between the two is a
 * warning on any plan that converts. Pyth is a pull oracle, so only feeds
 * someone has pushed to Arc recently are usable; older than an hour is
 * stale and reads as null. (Hermes' public price endpoints now answer
 * "unauthorized", so Lykia does not depend on them.)
 * Today Arc carries BTC/USD; EURC/USD and USD/TRY revert (not pushed).
 */
import { parseAbi } from "viem";
import type { ArcChains } from "../chains/arc.js";

export const PYTH_ARC_MAINNET = "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a" as const;
export const PYTH_FEEDS: Readonly<Record<string, `0x${string}`>> = Object.freeze({
  USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  EURC: "0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c",
  cirBTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "USD/TRY": "0x032a2eba1c2635bf973e95fb62b2c0705c1be2603b9572cc8d5edeaf8744e058",
});
const PYTH_ABI = parseAbi(["function getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))"]);
const MAX_AGE_S = 3600;

export interface PythPrice {
  readonly symbol: string;
  readonly price: string | null;
  readonly publishTime: number | null;
}

const cache = new Map<string, { at: number; value: PythPrice }>();

export async function pythPrices(chains: ArcChains, symbols: readonly string[], now: number): Promise<Record<string, PythPrice>> {
  const out: Record<string, PythPrice> = {};
  await Promise.all(
    symbols.map(async (s) => {
      const id = PYTH_FEEDS[s];
      if (!id) return;
      const hit = cache.get(s);
      if (hit && now - hit.at < 30_000) {
        out[s] = hit.value;
        return;
      }
      let value: PythPrice = { symbol: s, price: null, publishTime: null };
      try {
        const r = (await chains.client("mainnet").readContract({ address: PYTH_ARC_MAINNET, abi: PYTH_ABI, functionName: "getPriceUnsafe", args: [id] })) as { price: bigint; expo: number; publishTime: bigint };
        const age = now / 1000 - Number(r.publishTime);
        value = { symbol: s, price: age <= MAX_AGE_S && r.price > 0n ? (Number(r.price) * 10 ** r.expo).toFixed(8).replace(/0+$/u, "").replace(/\.$/u, "") : null, publishTime: Number(r.publishTime) };
      } catch {
        // Not pushed to Arc (the contract reverts with PriceFeedNotFound): unpriced, never a guess.
      }
      cache.set(s, { at: now, value });
      out[s] = value;
    }),
  );
  return out;
}

/** Gap between two prices in basis points (absolute); null when either is missing. */
export function deviationBps(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null;
  const x = Number(a);
  const y = Number(b);
  if (!(x > 0) || !(y > 0)) return null;
  return Math.round((Math.abs(x - y) / ((x + y) / 2)) * 10_000);
}
