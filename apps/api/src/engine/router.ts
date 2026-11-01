/**
 * The venue router: "neyi nereye". For each action it asks every live venue
 * on Arc that can do it, prices the options the same way (output after gas
 * for swaps, live APY with its source for earn, borrow rate and projected
 * health factor for borrow) and returns them with their execution
 * parameters, so the planner can pick one, explain why, and keep the rest
 * as alternatives the UI can show.
 */
import {
  chooseBorrow,
  chooseSwap,
  chooseYield,
  getToken,
  riskFromTvl,
  tokenAddress,
  unitsForUsdMicros,
  usdMicrosOf,
  fromBaseUnits,
  type Address,
  type ArcEnvironment,
  type RiskTier,
  type RouteChoice,
  type VenueOption,
} from "@lykia/core";
import type { ArcChains } from "../chains/arc.js";
import type { PriceService } from "../arc/prices.js";
import { ERC4626_ABI, morphoVaults } from "../flock/flock.js";
import { AAVE_SPOKE_ABI, CL_POOL_ABI, PRACTICE_LENDING_ABI, PRACTICE_SWAP_ABI } from "./abis.js";
import { aaveCollateralNeededMicros, aaveReserve, aaveSpokes, liveCollateralFactorBps, projectAaveHealth, readAaveAccount, wadToRatio } from "./venues/aave.js";
import { morphoCollateralNeeded, morphoMarketFor, projectMorphoHealth, readMorphoPosition } from "./venues/morphoBlue.js";
import { practiceVenues } from "./venues/practice.js";
import { quoteV3Single, quoteV3TwoHop, quoteV4 } from "./venues/uniswap.js";
import { CL_POOLS, metarouter, quoteCl } from "./venues/aerodrome.js";
import { sameAddr, type YieldService } from "./venues/yields.js";
import { apyFraction, manifestParams, readAdapterValue } from "../integrations/runtime.js";
import { RISK_ORDER, type AdapterManifest } from "@lykia/core";

export type RoutedAdapter =
  | "vault-deposit"
  | "aave-supply"
  | "practice-vault-deposit"
  | "swap"
  | "swap-path"
  | "swap-v4"
  | "swap-aerodrome"
  | "practice-swap"
  | "aave-borrow"
  | "morpho-borrow"
  | "practice-borrow"
  | "manifest";

/** Owner venue preferences (from the profile). */
export interface VenuePrefs {
  readonly favorites?: readonly string[];
  readonly blocked?: readonly string[];
  readonly maxRisk?: RiskTier;
  /** Never split a swap across two venues (aggregator callers can turn splitting off). */
  readonly noSplit?: boolean;
}

/** Favourites win when within this many bps of the best output, or this many APY points of the best yield. */
export const FAVORITE_SWAP_BPS = 5;
export const FAVORITE_APY_POINTS = 0.5;

function allowed<T extends { option: { venue: string } }>(list: readonly T[], prefs?: VenuePrefs): T[] {
  const blocked = prefs?.blocked ?? [];
  return list.filter((c) => !blocked.includes(c.option.venue));
}

export interface Candidate {
  readonly option: VenueOption;
  readonly adapter: RoutedAdapter;
  readonly params: Record<string, string>;
}

export interface SwapCandidate extends Candidate {
  readonly amountOut: bigint;
  readonly netOut: bigint;
}

export interface BorrowCandidate extends Candidate {
  /** Collateral units the step posts before borrowing. */
  readonly collateralUnits: bigint;
  readonly healthFactor: string | null;
}

/** Gas used when a quoter does not report one, plus the Memo/Multicall3From overhead. */
export const GAS_DEFAULTS = { v3: 130_000n, path: 210_000n, v4: 180_000n, aerodrome: 260_000n, practice: 90_000n, overhead: 60_000n } as const;
export const SPLIT_MIN_GAIN_BPS = 5;
const MIN_TVL_USD = 50_000;
const Q192 = 2n ** 192n;

/** Concentrated-liquidity pools outside Uniswap are listed in venues/aerodrome.ts (CL_POOLS). */

/** Quotes and rate reads are reused for this long (route search plans many candidates over the same quotes); prepare always re-quotes. */
export const QUOTE_CACHE_MS = 15_000;

export class VenueRouter {
  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(private readonly deps: { readonly chains: ArcChains; readonly prices: PriceService; readonly yields: YieldService; readonly now?: () => number; readonly adapters?: (environment: ArcEnvironment) => Promise<readonly AdapterManifest[]> }) {}

  /** Routable adapter manifests (integrations/registry.ts); none when the router has no registry. */
  async adapterManifests(environment: ArcEnvironment): Promise<readonly AdapterManifest[]> {
    if (!this.deps.adapters) return [];
    return this.deps.adapters(environment).catch(() => []);
  }

  /** Positions held at routable adapters, through each withdraw capability's position read. */
  async adapterPositions(environment: ArcEnvironment, symbol: string, account: Address): Promise<{ venue: string; label: string; max: bigint; params: Record<string, string> }[]> {
    const out: { venue: string; label: string; max: bigint; params: Record<string, string> }[] = [];
    for (const m of await this.adapterManifests(environment)) {
      for (const cap of m.capabilities.filter((c) => c.verb === "withdraw" && c.tokenIn === symbol && c.position)) {
        const params = manifestParams(m, environment, cap);
        const max = params ? await readAdapterValue(this.deps.chains, environment, m, cap.position!, { account }) : null;
        if (params && max !== null && max > 0n) out.push({ venue: m.protocol.id, label: m.protocol.name, max, params });
      }
    }
    return out;
  }

  /** Earn options at routable adapters: deposit/supply capabilities for `symbol`, priced by their APY read. */
  private async adapterEarn(environment: ArcEnvironment, symbol: string): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const m of await this.adapterManifests(environment)) {
      for (const cap of m.capabilities.filter((c) => (c.verb === "deposit" || c.verb === "supply") && c.tokenIn === symbol)) {
        const params = manifestParams(m, environment, cap);
        if (!params) continue;
        const read = cap.apy ? m.reads.find((r) => r.id === cap.apy) : undefined;
        const raw = read ? await readAdapterValue(this.deps.chains, environment, m, read.id, {}) : null;
        const apy = raw !== null && read ? apyFraction(raw, read.scale) : null;
        // TVL is not tracked for manifests: the risk is the manifest's tier, never below medium.
        const risk: RiskTier = RISK_ORDER.indexOf(m.risk.tier) < RISK_ORDER.indexOf("medium") ? "medium" : m.risk.tier;
        out.push({
          option: { venue: m.protocol.id, label: `${m.protocol.name} ${symbol}`, apy, ...(apy !== null ? { apySource: "on-chain (adapter manifest)" } : {}), tvlUsd: null, risk, executable: true, notes: ["Integrated through a Lykia adapter manifest (validated on chain, approved by a Lykia admin)."] },
          adapter: "manifest",
          params: { ...params, vaultName: m.protocol.name },
        });
      }
    }
    return out;
  }

  /** Memoises `load` under `key` for QUOTE_CACHE_MS; failures are not cached. */
  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = (this.deps.now ?? Date.now)();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < QUOTE_CACHE_MS) return hit.value as Promise<T>;
    if (this.cache.size > 500) for (const [k, v] of this.cache) if (now - v.at >= QUOTE_CACHE_MS) this.cache.delete(k);
    const value = load().catch((error: unknown) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { at: now, value });
    return value;
  }

  private async gasUsdMicros(environment: ArcEnvironment, gas: bigint): Promise<bigint> {
    let price = 20_000_000_000n; // Arc's 20 gwei floor, in native USDC wei (18 decimals)
    try {
      const live = await (this.deps.chains.client(environment) as unknown as { getGasPrice?: () => Promise<bigint> }).getGasPrice?.();
      if (typeof live === "bigint" && live > 0n) price = live;
    } catch {
      /* keep the floor */
    }
    return (gas * price) / 10n ** 12n; // native 18 decimals -> micro-dollars
  }

  /* --------------------------------------------------------------- earn */

  earn(environment: ArcEnvironment, symbol: string): Promise<Candidate[]> {
    return this.memo(`earn:${environment}:${symbol}`, () => this.earnUncached(environment, symbol));
  }

  private async earnUncached(environment: ArcEnvironment, symbol: string): Promise<Candidate[]> {
    const token = getToken(symbol);
    if (!token) return [];
    const address = tokenAddress(token, environment) as Address;
    const rates = await this.deps.yields.rates(environment);
    const price = (await this.deps.prices.price(token.symbol)).usd;
    const out: Candidate[] = [];
    const client = this.deps.chains.client(environment);

    const vaults = morphoVaults(environment).filter((v) => v.asset === token.symbol);
    if (vaults.length > 0) {
      const sizes = await client.multicall({ contracts: vaults.map((v) => ({ address: v.address, abi: ERC4626_ABI, functionName: "totalAssets" }) as const), allowFailure: true });
      vaults.forEach((v, i) => {
        const assets = sizes[i]?.status === "success" ? (sizes[i]!.result as bigint) : null;
        const rate = rates.vaults.find((r) => sameAddr(r.address, v.address));
        const tvl = rate?.tvlUsd ?? (assets !== null && price !== null ? fromBaseUnits(usdMicrosOf(assets, token.decimals, price), 6) : null);
        const tvlNumber = tvl === null ? null : Number(tvl);
        const label = `Morpho ${rate?.name || v.id}`;
        const notes = [rates.sources.morpho === "live" ? "APY net of vault fees (Morpho API)." : "Morpho API unavailable: APY unknown, ranked by size."];
        if (tvlNumber !== null && tvlNumber < MIN_TVL_USD) notes.push("Small vault: below Lykia's $50k floor for automatic picks.");
        out.push({
          option: { venue: "morpho-vaults", label, apy: rate?.apy ?? null, apySource: rate?.apy ? "Morpho API" : undefined, tvlUsd: tvl, risk: riskFromTvl(tvlNumber), executable: tvlNumber === null || tvlNumber >= MIN_TVL_USD, notes } as VenueOption,
          adapter: "vault-deposit",
          params: { vault: v.address, vaultName: label, token: address, symbol: token.symbol, decimals: String(token.decimals) },
        });
      });
    }

    for (const spoke of aaveSpokes(environment).filter((s) => s.key === "main")) {
      const reserve = aaveReserve(spoke, token.symbol);
      if (!reserve) continue;
      const rate = rates.reserves.find((r) => sameAddr(r.spoke, spoke.address) && r.reserveId === reserve.reserveId);
      let supplied: bigint | null;
      try {
        supplied = await client.readContract({ address: spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getReserveSuppliedAssets", args: [BigInt(reserve.reserveId)] });
      } catch {
        supplied = null;
      }
      const tvl = supplied !== null && price !== null ? fromBaseUnits(usdMicrosOf(supplied, token.decimals, price), 6) : null;
      out.push({
        option: { venue: "aave-v4", label: `${spoke.label} ${token.symbol}`, apy: rate?.supplyApy ?? null, apySource: rate?.supplyApy ? "Aave API" : undefined, tvlUsd: tvl, risk: riskFromTvl(tvl === null ? null : Number(tvl)), executable: rate ? rate.canSupply : true, notes: ["Supply stays withdrawable; it also counts as collateral if you enable it."] } as VenueOption,
        adapter: "aave-supply",
        params: { spoke: spoke.address, spokeName: spoke.label, reserveId: String(reserve.reserveId), token: address, symbol: token.symbol, decimals: String(token.decimals) },
      });
    }

    out.push(...(await this.adapterEarn(environment, token.symbol)));

    const practice = await practiceVenues(environment);
    const practiceVault = token.symbol === "EURC" ? practice.vaultEurc : token.symbol === "USDC" ? practice.vaultUsdc : null;
    if (practiceVault) {
      out.push({
        option: { venue: "lykia-practice", label: `Lykia Practice Vault ${token.symbol}`, apy: null, tvlUsd: null, risk: "medium", executable: true, notes: ["Testnet practice vault: test funds, yield dripped by its owner. Not audited."] },
        adapter: "practice-vault-deposit",
        params: { vault: practiceVault, vaultName: `Lykia Practice Vault ${token.symbol}`, token: address, symbol: token.symbol, decimals: String(token.decimals) },
      });
    }
    return out;
  }

  chooseEarn(all: readonly Candidate[], maxRisk: RiskTier = "medium", venue?: string, prefs?: VenuePrefs): { candidate: Candidate; route: RouteChoice } | null {
    const candidates = allowed(all, prefs);
    let pool = candidates;
    if (venue) {
      const [id, name] = venue.split(":");
      const named = candidates.filter((c) => c.option.venue === id && (!name || c.params.vault?.toLowerCase() === name.toLowerCase() || c.option.label.toLowerCase().replace(/\s+/gu, "").includes(name.toLowerCase().replace(/usdc|eurc/gu, ""))));
      if (named.length > 0) pool = named;
    }
    const route = chooseYield(pool.map((c) => c.option), maxRisk);
    if (!route) return null;
    let candidate = pool.find((c) => c.option === route.chosen) as Candidate;
    let reason = route.reason;
    const fav = !venue && prefs?.favorites?.length ? pool.find((c) => c !== candidate && prefs.favorites!.includes(c.option.venue) && c.option.executable !== false && c.option.apy !== null && c.option.apy !== undefined && route.chosen.apy !== null && route.chosen.apy !== undefined && Number(route.chosen.apy) - Number(c.option.apy) <= FAVORITE_APY_POINTS) : undefined;
    if (fav && !prefs!.favorites!.includes(candidate.option.venue)) {
      reason = `${fav.option.label} is one of your favourites and within ${FAVORITE_APY_POINTS} APY points of ${candidate.option.label}; your favourite wins the tie.`;
      candidate = fav;
    }
    return { candidate, route: { ...route, chosen: candidate.option, reason, alternatives: all.filter((c) => c !== candidate).map((c) => c.option) } };
  }

  /* --------------------------------------------------------------- swap */

  swap(environment: ArcEnvironment, fromSymbol: string, toSymbol: string, amountIn: bigint): Promise<{ candidates: SwapCandidate[]; readOnly: VenueOption[] }> {
    return this.memo(`swap:${environment}:${fromSymbol}:${toSymbol}:${amountIn}`, () => this.swapUncached(environment, fromSymbol, toSymbol, amountIn));
  }

  private async swapUncached(environment: ArcEnvironment, fromSymbol: string, toSymbol: string, amountIn: bigint): Promise<{ candidates: SwapCandidate[]; readOnly: VenueOption[] }> {
    const from = getToken(fromSymbol);
    const to = getToken(toSymbol);
    if (!from || !to || amountIn <= 0n) return { candidates: [], readOnly: [] };
    const tokenIn = tokenAddress(from, environment) as Address;
    const tokenOut = tokenAddress(to, environment) as Address;
    const usdc = tokenAddress(getToken("USDC")!, environment) as Address;
    const priceOut = (await this.deps.prices.price(to.symbol)).usd;
    const net = async (out: bigint, gas: bigint) => {
      const gasMicros = await this.gasUsdMicros(environment, gas + GAS_DEFAULTS.overhead);
      const gasOut = priceOut === null ? 0n : unitsForUsdMicros(gasMicros, to.decimals, priceOut);
      return out > gasOut ? out - gasOut : 0n;
    };
    const fmt = (units: bigint) => `${fromBaseUnits(units, to.decimals)} ${to.symbol}`;
    const candidates: SwapCandidate[] = [];
    const base = { tokenIn, tokenOut, symbolIn: from.symbol, symbolOut: to.symbol, amountIn: amountIn.toString(), decimals: String(from.decimals), decimalsOut: String(to.decimals) };

    const [v3, v4, path] = await Promise.all([
      quoteV3Single(this.deps.chains, environment, tokenIn, tokenOut, amountIn),
      quoteV4(this.deps.chains, environment, tokenIn, tokenOut, amountIn),
      from.symbol !== "USDC" && to.symbol !== "USDC" ? quoteV3TwoHop(this.deps.chains, environment, tokenIn, usdc, tokenOut, amountIn) : Promise.resolve([]),
    ]);
    for (const q of v3) {
      const n = await net(q.amountOut, q.gasEstimate > 0n ? q.gasEstimate : GAS_DEFAULTS.v3);
      candidates.push({ option: { venue: "uniswap-v3", label: `Uniswap v3 ${q.fee / 10_000}% pool`, amountOut: q.amountOut.toString(), netAmountOut: n.toString(), risk: "low", executable: true, notes: [`Quote ${fmt(q.amountOut)} (QuoterV2).`] }, adapter: "swap", params: { ...base, fee: String(q.fee) }, amountOut: q.amountOut, netOut: n });
    }
    for (const q of v4) {
      const n = await net(q.amountOut, q.gasEstimate > 0n ? q.gasEstimate : GAS_DEFAULTS.v4);
      candidates.push({
        option: { venue: "uniswap-v4", label: `Uniswap v4 ${q.key.fee / 10_000}% pool`, amountOut: q.amountOut.toString(), netAmountOut: n.toString(), risk: "low", executable: true, notes: [`Quote ${fmt(q.amountOut)} (V4Quoter); pays through Permit2.`] },
        adapter: "swap-v4",
        params: { ...base, currency0: q.key.currency0, currency1: q.key.currency1, fee: String(q.key.fee), tickSpacing: String(q.key.tickSpacing), hooks: q.key.hooks, zeroForOne: String(q.zeroForOne) },
        amountOut: q.amountOut,
        netOut: n,
      });
    }
    for (const q of path) {
      const n = await net(q.amountOut, q.gasEstimate > 0n ? q.gasEstimate : GAS_DEFAULTS.path);
      candidates.push({
        option: { venue: "uniswap-v3", label: `Uniswap v3 ${from.symbol}→USDC→${to.symbol} (${q.hops.map((h) => `${h.fee / 10_000}%`).join(" + ")})`, amountOut: q.amountOut.toString(), netAmountOut: n.toString(), risk: "low", executable: true, notes: ["Two hops through USDC, one transaction."] },
        adapter: "swap-path",
        params: { ...base, path: q.path, hops: q.hops.map((h) => `${h.fee}`).join(",") },
        amountOut: q.amountOut,
        netOut: n,
      });
    }

    const practice = await practiceVenues(environment);
    const isPair = (a: string, b: string) => (from.symbol === a && to.symbol === b) || (from.symbol === b && to.symbol === a);
    if (practice.swap && isPair("USDC", "EURC")) {
      try {
        const out = await this.deps.chains.client(environment).readContract({ address: practice.swap, abi: PRACTICE_SWAP_ABI, functionName: "quoteOut", args: [tokenIn, amountIn] });
        if (out > 0n) {
          const n = await net(out, GAS_DEFAULTS.practice);
          candidates.push({ option: { venue: "lykia-practice", label: "Lykia Practice Swap USDC/EURC", amountOut: out.toString(), netAmountOut: n.toString(), risk: "medium", executable: true, notes: ["Testnet practice pool at an owner-set rate. Not audited."] }, adapter: "practice-swap", params: { ...base, pool: practice.swap }, amountOut: out, netOut: n });
        }
      } catch {
        /* not quotable */
      }
    }

    // Routable adapter manifests with a swap or fx capability for this pair, priced by their quote read.
    for (const m of await this.adapterManifests(environment)) {
      for (const cap of m.capabilities.filter((c) => (c.verb === "swap" || c.verb === "fx") && c.tokenIn === from.symbol && c.tokenOut === to.symbol && c.quote)) {
        const params = manifestParams(m, environment, cap);
        const out = params ? await readAdapterValue(this.deps.chains, environment, m, cap.quote!, { amount: amountIn, tokenIn, tokenOut }) : null;
        if (!params || out === null || out <= 0n) continue;
        const n = await net(out, BigInt(cap.gas));
        const risk: RiskTier = RISK_ORDER.indexOf(m.risk.tier) < RISK_ORDER.indexOf("medium") ? "medium" : m.risk.tier;
        candidates.push({ option: { venue: m.protocol.id, label: `${m.protocol.name} (${cap.id})`, amountOut: out.toString(), netAmountOut: n.toString(), risk, executable: true, notes: [`Quote ${fmt(out)} (adapter manifest read ${cap.quote}).`] }, adapter: "manifest", params: { ...base, ...params }, amountOut: out, netOut: n });
      }
    }

    const readOnly: VenueOption[] = [];
    const router = metarouter(environment);
    for (const pool of CL_POOLS[environment] ?? []) {
      if (!isPair(pool.pair[0], pool.pair[1])) continue;
      const quote = await quoteCl(this.deps.chains, environment, pool.pool, tokenIn, amountIn);
      if (quote === null) {
        const estimate = await this.poolEstimate(environment, pool.pool, tokenIn, amountIn);
        if (estimate !== null) readOnly.push({ venue: pool.venue, label: pool.label, amountOut: estimate.toString(), risk: "low", executable: false, notes: ["Mid-price estimate (the exact quote was unavailable)."] });
        continue;
      }
      if (pool.executable && router) {
        const n = await net(quote.amountOut, GAS_DEFAULTS.aerodrome);
        candidates.push({
          option: { venue: pool.venue, label: pool.label, amountOut: quote.amountOut.toString(), netAmountOut: n.toString(), risk: "low", executable: true, notes: [`Quote ${fmt(quote.amountOut)} (pool math through Lykia's quoter). ${pool.note}`] },
          adapter: "swap-aerodrome",
          params: { ...base, pool: pool.pool, router },
          amountOut: quote.amountOut,
          netOut: n,
        });
      } else {
        readOnly.push({ venue: pool.venue, label: pool.label, amountOut: quote.amountOut.toString(), risk: "low", executable: false, notes: [pool.note] });
      }
    }
    return { candidates, readOnly };
  }

  /** amountIn at the pool's mid price minus its fee (estimate, not a quote). */
  private async poolEstimate(environment: ArcEnvironment, pool: Address, tokenIn: Address, amountIn: bigint): Promise<bigint | null> {
    try {
      const client = this.deps.chains.client(environment);
      const [slot0, fee, token0] = await Promise.all([
        client.readContract({ address: pool, abi: CL_POOL_ABI, functionName: "slot0" }),
        client.readContract({ address: pool, abi: CL_POOL_ABI, functionName: "fee" }),
        client.readContract({ address: pool, abi: CL_POOL_ABI, functionName: "token0" }),
      ]);
      const sq = slot0[0] * slot0[0];
      if (sq === 0n) return null;
      const out = sameAddr(token0, tokenIn) ? (amountIn * sq) / Q192 : (amountIn * Q192) / sq;
      return (out * BigInt(1_000_000 - Number(fee))) / 1_000_000n;
    } catch {
      return null;
    }
  }

  /**
   * Best execution, possibly split: when the two best executable options sit
   * in different pools, half/half is re-quoted and taken if it beats the
   * single route by SPLIT_MIN_GAIN_BPS after gas.
   */
  async bestSwap(environment: ArcEnvironment, fromSymbol: string, toSymbol: string, amountIn: bigint, prefs?: VenuePrefs): Promise<{ legs: { candidate: SwapCandidate; amountIn: bigint }[]; route: RouteChoice } | null> {
    const quoted = await this.swap(environment, fromSymbol, toSymbol, amountIn);
    const candidates = allowed(quoted.candidates, prefs);
    const readOnly = quoted.readOnly.filter((o) => !(prefs?.blocked ?? []).includes(o.venue));
    const route = chooseSwap([...candidates.map((c) => c.option), ...readOnly]);
    if (!route) return null;
    const best = candidates.find((c) => c.option === route.chosen) as SwapCandidate;
    if (best && prefs?.favorites?.length && !prefs.favorites.includes(best.option.venue)) {
      const fav = candidates.filter((c) => prefs.favorites!.includes(c.option.venue)).sort((a, b) => (b.netOut > a.netOut ? 1 : -1))[0];
      if (fav && best.netOut > 0n && (best.netOut - fav.netOut) * 10_000n <= best.netOut * BigInt(FAVORITE_SWAP_BPS)) {
        return { legs: [{ candidate: fav, amountIn }], route: { ...route, chosen: fav.option, reason: `${fav.option.label} is one of your favourites and within ${FAVORITE_SWAP_BPS} bps of ${best.option.label}; your favourite wins the tie.` } };
      }
    }
    const second = candidates.filter((c) => c !== best && c.adapter !== "swap-path" && !(c.adapter === best.adapter && c.params.fee === best.params.fee)).sort((a, b) => (b.netOut > a.netOut ? 1 : -1))[0];
    if (second && amountIn >= 2n && !prefs?.noSplit) {
      const half = amountIn / 2n;
      const rest = amountIn - half;
      const [a, b] = await Promise.all([this.swap(environment, fromSymbol, toSymbol, half), this.swap(environment, fromSymbol, toSymbol, rest)]);
      const pickSame = (list: SwapCandidate[], like: SwapCandidate) => list.find((c) => c.adapter === like.adapter && c.params.fee === like.params.fee && c.params.tickSpacing === like.params.tickSpacing);
      const legA = pickSame(a.candidates, best);
      const legB = pickSame(b.candidates, second);
      if (legA && legB) {
        const splitNet = legA.netOut + legB.netOut;
        if (best.netOut > 0n && (splitNet - best.netOut) * 10_000n > best.netOut * BigInt(SPLIT_MIN_GAIN_BPS)) {
          const gain = Number(((splitNet - best.netOut) * 10_000n) / best.netOut);
          return {
            legs: [{ candidate: legA, amountIn: half }, { candidate: legB, amountIn: rest }],
            route: { ...route, reason: `Split 50/50 across ${legA.option.label} and ${legB.option.label}: ${gain} bps more than ${best.option.label} alone, after gas.`, split: [{ option: legA.option, shareBps: 5000 }, { option: legB.option, shareBps: 5000 }] },
          };
        }
      }
    }
    return { legs: [{ candidate: best, amountIn }], route };
  }

  /* ------------------------------------------------------------- borrow */

  async borrow(
    environment: ArcEnvironment,
    input: { readonly loan: string; readonly amount: bigint; readonly collateral: string; readonly collateralUnits: bigint | null; readonly walletCollateral: bigint; readonly minHealthWad: bigint; readonly account: Address },
  ): Promise<BorrowCandidate[]> {
    const loan = getToken(input.loan);
    const coll = getToken(input.collateral);
    if (!loan || !coll) return [];
    const rates = await this.deps.yields.rates(environment);
    const [loanPrice, collPrice] = await Promise.all([this.deps.prices.price(loan.symbol), this.deps.prices.price(coll.symbol)]);
    const debtMicros = loanPrice.usd === null ? null : usdMicrosOf(input.amount, loan.decimals, loanPrice.usd);
    const loanAddress = tokenAddress(loan, environment) as Address;
    const collAddress = tokenAddress(coll, environment) as Address;
    const out: BorrowCandidate[] = [];
    const withBuffer = (units: bigint) => (units * 1_02n + 99n) / 100n;
    const capped = (units: bigint) => (units > input.walletCollateral ? input.walletCollateral : units);

    for (const spoke of aaveSpokes(environment).filter((s) => s.key === "main")) {
      const loanReserve = aaveReserve(spoke, loan.symbol);
      const collReserve = aaveReserve(spoke, coll.symbol);
      if (!loanReserve || !collReserve) continue;
      const cf = await liveCollateralFactorBps(this.deps.chains, environment, spoke, collReserve);
      const account = await readAaveAccount(this.deps.chains, environment, spoke.address, input.account);
      const rate = rates.reserves.find((r) => sameAddr(r.spoke, spoke.address) && r.reserveId === loanReserve.reserveId);
      let collateralUnits = input.collateralUnits ?? 0n;
      let hf: string | null = null;
      const notes: string[] = [];
      if (debtMicros === null || collPrice.usd === null || cf === 0) notes.push("Prices or the collateral factor are unreadable; the health factor cannot be projected.");
      else {
        if (input.collateralUnits === null) {
          const needMicros = aaveCollateralNeededMicros(account, cf, debtMicros, input.minHealthWad);
          collateralUnits = needMicros <= 0n ? 0n : capped(withBuffer(unitsForUsdMicros(needMicros, coll.decimals, collPrice.usd) + 1n));
        }
        hf = wadToRatio(projectAaveHealth(account, usdMicrosOf(collateralUnits, coll.decimals, collPrice.usd), cf, debtMicros));
        notes.push(`Collateral factor ${cf / 100}% for ${coll.symbol}.`);
      }
      out.push({
        option: { venue: "aave-v4", label: `${spoke.label} ${loan.symbol}`, apy: rate?.borrowApy ?? null, apySource: rate?.borrowApy ? "Aave API" : undefined, healthFactor: hf, risk: "low", executable: hf !== null && (rate ? rate.canBorrow : true), notes } as VenueOption,
        adapter: "aave-borrow",
        params: { spoke: spoke.address, spokeName: spoke.label, loanReserve: String(loanReserve.reserveId), collReserve: String(collReserve.reserveId), loanToken: loanAddress, collToken: collAddress, loanSymbol: loan.symbol, collSymbol: coll.symbol, decimals: String(coll.decimals), loanDecimals: String(loan.decimals) },
        collateralUnits,
        healthFactor: hf,
      });
    }

    const market = morphoMarketFor(environment, loan.symbol, coll.symbol);
    if (market) {
      const position = await readMorphoPosition(this.deps.chains, environment, market, input.account);
      const rate = rates.markets.find((m) => m.marketId === market.id.toLowerCase());
      let collateralUnits = input.collateralUnits ?? 0n;
      let hf: string | null = null;
      const notes: string[] = [];
      if (!position) notes.push("The market or its oracle could not be read.");
      else {
        if (input.collateralUnits === null) {
          const need = morphoCollateralNeeded(market, position, input.amount, input.minHealthWad);
          collateralUnits = need <= 0n ? 0n : capped(withBuffer(need));
        }
        hf = wadToRatio(projectMorphoHealth(market, position, collateralUnits, input.amount));
        notes.push(`LLTV ${Number(market.params.lltv / 10n ** 14n) / 100}%.`);
      }
      out.push({
        option: { venue: "morpho-blue", label: market.label, apy: rate?.borrowApy ?? null, apySource: rate?.borrowApy ? "Morpho API" : undefined, tvlUsd: rate?.supplyUsd ?? null, healthFactor: hf, risk: riskFromTvl(rate?.supplyUsd ? Number(rate.supplyUsd) : null), executable: hf !== null, notes } as VenueOption,
        adapter: "morpho-borrow",
        params: { market: market.id, loanToken: loanAddress, collToken: collAddress, loanSymbol: loan.symbol, collSymbol: coll.symbol, decimals: String(coll.decimals), loanDecimals: String(loan.decimals) },
        collateralUnits,
        healthFactor: hf,
      });
    }

    const practice = await practiceVenues(environment);
    if (practice.lending && loan.symbol === "USDC" && coll.symbol === "cirBTC") {
      try {
        const client = this.deps.chains.client(environment);
        let collateralUnits = input.collateralUnits ?? 0n;
        if (input.collateralUnits === null) {
          const full = await client.readContract({ address: practice.lending, abi: PRACTICE_LENDING_ABI, functionName: "healthFactorAfter", args: [input.account, input.walletCollateral, input.amount] });
          collateralUnits = full === 0n ? input.walletCollateral : capped(withBuffer((input.walletCollateral * input.minHealthWad + full - 1n) / full));
        }
        const hfWad = await client.readContract({ address: practice.lending, abi: PRACTICE_LENDING_ABI, functionName: "healthFactorAfter", args: [input.account, collateralUnits, input.amount] });
        const hf = wadToRatio(hfWad);
        out.push({
          option: { venue: "lykia-practice", label: "Lykia Practice Lending cirBTC/USDC", apy: null, healthFactor: hf, risk: "medium", executable: hf !== null, notes: ["Testnet practice market with an owner-set price. Not audited."] },
          adapter: "practice-borrow",
          params: { pool: practice.lending, loanToken: loanAddress, collToken: collAddress, loanSymbol: loan.symbol, collSymbol: coll.symbol, decimals: String(coll.decimals), loanDecimals: String(loan.decimals) },
          collateralUnits,
          healthFactor: hf,
        });
      } catch {
        /* practice lending unreadable */
      }
    }
    return out;
  }

  chooseBorrow(all: readonly BorrowCandidate[], minHealth: string, venue?: string, prefs?: VenuePrefs): { candidate: BorrowCandidate; route: RouteChoice } | null {
    const candidates = allowed(all, prefs);
    const pool = venue ? candidates.filter((c) => c.option.venue === venue.split(":")[0]) : candidates;
    const route = chooseBorrow((pool.length > 0 ? pool : candidates).map((c) => c.option), minHealth);
    if (!route) return null;
    const candidate = candidates.find((c) => c.option === route.chosen) as BorrowCandidate;
    return { candidate, route: { ...route, alternatives: candidates.filter((c) => c !== candidate).map((c) => c.option) } };
  }
}
