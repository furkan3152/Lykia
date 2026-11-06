/**
 * Liquidity positions: Uniswap v3, Uniswap v4 and Aerodrome Slipstream.
 *
 * v3 and Slipstream position NFTs are enumerable: balanceOf and
 * tokenOfOwnerByIndex give the token ids, positions(tokenId) the range and
 * liquidity, the factory's getPool and the pool's slot0 the current price.
 * Token amounts come from liquidity and the current sqrt price
 * (LiquidityAmounts); uncollected fees from a static call to collect() with
 * maximum amounts, sent as the owner (exact, nothing moves). Positions staked
 * in a Slipstream gauge are held by the gauge, not the owner, and are not
 * listed here.
 *
 * v4 position NFTs are not enumerable, so token ids come from Transfer
 * events to the owner (the event scanner, continued across reads), checked
 * with ownerOf. Each id is read with getPoolAndPositionInfo and
 * getPositionLiquidity; the price from StateView.getSlot0; fees from
 * StateView.getFeeGrowthInside against the position's last checkpoint
 * (getPositionInfo with the token id as salt): liquidity * delta / 2^128.
 */
import { classifyPosition, getProtocol, tokenByAddress, type Address, type ArcEnvironment, type Position, type PositionAsset } from "@lykia/core";
import { encodeAbiParameters, keccak256, maxUint128, type Hex } from "viem";
import { ERC20_META_ABI, ERC721_ENUM_ABI, ERC721_TRANSFER_TOPIC, SLIPSTREAM_FACTORY_ABI, SLIPSTREAM_NFPM_ABI, SLIPSTREAM_POOL_SLOT0_ABI, V3_FACTORY_ABI, V3_NFPM_ABI, V3_POOL_SLOT0_ABI, V4_POSM_ABI, V4_STATE_VIEW_POSITIONS_ABI } from "./abis.js";
import { action, addressLink, asset, finish, sumUsd, valued, VenueUnavailable, type ReadContext, type Reader } from "./context.js";
import { amountsForLiquidity, feesOwed, inRange, priceAtTick, priceFromSqrt } from "./math.js";
import { addressTopic, coverageLine, scanForOwner } from "./scanner.js";

/** At most this many positions per venue are read (newest first for v4). */
const MAX_POSITIONS = 24;
const ZERO: Address = "0x0000000000000000000000000000000000000000";
/** First v4 PositionManager Transfer on Arc mainnet (token #1, block 1,955,896, read from the explorer on 2026-11-06). */
const V4_POSM_FIRST_BLOCK = 1_955_896n;

interface TokenMeta {
  readonly symbol: string;
  readonly decimals: number;
}

/** Registry tokens first; any other token's own symbol() and decimals(); address(0) in v4 is native USDC (18 decimals). */
async function tokenMetas(r: ReadContext, addresses: readonly Address[]): Promise<Map<string, TokenMeta | null>> {
  const out = new Map<string, TokenMeta | null>();
  const unknown: Address[] = [];
  for (const a of new Set(addresses.map((x) => x.toLowerCase() as Address))) {
    if (a === ZERO) out.set(a, { symbol: "USDC", decimals: 18 });
    else {
      const t = tokenByAddress(r.environment, a);
      if (t) out.set(a, { symbol: t.symbol, decimals: t.decimals });
      else unknown.push(a);
    }
  }
  if (unknown.length > 0) {
    const reads = await r.ctx.chains.client(r.environment).multicall({ contracts: unknown.flatMap((a) => [{ address: a, abi: ERC20_META_ABI, functionName: "symbol" } as const, { address: a, abi: ERC20_META_ABI, functionName: "decimals" } as const]), allowFailure: true });
    unknown.forEach((a, i) => {
      const s = reads[2 * i];
      const d = reads[2 * i + 1];
      out.set(a, s?.status === "success" && d?.status === "success" ? { symbol: String(s.result).replace(/[^A-Za-z0-9.]/gu, "").slice(0, 12) || "TOKEN", decimals: Number(d.result) } : null);
    });
  }
  return out;
}

export interface LpFacts {
  readonly venue: string;
  readonly venueName: string;
  readonly environment: ArcEnvironment;
  readonly tokenId: bigint;
  readonly manager: Address;
  readonly token0: Address;
  readonly token1: Address;
  readonly meta0: TokenMeta;
  readonly meta1: TokenMeta;
  /** "0.05%" (v3/v4 fee) or "tick spacing 1" (Slipstream). */
  readonly tier: string;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: bigint;
  readonly sqrtPriceX96: bigint;
  readonly tick: number;
  readonly fees0: bigint | null;
  readonly fees1: bigint | null;
  readonly feeMethod: string;
  readonly price0: string | null;
  readonly price1: string | null;
  readonly readAt: string;
  readonly block: string | null;
  readonly extraFacts?: readonly { readonly label: string; readonly value: string }[];
}

/** One LP position from its on-chain facts: amounts, range, fees, value and state. Pure. */
export function lpPosition(f: LpFacts): Position {
  const { amount0, amount1 } = amountsForLiquidity(f.sqrtPriceX96, f.tickLower, f.tickUpper, f.liquidity);
  const a0 = valued(amount0, f.meta0.decimals, f.price0);
  const a1 = valued(amount1, f.meta1.decimals, f.price1);
  const live = inRange(f.tick, f.tickLower, f.tickUpper);
  // Prices of token1 in token0; inverted when tiny so they read as a price ("USDC per cirBTC").
  const p = priceFromSqrt(f.sqrtPriceX96, f.meta0.decimals, f.meta1.decimals);
  const lo = priceAtTick(f.tickLower, f.meta0.decimals, f.meta1.decimals);
  const hi = priceAtTick(f.tickUpper, f.meta0.decimals, f.meta1.decimals);
  const invert = p > 0 && p < 0.01;
  const range = invert
    ? { lower: 1 / hi, upper: 1 / lo, price: 1 / p, quote: `${f.meta0.symbol} per ${f.meta1.symbol}` }
    : { lower: lo, upper: hi, price: p, quote: `${f.meta1.symbol} per ${f.meta0.symbol}` };
  const sig = (n: number) => (Number.isFinite(n) ? (Math.abs(n) >= 1 ? n.toPrecision(6) : n.toPrecision(5)) : "0");
  const feeAssets: PositionAsset[] = [];
  if (f.fees0 !== null && f.fees0 > 0n) {
    const v = valued(f.fees0, f.meta0.decimals, f.price0);
    feeAssets.push(asset(f.meta0.symbol, f.token0, v.amount, v.valueUsd, "fees"));
  }
  if (f.fees1 !== null && f.fees1 > 0n) {
    const v = valued(f.fees1, f.meta1.decimals, f.price1);
    feeAssets.push(asset(f.meta1.symbol, f.token1, v.amount, v.valueUsd, "fees"));
  }
  const feesUsd = f.fees0 === null && f.fees1 === null ? null : sumUsd(feeAssets.map((a) => a.valueUsd));
  const principal = sumUsd([a0.valueUsd, a1.valueUsd]);
  const valueUsd = principal === null ? null : sumUsd([principal, feesUsd ?? "0"]);
  const pair = `${f.meta0.symbol}/${f.meta1.symbol}`;
  const name = `${f.venueName} #${f.tokenId} ${pair} ${f.tier}`;
  const assets = [asset(f.meta0.symbol, f.token0 === ZERO ? null : f.token0, a0.amount, a0.valueUsd, "liquidity"), asset(f.meta1.symbol, f.token1 === ZERO ? null : f.token1, a1.amount, a1.valueUsd, "liquidity")];
  const headline = Number(a0.valueUsd ?? 0) >= Number(a1.valueUsd ?? 0) ? { amount: a0.amount, symbol: f.meta0.symbol } : { amount: a1.amount, symbol: f.meta1.symbol };
  const actions = [
    ...(feeAssets.length > 0 ? [action("collect-fees", "Collect fees", `Collect the fees on my ${f.venueName} position #${f.tokenId} (${pair})`, "ask")] : []),
    ...(!live ? [action("rebalance-range", "Rebalance range", `My ${f.venueName} position #${f.tokenId} (${pair}) is out of range at ${sig(range.price)} ${range.quote}. What range should I move it to?`, "ask")] : []),
    action("withdraw", "Remove liquidity", `Remove the liquidity from my ${f.venueName} position #${f.tokenId} (${pair})`, "ask"),
  ];
  return finish({
    id: `${f.venue}:${f.manager.toLowerCase()}:${f.tokenId}`,
    venue: f.venue,
    venueName: f.venueName,
    venueKind: "lp",
    label: name,
    assets,
    amount: headline.amount,
    symbol: headline.symbol,
    valueUsd,
    counts: "net",
    state: classifyPosition({ kind: "lp", inRange: live }),
    range: { tickLower: f.tickLower, tickUpper: f.tickUpper, tick: f.tick, lower: sig(range.lower), upper: sig(range.upper), price: sig(range.price), quote: range.quote, inRange: live },
    ...(feeAssets.length > 0 || feesUsd !== null ? { fees: { assets: feeAssets, valueUsd: feesUsd, method: f.feeMethod } } : {}),
    facts: [{ label: "Token id", value: `#${f.tokenId}` }, { label: "Fee tier", value: f.tier }, { label: "Ticks", value: `${f.tickLower} → ${f.tickUpper} (now ${f.tick})` }, { label: "Liquidity", value: f.liquidity.toString() }, ...(f.extraFacts ?? [])],
    actions,
    source: "chain",
    readAt: f.readAt,
    block: f.block,
    explorer: addressLink(f.environment, f.manager),
  });
}

/* ------------------------------------------------------- v3 and Slipstream */

interface NfpmFlavour {
  readonly protocol: "uniswap-v3" | "aerodrome-slipstream";
  readonly factoryKey: string;
  readonly nfpmAbi: typeof V3_NFPM_ABI | typeof SLIPSTREAM_NFPM_ABI;
  readonly slipstream: boolean;
}

async function readEnumerable(r: ReadContext, venue: { id: string; name: string }, flavour: NfpmFlavour) {
  const contracts = getProtocol(flavour.protocol)?.deployments[r.environment]?.contracts;
  const nfpm = contracts?.positionManager as Address | undefined;
  const factory = contracts?.[flavour.factoryKey] as Address | undefined;
  if (!nfpm || !factory) throw new VenueUnavailable(`${venue.name} has no position manager on this network.`);
  const client = r.ctx.chains.client(r.environment);
  const [count, head] = await Promise.all([client.readContract({ address: nfpm, abi: ERC721_ENUM_ABI, functionName: "balanceOf", args: [r.owner] }), client.getBlockNumber()]);
  const block = head.toString();
  const method = `${flavour.slipstream ? "Slipstream" : "Uniswap v3"} NonfungiblePositionManager balanceOf and tokenOfOwnerByIndex; amounts from liquidity and slot0; fees by a static collect() as the owner.`;
  const n = Number(count > BigInt(MAX_POSITIONS) ? BigInt(MAX_POSITIONS) : count);
  if (n === 0) return { positions: [], block, method, source: "chain" as const };
  const ids = await client.multicall({ contracts: Array.from({ length: n }, (_, i) => ({ address: nfpm, abi: ERC721_ENUM_ABI, functionName: "tokenOfOwnerByIndex", args: [r.owner, BigInt(i)] }) as const), allowFailure: true });
  const tokenIds = ids.filter((x) => x.status === "success").map((x) => x.result as bigint);
  const infos = await client.multicall({ contracts: tokenIds.map((id) => ({ address: nfpm, abi: flavour.nfpmAbi, functionName: "positions", args: [id] }) as const), allowFailure: true });
  const rows = tokenIds
    .map((id, i) => ({ id, p: infos[i]?.status === "success" ? (infos[i]!.result as readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint]) : null }))
    .filter((x): x is { id: bigint; p: readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint] } => x.p !== null && (x.p[7] > 0n || x.p[10] > 0n || x.p[11] > 0n));
  if (rows.length === 0) return { positions: [], block, method, source: "chain" as const, ...(Number(count) > 0 ? { coverage: `${count} position NFT(s) held, all closed (no liquidity, no fees).` } : {}) };
  const poolKeys = [...new Map(rows.map((x) => [`${x.p[2]}:${x.p[3]}:${x.p[4]}`, { t0: x.p[2], t1: x.p[3], tier: x.p[4] }])).values()];
  const pools = await client.multicall({ contracts: poolKeys.map((k) => (flavour.slipstream ? ({ address: factory, abi: SLIPSTREAM_FACTORY_ABI, functionName: "getPool", args: [k.t0, k.t1, k.tier] } as const) : ({ address: factory, abi: V3_FACTORY_ABI, functionName: "getPool", args: [k.t0, k.t1, k.tier] } as const))), allowFailure: true });
  const poolAddr = poolKeys.map((_, i) => (pools[i]?.status === "success" ? (pools[i]!.result as Address) : null));
  const slots = await client.multicall({ contracts: poolAddr.map((a) => ({ address: a ?? ZERO, abi: flavour.slipstream ? SLIPSTREAM_POOL_SLOT0_ABI : V3_POOL_SLOT0_ABI, functionName: "slot0" }) as const), allowFailure: true });
  const metas = await tokenMetas(r, rows.flatMap((x) => [x.p[2], x.p[3]]));
  const prices = await r.prices([...new Set([...metas.values()].filter((m): m is TokenMeta => m !== null).map((m) => m.symbol))]);
  // Fees: a static collect() as the owner (exact), one call per position.
  const fees = await Promise.all(
    rows.map(async (x) => {
      try {
        const { result } = await client.simulateContract({ address: nfpm, abi: flavour.nfpmAbi, functionName: "collect", args: [{ tokenId: x.id, recipient: r.owner, amount0Max: maxUint128, amount1Max: maxUint128 }], account: r.owner });
        return { f0: result[0] as bigint, f1: result[1] as bigint, method: "static collect() as the owner (exact)" };
      } catch {
        return { f0: x.p[10], f1: x.p[11], method: "tokensOwed at the last checkpoint (a lower bound: the static collect did not answer)" };
      }
    }),
  );
  const positions: Position[] = [];
  rows.forEach((x, i) => {
    const k = poolKeys.findIndex((q) => q.t0 === x.p[2] && q.t1 === x.p[3] && q.tier === x.p[4]);
    const slot = slots[k]?.status === "success" ? (slots[k]!.result as unknown as readonly [bigint, number]) : null;
    const m0 = metas.get(x.p[2].toLowerCase());
    const m1 = metas.get(x.p[3].toLowerCase());
    if (!slot || !m0 || !m1) return;
    positions.push(
      lpPosition({
        venue: venue.id,
        venueName: venue.name,
        environment: r.environment,
        tokenId: x.id,
        manager: nfpm,
        token0: x.p[2],
        token1: x.p[3],
        meta0: m0,
        meta1: m1,
        tier: flavour.slipstream ? `tick spacing ${x.p[4]}` : `${(x.p[4] / 10_000).toString()}%`,
        tickLower: x.p[5],
        tickUpper: x.p[6],
        liquidity: x.p[7],
        sqrtPriceX96: slot[0],
        tick: slot[1],
        fees0: fees[i]!.f0,
        fees1: fees[i]!.f1,
        feeMethod: fees[i]!.method,
        price0: prices[m0.symbol]?.usd ?? null,
        price1: prices[m1.symbol]?.usd ?? null,
        readAt: r.readAt,
        block,
        extraFacts: poolAddr[k] ? [{ label: "Pool", value: `${poolAddr[k]!.slice(0, 8)}…${poolAddr[k]!.slice(-4)}` }] : [],
      }),
    );
  });
  const skipped = rows.length - positions.length;
  const coverage = [Number(count) > MAX_POSITIONS ? `Showing ${MAX_POSITIONS} of ${count} position NFTs.` : "", skipped > 0 ? `${skipped} position(s) could not be priced from their pool.` : ""].filter(Boolean).join(" ");
  return { positions, block, method, source: "chain" as const, ...(coverage ? { coverage } : {}) };
}

export const readUniswapV3: Reader = (r, venue) => readEnumerable(r, venue, { protocol: "uniswap-v3", factoryKey: "factory", nfpmAbi: V3_NFPM_ABI, slipstream: false });
export const readSlipstream: Reader = (r, venue) => readEnumerable(r, venue, { protocol: "aerodrome-slipstream", factoryKey: "clFactory", nfpmAbi: SLIPSTREAM_NFPM_ABI, slipstream: true });

/* ----------------------------------------------------------------- v4 */

/** int24 from 24 bits. */
function int24(bits: bigint): number {
  const v = Number(bits & 0xffffffn);
  return v >= 0x800000 ? v - 0x1000000 : v;
}

/** v4 PositionInfo: | poolId 200 | tickUpper 24 | tickLower 24 | hasSubscriber 8 |. */
export function decodeV4PositionInfo(info: bigint): { tickLower: number; tickUpper: number; hasSubscriber: boolean } {
  return { tickLower: int24(info >> 8n), tickUpper: int24(info >> 32n), hasSubscriber: (info & 0xffn) !== 0n };
}

export function v4PoolId(key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}

export const readUniswapV4: Reader = async (r, venue) => {
  const c = getProtocol("uniswap-v4")?.deployments[r.environment]?.contracts;
  const posm = c?.positionManager as Address | undefined;
  const stateView = c?.stateView as Address | undefined;
  if (!posm || !stateView) throw new VenueUnavailable("Uniswap v4 is not on this network.");
  const client = r.ctx.chains.client(r.environment);
  const scan = await scanForOwner(r.ctx, r.environment, r.owner, { key: "v4-posm", address: posm, topics: [ERC721_TRANSFER_TOPIC, null, addressTopic(r.owner)], fromBlock: V4_POSM_FIRST_BLOCK, extract: (log) => (log.topics[3] ? BigInt(log.topics[3]).toString() : null) });
  const block = (await client.getBlockNumber()).toString();
  const method = "Token ids from Transfer events to the owner (scanned in 9,999-block windows, continued across reads), checked with ownerOf; ranges from getPoolAndPositionInfo; fees from StateView fee growth.";
  const coverage = coverageLine(scan);
  const candidates = [...scan.ids].map((id) => BigInt(id)).sort((a, b) => (b > a ? 1 : -1)).slice(0, 200);
  if (candidates.length === 0) return { positions: [], block, method, source: "chain", ...(coverage ? { coverage } : {}) };
  const owners = await client.multicall({ contracts: candidates.map((id) => ({ address: posm, abi: V4_POSM_ABI, functionName: "ownerOf", args: [id] }) as const), allowFailure: true });
  const mine = candidates.filter((_, i) => owners[i]?.status === "success" && (owners[i]!.result as Address).toLowerCase() === r.owner.toLowerCase());
  if (mine.length === 0) return { positions: [], block, method, source: "chain", ...(coverage ? { coverage } : {}) };
  const reads = await client.multicall({ contracts: mine.flatMap((id) => [{ address: posm, abi: V4_POSM_ABI, functionName: "getPoolAndPositionInfo", args: [id] } as const, { address: posm, abi: V4_POSM_ABI, functionName: "getPositionLiquidity", args: [id] } as const]), allowFailure: true });
  const rows = mine
    .map((id, i) => {
      const pi = reads[2 * i]?.status === "success" ? (reads[2 * i]!.result as readonly [{ currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }, bigint]) : null;
      const liq = reads[2 * i + 1]?.status === "success" ? (reads[2 * i + 1]!.result as bigint) : null;
      return pi && liq !== null ? { id, key: pi[0], info: decodeV4PositionInfo(pi[1]), liquidity: liq } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.liquidity > 0n)
    .slice(0, MAX_POSITIONS);
  if (rows.length === 0) return { positions: [], block, method, source: "chain", ...(coverage ? { coverage } : {}), ...(mine.length > 0 && !coverage ? { coverage: `${mine.length} position NFT(s) held, all without liquidity.` } : {}) };
  const ids = rows.map((x) => v4PoolId(x.key));
  const state = await client.multicall({
    contracts: rows.flatMap((x, i) => [
      { address: stateView, abi: V4_STATE_VIEW_POSITIONS_ABI, functionName: "getSlot0", args: [ids[i]!] } as const,
      { address: stateView, abi: V4_STATE_VIEW_POSITIONS_ABI, functionName: "getPositionInfo", args: [ids[i]!, posm, x.info.tickLower, x.info.tickUpper, `0x${x.id.toString(16).padStart(64, "0")}` as Hex] } as const,
      { address: stateView, abi: V4_STATE_VIEW_POSITIONS_ABI, functionName: "getFeeGrowthInside", args: [ids[i]!, x.info.tickLower, x.info.tickUpper] } as const,
    ]),
    allowFailure: true,
  });
  const metas = await tokenMetas(r, rows.flatMap((x) => [x.key.currency0, x.key.currency1]));
  const prices = await r.prices([...new Set([...metas.values()].filter((m): m is TokenMeta => m !== null).map((m) => m.symbol))]);
  const positions: Position[] = [];
  rows.forEach((x, i) => {
    const slot = state[3 * i]?.status === "success" ? (state[3 * i]!.result as readonly [bigint, number, number, number]) : null;
    const last = state[3 * i + 1]?.status === "success" ? (state[3 * i + 1]!.result as readonly [bigint, bigint, bigint]) : null;
    const inside = state[3 * i + 2]?.status === "success" ? (state[3 * i + 2]!.result as readonly [bigint, bigint]) : null;
    const m0 = metas.get(x.key.currency0.toLowerCase());
    const m1 = metas.get(x.key.currency1.toLowerCase());
    if (!slot || !m0 || !m1) return;
    const fees = last && inside ? { f0: feesOwed(x.liquidity, inside[0], last[1]), f1: feesOwed(x.liquidity, inside[1], last[2]) } : null;
    positions.push(
      lpPosition({
        venue: venue.id,
        venueName: venue.name,
        environment: r.environment,
        tokenId: x.id,
        manager: posm,
        token0: x.key.currency0,
        token1: x.key.currency1,
        meta0: m0,
        meta1: m1,
        tier: `${(x.key.fee / 10_000).toString()}%`,
        tickLower: x.info.tickLower,
        tickUpper: x.info.tickUpper,
        liquidity: x.liquidity,
        sqrtPriceX96: slot[0],
        tick: slot[1],
        fees0: fees?.f0 ?? null,
        fees1: fees?.f1 ?? null,
        feeMethod: fees ? "StateView fee growth inside the range since the position's last checkpoint" : "fee growth unreadable",
        price0: prices[m0.symbol]?.usd ?? null,
        price1: prices[m1.symbol]?.usd ?? null,
        readAt: r.readAt,
        block,
        extraFacts: [...(x.key.hooks !== ZERO ? [{ label: "Hooks", value: `${x.key.hooks.slice(0, 8)}…${x.key.hooks.slice(-4)}` }] : []), { label: "Pool id", value: `${ids[i]!.slice(0, 10)}…${ids[i]!.slice(-6)}` }],
      }),
    );
  });
  return { positions, block, method, source: "chain", ...(coverage ? { coverage } : {}) };
};
