/**
 * Discover: the launch radar for Arc and read-only perps market data.
 *
 * Launch radar: new pools from the AMM factories Lykia knows (Uniswap v3/v2,
 * Aerodrome Slipstream, Synthra, SushiSwap V3, Archery), read from factory
 * events in the recent block windows (Arc's public log window is 10,000
 * blocks), with each new token's on-chain symbol and Lykia's trust verdict.
 * Launchpads come from the registry. Cached for five minutes.
 *
 * Perps: Extended runs a perpetuals exchange with collateral on Arc; its
 * public API serves markets, candles, the order book and trades. Lykia shows
 * that data read-only. Placing orders needs an Extended account (a Stark key)
 * and happens on Extended's own engine; Lykia does not custody or trade there.
 */
import { assessToken, PROTOCOLS, type Address, type ArcEnvironment } from "@lykia/core";
import { decodeEventLog, parseAbi, parseAbiItem } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { JsonValue } from "../store/types.js";

const V3_POOL = parseAbiItem("event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)");
const CL_POOL = parseAbiItem("event PoolCreated(address indexed token0, address indexed token1, int24 indexed tickSpacing, address pool)");
const V2_PAIR = parseAbiItem("event PairCreated(address indexed token0, address indexed token1, address pair, uint256)");
const ERC20 = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
const WINDOW = 10_000n;
const BACKFILL_WINDOWS = 30;
const CACHE_MS = 5 * 60_000;
const EXTENDED = "https://api.starknet.extended.exchange/api/v1";

interface RawPool {
  readonly venue: string;
  readonly label: string;
  readonly pool: Address;
  readonly block: string;
  readonly fee: number | null;
  readonly t0: Address;
  readonly t1: Address;
}

type FactoryKind = "v3" | "cl" | "v2";
const FACTORIES: readonly { readonly venue: string; readonly label: string; readonly address: Address; readonly kind: FactoryKind }[] = [
  { venue: "uniswap-v3", label: "Uniswap v3", address: "0xf0db7b58379503491d857db50ac9ece64c653918", kind: "v3" },
  { venue: "uniswap-v2", label: "Uniswap v2", address: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba", kind: "v2" },
  { venue: "aerodrome-slipstream", label: "Aerodrome Slipstream", address: "0x7F83235643181E440433400a027618Cd50879751", kind: "cl" },
  { venue: "aerodrome-slipstream", label: "Aerodrome Slipstream (lite)", address: "0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03", kind: "cl" },
  { venue: "synthra", label: "Synthra v3", address: "0x6307fc239C7964942c1BfFE51930E55606619c74", kind: "v3" },
  { venue: "sushiswap-v3", label: "SushiSwap V3", address: "0x7282249282902e1f99c2CB0A04230091bd30FE3A", kind: "v3" },
  { venue: "archery", label: "Archery v3", address: "0xc481038c013fe96f38ce7a2dc417b2b1b78b16a4", kind: "v3" },
];

export interface LaunchToken {
  readonly address: Address;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly trust: "verified" | "lookalike" | "unverified";
  readonly warning: string | null;
}

export interface LaunchPool {
  readonly venue: string;
  readonly label: string;
  readonly pool: Address;
  readonly block: string;
  readonly feeOrSpacing: number | null;
  readonly tokens: readonly [LaunchToken, LaunchToken];
  /** The side that is not a registry token, if any: what is being launched. */
  readonly newToken: Address | null;
}

export interface LaunchRadar {
  readonly environment: ArcEnvironment;
  readonly at: string;
  readonly fromBlock: string;
  readonly toBlock: string;
  readonly pools: readonly LaunchPool[];
  readonly launchpads: readonly { readonly id: string; readonly name: string; readonly website?: string; readonly summary: string }[];
  readonly notes: readonly string[];
}

class DiscoverService {
  private cache = new Map<string, { at: number; value: LaunchRadar }>();
  private perpsCache = new Map<string, { at: number; value: unknown }>();

  constructor(private readonly ctx: AppContext) {}

  async launches(environment: ArcEnvironment): Promise<LaunchRadar> {
    const hit = this.cache.get(environment);
    const now = this.ctx.clock.now();
    if (hit && now - hit.at < CACHE_MS) return hit.value;
    const launchpads = PROTOCOLS.filter((p) => p.category === "launchpad").map((p) => ({ id: p.id, name: p.name, ...(p.website ? { website: p.website } : {}), summary: p.summary }));
    if (environment !== "mainnet") {
      const value: LaunchRadar = { environment, at: new Date(now).toISOString(), fromBlock: "0", toBlock: "0", pools: [], launchpads, notes: ["The AMM factories Lykia watches are on Arc mainnet; testnet has no launch radar."] };
      this.cache.set(environment, { at: now, value });
      return value;
    }
    const client = this.ctx.chains.client(environment);
    const head = await client.getBlockNumber();
    const state = this.ctx.store.collection<JsonValue>("launch_radar");
    const saved = (await state.get(environment))?.value as unknown as { cursor: string; since?: string; pools: RawPool[] } | undefined;
    const floor = head - BigInt(BACKFILL_WINDOWS) * WINDOW;
    let from = saved && BigInt(saved.cursor) > floor ? BigInt(saved.cursor) + 1n : floor;
    const since = saved?.since && BigInt(saved.cursor) > floor ? saved.since : floor.toString();
    const found: RawPool[] = [];
    while (from <= head) {
      const batch: Promise<RawPool[]>[] = [];
      for (let i = 0; i < 4 && from <= head; i += 1) {
        const to = from + WINDOW - 1n > head ? head : from + WINDOW - 1n;
        batch.push(this.scan(environment, from, to));
        from = to + 1n;
      }
      for (const r of await Promise.all(batch)) found.push(...r);
    }
    const byPool = new Map<string, RawPool>();
    for (const r of [...found, ...(saved?.pools ?? [])]) byPool.set(r.pool.toLowerCase(), r);
    const raw = [...byPool.values()];
    raw.sort((x, y) => (BigInt(x.block) < BigInt(y.block) ? 1 : -1));
    await state.put(environment, { cursor: head.toString(), since, pools: raw.slice(0, 200) } as unknown as JsonValue);
    const top = raw.slice(0, 40);
    const tokens = [...new Set(top.flatMap((r) => [r.t0.toLowerCase(), r.t1.toLowerCase()]))] as Address[];
    const read = (address: Address, functionName: "symbol" | "name") =>
      client.readContract({ address, abi: ERC20, functionName }).then((v) => String(v)).catch(() => null);
    const meta = await Promise.all(tokens.map(async (t) => [await read(t, "symbol"), await read(t, "name")] as const));
    const info = new Map<string, LaunchToken>();
    tokens.forEach((t, i) => {
      const symbol = meta[i]?.[0]?.slice(0, 24) ?? null;
      const name = meta[i]?.[1]?.slice(0, 48) ?? null;
      const trust = assessToken({ environment, address: t, ...(symbol ? { symbol } : {}), ...(name ? { name } : {}) });
      info.set(t.toLowerCase(), { address: t, symbol, name, trust: trust.status, warning: trust.status === "verified" ? null : trust.warning });
    });
    const pools: LaunchPool[] = top.map((r) => {
      const a = info.get(r.t0.toLowerCase()) as LaunchToken;
      const b = info.get(r.t1.toLowerCase()) as LaunchToken;
      const fresh = a.trust !== "verified" ? a.address : b.trust !== "verified" ? b.address : null;
      return { venue: r.venue, label: r.label, pool: r.pool, block: r.block, feeOrSpacing: r.fee, tokens: [a, b], newToken: fresh };
    });
    const value: LaunchRadar = {
      environment,
      at: new Date(now).toISOString(),
      fromBlock: since,
      toBlock: head.toString(),
      pools,
      launchpads,
      notes: ["New pools from factory events, newest first, kept since the radar first ran (it backfills about 300,000 blocks). A new pool is not an endorsement: run Scent before trading any token that is not verified."],
    };
    this.cache.set(environment, { at: now, value });
    return value;
  }

  /** One eth_getLogs over every factory for a block window (Arc's limit is 10,000 blocks). */
  private async scan(environment: ArcEnvironment, fromBlock: bigint, toBlock: bigint): Promise<RawPool[]> {
    const client = this.ctx.chains.client(environment);
    let logs: { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}`; blockNumber: bigint | null }[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        logs = (await client.request({ method: "eth_getLogs", params: [{ address: FACTORIES.map((f) => f.address), fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }] } as never)) as never;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    const out: RawPool[] = [];
    for (const l of logs) {
      const f = FACTORIES.find((x) => x.address.toLowerCase() === l.address.toLowerCase());
      if (!f) continue;
      try {
        const ev = decodeEventLog({ abi: [f.kind === "v3" ? V3_POOL : f.kind === "cl" ? CL_POOL : V2_PAIR], topics: l.topics as [`0x${string}`, ...`0x${string}`[]], data: l.data });
        const a = ev.args as Record<string, unknown>;
        const pool = (a.pool ?? a.pair) as Address | undefined;
        if (!pool) continue;
        out.push({ venue: f.venue, label: f.label, pool, block: BigInt(l.blockNumber ?? 0n).toString(), fee: typeof a.fee === "number" ? a.fee : typeof a.tickSpacing === "number" ? a.tickSpacing : null, t0: a.token0 as Address, t1: a.token1 as Address });
      } catch {
        // another event from the factory (owner change, fee enable): not a pool
      }
    }
    return out;
  }

  private async extended(path: string, ttlMs: number): Promise<unknown> {
    const now = this.ctx.clock.now();
    const hit = this.perpsCache.get(path);
    if (hit && now - hit.at < ttlMs) return hit.value;
    const res = await this.ctx.fetch(`${EXTENDED}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res || !res.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 503, "Extended's market data is unavailable right now.");
    const body = (await res.json()) as { status?: string; data?: unknown };
    if (body.status !== "OK") throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 503, "Extended answered without data.");
    this.perpsCache.set(path, { at: now, value: body.data });
    return body.data;
  }

  async perpsMarkets(): Promise<{ venue: string; collateralOn: string; markets: unknown[]; notes: readonly string[] }> {
    const data = (await this.extended("/info/markets", 30_000)) as { name: string; category: string; status: string; visibleOnUi: boolean; marketStats?: Record<string, unknown>; tradingConfig?: Record<string, unknown> }[];
    const markets = data
      .filter((m) => m.status === "ACTIVE" && m.visibleOnUi)
      .map((m) => ({
        market: m.name,
        category: m.category,
        lastPrice: m.marketStats?.lastPrice ?? null,
        markPrice: m.marketStats?.markPrice ?? null,
        change24h: m.marketStats?.dailyPriceChangePercentage ?? null,
        volume24h: m.marketStats?.dailyVolume ?? null,
        fundingRate: m.marketStats?.fundingRate ?? null,
        openInterest: m.marketStats?.openInterest ?? null,
        maxLeverage: m.tradingConfig?.maxLeverage ?? null,
      }))
      .sort((a, b) => Number(b.volume24h ?? 0) - Number(a.volume24h ?? 0));
    return {
      venue: "Extended",
      collateralOn: "Arc (USDC)",
      markets,
      notes: [
        "Market data from Extended's public API. Extended is a perpetuals exchange that settles on Arc (it moved settlement from Starknet to Arc in October 2026) with USDC as its primary collateral; orders match on Extended's own engine.",
        "Lykia shows this read-only. Trading needs an Extended account; to hedge on Arc itself, use a conditional order (stop-loss, take-profit, limit) or a standing order.",
      ],
    };
  }

  async perpsMarket(market: string): Promise<{ market: string; candles: unknown; orderbook: unknown; trades: unknown }> {
    if (!/^[A-Z0-9]{1,12}-USD$/u.test(market)) throw new LykiaHttpError("INVALID_REQUEST", 400, "market looks like BTC-USD.");
    const [candles, orderbook, trades] = await Promise.all([
      this.extended(`/info/candles/${market}/trades?interval=PT1H&limit=168`, 60_000),
      this.extended(`/info/markets/${market}/orderbook`, 5_000),
      this.extended(`/info/markets/${market}/trades`, 5_000).catch(() => []),
    ]);
    return { market, candles, orderbook, trades };
  }
}

const instances = new WeakMap<AppContext, DiscoverService>();
export function discoverService(ctx: AppContext): DiscoverService {
  let s = instances.get(ctx);
  if (!s) {
    s = new DiscoverService(ctx);
    instances.set(ctx, s);
  }
  return s;
}

