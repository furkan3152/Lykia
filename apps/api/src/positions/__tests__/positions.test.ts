/**
 * Position readers: the math (ticks, liquidity amounts, fees, shares,
 * health), the state classification, the LP builder on a recorded mainnet
 * position, the v4 position-info decoding, the event scanner's windows, the
 * Aave interest-from-history rule, the summary, and the service's handling
 * of unavailable and owner-only venues with mocked readers.
 */
import { classifyPosition, POSITION_VENUES, positionDoing, summarizePositions, type Position, type PositionVenueInfo, type VenueRead } from "@lykia/core";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContext } from "../../context.js";
import { testConfig } from "../../__tests__/support.js";
import { aaveEarnedFromHistory } from "../lending.js";
import { decodeV4PositionInfo, lpPosition, v4PoolId } from "../lp.js";
import { amountsForLiquidity, feeGrowthInside, feesOwed, inRange, morphoHealthWad, morphoLtvWad, morphoSharesToAssets, navApyPercent, priceAtTick, sharesToAssets, sqrtRatioAtTick, wadString } from "../math.js";
import { LOG_WINDOW, scanWindows } from "../scanner.js";
import { readContext, readVenue, readPositions } from "../service.js";
import { VenueUnavailable, type Reader } from "../context.js";

const Q96 = 2n ** 96n;
const Q128 = 2n ** 128n;

describe("position math", () => {
  it("matches TickMath at known ticks", () => {
    assert.equal(sqrtRatioAtTick(0), Q96);
    assert.equal(sqrtRatioAtTick(-887272), 4295128739n);
    assert.equal(sqrtRatioAtTick(887272), 1461446703485210103287273052203988822378723970342n);
    assert.ok(sqrtRatioAtTick(1) > Q96 && sqrtRatioAtTick(-1) < Q96);
    assert.throws(() => sqrtRatioAtTick(887273));
  });

  it("splits liquidity into token amounts below, inside and above the range", () => {
    const L = 1_000_000_000n;
    const below = amountsForLiquidity(sqrtRatioAtTick(-200), -100, 100, L);
    assert.ok(below.amount0 > 0n && below.amount1 === 0n);
    const above = amountsForLiquidity(sqrtRatioAtTick(200), -100, 100, L);
    assert.ok(above.amount0 === 0n && above.amount1 > 0n);
    const inside = amountsForLiquidity(sqrtRatioAtTick(0), -100, 100, L);
    assert.ok(inside.amount0 > 0n && inside.amount1 > 0n);
    // Symmetric range around price 1: both sides hold about the same.
    assert.ok(inside.amount0 - inside.amount1 <= 1n && inside.amount1 - inside.amount0 <= 1n);
    assert.deepEqual(amountsForLiquidity(Q96, -100, 100, 0n), { amount0: 0n, amount1: 0n });
  });

  it("reproduces a recorded Uniswap v3 position exactly (decreaseLiquidity on Arc mainnet gave the same amounts)", () => {
    // Uniswap v3 #47379, USDC/EURC 0.05%, at block 29,857,405: decreaseLiquidity as the owner returned (891467, 1214977).
    const amounts = amountsForLiquidity(75036886051080008647005870484n, -2810, 30, 15542978n);
    assert.deepEqual(amounts, { amount0: 891467n, amount1: 1214977n });
    assert.equal(inRange(-1088, -2810, 30), true);
    assert.equal(inRange(30, -2810, 30), false);
  });

  it("accrues fees from fee growth, with uint256 wrap-around", () => {
    assert.equal(feesOwed(1000n, 5n * Q128, 2n * Q128), 3000n);
    // The checkpoint can sit above the current value after a wrap.
    assert.equal(feesOwed(10n, 1n * Q128, 2n ** 256n - 1n * Q128), 20n);
    assert.equal(feeGrowthInside(0, -10, 10, 100n, 30n, 20n), 50n);
    // Below the range: inside = lowerOutside - upperOutside (as the contract computes).
    assert.equal(feeGrowthInside(-20, -10, 10, 100n, 30n, 20n), 10n);
  });

  it("converts shares to assets like ERC-4626 and Morpho Blue", () => {
    assert.equal(sharesToAssets(500n, 1000n, 1000n), 500n);
    assert.equal(sharesToAssets(498784850753563542248n, 1_000_000_000n, 997_569_701_507_127_084_496n, 12), 499_999_999n);
    // Borrow shares round up, supply shares round down.
    assert.equal(morphoSharesToAssets(3n * 10n ** 6n, 1500n, 10n ** 9n, true), 5n);
    assert.equal(morphoSharesToAssets(3n * 10n ** 6n, 1500n, 10n ** 9n, false), 4n);
  });

  it("computes Morpho health and LTV", () => {
    // 1 cirBTC (8 decimals) at 100,000 USDC (6 decimals): price = 1e36 * 1e6 * 1e5 / 1e8.
    const price = 10n ** 36n * 10n ** 3n;
    const collateral = 10n ** 8n;
    const borrow = 43_000n * 10n ** 6n;
    const hf = morphoHealthWad(collateral, price, 86n * 10n ** 16n, borrow)!;
    assert.equal(wadString(hf, 4), "2.0000");
    assert.equal(wadString(morphoLtvWad(collateral, price, borrow)! * 100n, 2), "43.00");
    assert.equal(morphoHealthWad(collateral, price, 86n * 10n ** 16n, 0n), null);
  });

  it("prices ticks and NAV growth", () => {
    assert.ok(Math.abs(priceAtTick(-1210, 6, 6) - 0.886) < 0.0005);
    const apy = navApyPercent(1_142_831_108_426_541_885n, 1_138_156_613_097_908_472n, 42 * 86_400)!;
    assert.ok(apy > 3.5 && apy < 4.0, `apy ${apy}`);
    assert.equal(navApyPercent(1n, 1n, 3600), null);
  });
});

describe("state classification", () => {
  it("names every state from its facts", () => {
    assert.equal(classifyPosition({ kind: "held" }), "idle");
    assert.equal(classifyPosition({ kind: "vault", apyPercent: 3.9 }), "earning");
    assert.equal(classifyPosition({ kind: "vault", apyPercent: 0 }), "idle");
    assert.equal(classifyPosition({ kind: "supply", apyPercent: null }), "idle");
    assert.equal(classifyPosition({ kind: "debt", healthFactor: 1.78, healthFloor: 1.5 }), "borrowing");
    assert.equal(classifyPosition({ kind: "debt", healthFactor: 1.2, healthFloor: 1.5 }), "at-risk");
    assert.equal(classifyPosition({ kind: "collateral", healthFactor: 1.05, healthFloor: 1 }), "at-risk");
    assert.equal(classifyPosition({ kind: "supply", apyPercent: 2.4, healthFactor: 1.2, healthFloor: 1.5 }), "at-risk");
    assert.equal(classifyPosition({ kind: "lp", inRange: false }), "out-of-range");
    assert.equal(classifyPosition({ kind: "lp", inRange: true }), "earning");
    assert.equal(classifyPosition({ kind: "in-flight" }), "pending");
    assert.equal(classifyPosition({ kind: "escrow" }), "escrowed");
    assert.equal(classifyPosition({ kind: "commitment" }), "committed");
  });
});

const READ_AT = "2026-11-06T12:00:00.000Z";

describe("LP positions", () => {
  it("builds a recorded out-of-range Uniswap v4 position", () => {
    const info = decodeV4PositionInfo(106321458972776134265892163679807566863052663700733189193695629318492094416384n);
    assert.deepEqual(info, { tickLower: -1210, tickUpper: -1090, hasSubscriber: false });
    const p = lpPosition({
      venue: "uniswap-v4",
      venueName: "Uniswap v4",
      environment: "mainnet",
      tokenId: 321603n,
      manager: "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b",
      token0: "0x3600000000000000000000000000000000000000",
      token1: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
      meta0: { symbol: "USDC", decimals: 6 },
      meta1: { symbol: "EURC", decimals: 6 },
      tier: "0.05%",
      tickLower: info.tickLower,
      tickUpper: info.tickUpper,
      liquidity: 93402205904n,
      sqrtPriceX96: sqrtRatioAtTick(-1083),
      tick: -1083,
      fees0: 0n,
      fees1: 0n,
      feeMethod: "test",
      price0: "1",
      price1: "1.1154",
      readAt: READ_AT,
      block: "29857405",
    });
    assert.equal(p.state, "out-of-range");
    assert.equal(p.range?.inRange, false);
    assert.equal(p.range?.quote, "EURC per USDC");
    // Above the band the position is all token1.
    assert.equal(p.assets[0]!.amount, "0");
    assert.ok(Number(p.assets[1]!.amount) > 0);
    assert.match(p.doing, /^Out of range: price 0\.89\d\d is above your 0\.8860–0\.8967 band/u);
    assert.ok(p.actions.some((a) => a.kind === "rebalance-range" && a.mode === "ask"));
  });

  it("values fees and inverts tiny prices", () => {
    const p = lpPosition({
      venue: "aerodrome-slipstream",
      venueName: "Aerodrome Slipstream",
      environment: "mainnet",
      tokenId: 7n,
      manager: "0x4857DB576eE0e45F10525eC59527BfD10beeC60b",
      token0: "0x3600000000000000000000000000000000000000",
      token1: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
      meta0: { symbol: "USDC", decimals: 6 },
      meta1: { symbol: "cirBTC", decimals: 8 },
      tier: "tick spacing 50",
      tickLower: -69100,
      tickUpper: -68000,
      liquidity: 10n ** 9n,
      sqrtPriceX96: sqrtRatioAtTick(-68500),
      tick: -68500,
      fees0: 12_345n,
      fees1: 1_000n,
      feeMethod: "static collect() as the owner (exact)",
      price0: "1",
      price1: "100000",
      readAt: READ_AT,
      block: null,
    });
    assert.equal(p.state, "earning");
    assert.equal(p.range?.quote, "USDC per cirBTC");
    assert.ok(Number(p.range!.price) > 1000);
    assert.equal(p.fees?.valueUsd, "1.012345");
    assert.ok(p.actions.some((a) => a.kind === "collect-fees"));
  });

  it("hashes a v4 pool key the way PoolManager does", () => {
    const id = v4PoolId({ currency0: "0x3600000000000000000000000000000000000000", currency1: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", fee: 500, tickSpacing: 10, hooks: "0x0000000000000000000000000000000000000000" });
    assert.match(id, /^0x[0-9a-f]{64}$/u);
    // The upper 200 bits of PositionInfo are the pool id's first 25 bytes.
    const info = 106321458972776134265892163679807566863052663700733189193695629318492094416384n;
    assert.equal((info >> 56n).toString(16).padStart(50, "0"), id.slice(2, 52));
  });
});

describe("event scanner", () => {
  const extract = (log: { topics: readonly `0x${string}`[] }) => log.topics[1] ?? null;
  it("walks windows backward to the first block, then forward from where it stopped", async () => {
    const seen: [bigint, bigint][] = [];
    const fetchLogs = async (from: bigint, to: bigint) => {
      seen.push([from, to]);
      return from <= 25_000n && 25_000n <= to ? [{ topics: ["0x00", "0xabc"] as `0x${string}`[], data: "0x" as const }] : [];
    };
    const first = await scanWindows({ fromBlock: 1n, extract }, 50_000n, null, fetchLogs, { budgetMs: 10_000, parallel: 3 });
    assert.equal(first.result.complete, true);
    assert.deepEqual(first.result.ids, ["0xabc"]);
    for (const [a, b] of seen) assert.ok(b - a <= LOG_WINDOW);
    assert.equal(first.result.bottom, 1n);
    seen.length = 0;
    const second = await scanWindows({ fromBlock: 1n, extract }, 70_000n, first.doc, fetchLogs, { budgetMs: 10_000, parallel: 3 });
    assert.equal(seen[0]![0], 50_001n);
    assert.equal(second.result.top, 70_000n);
    assert.deepEqual(second.result.ids, ["0xabc"]);
  });

  it("stops at its budget and at a failed window, and reports partial coverage", async () => {
    let t = 0;
    const now = () => t;
    const fetchLogs = async (from: bigint) => {
      t += 600;
      if (from < 20_000n) throw new Error("range too large");
      return [];
    };
    const r = await scanWindows({ fromBlock: 1n, extract }, 100_000n, null, fetchLogs, { budgetMs: 1_000, parallel: 2, now });
    assert.equal(r.result.complete, false);
    assert.ok(r.result.covered > 0 && r.result.covered < 1);
    const failing = await scanWindows({ fromBlock: 1n, extract }, 30_000n, null, fetchLogs, { budgetMs: 1e9, parallel: 2, now });
    assert.equal(failing.result.complete, false);
    assert.ok(failing.result.bottom >= 20_000n);
  });
});

describe("interest from the owner's history", () => {
  const step = (kind: string, outputs: { symbol: string; amount: string }[], settledAt: string) => ({ venue: "aave-v4", kind, status: "settled", summary: kind === "withdraw" ? "Withdraw 10 USDC from Aave V4 Main Spoke" : "Deposit 100 USDC into Aave V4 Main Spoke", settledAt, inputs: [], outputs });
  const history = [{ createdAt: "2026-05-01T00:00:00.000Z", steps: [step("deposit", [{ symbol: "USDC@aave-v4", amount: "100000000" }], "2026-05-01T00:00:00.000Z"), step("withdraw", [{ symbol: "USDC", amount: "10000000" }], "2026-08-01T00:00:00.000Z")] }];
  const now = Date.parse("2026-11-01T00:00:00.000Z");

  it("is supplied now minus net Lykia supplies when the APY explains it", () => {
    const r = aaveEarnedFromHistory(history, { suppliedUnits: 91_000_000n, decimals: 6, symbol: "USDC", spokeLabel: "Aave V4 Main Spoke", apyPercent: 2.4, nowMs: now });
    assert.deepEqual(r, { units: 1_000_000n, since: "2026-05-01T00:00:00.000Z" });
  });

  it("is omitted when money clearly moved outside Lykia, or there is no history", () => {
    assert.equal(aaveEarnedFromHistory(history, { suppliedUnits: 500_000_000n, decimals: 6, symbol: "USDC", spokeLabel: "Aave V4 Main Spoke", apyPercent: 2.4, nowMs: now }), null);
    assert.equal(aaveEarnedFromHistory(history, { suppliedUnits: 80_000_000n, decimals: 6, symbol: "USDC", spokeLabel: "Aave V4 Main Spoke", apyPercent: 2.4, nowMs: now }), null);
    assert.equal(aaveEarnedFromHistory([], { suppliedUnits: 91_000_000n, decimals: 6, symbol: "USDC", spokeLabel: "Aave V4 Main Spoke", apyPercent: 2.4, nowMs: now }), null);
    assert.equal(aaveEarnedFromHistory(history, { suppliedUnits: 91_000_000n, decimals: 6, symbol: "USDC", spokeLabel: "Aave V4 Forex Spoke", apyPercent: 2.4, nowMs: now }), null);
  });
});

function pos(over: Partial<Position>): Position {
  const base = { id: "x", venue: "aave-v4", venueName: "Aave V4", venueKind: "lending" as const, label: "Aave V4 Main Spoke · USDC supplied", assets: [], amount: "100", symbol: "USDC", valueUsd: "100", counts: "net" as const, state: "earning" as const, actions: [], source: "chain" as const, readAt: READ_AT, block: "1", explorer: null };
  const merged = { ...base, ...over };
  return { ...merged, doing: positionDoing(merged) };
}

describe("summary and lines", () => {
  it("totals by state, weighs APY, nets borrowing and finds the lowest health", () => {
    const venues: VenueRead[] = [
      { venue: "aave-v4", venueName: "Aave V4", venueKind: "lending", status: "ok", positions: [pos({ valueUsd: "1000", apy: { percent: "4", kind: "supply", source: "t" } }), pos({ id: "d", valueUsd: "-200", state: "borrowing", amount: "200", apy: { percent: "6", kind: "borrow", source: "t" }, health: { factor: "1.84", liquidationAtPercent: "78", ltvPercent: "20", floor: "1.5" } })], source: "chain", method: "", readAt: READ_AT, block: "1", ms: 1 },
      { venue: "wallet", venueName: "Wallet", venueKind: "wallet", status: "ok", positions: [pos({ venue: "wallet", venueKind: "wallet", valueUsd: "50", state: "idle" })], source: "chain", method: "", readAt: READ_AT, block: "1", ms: 1 },
      { venue: "lykia-orders", venueName: "LykiaOrders", venueKind: "orders", status: "ok", positions: [pos({ venue: "lykia-orders", venueKind: "orders", valueUsd: "30", state: "escrowed", counts: "overlay" })], source: "history", method: "", readAt: READ_AT, block: null, ms: 1 },
      { venue: "morpho-blue", venueName: "Morpho Blue", venueKind: "market", status: "unavailable", reason: "x", positions: [], source: "chain", method: "", readAt: READ_AT, block: null, ms: 1 },
    ];
    const s = summarizePositions(venues);
    assert.equal(s.netUsd, "850.00");
    assert.equal(s.byState.earning, "1000.00");
    assert.equal(s.byState.borrowing, "200.00");
    assert.equal(s.byState.escrowed, "30.00");
    assert.equal(s.weightedApyPercent, "4.00");
    assert.equal(s.yearlyYieldUsd, "28.00");
    assert.deepEqual(s.lowestHealth, { venue: "aave-v4", label: "Aave V4 Main Spoke · USDC supplied", factor: "1.84" });
    assert.deepEqual(s.unavailable, ["Morpho Blue"]);
  });

  it("says what each position is doing in one line", () => {
    assert.equal(pos({ apy: { percent: "4.1", kind: "supply", source: "t" }, earned: { usd: "0.37", since: READ_AT, method: "t" } }).doing, "Earning 4.10% APY · +$0.37 so far");
    assert.equal(pos({ state: "borrowing", amount: "200", apy: { percent: "6.2", kind: "borrow", source: "t" }, health: { factor: "1.84", liquidationAtPercent: null, ltvPercent: null, floor: "1.5" } }).doing, "Borrowing 200 USDC at 6.20% · health 1.84");
    assert.equal(pos({ apy: { percent: "0.0003", kind: "supply", source: "t" } }).doing, "Earning 0.0003% APY");
    assert.equal(pos({ state: "pending", venueKind: "bridge", facts: [{ label: "Stage", value: "Burned on Arc, awaiting attestation (~2 min)" }] }).doing, "Burned on Arc, awaiting attestation (~2 min)");
    assert.equal(pos({ state: "out-of-range", venueKind: "lp", range: { tickLower: 0, tickUpper: 0, tick: 0, lower: "0.86", upper: "0.90", price: "0.91", quote: "EURC per USDC", inRange: false } }).doing, "Out of range: price 0.9100 is above your 0.8600–0.9000 band (EURC per USDC)");
  });
});

describe("the position service", () => {
  const ctx = createContext(testConfig());
  const info = (id: string, personal = false): PositionVenueInfo => ({ id, name: id, kind: "wallet", personal });

  it("turns a failing reader into an unavailable venue with its reason, never zeros", async () => {
    const r = await readContext(ctx, "mainnet", "0x00000000000000000000000000000000000000aa", false);
    const broken: Reader = async () => {
      throw new VenueUnavailable("Morpho did not answer.");
    };
    const read = await readVenue(r, info("morpho-vaults"), { readers: { "morpho-vaults": broken }, cached: false });
    assert.equal(read.status, "unavailable");
    assert.equal(read.reason, "Morpho did not answer.");
    assert.deepEqual(read.positions, []);
  });

  it("keeps owner-only venues private without proof, and reads them with it", async () => {
    const ok: Reader = async (_r, v) => ({ positions: [pos({ venue: v.id, state: "committed", counts: "overlay" })], block: null, method: "t", source: "history" });
    const pub = await readContext(ctx, "mainnet", "0x00000000000000000000000000000000000000aa", false);
    const own = await readContext(ctx, "mainnet", "0x00000000000000000000000000000000000000aa", true);
    assert.equal((await readVenue(pub, info("arc-transfer", true), { readers: { "arc-transfer": ok }, cached: false })).status, "private");
    const read = await readVenue(own, info("arc-transfer", true), { readers: { "arc-transfer": ok }, cached: false });
    assert.equal(read.status, "ok");
    assert.equal(read.positions.length, 1);
  });

  it("reads every venue side by side and caches each briefly", async () => {
    let calls = 0;
    const slow: Reader = async () => {
      calls += 1;
      return { positions: [pos({ venue: "wallet", venueKind: "wallet", state: "idle" })], block: "5", method: "t", source: "chain" };
    };
    const readers = Object.fromEntries(["wallet", "aave-v4", "morpho-vaults", "morpho-blue", "uniswap-v3", "uniswap-v4", "aerodrome-slipstream", "usyc", "gateway"].map((id) => [id, slow]));
    const owner = "0x00000000000000000000000000000000000000bb" as const;
    const res = await readPositions(ctx, "mainnet", owner, { personal: false, readers });
    assert.equal(res.venues.length, POSITION_VENUES.mainnet.length);
    assert.equal(res.venues.filter((v) => v.status === "private").length, POSITION_VENUES.mainnet.filter((v) => v.personal).length);
    assert.equal(res.block, "5");
    assert.equal(calls, 9);
    await readPositions(ctx, "mainnet", owner, { personal: false, readers });
    assert.equal(calls, 9, "the second read within 20 s is served from the store");
    const only = await readPositions(ctx, "mainnet", owner, { personal: false, readers, venues: ["wallet"], cached: false });
    assert.deepEqual(only.venues.map((v) => v.venue), ["wallet"]);
  });
});

describe("readers on mocked RPC answers", () => {
  type Call = { address: string; functionName: string; args?: readonly unknown[] };
  /** A client that answers calls by function name (recorded shapes), through multicall and readContract alike. */
  function fakeChains(answer: (c: Call) => unknown) {
    const client = {
      getBlockNumber: async () => 29_857_405n,
      readContract: async (c: Call) => answer(c),
      multicall: async ({ contracts }: { contracts: Call[] }) =>
        contracts.map((c) => {
          try {
            const result = answer(c);
            return result === undefined ? { status: "failure", error: new Error("revert") } : { status: "success", result };
          } catch (error) {
            return { status: "failure", error };
          }
        }),
    };
    return { client: () => client } as never;
  }
  const noRates = { vaults: [], markets: [], reserves: [], sources: { morpho: "unavailable", aave: "unavailable" }, at: READ_AT } as const;
  const owner = "0x00000000000000000000000000000000000000cc" as const;

  it("reads an Aave V4 borrow with its health factor and marks it at risk under the floor", async () => {
    const mainSpoke = "0xb843bdc3a87a05e77e07df9fe48928b3a34b134d";
    const ctx = createContext(testConfig(), {
      chains: fakeChains((c) => {
        const main = c.address.toLowerCase() === mainSpoke;
        switch (c.functionName) {
          case "getReserveCount":
            return main ? 3n : 2n;
          case "getUserSuppliedAssets":
            return main && c.args?.[0] === 2n ? 10_000_000n : 0n; // 0.1 cirBTC
          case "getUserTotalDebt":
            return main && c.args?.[0] === 0n ? 6_500_000_000n : 0n; // 6,500 USDC
          case "getUserReserveStatus":
            return [main && c.args?.[0] === 2n, main && c.args?.[0] === 0n];
          case "getReserve":
            return { underlying: c.args?.[0] === 0n ? "0x3600000000000000000000000000000000000000" : c.args?.[0] === 1n ? "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" : "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", hub: "0x17288dfc86205301064577b98B02b81017e6F79C", assetId: 0, decimals: 6, collateralRisk: 0, flags: 0, dynamicConfigKey: 1 };
          case "getDynamicReserveConfig":
            return { collateralFactor: 7800, maxLiquidationBonus: 0, liquidationFee: 0 };
          case "getUserAccountData":
            return { riskPremium: 0n, avgCollateralFactor: 78n * 10n ** 16n, healthFactor: 12n * 10n ** 17n, totalCollateralValue: 10_000n * 10n ** 26n, totalDebtValueRay: 6_500n * 10n ** 26n * 10n ** 27n, activeCollateralCount: 1n, borrowCount: 1n };
          default:
            return undefined;
        }
      }),
    });
    const { readAave } = await import("../lending.js");
    const r = { ...(await readContext(ctx, "mainnet", owner, false)), rates: async () => noRates as never, prices: async (symbols: readonly string[]) => Object.fromEntries(symbols.map((s) => [s, { symbol: s, usd: s === "cirBTC" ? "100000" : "1", source: "test", updatedAt: null }])) };
    const out = await readAave(r, { id: "aave-v4", name: "Aave V4", kind: "lending", personal: false });
    const debt = out.positions.find((p) => p.id.endsWith(":debt"))!;
    const supply = out.positions.find((p) => p.id.endsWith(":supply"))!;
    assert.equal(debt.valueUsd, "-6500");
    assert.equal(debt.health?.factor, "1.2000");
    assert.equal(debt.health?.ltvPercent, "65.00");
    assert.equal(debt.health?.liquidationAtPercent, "78.00");
    assert.equal(debt.state, "at-risk", "1.20 is under the default 1.5 floor");
    assert.equal(supply.collateral, true);
    assert.equal(supply.symbol, "cirBTC");
    assert.ok(debt.actions.some((a) => a.kind === "repay" && a.mode === "draft" && /Repay 1625 USDC/u.test(a.sentence)));
  });

  it("values Morpho vault shares with convertToAssets and leaves the APY out when the API is down", async () => {
    const galaxy = "0x8e357432cc12ff425c36432f312968aeb16112af";
    const ctx = createContext(testConfig(), {
      chains: fakeChains((c) => {
        if (c.functionName === "balanceOf") return c.address.toLowerCase() === galaxy ? 498_784_850_753_563_542_248n : 0n;
        if (c.functionName === "convertToAssets") return 500_039_278n;
        return undefined;
      }),
    });
    const { readMorphoVaults } = await import("../vaults.js");
    const r = { ...(await readContext(ctx, "mainnet", owner, false)), rates: async () => null, prices: async (symbols: readonly string[]) => Object.fromEntries(symbols.map((s) => [s, { symbol: s, usd: "1", source: "test", updatedAt: null }])) };
    // Galaxy's vault is read under its curator's venue, never twice.
    const out = await readMorphoVaults(r, { id: "galaxy-curation", name: "Galaxy (Morpho vaults)", kind: "vault", personal: false });
    assert.equal(out.positions.length, 1);
    assert.equal((await readMorphoVaults(r, { id: "morpho-vaults", name: "Morpho Vaults", kind: "vault", personal: false })).positions.length, 0);
    assert.equal(out.positions[0]!.amount, "500.039278");
    assert.equal(out.positions[0]!.apy, undefined);
    assert.equal(out.positions[0]!.state, "idle");
  });
});

describe("Lyko and the position map", () => {
  it("reads 'where is my money?' as a positions question, never a plan", async () => {
    const { infoQuestion, positionsCard } = await import("../../agents/cards.js");
    assert.deepEqual(infoQuestion("Where is my money and what is it doing?"), { kind: "positions" });
    assert.deepEqual(infoQuestion("what are my positions doing"), { kind: "positions" });
    assert.equal(infoQuestion("move my money to Aave"), null);
    const { parseAnswerBlock } = await import("@lykia/core/api/answer");
    const venues: VenueRead[] = [{ venue: "aave-v4", venueName: "Aave V4", venueKind: "lending", status: "ok", positions: [pos({ valueUsd: "-50607.156197", state: "at-risk", health: { factor: "1.1999", liquidationAtPercent: "90", ltvPercent: "75", floor: "1.5" } })], source: "chain", method: "", readAt: READ_AT, block: "1", ms: 1 }];
    const card = positionsCard({ address: "0x00000000000000000000000000000000000000aa", environment: "mainnet", at: READ_AT, block: "1", venues, summary: summarizePositions(venues), personal: false, healthFloor: "1.5" });
    assert.ok(card && parseAnswerBlock(card), "the card validates");
    assert.equal(card?.kind === "positions" ? card.rows[0]!.valueUsd : null, "-50607.15");
  });
});
