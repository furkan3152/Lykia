import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FEE_RECIPIENT, lykiaContracts, outrunOf, type Address } from "@lykia/core";
import { decodeFunctionData, erc20Abi } from "viem";
import { MEMO_ABI, MULTICALL3_FROM_ABI } from "../engine/abis.js";
import { buildCalls } from "../engine/adapters.js";
import { feeCall, shape } from "../engine/calls.js";
import { legsAllowlisted, routerRunCall, type RouterLeg } from "../engine/lykiaRouter.js";
import { Planner } from "../engine/planner.js";
import { bindingOf } from "../engine/service.js";
import { PriceService } from "../arc/prices.js";
import { systemClock } from "../clock.js";
import type { ArcChains } from "../chains/arc.js";
import { FakeArc, offlineFetch } from "./support.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as const;
const base = { id: "out_fee123", owner: OWNER, signer: "wallet" as const, source: "test", now: Date.UTC(2026, 10, 2, 10), spent: { dayUsd: "0", weekUsd: "0" } };

function planner(arc: FakeArc, bps = 100) {
  const chains = arc.asChains();
  return new Planner({ chains, prices: new PriceService({ chains, clock: systemClock }), fetch: offlineFetch(), stablefxConfigured: false, fee: { bps, recipient: DEFAULT_FEE_RECIPIENT } });
}

describe("Lykia protocol fee", () => {
  it("takes 1% from a swap's input before the trade and quotes the rest", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 1_000_000_000n);
    const { graph, plans } = await planner(arc).plan({ ...base, environment: "mainnet", actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }] });
    const step = graph.steps[0]!;
    assert.equal(step.fee?.amount, "1000000");
    assert.equal(step.fee?.basis, "input");
    assert.equal(step.inputs[0]?.amount, "100000000");
    assert.equal(plans.s1?.params.amountIn, "99000000");
    assert.equal(plans.s1?.params.feeAmount, "1000000");
    assert.equal(plans.s1?.params.feeRecipient, DEFAULT_FEE_RECIPIENT);
    assert.ok(graph.verdict.reasons.some((r) => r.rule === "fee" && r.message.includes("Lykia fee 1% · 1 USDC")));
    assert.deepEqual(outrunOf(graph).fees, ["1 USDC"]);
  });

  it("a fee of 0 bps adds nothing", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 1_000_000_000n);
    const { graph, plans } = await planner(arc, 0).plan({ ...base, environment: "mainnet", actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }] });
    assert.equal(graph.steps[0]?.fee, undefined);
    assert.equal(plans.s1?.params.feeAmount, undefined);
    assert.equal(plans.s1?.params.amountIn, "100000000");
  });

  it("dry runs show the fee too", async () => {
    const arc = new FakeArc();
    const { graph } = await planner(arc).plan({ ...base, environment: "mainnet", dryRun: true, actions: [{ verb: "send", token: "USDC", amount: { exact: "50" }, to: OWNER }] });
    assert.equal(graph.steps[0]?.fee?.amount, "500000");
    assert.equal(graph.steps[0]?.fee?.basis, "on-top");
  });

  it("puts the fee transfer in the same batch: before the action, or after a borrow", async () => {
    const chains = new FakeArc().asChains();
    const params = { token: USDC, amount: "100000000", to: "0x1111111111111111111111111111111111111111", display: "100 USDC", decimals: "6", feeAmount: "1000000", feeToken: USDC, feeRecipient: DEFAULT_FEE_RECIPIENT, feeLabel: "Lykia fee 1% · 1 USDC" };
    const before = await buildCalls({ adapter: "transfer", params: { ...params, feeAt: "before" } }, { environment: "mainnet", chains, account: OWNER });
    assert.equal(before.calls.length, 2);
    assert.equal(before.calls[0]?.role, "fee");
    const fee = decodeFunctionData({ abi: erc20Abi, data: before.calls[0]!.data });
    assert.deepEqual([fee.functionName, (fee.args[0] as string).toLowerCase(), fee.args[1]], ["transfer", DEFAULT_FEE_RECIPIENT, 1_000_000n]);
    const after = await buildCalls({ adapter: "transfer", params: { ...params, feeAt: "after" } }, { environment: "mainnet", chains, account: OWNER });
    assert.equal(after.calls[1]?.role, "fee");
  });

  it("the memo stays on the value-moving call when the fee comes after it", () => {
    const options = { environment: "mainnet" as const, chainId: 5042, from: OWNER as Address, memo: { intentId: "out_abc", stepId: "s1", verdict: "0123456789abcdef" }, account: "eoa" as const };
    const borrow = { to: "0x2222222222222222222222222222222222222222" as Address, data: "0x12345678" as `0x${string}`, label: "Borrow" };
    const [tx] = shape([borrow, feeCall(USDC, DEFAULT_FEE_RECIPIENT, 10n, "fee")], null, options);
    const inner = decodeFunctionData({ abi: MULTICALL3_FROM_ABI, data: tx!.data }).args[0] as readonly { target: string; callData: `0x${string}` }[];
    const memo = decodeFunctionData({ abi: MEMO_ABI, data: inner[0]!.callData });
    assert.equal((memo.args[0] as string).toLowerCase(), borrow.to);
    assert.equal(inner[1]!.target.toLowerCase(), USDC);
  });

  it("a transaction without the fee does not match the binding", () => {
    const options = { environment: "mainnet" as const, chainId: 5042, from: OWNER as Address, memo: { intentId: "out_abc", stepId: "s1", verdict: "0123456789abcdef" }, account: "eoa" as const };
    const send = { to: USDC as Address, data: "0xa9059cbb" as `0x${string}`, label: "Send" };
    const withFee = shape([feeCall(USDC, DEFAULT_FEE_RECIPIENT, 10n, "fee"), send], null, options);
    const without = shape(send, null, options);
    assert.notEqual(bindingOf(withFee), bindingOf(without));
  });
});

describe("LykiaRouter wiring", () => {
  const router = lykiaContracts.deployedAddress("mainnet", "LykiaRouter")!;
  const legs: RouterLeg[] = [
    { adapter: "swap", tokenIn: USDC, tokenOut: EURC, amountIn: "500000000", minOut: "440000000", fee: "500", label: "Uniswap v3 0.05%" },
    { adapter: "swap-aerodrome", tokenIn: USDC, tokenOut: EURC, amountIn: "500000000", minOut: "441000000", pool: "0x6F57B4C22155ceF09F17184c954f227FF0493742", router: "0x0fef9e88a7b76bcdbf451780c6774fe32965ee98", label: "Aerodrome" },
  ];

  it("encodes one run with every leg paying out to the router and the sum as the final minimum", () => {
    const call = routerRunCall("mainnet", "out_x", OWNER, legs, 2_000_000_000n, "split");
    assert.equal(call.to, router);
    const decoded = decodeFunctionData({ abi: lykiaContracts.lykiaRouterArtifact.abi, data: call.data });
    assert.equal(decoded.functionName, "run");
    const intent = decoded.args[0] as { amountIn: bigint; minFinalOut: bigint; recipient: string; feeBps: number; steps: readonly { amountIn: bigint }[] };
    assert.equal(intent.amountIn, 1_000_000_000n);
    assert.equal(intent.minFinalOut, 881_000_000n);
    assert.equal(intent.recipient.toLowerCase(), OWNER);
    assert.equal(intent.feeBps, 0);
    assert.equal(intent.steps.length, 2);
  });

  it("reads the allowlist and names the missing venues", async () => {
    const fake = (allowed: boolean) => ({ client: () => ({ readContract: async () => allowed }) }) as unknown as ArcChains;
    assert.deepEqual(await legsAllowlisted(fake(true), "mainnet", [{ adapter: "swap" }]), { ok: true, missing: [] });
    const missing = await legsAllowlisted(fake(false), "testnet", [{ adapter: "swap" }]);
    assert.equal(missing.ok, false);
  });
});
