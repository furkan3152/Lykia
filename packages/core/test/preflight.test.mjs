import { test } from "node:test";
import assert from "node:assert/strict";
import { runPreflight, preflightGate, preflightLead, topFindings, watchFindings, walletNetworkFinding, quoteAgeFinding, unlimitedApprovalFindings, bridgeRefusal, lookalike, PREFLIGHT_CHECKS, fingerprintOf, buildCapabilityMap, DEFAULT_FENCE } from "../dist/index.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41";
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0x89b50855aa3be2f677cd6303cec089b5f319d72a";
const NOW = Date.UTC(2026, 10, 9, 12);
const AT = new Date(NOW).toISOString();
const usdc = (n) => String(Math.round(n * 1e6));
const amount = (symbol, units, extra = {}) => ({ symbol, token: symbol === "USDC" ? USDC : EURC, decimals: 6, amount: String(units), usd: symbol === "USDC" ? String(Number(units) / 1e6) : String((Number(units) / 1e6) * 1.1154), ...extra });
const fee = (units, basis = "input") => ({ bps: 100, recipient: OWNER, symbol: "USDC", token: USDC, decimals: 6, amount: String(units), usd: String(units / 1e6), basis });

function state(overrides = {}) {
  return {
    now: NOW,
    wallet: { balances: { USDC: usdc(2.01), EURC: "0" }, read: { source: "Arc chain · balanceOf", readAt: AT } },
    gas: { priceWei: String(20_000_000_000n), read: { source: "Arc chain · eth_gasPrice", readAt: AT } },
    prices: { USDC: { usd: "1", updatedAt: null, maxAgeSeconds: null, source: "unit" }, EURC: { usd: "1.1154", updatedAt: AT, maxAgeSeconds: 26 * 3600, source: "chainlink:EURC/USD" } },
    prefs: { gasReserveUsdc: "0.5", cashFloorUsd: "500", read: { source: "Your Lyko", readAt: null } },
    obligations: [],
    running: [],
    recent: [],
    counterparties: [],
    code: {},
    contracts: [{ address: USDC, name: "USDC token" }],
    incoming: [],
    head: null,
    destinations: {},
    unlimitedApprovals: [],
    vaults: {},
    health: {},
    budget: { kind: "fence", name: "Your Fence" },
    beta: null,
    minFeeGwei: 20,
    ...overrides,
  };
}

/** "Buy EURC with 2 USDC" planned for 2 USDC: 1% fee inside, an approve folded into the same stage. */
function swapPlan(gross = 2, overrides = {}) {
  const g = Math.round(gross * 1e6);
  const f = Math.round(g / 100);
  const out = Math.round(((g - f) * 0.896));
  return {
    id: "out_test0001",
    environment: "mainnet",
    owner: OWNER,
    account: OWNER,
    accountKind: "eoa",
    source: `buy EURC with ${gross} USDC`,
    dryRun: false,
    createdAt: AT,
    actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: String(gross) } }],
    steps: [
      { id: "s1", kind: "fx", venue: "uniswap-v3", summary: "Convert", inputs: [amount("USDC", g)], outputs: [amount("EURC", out, { minimum: String(Math.round(out * 0.995)) })], fee: fee(f), settlement: { kind: "receipt" }, stage: 1, status: "ready", gasUnits: 240_000, action: 0, usd: String(gross), fxDeviationBps: 6, params: {} },
    ],
    verdict: { decision: "allow", reasons: [] },
    fence: DEFAULT_FENCE,
    spent: { dayUsd: "0.00", weekUsd: "0.00" },
    ...overrides,
  };
}

function sendPlan(to, gross = 5, overrides = {}) {
  const g = Math.round(gross * 1e6);
  const f = Math.round(g / 100);
  return {
    ...swapPlan(gross),
    source: `send ${gross} USDC to ${to}`,
    actions: [{ verb: "send", token: "USDC", amount: { exact: String(gross) }, to }],
    steps: [{ id: "s1", kind: "transfer", venue: "arc", summary: "Send", inputs: [amount("USDC", g + f)], outputs: [], fee: fee(f, "on-top"), settlement: { kind: "receipt" }, stage: 1, status: "ready", gasUnits: 125_000, action: 0, usd: String(gross), recipient: to, params: { to } }],
    ...overrides,
  };
}

test("the owner's case: 2 of 2.01 USDC to EURC warns about gas with a computed fix near 1.50", () => {
  const findings = runPreflight(swapPlan(2), state());
  const gas = findings.find((f) => f.check === "gas-reserve");
  assert.ok(gas, JSON.stringify(findings.map((f) => f.id)));
  assert.equal(gas.severity, "warn");
  assert.match(gas.say, /gas is paid in USDC/u);
  const fix = gas.fixes[0];
  assert.equal(fix.kind, "replan");
  const x = Number(fix.actions[0].amount.exact);
  assert.ok(x >= 1.49 && x <= 1.5, String(x));
  assert.equal(fix.sentence, `Convert ${fix.actions[0].amount.exact} USDC to EURC`);
  assert.match(preflightLead(findings), /Use 1\.5\d? USDC and keep 0\.5 for gas\?$/u);
  assert.deepEqual(preflightGate(findings).needsAck, ["gas-reserve"]);
  assert.deepEqual(preflightGate(findings, true).needsAck, []);
});

test("the fix re-plans clean: the computed amount keeps the reserve", () => {
  const first = runPreflight(swapPlan(2), state()).find((f) => f.check === "gas-reserve");
  const again = runPreflight(swapPlan(Number(first.fixes[0].actions[0].amount.exact)), state());
  assert.equal(again.find((f) => f.check === "gas-reserve"), undefined, JSON.stringify(again.map((f) => f.title)));
});

test("a plan that cannot pay its own network fee blocks and offers what fits", () => {
  const findings = runPreflight(swapPlan(2.01), state());
  const gas = findings.find((f) => f.check === "gas-reserve");
  assert.equal(gas.severity, "block");
  assert.ok(gas.fixes.some((f) => f.kind === "replan"));
  assert.ok(gas.fixes.some((f) => f.kind === "add-funds" && f.needsGas === false));
  assert.equal(preflightGate(findings).blocked, true);
});

test("insufficient balance names the amount, the fee and the gas, with the max that fits", () => {
  const findings = runPreflight(sendPlan("0x1111111111111111111111111111111111111111", 2.5), state());
  const f = findings.find((x) => x.check === "insufficient");
  assert.equal(f.severity, "block");
  assert.match(f.why, /2\.50 to move \+ 0\.025 Lykia fee \+ up to 0\.00\d+ network fee/u);
  const max = f.fixes.find((x) => x.kind === "replan");
  assert.ok(max && Number(max.actions[0].amount.exact) < 2.01);
});

test("waiting for incoming funds is offered when they cover the gap", () => {
  const findings = runPreflight(sendPlan("0x1111111111111111111111111111111111111111", 2.5), state({ incoming: [{ label: "250 USDC arriving from Base", symbol: "USDC", units: usdc(250), decimals: 6, etaSeconds: 120 }] }));
  const wait = findings.find((x) => x.check === "insufficient").fixes.find((x) => x.kind === "wait");
  assert.equal(wait.label, "Wait for 250.00 USDC");
  assert.match(wait.detail, /~2 min/u);
});

test("a poisoned address blocks with a 'Did you mean' fix; a first payee is a note", () => {
  const real = "0xabcd1111111111111111111111111111111b1234";
  const fake = "0xabcd9999999999999999999999999999999b1234";
  assert.equal(lookalike(real, fake), true);
  const s = state({ wallet: { balances: { USDC: usdc(100) }, read: { source: "Arc", readAt: AT } }, counterparties: [{ address: real, label: "Supplier" }] });
  const f = runPreflight(sendPlan(fake), s).find((x) => x.check === "recipient");
  assert.equal(f.severity, "block");
  assert.equal(f.fixes[0].actions[0].to, real);
  assert.match(f.fixes[0].label, /^Did you mean 0xabcd1111…1234\?$/u);
  const first = runPreflight(sendPlan("0x2222222222222222222222222222222222222222"), s).find((x) => x.check === "recipient");
  assert.equal(first.severity, "note");
});

test("zero address and token contracts are blocked as payees", () => {
  const s = state({ wallet: { balances: { USDC: usdc(100) }, read: { source: "Arc", readAt: AT } } });
  assert.equal(runPreflight(sendPlan("0x0000000000000000000000000000000000000000"), s).find((x) => x.check === "recipient").severity, "block");
  assert.match(runPreflight(sendPlan(USDC), s).find((x) => x.check === "recipient").title, /USDC token contract/u);
});

test("bridge destination without gas warns; unsupported chains block with the list", () => {
  const plan = { ...sendPlan(OWNER, 10), steps: [{ id: "s1", kind: "bridge", venue: "cctp", summary: "Bridge", inputs: [amount("USDC", 10_000_000)], outputs: [amount("USDC@base", 9_900_000)], fee: fee(100_000), settlement: { kind: "cctp", destination: "base", expectedSeconds: 900 }, stage: 1, status: "ready", gasUnits: 200_000, action: 0, usd: "10", recipient: OWNER, destination: "base", params: { destination: "base", forward: "1" } }], actions: [{ verb: "bridge", token: "USDC", amount: { exact: "10" }, destination: "base" }] };
  const s = state({ wallet: { balances: { USDC: usdc(100) }, read: { source: "Arc", readAt: AT } }, destinations: { [`base:${OWNER}`]: { nativeWei: "0", nativeSymbol: "ETH", chainName: "Base", read: { source: "Base RPC", readAt: AT } } } });
  const f = runPreflight(plan, s);
  assert.equal(f.find((x) => x.id.startsWith("bridge-destination:gas")).severity, "warn");
  assert.ok(f.some((x) => x.id.startsWith("bridge-destination:time")));
  const r = bridgeRefusal("mainnet", "solana is not a CCTP destination.");
  assert.equal(r.severity, "block");
  assert.match(r.why, /Base/u);
});

test("the Fence room splits a day: what fits today, the rest tomorrow", () => {
  const plan = sendPlan("0x1111111111111111111111111111111111111111", 300, { verdict: { decision: "deny", reasons: [{ rule: "caps.daily", decision: "deny", message: "Over the daily cap of $500." }] }, fence: { ...DEFAULT_FENCE, caps: { dailyUsd: "500" } }, spent: { dayUsd: "400.00", weekUsd: "400.00" } });
  const s = state({ wallet: { balances: { USDC: usdc(1000) }, read: { source: "Arc", readAt: AT } }, counterparties: null });
  const f = runPreflight(plan, s).find((x) => x.check === "fence-room");
  assert.equal(f.severity, "block");
  const split = f.fixes.find((x) => x.id === "split-days");
  assert.ok(Number(split.actions[0].amount.exact) <= 100 / 1.01 + 0.01, split.actions[0].amount.exact);
  assert.ok(f.fixes.some((x) => x.kind === "change-fence"));
});

test("a repeat within 10 minutes warns", () => {
  const plan = swapPlan(1);
  const s = state({ recent: [{ id: "out_earlier01", createdAt: new Date(NOW - 2 * 60_000).toISOString(), status: "settled", fingerprint: fingerprintOf(plan.steps), swaps: [], paid: [] }] });
  const f = runPreflight(plan, s).find((x) => x.check === "duplicate");
  assert.equal(f.severity, "warn");
  assert.match(f.say, /signed 2 minutes ago/u);
});

test("obligations due this week that the balance left won't cover warn, with a pause fix", () => {
  const s = state({ wallet: { balances: { USDC: usdc(120) }, read: { source: "Arc", readAt: AT } }, obligations: [{ id: "so_1", name: "Rent", kind: "Recurring payment", symbol: "USDC", units: usdc(100), decimals: 6, dueAt: new Date(NOW + 3 * 86_400_000).toISOString(), pause: { path: "/v1/automations/so_1/pause", method: "post" } }] });
  const f = runPreflight(swapPlan(50), s).find((x) => x.check === "obligations");
  assert.equal(f.severity, "warn");
  assert.ok(f.fixes.some((x) => x.kind === "pause"));
  assert.ok(f.fixes.some((x) => x.kind === "replan"));
});

test("loan health under the floor blocks, close to it warns", () => {
  const plan = (hf) => ({ ...swapPlan(1), steps: [{ ...swapPlan(1).steps[0], kind: "borrow", venue: "aave-v4", fxDeviationBps: undefined, healthFactorAfter: hf }] });
  const s = state({ wallet: { balances: { USDC: usdc(100) }, read: { source: "Arc", readAt: AT } }, health: { "aave-v4": "2.4" } });
  const fence = { ...DEFAULT_FENCE, lending: { minHealthFactor: "1.5" } };
  assert.equal(runPreflight({ ...plan("1.3"), fence }, s).find((x) => x.check === "loan-health").severity, "block");
  const warn = runPreflight({ ...plan("1.6"), fence }, s).find((x) => x.check === "loan-health");
  assert.equal(warn.severity, "warn");
  assert.deepEqual(warn.change, { label: "Loan health", before: "2.40", after: "1.60" });
});

test("costs, FX band, stale prices, dust and round trips", () => {
  const tiny = runPreflight(swapPlan(0.2), state({ wallet: { balances: { USDC: usdc(100) }, read: { source: "Arc", readAt: AT } } }));
  assert.ok(tiny.some((x) => x.check === "cost-ratio"), JSON.stringify(tiny.map((x) => x.id)));
  const off = swapPlan(1);
  off.steps[0] = { ...off.steps[0], fxDeviationBps: 80 };
  assert.equal(runPreflight(off, state({ wallet: { balances: { USDC: usdc(100) }, read: { source: "Arc", readAt: AT } } })).find((x) => x.check === "fx-band").severity, "block");
  const stale = state({ prices: { ...state().prices, EURC: { usd: "1.1154", updatedAt: new Date(NOW - 30 * 3600_000).toISOString(), maxAgeSeconds: 26 * 3600, source: "chainlink" } } });
  assert.ok(runPreflight(swapPlan(1), stale).some((x) => x.check === "price-stale"));
  const back = state({ wallet: { balances: { USDC: usdc(100) }, read: { source: "Arc", readAt: AT } }, recent: [{ id: "out_old00001", createdAt: new Date(NOW - 3 * 3600_000).toISOString(), status: "settled", fingerprint: "x", swaps: [{ from: "EURC", to: "USDC", settledAt: new Date(NOW - 3 * 3600_000).toISOString(), feeUsd: "0.5" }], paid: [] }] });
  assert.match(runPreflight(swapPlan(1), back).find((x) => x.check === "round-trip").why, /lose about \$/u);
});

test("client checks: wallet on the wrong chain blocks with Switch network; old quotes are rebuilt", () => {
  const f = walletNetworkFinding(5042002, "mainnet");
  assert.equal(f.severity, "block");
  assert.equal(f.fixes[0].kind, "switch-network");
  assert.equal(walletNetworkFinding(5042, "mainnet"), null);
  assert.equal(quoteAgeFinding(NOW - 10_000, NOW), null);
  assert.equal(quoteAgeFinding(NOW - 45_000, NOW).severity, "note");
});

test("an unlimited approve in prepared calls blocks", () => {
  const data = `0x095ea7b3${"0".repeat(24)}${"ab".repeat(20)}${"f".repeat(64)}`;
  assert.equal(unlimitedApprovalFindings([{ to: USDC, data }])[0].severity, "block");
  assert.deepEqual(unlimitedApprovalFindings([{ to: USDC, data: `0x095ea7b3${"0".repeat(24)}${"ab".repeat(20)}${"0".repeat(60)}1234` }]), []);
});

test("calm: the most severe one or two first, the rest behind a count", () => {
  const s = state({ wallet: { balances: { USDC: usdc(2.01) }, read: { source: "Arc", readAt: AT } }, counterparties: [] });
  const { shown, more } = topFindings(runPreflight(sendPlan("0x0000000000000000000000000000000000000000", 2.5), s));
  const all = runPreflight(sendPlan("0x0000000000000000000000000000000000000000", 2.5), s);
  assert.ok(shown.length <= 2);
  assert.equal(more, all.length - shown.length);
  assert.equal(shown[0].severity, "block");
});

test("watch: the owner's wallet after the trade shows 'Gas is nearly empty' with an honest fix", () => {
  const f = watchFindings({ now: NOW, owner: OWNER, usdc: usdc(0.01), read: { source: "Arc chain · native USDC", readAt: AT }, holdings: [{ symbol: "EURC", units: usdc(1.77), decimals: 6, usd: "1.97" }], gasReserveUsdc: "0.5", gas: null, minFeeGwei: 20, obligations: [], inFlight: [] });
  const gas = f.find((x) => x.id === "gas-empty");
  assert.equal(gas.title, "Gas is nearly empty: 0.01 USDC left");
  assert.equal(gas.fixes[0].label, "Add USDC to this wallet");
  assert.equal(gas.fixes[0].needsGas, false);
  // A swap back needs more gas than the wallet holds, so it is not offered.
  assert.ok(!gas.fixes.some((x) => x.needsGas));
  const stuck = watchFindings({ now: NOW, owner: OWNER, usdc: "0", read: { source: "Arc", readAt: AT }, holdings: [{ symbol: "EURC", units: usdc(10), decimals: 6, usd: "11" }], gasReserveUsdc: "0.5", gas: null, minFeeGwei: 20, obligations: [], inFlight: [{ intentId: "out_x", stepId: "s1", summary: "Bridge", destination: "Base", sentAt: new Date(NOW - 3600_000).toISOString(), expectedSeconds: 900 }] });
  assert.ok(stuck.some((x) => x.id === "stranded"));
  assert.ok(stuck.some((x) => x.id.startsWith("bridge-stuck")));
});

test("the capability map lists every check", () => {
  const map = buildCapabilityMap({ environment: "mainnet", executable: new Set(["cctp"]), gatewayChains: [] });
  assert.equal(map.checks.length, PREFLIGHT_CHECKS.length);
  assert.ok(map.checks.some((c) => c.id === "gas-reserve"));
});
