/**
 * Lending positions: Aave V4 (Main and Forex Spokes) and Morpho Blue.
 *
 * Aave V4: every reserve of each Spoke (getReserveCount + getReserve, so a
 * new reserve such as WETH appears without a code change) is read in one
 * Multicall3 batch: supplied assets, total debt, the collateral and
 * borrowing flags (getUserReserveStatus), and the account's health factor,
 * average collateral factor, collateral and debt value (getUserAccountData).
 * In Aave V4 the collateral factor is the liquidation threshold: the health
 * factor is collateral value times its factor over debt. Rates come from
 * the Aave API. Interest earned is shown only for the proven owner and only
 * when the owner's own Lykia history explains the supply: supplied now
 * minus net settled Lykia supplies to that Spoke and reserve, kept only when
 * it is positive and no larger than the reserve's APY could have produced
 * since the first deposit (anything else means money moved outside Lykia,
 * so the figure is omitted, never guessed).
 *
 * Morpho Blue: market ids come from the registry, from the Morpho API's
 * positions for the address, and from the chain itself (Supply and
 * SupplyCollateral events with the owner as onBehalf, scanned by the event
 * scanner). Each market is read with idToMarketParams, market, position
 * and the market oracle's price; borrow assets round up and supply assets
 * round down, as SharesMathLib does. Health = collateral * price / 1e36 *
 * LLTV / borrowed.
 */
import { classifyPosition, tokenByAddress, type Address, type Position, type TokenDescriptor } from "@lykia/core";
import { toEventSelector, type Hex } from "viem";
import { AAVE_SPOKE_ABI, MORPHO_BLUE_ABI, MORPHO_ORACLE_ABI } from "../engine/abis.js";
import { aaveSpokes, wadToRatio } from "../engine/venues/aave.js";
import { MORPHO_BLUE, morphoMarkets } from "../engine/venues/morphoBlue.js";
import { ERC20_META_ABI } from "./abis.js";
import { action, addressLink, asset, finish, fractionToPercent, sentenceAmount, valued, VenueUnavailable, type ReadContext, type Reader } from "./context.js";
import { morphoHealthWad, morphoLtvWad, morphoSharesToAssets, wadString } from "./math.js";
import { addressTopic, coverageLine, scanForOwner } from "./scanner.js";

const RAY = 10n ** 27n;
/** Aave V4 values are 1e26 per USD. */
const AAVE_VALUE_PER_USD = 10n ** 26n;

const usd2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ----------------------------------------------------------- Aave V4 */

export interface AaveEarnedInput {
  readonly suppliedUnits: bigint;
  readonly decimals: number;
  readonly symbol: string;
  readonly spokeLabel: string;
  readonly apyPercent: number | null;
  readonly nowMs: number;
}

/**
 * Interest earned on an Aave supply from the owner's Lykia history, or null
 * when the history does not explain the position (see the module comment).
 */
export function aaveEarnedFromHistory(history: readonly { readonly createdAt: string; readonly steps: readonly { readonly venue: string; readonly kind: string; readonly status: string; readonly summary: string; readonly settledAt?: string; readonly inputs: readonly { readonly symbol: string; readonly amount: string }[]; readonly outputs: readonly { readonly symbol: string; readonly amount: string }[] }[] }[], input: AaveEarnedInput): { units: bigint; since: string } | null {
  let principal = 0n;
  let first: string | null = null;
  for (const g of history) {
    for (const s of g.steps) {
      if (s.venue !== "aave-v4" || s.status !== "settled" || !s.summary.includes(input.spokeLabel)) continue;
      const at = s.settledAt ?? g.createdAt;
      for (const o of s.outputs) {
        if (o.symbol === `${input.symbol}@aave-v4`) {
          principal += BigInt(o.amount);
          if (first === null || at < first) first = at;
        } else if (s.kind === "withdraw" && o.symbol === input.symbol) {
          principal -= BigInt(o.amount);
        }
      }
    }
  }
  if (first === null || principal <= 0n || input.suppliedUnits < principal) return null;
  const gain = input.suppliedUnits - principal;
  const years = Math.max(0, (input.nowMs - Date.parse(first)) / (365 * 86_400_000));
  const ceiling = input.apyPercent === null ? 0 : (input.apyPercent / 100) * years * 1.5 + 0.0005;
  if (Number(gain) / Number(principal) > ceiling) return null;
  return { units: gain, since: first };
}

export const readAave: Reader = async (r, venue) => {
  const spokes = aaveSpokes(r.environment);
  if (spokes.length === 0) throw new VenueUnavailable("Aave V4 has no Spokes on this network.");
  const client = r.ctx.chains.client(r.environment);
  const counts = await client.multicall({ contracts: spokes.map((s) => ({ address: s.address, abi: AAVE_SPOKE_ABI, functionName: "getReserveCount" }) as const), allowFailure: true });
  const pairs = spokes.flatMap((spoke, i) => {
    const n = counts[i]?.status === "success" ? Number(counts[i]!.result as bigint) : spoke.reserves.length;
    return Array.from({ length: Math.min(n, 16) }, (_, reserveId) => ({ spoke, reserveId }));
  });
  const reads = await client.multicall({
    contracts: pairs.flatMap(({ spoke, reserveId }) => [
      { address: spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getUserSuppliedAssets", args: [BigInt(reserveId), r.owner] } as const,
      { address: spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getUserTotalDebt", args: [BigInt(reserveId), r.owner] } as const,
      { address: spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getUserReserveStatus", args: [BigInt(reserveId), r.owner] } as const,
      { address: spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getReserve", args: [BigInt(reserveId)] } as const,
    ]),
    allowFailure: true,
  });
  if (reads.length > 0 && reads.every((x) => x.status === "failure")) throw new VenueUnavailable("The Aave V4 Spokes did not answer.");
  const rows = pairs
    .map((p, i) => {
      const at = (k: number) => reads[4 * i + k];
      const ok = (k: number) => at(k)?.status === "success";
      return {
        ...p,
        supplied: ok(0) ? (at(0)!.result as bigint) : null,
        debt: ok(1) ? (at(1)!.result as bigint) : null,
        status: ok(2) ? (at(2)!.result as readonly [boolean, boolean]) : null,
        reserve: ok(3) ? (at(3)!.result as { underlying: Address; decimals: number; dynamicConfigKey: number }) : null,
      };
    })
    .filter((x) => (x.supplied ?? 0n) > 0n || (x.debt ?? 0n) > 0n);
  const missing = pairs.filter((_, i) => reads[4 * i]?.status !== "success" || reads[4 * i + 1]?.status !== "success").length;
  const block = (await client.getBlockNumber()).toString();
  if (rows.length === 0) {
    if (missing > 0) throw new VenueUnavailable(`${missing} Aave V4 reserve read(s) failed; the position cannot be judged.`);
    return { positions: [], block, method: "Every reserve of the Main and Forex Spokes, one Multicall3 batch.", source: "chain" };
  }
  const active = [...new Set(rows.map((x) => x.spoke))];
  const [accounts, configs, rates, history] = await Promise.all([
    client.multicall({ contracts: active.map((s) => ({ address: s.address, abi: AAVE_SPOKE_ABI, functionName: "getUserAccountData", args: [r.owner] }) as const), allowFailure: true }),
    client.multicall({ contracts: rows.map((x) => ({ address: x.spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getDynamicReserveConfig", args: [BigInt(x.reserveId), x.reserve?.dynamicConfigKey ?? 0] }) as const), allowFailure: true }),
    r.rates(),
    r.personal ? r.history() : Promise.resolve([]),
  ]);
  const tokens = rows.map((x) => (x.reserve ? tokenByAddress(r.environment, x.reserve.underlying) : null) ?? (x.spoke.reserves.find((s) => s.reserveId === x.reserveId) ? { symbol: x.spoke.reserves.find((s) => s.reserveId === x.reserveId)!.symbol, decimals: x.spoke.reserves.find((s) => s.reserveId === x.reserveId)!.decimals } : null));
  const prices = await r.prices(tokens.filter((t): t is NonNullable<typeof t> => t !== null).map((t) => t.symbol));
  const positions: Position[] = [];
  rows.forEach((x, i) => {
    const t = tokens[i];
    if (!t) return;
    const ai = active.indexOf(x.spoke);
    const account = accounts[ai]?.status === "success" ? (accounts[ai]!.result as { healthFactor: bigint; avgCollateralFactor: bigint; totalCollateralValue: bigint; totalDebtValueRay: bigint }) : null;
    const hasDebt = account ? account.totalDebtValueRay > 0n : (x.debt ?? 0n) > 0n;
    const hf = account && hasDebt ? wadToRatio(account.healthFactor) : null;
    const hfNum = hf === null ? null : Number(hf);
    const cf = configs[i]?.status === "success" ? (configs[i]!.result as { collateralFactor: number }).collateralFactor : null;
    const debtUsd = account ? Number(account.totalDebtValueRay / RAY) / Number(AAVE_VALUE_PER_USD) : null;
    const collUsd = account ? Number(account.totalCollateralValue) / Number(AAVE_VALUE_PER_USD) : null;
    const ltv = debtUsd !== null && collUsd !== null && collUsd > 0 && debtUsd > 0 ? ((debtUsd / collUsd) * 100).toFixed(2) : null;
    const avgCf = account ? wadString(account.avgCollateralFactor * 100n, 2) : null;
    const rate = rates?.reserves.find((q) => q.spoke.toLowerCase() === x.spoke.address.toLowerCase() && q.reserveId === x.reserveId) ?? null;
    const price = prices[t.symbol]?.usd ?? null;
    const usingAsCollateral = x.status?.[0] ?? false;
    const health = { factor: hf, liquidationAtPercent: avgCf, ltvPercent: ltv, floor: String(r.healthFloor) };
    const underlying = x.reserve?.underlying ?? null;
    const base = { venue: venue.id, venueName: venue.name, venueKind: "lending" as const, source: "chain" as const, readAt: r.readAt, block, explorer: addressLink(r.environment, x.spoke.address) };
    const facts = (extra: { label: string; value: string }[]) => [{ label: "Spoke", value: x.spoke.label }, { label: "Reserve id", value: String(x.reserveId) }, ...extra];
    if ((x.supplied ?? 0n) > 0n) {
      const v = valued(x.supplied!, t.decimals, price);
      const apy = fractionToPercent(rate?.supplyApy);
      const earned = r.personal ? aaveEarnedFromHistory(history, { suppliedUnits: x.supplied!, decimals: t.decimals, symbol: t.symbol, spokeLabel: x.spoke.label, apyPercent: apy === null ? null : Number(apy), nowMs: r.ctx.clock.now() }) : null;
      const earnedV = earned ? valued(earned.units, t.decimals, price) : null;
      const amount = Number(v.amount);
      positions.push(
        finish({
          ...base,
          id: `aave-v4:${x.spoke.key}:${x.reserveId}:supply`,
          label: `${x.spoke.label} · ${t.symbol} supplied`,
          assets: [asset(t.symbol, underlying, v.amount, v.valueUsd, usingAsCollateral ? "collateral" : "supplied")],
          amount: v.amount,
          symbol: t.symbol,
          valueUsd: v.valueUsd,
          counts: "net",
          state: classifyPosition({ kind: "supply", apyPercent: apy === null ? null : Number(apy), healthFactor: usingAsCollateral && hasDebt ? hfNum : null, healthFloor: r.healthFloor }),
          ...(apy !== null ? { apy: { percent: apy, kind: "supply" as const, source: "Aave API" } } : {}),
          ...(earnedV && earnedV.valueUsd !== null ? { earned: { usd: earnedV.valueUsd, since: earned!.since, method: "Supplied now minus your net Lykia supplies to this reserve" } } : {}),
          ...(hasDebt && usingAsCollateral ? { health } : {}),
          collateral: usingAsCollateral,
          facts: facts([{ label: "Used as collateral", value: usingAsCollateral ? "yes" : "no" }, ...(cf !== null && usingAsCollateral ? [{ label: "Collateral factor", value: `${(cf / 100).toFixed(2)}%` }] : [])]),
          actions: [
            action("withdraw", "Withdraw", `Withdraw ${sentenceAmount(amount / 2)} ${t.symbol} from ${x.spoke.label}`),
            ...(r.environment === "mainnet" ? [action("move-rate", "Move to a better rate", `Withdraw ${sentenceAmount(amount)} ${t.symbol} from ${x.spoke.label} and put it to work at low risk`)] : []),
          ],
        }),
      );
    }
    if ((x.debt ?? 0n) > 0n) {
      const v = valued(-x.debt!, t.decimals, price);
      const apy = fractionToPercent(rate?.borrowApy);
      const amount = Number(v.amount.replace(/^-/u, ""));
      positions.push(
        finish({
          ...base,
          id: `aave-v4:${x.spoke.key}:${x.reserveId}:debt`,
          label: `${x.spoke.label} · ${t.symbol} borrowed`,
          assets: [asset(t.symbol, underlying, v.amount, v.valueUsd, "borrowed")],
          amount: v.amount.replace(/^-/u, ""),
          symbol: t.symbol,
          valueUsd: v.valueUsd,
          counts: "net",
          state: classifyPosition({ kind: "debt", healthFactor: hfNum, healthFloor: r.healthFloor }),
          ...(apy !== null ? { apy: { percent: apy, kind: "borrow" as const, source: "Aave API" } } : {}),
          health,
          facts: facts([
            { label: "Collateral value", value: collUsd === null ? "unreadable" : usd2(collUsd) },
            { label: "Debt value", value: debtUsd === null ? "unreadable" : usd2(debtUsd) },
          ]),
          actions: [
            action("repay", "Repay a quarter", `Repay ${sentenceAmount(amount / 4)} ${t.symbol} on aave-v4`),
            action("add-collateral", "Add collateral", `How much cirBTC should I add as collateral on ${x.spoke.label} to lift my health factor above ${r.healthFloor}?`, "ask"),
          ],
        }),
      );
    }
  });
  return { positions, block, method: "Every reserve of the Main and Forex Spokes (getReserveCount), one Multicall3 batch; health from getUserAccountData; rates from the Aave API.", source: "chain", ...(missing > 0 ? { coverage: `${missing} reserve read(s) did not answer this time.` } : {}) };
};

/* --------------------------------------------------------- Morpho Blue */

const MORPHO_SUPPLY = toEventSelector("Supply(bytes32,address,address,uint256,uint256)");
const MORPHO_SUPPLY_COLLATERAL = toEventSelector("SupplyCollateral(bytes32,address,address,uint256)");
/** First Morpho Blue event on Arc mainnet (block 1,208,173, read from the explorer on 2026-11-06). */
const MORPHO_BLUE_FIRST_BLOCK = 1_208_173n;

/** Market ids the Morpho API lists for the address (a real API; empty when it does not answer). */
async function morphoApiMarkets(r: ReadContext): Promise<string[]> {
  if (r.environment !== "mainnet") return [];
  try {
    const res = await r.ctx.fetch("https://api.morpho.org/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{ marketPositions(first: 50, where: { chainId_in: [5042], userAddress_in: ["${r.owner}"] }) { items { market { marketId } } } }` }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { marketPositions?: { items?: Array<{ market?: { marketId?: string } }> } } };
    return (body.data?.marketPositions?.items ?? []).map((i) => i.market?.marketId ?? "").filter((id) => /^0x[0-9a-fA-F]{64}$/u.test(id)).map((id) => id.toLowerCase());
  } catch {
    return [];
  }
}

export const readMorphoBlue: Reader = async (r, venue) => {
  const blue = MORPHO_BLUE[r.environment];
  if (!blue) throw new VenueUnavailable("Morpho Blue is not on this network.");
  const client = r.ctx.chains.client(r.environment);
  const registry = morphoMarkets(r.environment).map((m) => m.id.toLowerCase());
  const [api, scan] = await Promise.all([
    morphoApiMarkets(r),
    scanForOwner(r.ctx, r.environment, r.owner, { key: "morpho-blue", address: blue, topics: [[MORPHO_SUPPLY, MORPHO_SUPPLY_COLLATERAL], null, null, addressTopic(r.owner)], fromBlock: MORPHO_BLUE_FIRST_BLOCK, extract: (log) => (log.topics[1] ? log.topics[1].toLowerCase() : null) }).catch(() => null),
  ]);
  const ids = [...new Set([...registry, ...api, ...(scan?.ids ?? [])])].slice(0, 40) as Hex[];
  const reads = await client.multicall({
    contracts: ids.flatMap((id) => [
      { address: blue, abi: MORPHO_BLUE_ABI, functionName: "position", args: [id, r.owner] } as const,
      { address: blue, abi: MORPHO_BLUE_ABI, functionName: "market", args: [id] } as const,
      { address: blue, abi: MORPHO_BLUE_ABI, functionName: "idToMarketParams", args: [id] } as const,
    ]),
    allowFailure: true,
  });
  if (ids.length > 0 && reads.every((x) => x.status === "failure")) throw new VenueUnavailable("Morpho Blue did not answer.");
  const block = (await client.getBlockNumber()).toString();
  const held = ids
    .map((id, i) => {
      const pos = reads[3 * i]?.status === "success" ? (reads[3 * i]!.result as readonly [bigint, bigint, bigint]) : null;
      const mkt = reads[3 * i + 1]?.status === "success" ? (reads[3 * i + 1]!.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint]) : null;
      const params = reads[3 * i + 2]?.status === "success" ? (reads[3 * i + 2]!.result as readonly [Address, Address, Address, Address, bigint]) : null;
      return { id, pos, mkt, params };
    })
    .filter((m): m is { id: Hex; pos: readonly [bigint, bigint, bigint]; mkt: readonly [bigint, bigint, bigint, bigint, bigint, bigint]; params: readonly [Address, Address, Address, Address, bigint] } => m.pos !== null && m.mkt !== null && m.params !== null && (m.pos[0] > 0n || m.pos[1] > 0n || m.pos[2] > 0n));
  const method = `Markets from the registry (${registry.length}), the Morpho API (${api.length}) and Supply/SupplyCollateral events with the owner as onBehalf (${scan ? scan.ids.length : "scan unavailable"}).`;
  const coverage = scan ? coverageLine(scan) : "The event scan did not answer; markets from the registry and the Morpho API only.";
  if (held.length === 0) return { positions: [], block, method, source: "chain", ...(coverage ? { coverage } : {}) };
  // Token metadata: the registry first, the token itself otherwise.
  const tokenAddrs = [...new Set(held.flatMap((m) => [m.params[0].toLowerCase(), m.params[1].toLowerCase()]))] as Address[];
  const unknown = tokenAddrs.filter((a) => !tokenByAddress(r.environment, a));
  const meta = await client.multicall({ contracts: unknown.flatMap((a) => [{ address: a, abi: ERC20_META_ABI, functionName: "symbol" } as const, { address: a, abi: ERC20_META_ABI, functionName: "decimals" } as const]), allowFailure: true });
  const tokenOf = (a: Address): Pick<TokenDescriptor, "symbol" | "decimals"> | null => {
    const known = tokenByAddress(r.environment, a);
    if (known) return known;
    const k = unknown.indexOf(a.toLowerCase() as Address);
    const s = meta[2 * k];
    const d = meta[2 * k + 1];
    return s?.status === "success" && d?.status === "success" ? { symbol: String(s.result).slice(0, 12), decimals: Number(d.result) } : null;
  };
  const oracles = await client.multicall({ contracts: held.map((m) => ({ address: m.params[2], abi: MORPHO_ORACLE_ABI, functionName: "price" }) as const), allowFailure: true });
  const rates = await r.rates();
  const symbols = held.flatMap((m) => [tokenOf(m.params[0])?.symbol, tokenOf(m.params[1])?.symbol]).filter((s): s is string => Boolean(s));
  const prices = await r.prices(symbols);
  const positions: Position[] = [];
  held.forEach((m, i) => {
    const loan = tokenOf(m.params[0]);
    const coll = tokenOf(m.params[1]);
    if (!loan) return;
    const [supplyShares, borrowShares, collateral] = m.pos;
    const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares] = m.mkt;
    const lltv = m.params[4];
    const oraclePrice = oracles[i]?.status === "success" ? (oracles[i]!.result as bigint) : null;
    const borrowAssets = morphoSharesToAssets(borrowShares, totalBorrowAssets, totalBorrowShares, true);
    const supplyAssets = morphoSharesToAssets(supplyShares, totalSupplyAssets, totalSupplyShares, false);
    const hfWad = oraclePrice === null ? null : morphoHealthWad(collateral, oraclePrice, lltv, borrowAssets);
    const ltvWad = oraclePrice === null ? null : morphoLtvWad(collateral, oraclePrice, borrowAssets);
    const hf = hfWad === null ? null : wadString(hfWad, 4);
    const health = { factor: hf, liquidationAtPercent: wadString(lltv * 100n, 2), ltvPercent: ltvWad === null || borrowAssets === 0n ? null : wadString(ltvWad * 100n, 2), floor: String(r.healthFloor) };
    const rate = rates?.markets.find((q) => q.marketId === m.id.toLowerCase()) ?? null;
    const pair = `${coll?.symbol ?? "?"}/${loan.symbol}`;
    const label = `Morpho ${pair} ${wadString(lltv * 100n, 0)}%`;
    const base = { venue: venue.id, venueName: venue.name, venueKind: "market" as const, source: "chain" as const, readAt: r.readAt, block, explorer: addressLink(r.environment, blue) };
    const facts = [{ label: "Market id", value: `${m.id.slice(0, 10)}…${m.id.slice(-6)}` }, { label: "LLTV", value: `${wadString(lltv * 100n, 2)}%` }, { label: "Oracle", value: `${m.params[2].slice(0, 8)}…${m.params[2].slice(-4)}` }];
    const hfNum = hf === null ? null : Number(hf);
    if (collateral > 0n && coll) {
      const v = valued(collateral, coll.decimals, prices[coll.symbol]?.usd ?? null);
      positions.push(
        finish({
          ...base,
          id: `morpho-blue:${m.id}:collateral`,
          label: `${label} · ${coll.symbol} collateral`,
          assets: [asset(coll.symbol, m.params[1], v.amount, v.valueUsd, "collateral")],
          amount: v.amount,
          symbol: coll.symbol,
          valueUsd: v.valueUsd,
          counts: "net",
          state: classifyPosition({ kind: "collateral", healthFactor: borrowAssets > 0n ? hfNum : null, healthFloor: r.healthFloor }),
          ...(borrowAssets > 0n ? { health } : {}),
          collateral: true,
          facts,
          actions: [action("withdraw", "Withdraw collateral", `Withdraw ${sentenceAmount(Number(v.amount) / 4)} ${coll.symbol} from ${label}`)],
        }),
      );
    }
    if (borrowAssets > 0n) {
      const v = valued(-borrowAssets, loan.decimals, prices[loan.symbol]?.usd ?? null);
      const apy = fractionToPercent(rate?.borrowApy);
      const amount = Number(v.amount.replace(/^-/u, ""));
      positions.push(
        finish({
          ...base,
          id: `morpho-blue:${m.id}:debt`,
          label: `${label} · ${loan.symbol} borrowed`,
          assets: [asset(loan.symbol, m.params[0], v.amount, v.valueUsd, "borrowed")],
          amount: v.amount.replace(/^-/u, ""),
          symbol: loan.symbol,
          valueUsd: v.valueUsd,
          counts: "net",
          state: classifyPosition({ kind: "debt", healthFactor: hfNum, healthFloor: r.healthFloor }),
          ...(apy !== null ? { apy: { percent: apy, kind: "borrow" as const, source: "Morpho API" } } : {}),
          health,
          facts,
          actions: [action("repay", "Repay a quarter", `Repay ${sentenceAmount(amount / 4)} ${loan.symbol} on morpho-blue`), action("add-collateral", "Add collateral", `How much ${coll?.symbol ?? "collateral"} should I add on ${label} to lift my health factor above ${r.healthFloor}?`, "ask")],
        }),
      );
    }
    if (supplyAssets > 0n) {
      const v = valued(supplyAssets, loan.decimals, prices[loan.symbol]?.usd ?? null);
      const apy = fractionToPercent(rate?.supplyApy);
      positions.push(
        finish({
          ...base,
          id: `morpho-blue:${m.id}:supply`,
          label: `${label} · ${loan.symbol} lent`,
          assets: [asset(loan.symbol, m.params[0], v.amount, v.valueUsd, "supplied")],
          amount: v.amount,
          symbol: loan.symbol,
          valueUsd: v.valueUsd,
          counts: "net",
          state: classifyPosition({ kind: "supply", apyPercent: apy === null ? null : Number(apy) }),
          ...(apy !== null ? { apy: { percent: apy, kind: "supply" as const, source: "Morpho API" } } : {}),
          facts,
          actions: [],
        }),
      );
    }
  });
  return { positions, block, method, source: "chain", ...(coverage ? { coverage } : {}) };
};
