/**
 * Live rates for ranking venues. Morpho vault APYs and market rates come
 * from the Morpho API (api.morpho.org); Aave V4 reserve rates come from the
 * Aave API (api.aave.com). Both are labelled with their source. When an API
 * does not answer, the rate is null ("APY unknown"), never a guess, and the
 * router falls back to on-chain size.
 */
import type { Address, ArcEnvironment } from "@lykia/core";
import type { Clock } from "../../clock.js";
import type { FetchLike } from "../../health/dependencies.js";

const MORPHO_API = "https://api.morpho.org/graphql";
const AAVE_API = "https://api.aave.com/graphql";
const RATES_CACHE_MS = 5 * 60_000;
const ARC_MAINNET_CHAIN_ID = 5042;

export interface VaultRate {
  readonly address: Address;
  readonly name: string;
  readonly asset: string;
  /** Net APY after the vault's fees, decimal fraction string. */
  readonly apy: string | null;
  readonly tvlUsd: string | null;
  /** Curator names as the Morpho API lists them. */
  readonly curators?: readonly string[];
}

export interface MarketRate {
  readonly marketId: string;
  readonly loan: string;
  readonly collateral: string | null;
  readonly borrowApy: string | null;
  readonly supplyApy: string | null;
  readonly utilization: string | null;
  readonly supplyUsd: string | null;
}

export interface ReserveRate {
  readonly spoke: Address;
  readonly spokeName: string;
  readonly reserveId: number;
  readonly symbol: string;
  readonly supplyApy: string | null;
  readonly borrowApy: string | null;
  readonly canSupply: boolean;
  readonly canBorrow: boolean;
}

export interface RatesSnapshot {
  readonly vaults: readonly VaultRate[];
  readonly markets: readonly MarketRate[];
  readonly reserves: readonly ReserveRate[];
  readonly sources: { readonly morpho: "live" | "unavailable"; readonly aave: "live" | "unavailable" };
  readonly at: string;
}

function num(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?(?:e-?\d+)?$/iu.test(value)) return String(Number(value));
  return null;
}

async function graphql(fetchImpl: FetchLike, url: string, query: string): Promise<unknown> {
  const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body = (await response.json()) as { data?: unknown; errors?: unknown };
  if (!body.data) throw new Error(`${url} returned no data`);
  return body.data;
}

export class YieldService {
  private cache: { at: number; snapshot: RatesSnapshot } | null = null;
  private inflight: Promise<RatesSnapshot> | null = null;

  constructor(private readonly deps: { readonly fetch: FetchLike; readonly clock: Clock }) {}

  /** Rates on Arc mainnet (testnet venues have no market rates). */
  async rates(environment: ArcEnvironment): Promise<RatesSnapshot> {
    const now = this.deps.clock.now();
    if (environment === "testnet") return { vaults: [], markets: [], reserves: [], sources: { morpho: "unavailable", aave: "unavailable" }, at: new Date(now).toISOString() };
    if (this.cache && now - this.cache.at < RATES_CACHE_MS) return this.cache.snapshot;
    if (this.inflight) return this.inflight;
    this.inflight = this.load()
      .then((snapshot) => {
        this.cache = { at: this.deps.clock.now(), snapshot };
        return snapshot;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async load(): Promise<RatesSnapshot> {
    const [morpho, aave] = await Promise.allSettled([this.loadMorpho(), this.loadAave()]);
    return {
      vaults: morpho.status === "fulfilled" ? morpho.value.vaults : [],
      markets: morpho.status === "fulfilled" ? morpho.value.markets : [],
      reserves: aave.status === "fulfilled" ? aave.value : [],
      sources: { morpho: morpho.status === "fulfilled" ? "live" : "unavailable", aave: aave.status === "fulfilled" ? "live" : "unavailable" },
      at: new Date(this.deps.clock.now()).toISOString(),
    };
  }

  private async loadMorpho(): Promise<{ vaults: VaultRate[]; markets: MarketRate[] }> {
    const data = (await graphql(
      this.deps.fetch,
      MORPHO_API,
      `{ vaultV2s(first: 100, where: { chainId_in: [${ARC_MAINNET_CHAIN_ID}] }) { items { address name asset { symbol } totalAssetsUsd netApy apy curators { items { name } } } }
         markets(first: 100, where: { chainId_in: [${ARC_MAINNET_CHAIN_ID}] }) { items { marketId loanAsset { symbol } collateralAsset { symbol } state { borrowApy supplyApy utilization supplyAssetsUsd } } } }`,
    )) as {
      vaultV2s?: { items?: Array<{ address?: string; name?: string; asset?: { symbol?: string }; totalAssetsUsd?: number; netApy?: number; apy?: number; curators?: { items?: Array<{ name?: string }> } }> };
      markets?: { items?: Array<{ marketId?: string; loanAsset?: { symbol?: string }; collateralAsset?: { symbol?: string } | null; state?: { borrowApy?: number; supplyApy?: number; utilization?: number; supplyAssetsUsd?: number } | null }> };
    };
    const vaults = (data.vaultV2s?.items ?? [])
      .filter((v): v is Required<Pick<typeof v, "address">> & typeof v => typeof v.address === "string")
      .map((v) => ({ address: v.address as Address, name: v.name ?? "", asset: v.asset?.symbol ?? "", apy: num(v.netApy ?? v.apy), tvlUsd: num(v.totalAssetsUsd), curators: (v.curators?.items ?? []).map((c) => c.name ?? "").filter((n) => n.length > 0) }));
    const markets = (data.markets?.items ?? [])
      .filter((m) => typeof m.marketId === "string" && m.state)
      .map((m) => ({
        marketId: (m.marketId as string).toLowerCase(),
        loan: m.loanAsset?.symbol ?? "",
        collateral: m.collateralAsset?.symbol ?? null,
        borrowApy: num(m.state?.borrowApy),
        supplyApy: num(m.state?.supplyApy),
        utilization: num(m.state?.utilization),
        supplyUsd: num(m.state?.supplyAssetsUsd),
      }));
    return { vaults, markets };
  }

  private async loadAave(): Promise<ReserveRate[]> {
    const data = (await graphql(
      this.deps.fetch,
      AAVE_API,
      `query { reserves(request: { query: { chainIds: [${ARC_MAINNET_CHAIN_ID}] }, filter: ALL, orderBy: { supplyApy: DESC } }) { onChainId canSupply canBorrow spoke { address name } asset { underlying { info { symbol } } } summary { supplyApy { value } borrowApy { value } } } }`,
    )) as {
      reserves?: Array<{ onChainId?: string; canSupply?: boolean; canBorrow?: boolean; spoke?: { address?: string; name?: string }; asset?: { underlying?: { info?: { symbol?: string } } }; summary?: { supplyApy?: { value?: string }; borrowApy?: { value?: string } } }>;
    };
    return (data.reserves ?? [])
      .filter((r) => typeof r.spoke?.address === "string" && typeof r.onChainId === "string")
      .map((r) => ({
        spoke: r.spoke?.address as Address,
        spokeName: r.spoke?.name ?? "",
        reserveId: Number(r.onChainId),
        symbol: r.asset?.underlying?.info?.symbol ?? "",
        supplyApy: num(r.summary?.supplyApy?.value),
        borrowApy: num(r.summary?.borrowApy?.value),
        canSupply: r.canSupply === true,
        canBorrow: r.canBorrow === true,
      }));
  }
}

export function sameAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
