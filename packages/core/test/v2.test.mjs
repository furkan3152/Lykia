import { test } from "node:test";
import assert from "node:assert/strict";
import { planAllocation, allocationActions, usdMicrosOf, unitsForUsdMicros, checkTrigger, nextScheduleRun, validateStandingDraft, describeTrigger, chooseYield, chooseSwap, chooseBorrow, riskFromTvl, validateActions, PROTOCOLS, validateProtocols } from "../dist/index.js";

test("allocation: fewest swaps to target weights, in USD", () => {
  const plan = planAllocation(
    [{ symbol: "USDC", units: 1000_000000n, decimals: 6, usd: "1" }, { symbol: "EURC", units: 0n, decimals: 6, usd: "1.1" }],
    [{ token: "USDC", weightBps: 6000 }, { token: "EURC", weightBps: 4000 }],
  );
  assert.equal(plan.legs.length, 1);
  assert.equal(plan.legs[0].from, "USDC");
  assert.equal(plan.legs[0].units, 400_000000n);
  assert.deepEqual(allocationActions(plan, () => 6), [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "400" } }]);
  const done = planAllocation([{ symbol: "USDC", units: 600_000000n, decimals: 6, usd: "1" }, { symbol: "EURC", units: 363_636363n, decimals: 6, usd: "1.1" }], [{ token: "USDC", weightBps: 6000 }, { token: "EURC", weightBps: 4000 }]);
  assert.equal(done.balanced, true);
  const unpriced = planAllocation([{ symbol: "USDC", units: 1n, decimals: 6, usd: "1" }, { symbol: "cirBTC", units: 1n, decimals: 8, usd: null }], [{ token: "USDC", weightBps: 5000 }, { token: "cirBTC", weightBps: 5000 }]);
  assert.deepEqual(unpriced.unpriced, ["cirBTC"]);
  assert.equal(usdMicrosOf(1_00000000n, 8, "77896.6"), 77_896_600000n);
  assert.equal(unitsForUsdMicros(77_896_600000n, 8, "77896.6"), 1_00000000n);
});

test("standing: price, schedule and health triggers fail closed", () => {
  const base = { status: "active", fired: 0, createdAt: "2026-11-02T00:00:00Z" };
  const price = { ...base, trigger: { kind: "price", feed: "EURC/USD", op: "above", value: "1.12" } };
  assert.equal(checkTrigger(price, { now: 0, prices: { "EURC/USD": "1.1234" } }).due, true);
  assert.equal(checkTrigger(price, { now: 0, prices: { "EURC/USD": "1.11" } }).due, false);
  assert.equal(checkTrigger(price, { now: 0, prices: { "EURC/USD": null } }).due, false);
  assert.equal(checkTrigger({ ...price, fired: 1 }, { now: 0, prices: { "EURC/USD": "2" } }).due, false);
  const health = { ...base, trigger: { kind: "health", below: "1.5" } };
  assert.equal(checkTrigger(health, { now: 0, prices: {}, health: { "aave-v4": "1.42" } }).due, true);
  assert.equal(checkTrigger(health, { now: 0, prices: {}, health: { "aave-v4": null } }).due, false);
  const friday = { kind: "schedule", every: "week", weekday: "fri", at: "09:00", timezone: "Europe/Istanbul" };
  const next = nextScheduleRun(friday, Date.parse("2026-11-02T10:00:00Z")); // a Monday
  assert.equal(new Date(next).toISOString(), "2026-11-06T06:00:00.000Z");
  const monthly = nextScheduleRun({ kind: "schedule", every: "month", day: 1, at: "10:00", timezone: "UTC" }, Date.parse("2026-11-02T10:00:00Z"));
  assert.equal(new Date(monthly).toISOString(), "2026-12-01T10:00:00.000Z");
  assert.equal(checkTrigger({ ...base, trigger: friday, nextRunAt: "2026-11-06T06:00:00.000Z" }, { now: Date.parse("2026-11-06T06:00:01Z"), prices: {} }).due, true);
  assert.match(describeTrigger(friday), /every fri at 09:00/u);
  assert.deepEqual(validateStandingDraft({ trigger: price.trigger, actions: [{ verb: "fx", from: "EURC", to: "USDC", amount: { exact: "1000" } }], text: "x" }), []);
  assert.ok(validateStandingDraft({ trigger: { kind: "price", feed: "DOGE/USD", op: "up", value: "x" }, actions: [], text: "" }).length >= 4);
});

test("routes: yield, swap and borrow choices explain themselves", () => {
  const y = chooseYield([
    { venue: "morpho-vaults", label: "Morpho Gauntlet", apy: "0.119", tvlUsd: "185000", risk: riskFromTvl(185000), executable: true, notes: [] },
    { venue: "aave-v4", label: "Aave V4 Main USDC", apy: "0.029", tvlUsd: "98000000", risk: riskFromTvl(98e6), executable: true, notes: [] },
    { venue: "morpho-vaults", label: "Morpho Keyrock", apy: "0.0105", tvlUsd: "75000000", risk: "low", executable: true, notes: [] },
  ], "medium");
  assert.equal(y.chosen.label, "Aave V4 Main USDC");
  assert.match(y.reason, /Gauntlet pay more but sit above the medium-risk ceiling/u);
  assert.equal(chooseYield([{ venue: "x", label: "X", apy: "0.2", tvlUsd: "100", risk: "high", executable: true, notes: [] }], "high").chosen.label, "X");
  const s = chooseSwap([
    { venue: "uniswap-v3", label: "v3", amountOut: "100", netAmountOut: "99", risk: "low", executable: true, notes: [] },
    { venue: "uniswap-v4", label: "v4", amountOut: "101", netAmountOut: "100", risk: "low", executable: true, notes: [] },
    { venue: "aerodrome-slipstream", label: "aero", amountOut: "105", risk: "low", executable: false, notes: [] },
  ]);
  assert.equal(s.chosen.label, "v4");
  assert.match(s.reason, /aero quote higher but Lykia cannot execute it yet/u);
  const b = chooseBorrow([
    { venue: "aave-v4", label: "Aave", apy: "0.037", healthFactor: "1.9", risk: "low", executable: true, notes: [] },
    { venue: "morpho-blue", label: "Morpho", apy: "0.024", healthFactor: "1.6", risk: "low", executable: true, notes: [] },
  ], "1.8");
  assert.equal(b.chosen.label, "Aave");
  assert.match(b.reason, /Morpho would leave the health factor under 1.8/u);
  assert.equal(chooseBorrow([{ venue: "x", label: "X", apy: "0.01", healthFactor: "1.2", risk: "low", executable: true, notes: [] }], "1.5"), null);
});

test("actions: new verbs validate; registry stays consistent", () => {
  assert.deepEqual(validateActions([{ verb: "borrow", token: "USDC", amount: { exact: "1000" }, collateral: { token: "cirBTC" }, minHealth: "1.8" }, { verb: "reserve", token: "USDC", amount: { exact: "5000" } }, { verb: "rebalance", targets: [{ token: "USDC", weightBps: 6000 }, { token: "EURC", weightBps: 4000 }] }]), []);
  assert.ok(validateActions([{ verb: "rebalance", targets: [{ token: "USDC", weightBps: 6000 }, { token: "EURC", weightBps: 3000 }] }]).some((i) => /100%/u.test(i.message)));
  assert.ok(validateActions([{ verb: "borrow", token: "USDC", amount: { exact: "1" }, minHealth: "0.9" }]).length > 0);
  assert.deepEqual(validateProtocols(PROTOCOLS), []);
  assert.ok(PROTOCOLS.length >= 30);
  assert.ok(PROTOCOLS.find((p) => p.id === "aave-v4").verbs.includes("borrow"));
});
