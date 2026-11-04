/**
 * Arc + Circle accuracy: CCTP from Arc (standard threshold, Forwarding
 * Service end to end, status), Gateway estimate and forwarding, Compliance
 * chain fallback, USYC entitlement gating. All HTTP and RPC are mocked.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARC_CCTP_SOURCE, contractAddress, DEFAULT_FENCE, findCctpDestination, type Address } from "@lykia/core";
import { decodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import { cctpFees, cctpTransferStatus, forwardedRouteFee } from "../circle/cctp.js";
import { resetScreeningCache, screenAddress } from "../circle/compliance.js";
import { draftGatewayTransfer, draftGatewayTransferEstimated, estimateGatewayTransfer, gatewayTransferStatus, submitGatewayTransfer } from "../circle/gateway.js";
import { stablefxFund, stablefxFundingPresign, stablefxQuote } from "../circle/stablefx.js";
import { planUsyc, TELLER_DEPOSIT, TELLER_REDEEM, USYC_TELLER_ABI, usycEligibility } from "../circle/usyc.js";
import { CCTP_FORWARDING_HOOK_DATA, MULTICALL3_FROM_ABI, TOKEN_MESSENGER_HOOK_ABI, TOKEN_MESSENGER_V2_ABI } from "../engine/abis.js";
import { buildCalls } from "../engine/adapters.js";
import { Planner } from "../engine/planner.js";
import { PriceService } from "../arc/prices.js";
import { systemClock } from "../clock.js";
import type { ArcChains } from "../chains/arc.js";
import { FakeArc, offlineFetch } from "./support.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as Address;
const USDC = "0x3600000000000000000000000000000000000000";
const TX = `0x${"ab".repeat(32)}`;

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const fakeFetch = (handler: Handler) => async (url: string, init?: RequestInit) => handler(url, init);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const IRIS_FEES = [
  { finalityThreshold: 1000, minimumFee: 0, forwardFee: { low: 54046, med: 54390, high: 55501 } },
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 54046, med: 54390, high: 55501 } },
];

describe("CCTP from Arc", () => {
  it("knows Arc is a standard-only, zero-fee CCTP source and lists the forwarding destinations", () => {
    assert.equal(ARC_CCTP_SOURCE.fastTransfer, false);
    assert.equal(ARC_CCTP_SOURCE.standardFeeBps, 0);
    for (const key of ["sonic", "worldchain", "sei", "hyperevm", "base"]) assert.equal(findCctpDestination(key)?.forwarding, true, key);
    assert.equal(findCctpDestination("world chain")?.domain, 14);
    assert.equal(findCctpDestination("world"), null);
  });

  it("reads the forwarding fee under `med` (live API) and `medium` (API reference)", async () => {
    const live = await cctpFees(fakeFetch(() => json(IRIS_FEES)), "mainnet", 6, true);
    assert.equal(live[1]?.forwardFee?.med, "54390");
    const documented = await cctpFees(fakeFetch(() => json([{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 90, medium: 110, high: 160 } }])), "mainnet", 6, true);
    assert.equal(documented[0]?.forwardFee?.med, "110");
    assert.deepEqual(await forwardedRouteFee(fakeFetch(() => json(IRIS_FEES)), "mainnet", 6, 50_000_000n), { maxFee: 54_390n, protocol: 0n, forward: 54_390n });
    assert.equal(await forwardedRouteFee(fakeFetch(() => json({ error: "x" }, 500)), "mainnet", 6, 1n), null);
  });

  it("reports a forwarded transfer's state from Iris, and 404 as not seen yet", async () => {
    const f = fakeFetch((url) => {
      assert.equal(url, `https://iris-api.circle.com/v2/messages/26?transactionHash=${TX}`);
      return json({ messages: [{ status: "complete", forwardState: "COMPLETE", destinationMintTxHash: `0x${"cd".repeat(32)}`, attestation: "0x11", message: "0x22", decodedMessage: { destinationDomain: "6" } }] });
    });
    const s = await cctpTransferStatus(f, "mainnet", TX);
    assert.equal(s.forwardState, "COMPLETE");
    assert.equal(s.destinationDomain, 6);
    assert.equal(s.destinationMintTxHash, `0x${"cd".repeat(32)}`);
    const none = await cctpTransferStatus(fakeFetch(() => json({}, 404)), "mainnet", TX);
    assert.equal(none.found, false);
    await assert.rejects(cctpTransferStatus(f, "mainnet", "0x12"));
  });

  it("the intent engine bridges with Circle's Forwarding Service: hook data, maxFee = forwarding fee, standard threshold", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 100_000_000n);
    const chains = arc.asChains();
    const fetch = offlineFetch({ "https://iris-api.circle.com/v2/burn/USDC/fees/26/6": IRIS_FEES });
    const planner = new Planner({ chains, prices: new PriceService({ chains, clock: systemClock }), fetch, stablefxConfigured: false });
    const { graph, plans } = await planner.plan({ id: "out_fwd0001", owner: OWNER, signer: "wallet", source: "test", now: Date.UTC(2026, 10, 4), spent: { dayUsd: "0", weekUsd: "0" }, environment: "mainnet", fence: DEFAULT_FENCE, actions: [{ verb: "bridge", token: "USDC", amount: { exact: "50" }, destination: "base" }] });
    const step = graph.steps[0]!;
    const plan = plans[step.id]!;
    assert.equal(plan.params.forward, "1");
    assert.equal(plan.params.maxFee, "54390");
    assert.ok(step.summary.includes("Circle forwards the mint"));
    const built = await buildCalls(plan, { environment: "mainnet", chains, account: OWNER });
    const call = built.calls.find((c) => c.to.toLowerCase() === (contractAddress("tokenMessengerV2", "mainnet") as string).toLowerCase())!;
    const decoded = decodeFunctionData({ abi: TOKEN_MESSENGER_HOOK_ABI, data: call.data });
    assert.equal(decoded.functionName, "depositForBurnWithHook");
    assert.equal(decoded.args[5], 54_390n);
    assert.equal(decoded.args[6], 2000);
    assert.equal(decoded.args[7], CCTP_FORWARDING_HOOK_DATA);
  });

  it("falls back to a plain burn, and says the mint is manual, when the forwarding fee cannot be read", async () => {
    const arc = new FakeArc();
    arc.setBalance(USDC, OWNER, 100_000_000n);
    const chains = arc.asChains();
    const planner = new Planner({ chains, prices: new PriceService({ chains, clock: systemClock }), fetch: offlineFetch(), stablefxConfigured: false });
    const { graph, plans } = await planner.plan({ id: "out_fwd0002", owner: OWNER, signer: "wallet", source: "test", now: Date.UTC(2026, 10, 4), spent: { dayUsd: "0", weekUsd: "0" }, environment: "mainnet", fence: DEFAULT_FENCE, actions: [{ verb: "bridge", token: "USDC", amount: { exact: "50" }, destination: "base" }] });
    const plan = plans[graph.steps[0]!.id]!;
    assert.equal(plan.params.forward, undefined);
    assert.ok(graph.warnings.some((w) => w.includes("receiveMessage")));
    const built = await buildCalls(plan, { environment: "mainnet", chains, account: OWNER });
    const call = built.calls.at(-1)!;
    assert.equal(decodeFunctionData({ abi: TOKEN_MESSENGER_V2_ABI, data: call.data }).functionName, "depositForBurn");
  });
});

describe("Gateway estimate and forwarding", () => {
  const ESTIMATE = { body: [{ burnIntent: { maxBlockHeight: "30911559", maxFee: "56494", spec: {} } }], fees: { token: "USDC", total: "0.056494", forwardingFee: "0.052994", perIntent: [] } };

  it("uses Gateway's estimate for maxFee and expiry; forwarded drafts carry the forwarding fee plus a gas buffer", async () => {
    let url = "";
    const f = fakeFetch((u, init) => {
      url = u;
      const body = JSON.parse(String(init?.body)) as { spec: { sourceDomain: number; destinationDomain: number } }[];
      assert.equal(body[0]?.spec.sourceDomain, 26);
      assert.equal(body[0]?.spec.destinationDomain, 6);
      return json(ESTIMATE);
    });
    const draft = await draftGatewayTransferEstimated(f, { environment: "mainnet", depositor: OWNER, destination: "base", valueUnits: 10_000_000n, forward: true });
    assert.equal(url, "https://gateway-api.circle.com/v1/estimate?enableForwarder=true");
    assert.equal(draft.fee.source, "estimate");
    assert.equal(draft.fee.forwardingFeeUsdc, "0.052994");
    assert.equal(draft.fee.maxFee, String(56_494n + 3_500n));
    assert.equal((draft.burnIntents[0] as { maxBlockHeight: string }).maxBlockHeight, "30911559");
    assert.equal(draft.forward, true);
  });

  it("reads the bare-array estimate shape; falls back to the formula for plain transfers and refuses forwarded ones", async () => {
    const bare = await estimateGatewayTransfer(fakeFetch(() => json([{ burnIntent: { maxBlockHeight: "5", maxFee: "3850" } }])), "mainnet", {}, false);
    assert.equal(bare.maxFee, 3_850n);
    const down = fakeFetch(() => json({ message: "unavailable" }, 503));
    const plain = await draftGatewayTransferEstimated(down, { environment: "mainnet", depositor: OWNER, destination: "base", valueUnits: 10_000_000n });
    assert.equal(plain.fee.source, "formula");
    await assert.rejects(draftGatewayTransferEstimated(down, { environment: "mainnet", depositor: OWNER, destination: "base", valueUnits: 10_000_000n, forward: true }));
    assert.throws(() => draftGatewayTransfer({ environment: "mainnet", depositor: OWNER, destination: "base", valueUnits: 1n, forward: true }));
  });

  it("submits forwarded transfers with enableForwarder and returns no mint to sign", async () => {
    let url = "";
    const r = await submitGatewayTransfer(fakeFetch((u) => {
      url = u;
      return json({ transferId: "6f1c1b2a-1111-4c4c-9a9a-123456789abc" });
    }), { environment: "mainnet", destination: "base", burnIntents: [{}], signatures: [`0x${"11".repeat(65)}`], forward: true });
    assert.equal(url, "https://gateway-api.circle.com/v1/transfer?enableForwarder=true");
    assert.equal(r.forwarded, true);
    assert.equal(r.mint, null);
    const status = await gatewayTransferStatus(fakeFetch((u) => {
      assert.equal(u, "https://gateway-api.circle.com/v1/transfer/6f1c1b2a-1111-4c4c-9a9a-123456789abc");
      return json({ id: "6f1c1b2a-1111-4c4c-9a9a-123456789abc", status: "minted" });
    }), "mainnet", "6f1c1b2a-1111-4c4c-9a9a-123456789abc");
    assert.equal(status.status, "minted");
    await assert.rejects(submitGatewayTransfer(fakeFetch(() => json({})), { environment: "mainnet", destination: "base", burnIntents: Array(17).fill({}), signatures: Array(17).fill("0x") }));
  });
});

describe("Compliance Engine on Arc", () => {
  it("asks for ARC first and screens the same EVM address as ETH when Circle refuses the chain", async () => {
    resetScreeningCache();
    const chains: string[] = [];
    const f = fakeFetch((_u, init) => {
      const body = JSON.parse(String(init?.body)) as { chain: string };
      chains.push(body.chain);
      if (body.chain === "ARC") return json({ code: 2, message: "invalid chain" }, 400);
      return json({ data: { result: "APPROVED", decision: { ruleName: "Low risk", actions: [] } } });
    });
    const r = await screenAddress(f, "k", "mainnet", "0x7fb49965753A9eC3646fd5d004ee5AeD6Cc89999", 1_000);
    assert.deepEqual(chains, ["ARC", "ETH"]);
    assert.equal(r.result, "APPROVED");
    assert.equal(r.screenedAs, "ETH");
  });

  it("never reads a failure as approval: no access is UNKNOWN with a reason, and is not cached", async () => {
    resetScreeningCache();
    let calls = 0;
    const f = fakeFetch(() => {
      calls += 1;
      return json({ message: "forbidden" }, 403);
    });
    const r = await screenAddress(f, "k", "testnet", "0x7fb49965753A9eC3646fd5d004ee5AeD6Cc89999", 1_000);
    assert.equal(r.result, "UNKNOWN");
    assert.match(r.reason ?? "", /Compliance Engine access/u);
    await screenAddress(f, "k", "testnet", "0x7fb49965753A9eC3646fd5d004ee5AeD6Cc89999", 2_000);
    assert.equal(calls, 2);
  });
});

describe("USYC through the Teller", () => {
  function usycChains(entitled: boolean | "error"): ArcChains {
    const client = {
      readContract: async (call: { functionName: string; args: readonly unknown[] }) => {
        if (call.functionName === "canCall") {
          if (entitled === "error") throw new Error("rpc down");
          assert.ok(call.args[2] === TELLER_DEPOSIT || call.args[2] === TELLER_REDEEM);
          return entitled;
        }
        if (call.functionName === "previewDeposit") return ((call.args[0] as bigint) * 875_239n) / 1_000_000n;
        if (call.functionName === "previewRedeem") return ((call.args[0] as bigint) * 1_142_544n) / 1_000_000n;
        throw new Error(call.functionName);
      },
    };
    return { client: () => client } as unknown as ArcChains;
  }

  it("refuses wallets the Entitlements contract does not allow (and a failed read), building nothing", async () => {
    const e = await usycEligibility(usycChains(false), "mainnet", OWNER);
    assert.equal(e.subscribe, false);
    assert.equal(e.contracts.teller, contractAddress("usycTeller", "mainnet"));
    await assert.rejects(planUsyc(usycChains(false), { environment: "mainnet", owner: OWNER, side: "subscribe", amountUnits: 1_000_000n }), /not entitled/u);
    await assert.rejects(planUsyc(usycChains("error"), { environment: "mainnet", owner: OWNER, side: "redeem", amountUnits: 1_000_000n }), /Could not read/u);
  });

  it("entitled wallets get approve + deposit (subscribe) or redeem, with the Teller's own preview", async () => {
    const sub = await planUsyc(usycChains(true), { environment: "mainnet", owner: OWNER, side: "subscribe", amountUnits: 100_000_000n });
    assert.equal(sub.plan.previewUnits, 87_523_900n);
    assert.equal(sub.plan.usd, "100");
    assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: sub.plan.approval!.data }).args, [contractAddress("usycTeller", "mainnet"), 100_000_000n]);
    assert.deepEqual(decodeFunctionData({ abi: USYC_TELLER_ABI, data: sub.plan.calls[0]!.data }).args, [100_000_000n, getAddress(OWNER)]);
    const red = await planUsyc(usycChains(true), { environment: "mainnet", owner: OWNER, side: "redeem", amountUnits: 10_000_000n });
    assert.equal(red.plan.approval, null);
    assert.deepEqual(decodeFunctionData({ abi: USYC_TELLER_ABI, data: red.plan.calls[0]!.data }).args, [10_000_000n, getAddress(OWNER), getAddress(OWNER)]);
    assert.equal(red.plan.usd, "11.42544");
    assert.ok(MULTICALL3_FROM_ABI.length > 0 && (TX as Hex).length === 66);
  });
});

describe("StableFX taker flow", () => {
  it("uses the sandbox host on testnet and completes the taker side with funding presign + fund", async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const f = fakeFetch((u, init) => {
      urls.push(u);
      bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      if (u.endsWith("/fund")) return new Response("", { status: 200 });
      return json({ id: "q1", typedData: { message: {} } });
    });
    await stablefxQuote(f, "k", { from: "USDC", to: "EURC", amount: "100", side: "from", type: "reference", tenor: "instant", environment: "testnet" });
    await stablefxFundingPresign(f, "k", { contractTradeIds: ["24"], environment: "mainnet" });
    assert.deepEqual(await stablefxFund(f, "k", { permit2: { nonce: "1" }, signature: "0x01", environment: "mainnet" }), {});
    assert.deepEqual(urls, ["https://api-sandbox.circle.com/v1/exchange/stablefx/quotes", "https://api.circle.com/v1/exchange/stablefx/signatures/funding/presign", "https://api.circle.com/v1/exchange/stablefx/fund"]);
    assert.deepEqual(bodies[1], { contractTradeIds: ["24"], type: "taker" });
    assert.equal((bodies[2] as { type: string }).type, "taker");
    assert.throws(() => stablefxFundingPresign(f, "k", { contractTradeIds: ["abc"] }));
  });
});
