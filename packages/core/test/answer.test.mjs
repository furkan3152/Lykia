import { test } from "node:test";
import assert from "node:assert/strict";
import { ANSWER_BLOCK_KINDS, CHAT_STEP_KINDS, gasShortfall, parseAnswerBlock, parseAnswerBlocks, parseChatStep, sourceLine } from "../dist/api/answer.js";
import { CHAT_EVENT_NAMES } from "../dist/api/agents.js";

const ADDR = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f";

test("the chat stream names its step and block events", () => {
  assert.ok(CHAT_EVENT_NAMES.includes("step"));
  assert.ok(CHAT_EVENT_NAMES.includes("block"));
  assert.deepEqual([...ANSWER_BLOCK_KINDS].sort(), ["balance", "capabilities", "facts", "fence", "gas", "herded", "offer", "order", "positions", "rate", "settled", "stress"]);
  assert.ok(CHAT_STEP_KINDS.includes("fence") && CHAT_STEP_KINDS.includes("route"));
});

test("answer blocks validate strictly and drop extra fields", () => {
  const gas = { kind: "gas", balance: "0.04", floor: "0.5", address: ADDR, gasPriceGwei: null };
  assert.deepEqual(parseAnswerBlock({ ...gas, script: "<script>" }), gas);
  assert.equal(parseAnswerBlock({ ...gas, balance: "1e9" }), null);
  assert.equal(parseAnswerBlock({ ...gas, address: "0xnot" }), null);
  assert.equal(parseAnswerBlock({ kind: "herded", items: [{ kind: "order", label: "x", saved: false, href: "https://evil.example/app", next: null }] }), null);
  assert.equal(parseAnswerBlock({ kind: "fence", decision: "allow", rules: [{ rule: "caps.step", message: "x" }] }), null);
  assert.equal(parseAnswerBlocks([gas, gas, gas, gas, gas, gas, gas]).length, 6);
  assert.equal(gasShortfall(gas), "0.46");
});

test("chat steps validate strictly", () => {
  const step = { id: "s1", kind: "wallet", label: "Reading the wallet", state: "ok", result: "4 holdings", ms: 612.4 };
  assert.deepEqual(parseChatStep(step), { ...step, ms: 612 });
  assert.equal(parseChatStep({ ...step, state: "done" }), null);
  assert.equal(parseChatStep({ ...step, kind: "magic" }), null);
});

test("the positions block validates its rows and states", () => {
  const block = { kind: "positions", netUsd: "18471.2", weightedApyPercent: "0.62", lowestHealth: "1.1999", rows: [{ venue: "Aave V4", label: "Aave V4 Forex Spoke · USDC borrowed", state: "at-risk", valueUsd: "-50607.15", doing: "At risk: health 1.20, under your 1.5 floor · liquidation at 1.00" }], unavailable: ["Morpho Blue"] };
  assert.deepEqual(parseAnswerBlock({ ...block, extra: 1 }), block);
  assert.equal(parseAnswerBlock({ ...block, rows: [{ ...block.rows[0], state: "on-fire" }] }), null);
  assert.equal(parseAnswerBlock({ ...block, netUsd: "lots" }), null);
});

test("cards carry where their figures came from, and sourced facts validate strictly", () => {
  const from = { source: "Arc chain · native USDC", readAt: "2026-11-09T10:00:00.000Z", block: "29857405" };
  const gas = { kind: "gas", balance: "0.04", floor: "0.5", address: ADDR, gasPriceGwei: null, from };
  assert.deepEqual(parseAnswerBlock(gas), gas);
  assert.equal(parseAnswerBlock({ ...gas, from: { ...from, block: "29.8k" } }), null);
  assert.equal(parseAnswerBlock({ ...gas, from: { ...from, readAt: "yesterday" } }), null);
  const facts = { kind: "facts", title: "Your Fold, read now", note: null, rows: [{ label: "Net worth", value: "$15,470.41", from }, { label: "EURC price", value: "unavailable", note: "stale", from: { ...from, block: null, stale: "EURC/USD round is 30 h old, past its 26 h heartbeat" } }] };
  assert.deepEqual(parseAnswerBlock(facts), facts);
  assert.equal(parseAnswerBlock({ ...facts, rows: [{ label: "Net worth", value: "$1" }] }), null, "a fact without a source is refused");
  assert.equal(sourceLine(from), "Arc chain · native USDC · block 29857405");
  assert.equal(sourceLine({ ...from, block: null, stale: "old round" }), "Arc chain · native USDC · 10:00 UTC · stale: old round");
});

test("an order block keeps its verdict and the inputs to rebuild it, nothing else", () => {
  const order = { kind: "order", summary: "Stop-loss: sell 0.01 cirBTC for USDC when BTC/USD falls to 60000", environment: "mainnet", decision: "allow", reasons: [], perExecution: { fee: "0.0001", swapped: "0.00989", minOut: "583.2", symbolIn: "cirBTC", symbolOut: "USDC" }, approval: "Approve 0.01 cirBTC for LykiaOrders", executions: 1, input: { kind: "stop-loss", sell: "cirBTC", buy: "USDC", amount: "0.01", triggerPrice: "60000" } };
  assert.deepEqual(parseAnswerBlock({ ...order, typedData: { evil: true } }), order);
  assert.equal(parseAnswerBlock({ ...order, input: { ...order.input, kind: "martingale" } }), null);
  assert.equal(parseAnswerBlock({ ...order, decision: "maybe" }), null);
});
