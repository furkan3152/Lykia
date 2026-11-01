import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FENCE, contractAddress, decodeMemo, FENCE_TEMPLATES, type UnsignedTransaction } from "@lykia/core";
import { decodeFunctionData } from "viem";
import { MEMO_ABI, MULTICALL3_FROM_ABI } from "../engine/abis.js";
import { approveCall, shape } from "../engine/calls.js";
import { Planner, fxDeviation } from "../engine/planner.js";
import { bindingOf, matchesPrepared } from "../engine/service.js";
import { PriceService } from "../arc/prices.js";
import { systemClock } from "../clock.js";
import { FakeArc, offlineFetch } from "./support.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as const;
const USDC = "0x3600000000000000000000000000000000000000";
const GALAXY = "0x8E357432CC12ff425c36432F312968aEb16112AF";

function planner(arc: FakeArc) {
  const chains = arc.asChains();
  return new Planner({ chains, prices: new PriceService({ chains, clock: systemClock }), fetch: offlineFetch(), stablefxConfigured: false });
}

const base = { id: "out_test123", owner: OWNER, signer: "wallet" as const, source: "test", now: Date.UTC(2026, 10, 2, 10), spent: { dayUsd: "0", weekUsd: "0" } };

describe("planner + fence", () => {
  it("plans earn into the largest Morpho vault and the Fence allows a small one", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 500_000_000n);
    arc.vaultAssets.set(GALAXY.toLowerCase(), 80_000_000_000_000n);
    const { graph, plans } = await planner(arc).plan({ ...base, environment: "mainnet", actions: [{ verb: "earn", token: "USDC", amount: { exact: "100" } }] });
    assert.equal(graph.steps[0]?.kind, "deposit");
    assert.equal(graph.steps[0]?.venue, "morpho-vaults");
    assert.equal(plans.s1?.params.vault, GALAXY);
    assert.equal(graph.verdict.decision, "allow");
    assert.equal(graph.verdict.signable, true);
  });

  it("chains amounts: earn the rest after a send", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 300_000_000n);
    arc.vaultAssets.set(GALAXY.toLowerCase(), 1n);
    const { graph } = await planner(arc).plan({
      ...base,
      environment: "mainnet",
      fence: { ...DEFAULT_FENCE, recipients: { mode: "any" } },
      actions: [
        { verb: "send", token: "USDC", amount: { exact: "100" }, to: "0x1111111111111111111111111111111111111111" },
        { verb: "earn", token: "USDC", amount: { all: true } },
      ],
    });
    assert.equal(graph.steps[1]?.inputs[0]?.amount, "200000000");
    assert.deepEqual(graph.steps[1]?.dependsOn, ["s1"]);
    assert.equal(graph.verdict.decision, "confirm");
  });

  it("fx is checked against Chainlink EURC/USD and denied outside the band", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 1_000_000_000n);
    const good = await planner(arc).plan({ ...base, environment: "mainnet", actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }] });
    assert.equal(good.graph.steps[0]?.kind, "fx");
    assert.equal(good.graph.verdict.decision, "allow");
    arc.quoteRatePpm = 880_000n; // ~1.8% worse than the reference
    const bad = await planner(arc).plan({ ...base, environment: "mainnet", actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }] });
    assert.ok(bad.graph.verdict.reasons.some((r) => r.rule === "fx.deviation"));
  });

  it("refuses what it cannot do, plainly", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 1_000_000n);
    await assert.rejects(planner(arc).plan({ ...base, environment: "testnet", actions: [{ verb: "earn", token: "USDC", amount: { exact: "1" } }] }), /testnet/u);
    await assert.rejects(planner(arc).plan({ ...base, environment: "mainnet", actions: [{ verb: "borrow", token: "USDC", amount: { exact: "1" } }] }), /not executable/u);
    await assert.rejects(planner(arc).plan({ ...base, environment: "mainnet", actions: [{ verb: "send", token: "USDC", amount: { exact: "5" }, to: OWNER }] }), /needs 5 USDC/u);
  });

  it("the caravan Fence keeps agents on a short leash", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 1_000_000_000n);
    const { graph } = await planner(arc).plan({ ...base, environment: "testnet", signer: "agent", fence: FENCE_TEMPLATES.caravan, actions: [{ verb: "unify", amount: { exact: "60" } }] });
    assert.equal(graph.verdict.decision, "deny");
    assert.ok(graph.verdict.reasons.some((r) => r.rule === "kinds"));
    assert.ok(graph.verdict.reasons.some((r) => r.rule === "caps.step"));
  });

  it("measures fx deviation in bps", () => {
    assert.equal(fxDeviation("USDC", 100_000_000n, 89_653_000n, "1.115403"), 0);
    assert.ok(fxDeviation("USDC", 100_000_000n, 88_000_000n, "1.115403") > 150);
  });
});

describe("call shaping and binding", () => {
  const options = { environment: "testnet" as const, chainId: 5042002, from: OWNER, memo: { intentId: "out_abc123", stepId: "s1", verdict: "0123456789abcdef", note: "invoice 7" }, account: "eoa" as const };
  const main = { to: USDC as `0x${string}`, data: "0xa9059cbb" as `0x${string}`, label: "Send" };

  it("wraps a lone call in an Arc Memo carrying the outrun id", () => {
    const [tx] = shape(main, null, options);
    assert.equal(tx?.to, contractAddress("memo", "testnet"));
    const decoded = decodeFunctionData({ abi: MEMO_ABI, data: tx!.data });
    assert.equal(decoded.args[0], USDC);
    assert.deepEqual(decodeMemo(decoded.args[3]), options.memo);
  });

  it("batches approve + memo-wrapped call through Multicall3From", () => {
    const [tx] = shape(main, approveCall(USDC, OWNER, 5n, "Approve"), options);
    assert.equal(tx?.to, contractAddress("multicall3From", "testnet"));
    const decoded = decodeFunctionData({ abi: MULTICALL3_FROM_ABI, data: tx!.data });
    const calls = decoded.args[0];
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.target, contractAddress("memo", "testnet"));
    assert.equal(calls.every((c) => c.allowFailure === false), true);
  });

  it("smart accounts get plain calls", () => {
    assert.equal(shape(main, approveCall(USDC, OWNER, 5n, "Approve"), { ...options, account: "smart" }).length, 2);
  });

  it("binds prepared transactions and matches on-chain ones exactly", () => {
    const tx: UnsignedTransaction = { chainId: 5042002, from: OWNER, to: USDC, data: "0xabcdef", value: "0", label: "x" };
    assert.equal(bindingOf([tx]), bindingOf([{ ...tx, label: "other", from: OWNER.toUpperCase().replace("0X", "0x") as `0x${string}` }]));
    assert.equal(matchesPrepared(tx, { from: OWNER, to: USDC, input: "0xABCDEF", value: 0n, chainId: 5042002 }), true);
    assert.equal(matchesPrepared(tx, { from: OWNER, to: USDC, input: "0xabcd00", value: 0n }), false);
    assert.equal(matchesPrepared(tx, { from: OWNER, to: USDC, input: "0xabcdef", value: 1n }), false);
    assert.equal(matchesPrepared(tx, { from: OWNER, to: null, input: "0xabcdef", value: 0n }), false);
  });
});
