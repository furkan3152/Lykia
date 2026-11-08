import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_FENCE, evaluateFence, outrunOf, type IntentGraph } from "@lykia/core";
import type { PrepareStepResponse, SubmitStepResponse } from "@lykia/core/api/intents";

import { ApiError } from "../../../lib/apiErrors";
import { coverageSummary, LYKIA_ROLE } from "../../ecosystem/model";
import { sendSequentially } from "../../wallet/sequence";
import type { WalletTx } from "../../wallet/useLykiaWallet";
import { reviewView } from "../reviewModel";
import { isQuoteStale, QUOTE_TTL_MS, signStep, StepFlowError, submitWithRetry, type StepEffects } from "../stepFlow";
import { classifyTxError } from "../txErrors";

const OWNER = "0x1111111111111111111111111111111111111111";
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const H1 = `0x${"a".repeat(64)}` as const;
const H2 = `0x${"b".repeat(64)}` as const;

const tx = (label: string, chainId = 5042): WalletTx & { label: string } => ({ to: USDC, data: "0x", value: "0", chainId, label });
const prepared = (n = 2): PrepareStepResponse => ({ stepId: "s1", transactions: Array.from({ length: n }, (_, i) => ({ ...tx(`call ${i}`), from: OWNER })), binding: "sha256:x", memo: "lykia:1:out_1:s1:0123456789abcdef" }) as unknown as PrepareStepResponse;
const settled = (status: "settled" | "failed" = "settled"): SubmitStepResponse => ({ step: { id: "s1", status, ...(status === "failed" ? { failure: { code: "RECEIPT_REVERTED", message: "The transaction reverted on Arc.", retryable: false } } : {}) }, outrun: {} }) as unknown as SubmitStepResponse;

function effects(over: Partial<StepEffects> = {}): StepEffects & { log: string[] } {
  const log: string[] = [];
  let t = 1_000_000;
  return {
    log,
    prepare: async () => (log.push("prepare"), prepared()),
    ensureChain: async (id) => void log.push(`chain:${id}`),
    send: async () => (log.push("send"), { hashes: [H1, H2] }),
    submit: async () => (log.push("submit"), settled()),
    sleep: async (ms) => void log.push(`sleep:${ms}`),
    now: () => (t += 1),
    ...over,
  };
}

describe("transaction failures in plain words", () => {
  it("classifies wallet, chain, gas, revert, quote and RPC failures with the right retry", () => {
    const rejected = classifyTxError(Object.assign(new Error("User rejected the request."), { name: "UserRejectedRequestError", code: 4001 }), "sign");
    assert.equal(rejected.kind, "rejected");
    assert.equal(rejected.retry, "sign-again");
    assert.match(rejected.detail, /Nothing was sent/u);

    const chain = classifyTxError({ name: "ChainMismatchError", shortMessage: "The current chain of the wallet (id: 1) does not match the target chain for the transaction (id: 5042)." }, "chain", { network: "Arc mainnet" });
    assert.equal(chain.kind, "chain");
    assert.equal(chain.retry, "switch-chain");
    assert.match(chain.detail, /Arc mainnet/u);
    assert.equal(classifyTxError({ code: 4902, message: "Unrecognized chain ID" }, "chain").kind, "chain");

    const gas = classifyTxError({ name: "InsufficientFundsError", shortMessage: "The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account." }, "sign");
    assert.equal(gas.kind, "gas");
    assert.match(gas.detail, /gas in USDC/u);

    const revert = classifyTxError({ name: "EstimateGasExecutionError", shortMessage: "Execution reverted with reason: STF." }, "sign");
    assert.equal(revert.kind, "revert");
    assert.equal(revert.sent, false);
    assert.match(revert.detail, /Nothing was sent/u);

    const quote = classifyTxError(new ApiError({ code: "NO_ROUTE", message: "The price moved past the planned minimum; plan again.", status: 422 }), "prepare");
    assert.equal(quote.kind, "quote");
    assert.equal(quote.retry, "replan");

    const rpc = classifyTxError(new ApiError({ code: "NETWORK_ERROR", message: "Could not reach the Lykia API." }), "prepare");
    assert.equal(rpc.kind, "rpc");
    assert.equal(rpc.retry, "sign-again");
    assert.equal(classifyTxError({ name: "HttpRequestError", shortMessage: "HTTP request failed." }, "sign").kind, "rpc");

    const confirm = classifyTxError(new ApiError({ code: "CONFIRMATION_REQUIRED", message: "The Fence asks the owner to confirm this plan.", status: 409 }), "prepare");
    assert.equal(confirm.retry, "confirm");
  });

  it("never asks to sign again once something was sent", () => {
    const lagging = classifyTxError(new ApiError({ code: "NOT_FOUND", message: "Arc does not know 0xabc yet. Submit again once it is broadcast.", status: 404 }), "submit");
    assert.equal(lagging.retry, "resubmit");
    assert.equal(lagging.sent, true);
    const onChain = classifyTxError(Object.assign(new Error("execution reverted: Approve reverted on Arc"), { onChain: true }), "sign");
    assert.equal(onChain.sent, true);
    assert.equal(onChain.retry, "replan");
    const partial = classifyTxError(Object.assign(new Error("User rejected the request."), { code: 4001, partialHashes: [H1] }), "sign");
    assert.match(partial.detail, /approval\) went through/u);
  });
});

describe("one step, quote to settled", () => {
  it("re-quotes a stale quote before signing, switches the chain, sends and submits", async () => {
    const e = effects();
    const phases: string[] = [];
    const result = await signStep(e, { stepId: "s1", confirmed: false, prepared: { response: prepared(), at: 0 } }, { onPhase: (p) => phases.push(p) });
    assert.equal(result.step.status, "settled");
    assert.deepEqual(e.log, ["prepare", "chain:5042", "send", "submit"]);
    assert.deepEqual(phases, ["quoting", "quoted", "switching", "signing", "submitting", "settled"]);
    assert.equal(isQuoteStale({ response: prepared(), at: 1000 }, 1000 + QUOTE_TTL_MS + 1), true);
    assert.equal(isQuoteStale({ response: prepared(), at: 1000 }, 1000 + 5), false);
  });

  it("signs a fresh quote without preparing again", async () => {
    const e = effects();
    await signStep(e, { stepId: "s1", confirmed: false, prepared: { response: prepared(), at: e.now() } });
    assert.deepEqual(e.log, ["chain:5042", "send", "submit"]);
  });

  it("resubmits what the wallet already sent instead of signing again", async () => {
    const e = effects();
    await signStep(e, { stepId: "s1", confirmed: false, sent: { hashes: [H1, H2] } });
    assert.deepEqual(e.log, ["submit"]);
  });

  it("waits out a node that has not seen the transaction yet", async () => {
    let calls = 0;
    const e = effects({
      submit: async () => {
        calls += 1;
        if (calls < 3) throw new ApiError({ code: "NOT_FOUND", message: "Arc does not know 0xaa yet. Submit again once it is broadcast.", status: 404 });
        return settled();
      },
    });
    const result = await submitWithRetry(e, "s1", { hashes: [H1] });
    assert.equal(result.step.status, "settled");
    assert.equal(calls, 3);
    assert.deepEqual(e.log, ["sleep:800", "sleep:1500"]);
  });

  it("reports a wallet rejection, a chain refusal and a reverted receipt as classified failures", async () => {
    await assert.rejects(signStep(effects({ send: async () => Promise.reject(Object.assign(new Error("User rejected the request."), { code: 4001 })) }), { stepId: "s1", confirmed: false }), (e: unknown) => e instanceof StepFlowError && e.failure.kind === "rejected");
    await assert.rejects(signStep(effects({ ensureChain: async () => Promise.reject(Object.assign(new Error("Unrecognized chain."), { code: 4902 })) }), { stepId: "s1", confirmed: false, network: "Arc mainnet" }), (e: unknown) => e instanceof StepFlowError && e.failure.kind === "chain");
    await assert.rejects(signStep(effects({ submit: async () => settled("failed") }), { stepId: "s1", confirmed: false }), (e: unknown) => e instanceof StepFlowError && e.failure.kind === "revert" && e.failure.sent);
  });
});

describe("browser wallet sequencing", () => {
  it("waits for each receipt before the next call and switches chain once", async () => {
    const log: string[] = [];
    let chain = 1;
    const hashes = await sendSequentially([tx("approve"), tx("swap")], {
      currentChainId: () => chain,
      switchChain: async (id) => {
        log.push(`switch:${id}`);
        chain = id;
      },
      sendOne: async (t) => (log.push(`send:${t.label}`), t.label === "approve" ? H1 : H2),
      waitFor: async (h) => (log.push(`wait:${h === H1 ? 1 : 2}`), { status: "success" as const }),
    });
    assert.deepEqual(hashes, [H1, H2]);
    assert.deepEqual(log, ["switch:5042", "send:approve", "wait:1", "send:swap", "wait:2"]);
  });

  it("stops after a reverted approval, and returns a reverted last call for submit to record", async () => {
    const base = { currentChainId: () => 5042, switchChain: async () => undefined };
    await assert.rejects(
      sendSequentially([tx("approve"), tx("swap")], { ...base, sendOne: async () => H1, waitFor: async () => ({ status: "reverted" as const }) }),
      (e: unknown) => (e as { onChain?: boolean }).onChain === true,
    );
    const last = await sendSequentially([tx("approve"), tx("swap")], { ...base, sendOne: async (t) => (t.label === "approve" ? H1 : H2), waitFor: async (h) => ({ status: h === H2 ? ("reverted" as const) : ("success" as const) }) });
    assert.deepEqual(last, [H1, H2]);
    await assert.rejects(
      sendSequentially([tx("approve"), tx("swap")], { ...base, sendOne: async (t) => (t.label === "approve" ? H1 : Promise.reject(Object.assign(new Error("User rejected the request."), { code: 4001 }))), waitFor: async () => ({ status: "success" as const }) }),
      (e: unknown) => Array.isArray((e as { partialHashes?: unknown }).partialHashes),
    );
  });
});

function plan(): IntentGraph {
  const verdict = evaluateFence(DEFAULT_FENCE, { environment: "mainnet", signer: "wallet", owner: OWNER, steps: [], spent: { dayUsd: "0", weekUsd: "0" }, now: 0 });
  return {
    spec: "lykia.intent/v1", id: "out_rv1", environment: "mainnet", createdAt: "2026-11-06T00:00:00Z", source: "t", owner: OWNER, verdict, warnings: [],
    steps: [
      { id: "s1", kind: "fx", venue: "uniswap-v4", summary: "Convert 1 USDC", signer: "wallet", account: OWNER, dependsOn: [], inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "1000000", usd: "1.00" }], outputs: [{ symbol: "EURC", token: EURC, decimals: 6, amount: "885278", minimum: "880851", usd: "0.99" }], settlement: { kind: "receipt" }, fee: { bps: 100, recipient: OWNER, symbol: "USDC", token: USDC, decimals: 6, amount: "10000", usd: "0.01", basis: "input" }, status: "settled", references: [H1] },
      { id: "s2", kind: "deposit", venue: "aave-v4", summary: "Deposit EURC", signer: "wallet", account: OWNER, dependsOn: ["s1"], inputs: [{ symbol: "EURC", token: EURC, decimals: 6, amount: "885278", usd: "0.99" }], outputs: [{ symbol: "EURC@aave-v4", token: EURC, decimals: 6, amount: "872042", usd: "0.98" }], settlement: { kind: "receipt" }, route: { chosen: { venue: "aave-v4", label: "Aave V4 Main Spoke EURC", risk: "medium", executable: true, notes: [] }, alternatives: [], reason: "Compared 5 venues: …" }, fee: { bps: 100, recipient: OWNER, symbol: "EURC", token: EURC, decimals: 6, amount: "8852", usd: "0.01", basis: "input" }, status: "ready" },
    ],
  } as IntentGraph;
}

describe("review view model", () => {
  it("shows what you send, what you get, memos, fees and the next step", () => {
    const g = plan();
    const v = reviewView(g, outrunOf(g));
    assert.deepEqual(v.send.map((f) => `${f.amount} ${f.symbol}`), ["1 USDC"]);
    assert.deepEqual(v.get.map((f) => `${f.amount} ${f.symbol} ${f.where}`), ["0.872042 EURC in Aave V4 Main Spoke EURC"]);
    assert.equal(v.steps.length, 2);
    assert.match(v.steps[0]!.memo, /^lykia:1:out_rv1:s1:[0-9a-f]{16}$/u);
    assert.deepEqual(v.fees, ["0.01 USDC", "0.008852 EURC"]);
    assert.equal(v.feeBps, 100);
    assert.equal(v.nextStepId, "s2");
    assert.equal(v.stage, "running");
    assert.equal(v.settledCount, 1);
    assert.equal(v.lastTx, H1);
  });
});

describe("ecosystem coverage copy", () => {
  it("states both numbers from the API's counts and labels each status", () => {
    assert.equal(coverageSummary({ protocols: 94, verified: 42, routable: 9, tvlUsd: null, routed: { intents: 0, steps: 0, usd: "0", window: "" } }), "9 protocols Lykia can route through today · 94 protocols mapped on Arc");
    assert.equal(coverageSummary(undefined), null);
    assert.deepEqual(Object.values(LYKIA_ROLE).map((r) => r.label), ["ROUTABLE", "READ-ONLY", "MAPPED"]);
  });
});
