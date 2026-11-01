import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAmount, readSentence } from "../language/reader.js";

const ADDR = "0x1111111111111111111111111111111111111111";

describe("language reader", () => {
  it("reads English payments with memos", () => {
    const r = readSentence(`send 20 USDC to ${ADDR} for invoice 4411`);
    assert.deepEqual(r.actions, [{ verb: "send", token: "USDC", amount: { exact: "20" }, to: ADDR, memo: "invoice 4411" }]);
  });

  it("reads shares, venues, possessives and memos", () => {
    assert.deepEqual(readSentence("deposit half into Morpho").actions, [{ verb: "earn", token: "USDC", amount: { percent: 50 }, venue: "morpho-vaults" }]);
    assert.deepEqual(readSentence("convert 100 USDC to EURC").actions, [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }]);
    assert.deepEqual(readSentence("bridge 50 usdc to base").actions, [{ verb: "bridge", token: "USDC", amount: { exact: "50" }, destination: "base" }]);
    assert.deepEqual(readSentence(`pay ${ADDR} 20 USDC for order 12`).actions[0], { verb: "send", token: "USDC", amount: { exact: "20" }, to: ADDR, memo: "order 12" });
    assert.deepEqual(readSentence("withdraw everything").actions, [{ verb: "withdraw", token: "USDC", amount: { all: true } }]);
  });

  it("chains clauses and inherits the rest", () => {
    const r = readSentence("bridge 50 usdc to base then earn the rest");
    assert.deepEqual(r.actions, [
      { verb: "bridge", token: "USDC", amount: { exact: "50" }, destination: "base" },
      { verb: "earn", token: "USDC", amount: { all: true } },
    ]);
  });

  it("refuses ambiguous amounts and asks", () => {
    assert.match(readAmount("send 1,5 usdc").problem ?? "", /ambiguous/u);
    assert.match(readAmount("send 1,500 usdc").problem ?? "", /thousands/u);
    const r = readSentence("send usdc");
    assert.equal(r.actions.length, 0);
    assert.ok(r.clarify.length > 0);
  });

  it("separates slippage from the amount", () => {
    assert.deepEqual(readSentence("swap 10 usdc to cirbtc with 1% slippage").actions, [{ verb: "swap", from: "USDC", to: "cirBTC", amount: { exact: "10" }, slippageBps: 100 }]);
  });

  it("recognises sheepdog commands and hidden words first", () => {
    assert.equal(readSentence("lie down").command, "lie down");
    assert.equal(readSentence("Lykaion").easterEgg, "lykaion");
  });
});
