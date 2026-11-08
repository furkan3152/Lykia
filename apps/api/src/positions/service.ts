/**
 * The position map: every venue's reader run side by side, each with its own
 * time limit, so one slow venue never holds the rest. A reader that fails
 * returns its venue as "unavailable" with the reason; nothing is zeroed.
 * Owner-only venues (Lykia's own records) are "private" for anyone else.
 * Each venue's result is cached briefly per address in the store.
 */
import { fenceForProfile, POSITION_VENUES, riskTierOf, summarizePositions, type Address, type ArcEnvironment, type IntentGraph, type PositionsResponse, type PositionVenueInfo, type VenueRead } from "@lykia/core";
import type { AppContext } from "../context.js";
import type { PriceQuote } from "../arc/prices.js";
import type { RatesSnapshot } from "../engine/venues/yields.js";
import { getPreferences } from "../fold/preferences.js";
import { ownerIntents } from "../fold/trails.js";
import { withTimeout } from "../fold/util.js";
import { getProfile } from "../personal/profile.js";
import { typedCollection } from "../platform/typed.js";
import { services } from "../services.js";
import { readGateway, readInFlight } from "./circle.js";
import { VenueUnavailable, type ReadContext, type Reader, type ReaderOutput } from "./context.js";
import { readOrders, readPayments } from "./herding.js";
import { readAave, readMorphoBlue } from "./lending.js";
import { readArchery, readSlipstream, readSushiswap, readUniswapV3, readUniswapV4, readUnitflow } from "./lp.js";
import { readAcross, readRelay, readZeroX } from "./bridges.js";
import { readMorphoVaults, readPractice } from "./vaults.js";
import { readUsyc, readWallet } from "./wallet.js";
import { readLeashes } from "./leashes.js";
import { readPlans, readWatches } from "./tracked.js";

/** How long one venue's read is reused for the same address. */
export const POSITIONS_CACHE_MS = 20_000;

export const READERS: Readonly<Record<string, Reader>> = {
  wallet: readWallet,
  "aave-v4": readAave,
  "morpho-vaults": readMorphoVaults,
  // Curators' Morpho vaults: the same reader, each venue reading only its own vaults.
  "galaxy-curation": readMorphoVaults,
  keyrock: readMorphoVaults,
  "steakhouse-financial": readMorphoVaults,
  gauntlet: readMorphoVaults,
  bitwise: readMorphoVaults,
  archery: readArchery,
  "unitflow-finance-v3": readUnitflow,
  sushiswap: readSushiswap,
  relay: readRelay,
  across: readAcross,
  zerox: readZeroX,
  "morpho-blue": readMorphoBlue,
  "uniswap-v3": readUniswapV3,
  "uniswap-v4": readUniswapV4,
  "aerodrome-slipstream": readSlipstream,
  usyc: readUsyc,
  gateway: readGateway,
  cctp: readInFlight,
  "lykia-orders": readOrders,
  "arc-transfer": readPayments,
  "lykia-practice": readPractice,
  leashes: readLeashes,
  plans: readPlans,
  watches: readWatches,
};

/** Venues whose discovery scans events get more time (the scan has its own budget inside). */
const TIME_LIMIT_MS: Readonly<Record<string, number>> = { "uniswap-v4": 14_000, "morpho-blue": 14_000 };
const DEFAULT_LIMIT_MS = 9_000;

const cache = (ctx: AppContext) => typedCollection<VenueRead>(ctx, "position_reads");

function reasonOf(error: unknown): string {
  if (error instanceof VenueUnavailable) return error.message;
  const short = (error as { shortMessage?: unknown })?.shortMessage;
  const text = typeof short === "string" ? short : error instanceof Error ? error.message : "";
  if (/timeout|timed out|took too long/iu.test(text)) return "Arc's RPC did not answer in time.";
  if (/fetch failed|ECONN|network/iu.test(text)) return "The network request failed.";
  return text ? `The read failed: ${text.split("\n")[0]!.slice(0, 120)}` : "The read failed.";
}

export interface ReadOptions {
  readonly personal: boolean;
  /** Only these venues (ids from POSITION_VENUES); all when absent. */
  readonly venues?: readonly string[];
  /** Reuse a recent read (default true). */
  readonly cached?: boolean;
  /** Override readers (tests). */
  readonly readers?: Readonly<Record<string, Reader>>;
}

/** Builds the shared read context once per request: prices, rates and history are fetched at most once. */
export async function readContext(ctx: AppContext, environment: ArcEnvironment, owner: Address, personal: boolean): Promise<ReadContext> {
  const [profile, prefs] = await Promise.all([getProfile(ctx, personal ? owner : null).catch(() => null), getPreferences(ctx, personal ? owner : null).catch(() => null)]);
  const fence = profile && prefs ? fenceForProfile({ ...profile, risk: riskTierOf(prefs.risk) }) : null;
  const healthFloor = Number(fence?.lending?.minHealthFactor ?? "1.2");
  const priceCache = new Map<string, Promise<PriceQuote>>();
  let rates: Promise<RatesSnapshot | null> | null = null;
  let history: Promise<readonly IntentGraph[]> | null = null;
  return {
    ctx,
    environment,
    owner,
    personal,
    healthFloor: Number.isFinite(healthFloor) ? healthFloor : 1.2,
    liquidityFloorUsd: Number(prefs?.liquidityFloorUsd ?? "500") || 0,
    readAt: new Date(ctx.clock.now()).toISOString(),
    async prices(symbols) {
      const out: Record<string, PriceQuote> = {};
      await Promise.all(
        [...new Set(symbols)].map(async (s) => {
          if (!priceCache.has(s)) priceCache.set(s, services(ctx).prices.price(s).catch(() => ({ symbol: s, usd: null, source: "read failed", updatedAt: null })));
          out[s] = await priceCache.get(s)!;
        }),
      );
      return out;
    },
    rates() {
      rates ??= withTimeout(services(ctx).yields.rates(environment), 5_000).catch(() => null);
      return rates;
    },
    history() {
      history ??= ownerIntents(ctx, owner)
        .then((list) => list.filter((g) => g.environment === environment))
        .catch(() => []);
      return history;
    },
  };
}

/** One venue: cached, timed, and never thrown. */
export async function readVenue(r: ReadContext, info: PositionVenueInfo, options: Pick<ReadOptions, "cached" | "readers">): Promise<VenueRead> {
  const started = Date.now();
  const base = { venue: info.id, venueName: info.name, venueKind: info.kind, readAt: r.readAt } as const;
  if (info.personal && !r.personal) return { ...base, status: "private", reason: "Sign in as the owner to see this: it reads Lykia's own records.", positions: [], source: "history", method: "Owner-only.", block: null, ms: 0 };
  const reader = (options.readers ?? READERS)[info.id];
  if (!reader) return { ...base, status: "unavailable", reason: "No reader for this venue yet.", positions: [], source: "chain", method: "", block: null, ms: 0 };
  const key = `${r.environment}:${info.id}:${r.owner.toLowerCase()}:${r.personal ? "owner" : "public"}`;
  if (options.cached !== false) {
    const hit = await cache(r.ctx).get(key).catch(() => null);
    if (hit && r.ctx.clock.now() - Date.parse(hit.value.readAt) < POSITIONS_CACHE_MS) return hit.value;
  }
  const limit = TIME_LIMIT_MS[info.id] ?? DEFAULT_LIMIT_MS;
  let timer: NodeJS.Timeout | undefined;
  try {
    const out = await Promise.race([
      reader(r, info),
      new Promise<ReaderOutput>((_, reject) => {
        timer = setTimeout(() => reject(new VenueUnavailable(`${info.name} did not answer within ${Math.round(limit / 1000)} s.`)), limit);
      }),
    ]);
    const read: VenueRead = { ...base, status: "ok", positions: out.positions, source: out.source, method: out.method, ...(out.coverage ? { coverage: out.coverage } : {}), block: out.block, ms: Date.now() - started };
    await cache(r.ctx).put(key, read, { ttlMs: POSITIONS_CACHE_MS * 3 }).catch(() => undefined);
    return read;
  } catch (error) {
    r.ctx.log.warn("position read failed", { venue: info.id, error: reasonOf(error) });
    return { ...base, status: "unavailable", reason: reasonOf(error), positions: [], source: "chain", method: "", block: null, ms: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Every venue's positions for an address, read in parallel. */
export async function readPositions(ctx: AppContext, environment: ArcEnvironment, owner: Address, options: ReadOptions): Promise<PositionsResponse> {
  const r = await readContext(ctx, environment, owner, options.personal);
  const wanted = POSITION_VENUES[environment].filter((v) => !options.venues || options.venues.includes(v.id));
  const venues = await Promise.all(wanted.map((v) => readVenue(r, v, options)));
  const blocks = venues.map((v) => (v.block ? BigInt(v.block) : null)).filter((b): b is bigint => b !== null);
  return {
    address: owner.toLowerCase() as Address,
    environment,
    at: r.readAt,
    block: blocks.length > 0 ? blocks.reduce((a, b) => (b > a ? b : a)).toString() : null,
    venues,
    summary: summarizePositions(venues),
    personal: options.personal,
    healthFloor: String(r.healthFloor),
  };
}
