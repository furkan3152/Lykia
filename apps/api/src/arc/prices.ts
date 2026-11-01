/**
 * USD prices. USDC is the unit of account on Arc (gas is paid in it), so it
 * prices at 1. EURC and cirBTC price from Chainlink feeds on Arc mainnet
 * (EURC/USD, BTC/USD); the same reference serves testnet, because a price
 * is a price. A feed older than its heartbeat allowance is stale and the
 * token is unpriced: null, never zero, never a guess. USYC (NAV-priced and
 * restricted) is unpriced.
 */
import { getToken, type Address } from "@lykia/core";
import { parseAbi } from "viem";
import type { ArcChains } from "../chains/arc.js";
import type { Clock } from "../clock.js";

export const AGGREGATOR_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const FEEDS: Readonly<Record<string, { readonly address: Address; readonly pair: string; readonly maxAgeSeconds: number }>> = Object.freeze({
  USDC: { address: "0x84EA90AC252Dc437031461836DB5164219147905", pair: "USDC/USD", maxAgeSeconds: 26 * 3600 },
  EURC: { address: "0x361b95c10b76Ca3f35C686d423e43A951755Bf23", pair: "EURC/USD", maxAgeSeconds: 26 * 3600 },
  cirBTC: { address: "0xa109B535C70C8Be9995be64Bb6751AcDB27e03De", pair: "BTC/USD", maxAgeSeconds: 2 * 3600 },
});

export const PRICE_CACHE_MS = 60_000;

export interface PriceQuote {
  readonly symbol: string;
  /** Decimal string, up to 8 decimals; null = unpriced. */
  readonly usd: string | null;
  readonly source: string;
  readonly updatedAt: string | null;
}

export function scaledToDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const fraction = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
  return `${negative ? "-" : ""}${abs / scale}${fraction ? `.${fraction}` : ""}`;
}

export class PriceService {
  private readonly cache = new Map<string, { at: number; quote: PriceQuote }>();

  constructor(private readonly deps: { readonly chains: ArcChains; readonly clock: Clock }) {}

  async price(symbol: string): Promise<PriceQuote> {
    const token = getToken(symbol);
    if (!token) return { symbol, usd: null, source: "unknown token", updatedAt: null };
    if (token.symbol === "USDC") return { symbol: "USDC", usd: "1", source: "unit of account (Arc gas token)", updatedAt: null };
    const feed = FEEDS[token.symbol];
    if (!feed) return { symbol: token.symbol, usd: null, source: token.pricing === "nav" ? "NAV token: no public reference price" : "no feed", updatedAt: null };
    const cached = this.cache.get(token.symbol);
    const now = this.deps.clock.now();
    if (cached && now - cached.at < PRICE_CACHE_MS) return cached.quote;
    const quote = await this.readFeed(token.symbol, feed).catch((): PriceQuote => ({ symbol: token.symbol, usd: null, source: `chainlink:${feed.pair} (read failed)`, updatedAt: null }));
    this.cache.set(token.symbol, { at: now, quote });
    return quote;
  }

  async prices(symbols: readonly string[]): Promise<Record<string, PriceQuote>> {
    const out: Record<string, PriceQuote> = {};
    await Promise.all([...new Set(symbols)].map(async (s) => (out[s] = await this.price(s))));
    return out;
  }

  /** EURC per USDC reference (EURC/USD feed), used for the Fence's FX band. */
  async eurcPerUsdc(): Promise<string | null> {
    return (await this.price("EURC")).usd;
  }

  private async readFeed(symbol: string, feed: (typeof FEEDS)[string]): Promise<PriceQuote> {
    const client = this.deps.chains.client("mainnet");
    const [decimals, round] = await Promise.all([
      client.readContract({ address: feed.address, abi: AGGREGATOR_ABI, functionName: "decimals" }),
      client.readContract({ address: feed.address, abi: AGGREGATOR_ABI, functionName: "latestRoundData" }),
    ]);
    const answer = round[1];
    const updatedAt = Number(round[3]);
    const age = this.deps.clock.now() / 1000 - updatedAt;
    const source = `chainlink:${feed.pair}`;
    if (answer <= 0n || age > feed.maxAgeSeconds) return { symbol, usd: null, source: `${source} (stale)`, updatedAt: new Date(updatedAt * 1000).toISOString() };
    return { symbol, usd: scaledToDecimal(answer, Number(decimals)), source, updatedAt: new Date(updatedAt * 1000).toISOString() };
  }
}

/** USD value (decimal string, 2+ decimals truncated to 6) of `amount` whole tokens at `price`; null when unpriced. */
export function usdValue(amount: string, price: string | null): string | null {
  if (price === null) return null;
  const toMicros = (v: string, scale: number) => {
    const [w = "0", f = ""] = v.split(".");
    return BigInt(w) * 10n ** BigInt(scale) + BigInt(f.padEnd(scale, "0").slice(0, scale) || "0");
  };
  const product = toMicros(amount, 18) * toMicros(price, 8);
  return scaledToDecimal(product / 10n ** 20n, 6);
}
