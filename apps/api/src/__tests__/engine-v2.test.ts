import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FENCE, contractAddress, type IntentGraph } from "@lykia/core";
import { decodeFunctionData } from "viem";
import { AAVE_SPOKE_ABI, MEMO_ABI, MORPHO_BLUE_ABI, MULTICALL3_FROM_ABI, UNIVERSAL_ROUTER_ABI } from "../engine/abis.js";
import { buildCalls } from "../engine/adapters.js";
import { shape } from "../engine/calls.js";
import { compileGoals } from "../engine/api.js";
import { Planner } from "../engine/planner.js";
import { StandingService } from "../engine/standing.js";
import { encodeV3Path, uniswapCalls, v4Key } from "../engine/venues/uniswap.js";
import { findPracticeAddresses } from "../engine/venues/practice.js";
import { projectAaveHealth, aaveCollateralNeededMicros, wadToRatio } from "../engine/venues/aave.js";
import { MORPHO_MARKETS, projectMorphoHealth, morphoCollateralNeeded } from "../engine/venues/morphoBlue.js";
import { PriceService } from "../arc/prices.js";
import { EventBus } from "../bus.js";
import { systemClock } from "../clock.js";
import { silentLogger } from "../log.js";
import { MemoryStore } from "../store/memory.js";
import type { IntentService } from "../engine/service.js";
import { FakeArc, offlineFetch } from "./support.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as const;
const ADDR = "0x1111111111111111111111111111111111111111";
const USDC = "0x3600000000000000000000000000000000000000";
const GALAXY = "0x8E357432CC12ff425c36432F312968aEb16112AF";
const base = { id: "out_test123", owner: OWNER, signer: "wallet" as const, source: "test", now: Date.UTC(2026, 10, 2, 10), spent: { dayUsd: "0", weekUsd: "0" } };

function planner(arc: FakeArc) {
  const chains = arc.asChains();
  return new Planner({ chains, prices: new PriceService({ chains, clock: systemClock }), fetch: offlineFetch(), stablefxConfigured: false });
}

describe("complex intents", () => {
  const cases: [string, unknown, unknown?][] = [
    [
      "put 40% of my USDC in the best vault, convert 20% to EURC and bridge the rest to Base",
      [{ verb: "earn", token: "USDC", amount: { percent: 40 } }, { verb: "fx", from: "USDC", to: "EURC", amount: { percent: 20 } }, { verb: "bridge", token: "USDC", amount: { all: true }, destination: "base" }],
    ],
    ["keep 30 days of payroll, 5000 USDC, liquid and earn the rest in the best vault", [{ verb: "reserve", token: "USDC", amount: { exact: "5000" }, reason: "payroll" }, { verb: "earn", token: "USDC", amount: { all: true } }]],
    ["borrow 1000 USDC against my cirBTC but keep health above 1.8", [{ verb: "borrow", token: "USDC", amount: { exact: "1000" }, collateral: { token: "cirBTC" }, minHealth: "1.8" }]],
    ["take a loan of 1000 USDC using cirBTC as collateral, health factor at least 1.8", [{ verb: "borrow", token: "USDC", amount: { exact: "1000" }, collateral: { token: "cirBTC" }, minHealth: "1.8" }]],
    ["rebalance to 60% USDC and 40% EURC", [{ verb: "rebalance", targets: [{ token: "USDC", weightBps: 6000 }, { token: "EURC", weightBps: 4000 }] }]],
    ["reallocate 60/40 between USDC and EURC", [{ verb: "rebalance", targets: [{ token: "USDC", weightBps: 6000 }, { token: "EURC", weightBps: 4000 }] }]],
    ["deposit 40% in the safest vault, convert 20% to EURC and bridge the rest to Base", [{ verb: "earn", token: "USDC", amount: { percent: 40 }, maxRisk: "low" }, { verb: "fx", from: "USDC", to: "EURC", amount: { percent: 20 } }, { verb: "bridge", token: "USDC", amount: { all: true }, destination: "base" }]],
    ["keep 2000 USDC liquid for payroll and put the rest in Aave", [{ verb: "reserve", token: "USDC", amount: { exact: "2000" }, reason: "payroll" }, { verb: "earn", token: "USDC", amount: { all: true }, venue: "aave-v4" }]],
    ["swap 0.01 cirbtc to eurc", [{ verb: "swap", from: "cirBTC", to: "EURC", amount: { exact: "0.01" } }]],
  ];
  for (const [text, actions] of cases) {
    it(text, () => {
      const r = compileGoals(text);
      assert.deepEqual(r.clarify, []);
      assert.deepEqual(r.actions, actions);
    });
  }

  it("turns conditions and schedules into standing orders", () => {
    const price = compileGoals("if EURC/USD goes above 1.12 convert 1000 EURC to USDC");
    assert.deepEqual(price.actions, []);
    assert.deepEqual(price.standing[0]?.trigger, { kind: "price", feed: "EURC/USD", op: "above", value: "1.12" });
    assert.deepEqual(price.standing[0]?.actions, [{ verb: "fx", from: "EURC", to: "USDC", amount: { exact: "1000" } }]);
    assert.deepEqual(compileGoals("when EURC drops below 1.05 convert 1000 USDC to EURC").standing[0]?.trigger, { kind: "price", feed: "EURC/USD", op: "below", value: "1.05" });
    const weekly = compileGoals(`every friday pay ${ADDR} 200 USDC for rent`).standing[0];
    assert.deepEqual(weekly?.trigger, { kind: "schedule", every: "week", weekday: "fri", at: "09:00", timezone: "UTC" });
    assert.deepEqual(weekly?.actions, [{ verb: "send", token: "USDC", amount: { exact: "200" }, to: ADDR, memo: "rent" }]);
    const daily = compileGoals(`daily at 8pm send ${ADDR} 5 USDC`).standing[0];
    assert.deepEqual(daily?.trigger, { kind: "schedule", every: "day", at: "20:00", timezone: "UTC" });
    assert.equal((daily?.actions[0] as { to: string }).to, ADDR);
    assert.deepEqual(compileGoals("if my health factor drops below 1.5 repay 500 USDC").standing[0]?.trigger, { kind: "health", below: "1.5" });
    assert.deepEqual(compileGoals(`monthly on the 1st at 10:00 send 500 EURC to ${ADDR} for salary`).standing[0]?.trigger, { kind: "schedule", every: "month", day: 1, at: "10:00", timezone: "UTC" });
  });

  it("asks with choices when it cannot tell", () => {
    const r = compileGoals("convert 100");
    assert.equal(r.actions.length, 0);
    assert.deepEqual(r.clarifyChoices[0]?.choices, ["USDC to EURC", "EURC to USDC", "USDC to cirBTC"]);
    assert.ok(compileGoals("rebalance to 60% USDC 30% EURC").clarify[0]?.includes("100%"));
  });
});

describe("planner v2: shares, reserves, rebalancing, routing", () => {
  it("takes shares of the starting balance after reserves, and bridges the rest", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 1000_000_000n);
    arc.vaultAssets.set(GALAXY.toLowerCase(), 80_000_000_000_000n);
    const { graph } = await planner(arc).plan({
      ...base,
      environment: "mainnet",
      actions: [
        { verb: "reserve", token: "USDC", amount: { exact: "200" }, reason: "payroll" },
        { verb: "earn", token: "USDC", amount: { percent: 40 } },
        { verb: "fx", from: "USDC", to: "EURC", amount: { percent: 20 } },
        { verb: "bridge", token: "USDC", amount: { all: true }, destination: "base" },
      ],
    });
    assert.deepEqual(graph.steps.map((s) => s.inputs[0]?.amount), ["320000000", "160000000", "320000000"]);
    assert.equal(graph.steps[0]?.venue, "galaxy-curation");
    assert.ok(graph.steps[0]?.route?.reason.includes("Morpho"));
    assert.ok((graph.steps[0]?.route?.alternatives.length ?? 0) > 0);
    assert.ok(graph.warnings.some((w) => w.startsWith("Keeping 200 USDC liquid (payroll)")));
  });

  it("rebalances by value with one fx step", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 1000_000_000n);
    const { graph } = await planner(arc).plan({ ...base, environment: "mainnet", actions: [{ verb: "rebalance", targets: [{ token: "USDC", weightBps: 6000 }, { token: "EURC", weightBps: 4000 }] }] });
    assert.equal(graph.steps.length, 1);
    assert.equal(graph.steps[0]?.kind, "fx");
    assert.equal(graph.steps[0]?.inputs[0]?.amount, "400000000");
  });

  it("keeps default slippage inside the Fence ceiling", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 1000_000_000n);
    const { facts } = await planner(arc).plan({ ...base, environment: "mainnet", fence: { ...DEFAULT_FENCE, limits: { maxSteps: 8, maxSlippageBps: 20 } }, actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "10" } }] });
    assert.equal(facts.steps[0]?.slippageBps, 20);
  });
});

describe("venue math and calldata", () => {
  it("projects Aave V4 health like the Spoke does", () => {
    // 0.01 cirBTC at $77,896.6 with a 78% factor against $100 of debt: the Spoke answered 6.0772 in simulation.
    const hf = projectAaveHealth(null, 778_966_000n, 7800, 100_000_000n);
    assert.equal(wadToRatio(hf), "6.0759");
    const need = aaveCollateralNeededMicros(null, 7800, 1000_000_000n, 18n * 10n ** 17n);
    assert.ok(need > 2_300_000_000n && need < 2_310_000_000n);
  });

  it("projects Morpho health from the oracle price and LLTV", () => {
    const market = MORPHO_MARKETS.mainnet![0]!;
    const position = { collateral: 0n, borrowAssets: 0n, price: 778_966_906_887_000_000_000_000_000_000_000_000_000n };
    assert.equal(wadToRatio(projectMorphoHealth(market, position, 1_000_000n, 100_000_000n)), "6.6991");
    const need = morphoCollateralNeeded(market, position, 1000_000_000n, 18n * 10n ** 17n);
    assert.ok(need > 2_680_000n && need < 2_700_000n);
  });

  it("builds Aave borrow and Morpho borrow as one batch of calls", async () => {
    const arc = new FakeArc();
    const ctx = { environment: "mainnet" as const, chains: arc.asChains(), account: OWNER };
    const aave = await buildCalls({ adapter: "aave-borrow", params: { spoke: "0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d", spokeName: "Aave V4 Main Spoke", loanReserve: "0", collReserve: "2", loanToken: USDC, collToken: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", loanSymbol: "USDC", collSymbol: "cirBTC", decimals: "8", amount: "1000000000", collateral: "2600000", display: "1000 USDC" } }, ctx);
    assert.equal(aave.approvals.length, 1);
    assert.deepEqual(aave.calls.map((c) => decodeFunctionData({ abi: AAVE_SPOKE_ABI, data: c.data }).functionName), ["supply", "setUsingAsCollateral", "borrow"]);
    const morpho = await buildCalls({ adapter: "morpho-borrow", params: { market: MORPHO_MARKETS.mainnet![0]!.id, loanToken: USDC, collToken: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", loanSymbol: "USDC", collSymbol: "cirBTC", decimals: "8", amount: "1000000000", collateral: "2600000", display: "1000 USDC" } }, ctx);
    assert.deepEqual(morpho.calls.map((c) => decodeFunctionData({ abi: MORPHO_BLUE_ABI, data: c.data }).functionName), ["supplyCollateral", "borrow"]);
    const txs = shape(aave.calls, aave.approvals, { environment: "mainnet", chainId: 5042, from: OWNER, memo: { intentId: "out_abc123", stepId: "s1", verdict: "0123456789abcdef" }, account: "eoa" });
    assert.equal(txs.length, 1);
    const batch = decodeFunctionData({ abi: MULTICALL3_FROM_ABI, data: txs[0]!.data });
    const calls = batch.args[0] as readonly { target: string; callData: `0x${string}` }[];
    assert.equal(calls.length, 4);
    assert.equal(calls[3]?.target.toLowerCase(), contractAddress("memo", "mainnet")?.toLowerCase());
    assert.equal(decodeFunctionData({ abi: MEMO_ABI, data: calls[3]!.callData }).functionName, "memo");
  });

  it("encodes Uniswap v3 paths and v4 UniversalRouter swaps", () => {
    const path = encodeV3Path([{ tokenIn: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", tokenOut: USDC, fee: 100 }, { tokenIn: USDC, tokenOut: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", fee: 500 }]);
    assert.equal((path.length - 2) / 2, 66);
    const { key, zeroForOne } = v4Key("0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", USDC, 500, 10);
    assert.equal(key.currency0, USDC);
    assert.equal(zeroForOne(USDC), true);
    const call = uniswapCalls.v4Single("0x8702463e73f74d0b6765aBceb314Ef07aCb92650", key, true, 1_000_000n, 890_000n, 1n, "swap");
    const decoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data: call.data });
    assert.equal(decoded.args[0], "0x10");
  });

  it("finds practice venues in the contracts manifest shape", () => {
    const found = findPracticeAddresses({ LYKIA_DEPLOYMENTS: { mainnet: {}, testnet: { PracticeVaultUSDC: ADDR, PracticeSwap: "0x2222222222222222222222222222222222222222", PracticeLending: { address: "0x3333333333333333333333333333333333333333" } } } });
    assert.equal(found?.vaultUsdc, ADDR);
    assert.equal(found?.swap, "0x2222222222222222222222222222222222222222");
    assert.equal(found?.lending, "0x3333333333333333333333333333333333333333");
    assert.equal(findPracticeAddresses({ LYKIA_DEPLOYMENTS: { mainnet: {}, testnet: {} } }), null);
  });
});

describe("standing orders", () => {
  function service(arc: FakeArc) {
    const created: unknown[] = [];
    const intents = { create: async (input: unknown) => (created.push(input), { intent: { id: `out_fire${created.length}xx` } as IntentGraph, outrun: {}, stored: true }) } as unknown as IntentService;
    const svc = new StandingService({ chains: arc.asChains(), store: new MemoryStore(), clock: systemClock, bus: new EventBus(silentLogger), log: silentLogger, intents: () => intents });
    return { svc, created };
  }

  it("fires a price order once: plans an intent, never signs", async () => {
    const arc = new FakeArc();
    const { svc, created } = service(arc);
    const order = await svc.create({ owner: OWNER, environment: "mainnet", draft: { trigger: { kind: "price", feed: "EURC/USD", op: "above", value: "1.11" }, actions: [{ verb: "fx", from: "EURC", to: "USDC", amount: { exact: "1000" } }], text: "if EURC/USD goes above 1.11 convert 1000 EURC" } });
    const first = await svc.check(order.id);
    assert.equal(first.due, true);
    assert.equal(first.order.status, "done");
    assert.equal(first.order.lastIntentId, "out_fire1xx");
    assert.equal(created.length, 1);
    const again = await svc.check(order.id);
    assert.equal(again.due, false);
    assert.equal(created.length, 1);
  });

  it("waits on a price below the line and on a schedule not yet reached", async () => {
    const arc = new FakeArc();
    const { svc, created } = service(arc);
    const low = await svc.create({ owner: OWNER, environment: "mainnet", draft: { trigger: { kind: "price", feed: "EURC/USD", op: "above", value: "1.5" }, actions: [{ verb: "fx", from: "EURC", to: "USDC", amount: { exact: "1" } }], text: "x" } });
    assert.equal((await svc.check(low.id)).due, false);
    const weekly = await svc.create({ owner: OWNER, environment: "testnet", draft: { trigger: { kind: "schedule", every: "week", weekday: "fri", at: "09:00", timezone: "UTC" }, actions: [{ verb: "send", token: "USDC", amount: { exact: "200" }, to: ADDR, memo: "rent" }], text: "every friday" } });
    assert.ok(weekly.nextRunAt);
    assert.equal(await svc.tick(), 0);
    assert.equal(created.length, 0);
    const paused = await svc.setStatus(weekly.id, "paused");
    assert.equal(paused.status, "paused");
    assert.equal((await svc.list(OWNER)).length, 2);
  });
});
