import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectLang, readAmount, readSentence, stripSuffix } from "../language/reader.js";

const ADDR = "0x1111111111111111111111111111111111111111";

describe("language reader", () => {
  it("reads English payments with memos", () => {
    const r = readSentence(`send 20 USDC to ${ADDR} for invoice 4411`);
    assert.deepEqual(r.actions, [{ verb: "send", token: "USDC", amount: { exact: "20" }, to: ADDR, memo: "invoice 4411" }]);
    assert.equal(r.lang, "en");
  });

  it("reads Turkish: shares, venues, suffixes and memos", () => {
    assert.deepEqual(readSentence("yarısını Morpho'ya yatır").actions, [{ verb: "earn", token: "USDC", amount: { percent: 50 }, venue: "morpho-vaults" }]);
    assert.deepEqual(readSentence("100 USDC'yi EURC'ye çevir").actions, [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }]);
    assert.deepEqual(readSentence("50 usdc'yi base'e köprüle").actions, [{ verb: "bridge", token: "USDC", amount: { exact: "50" }, destination: "base" }]);
    assert.deepEqual(readSentence(`20 USDC'yi ${ADDR} adresine fatura 12 için gönder`).actions[0], { verb: "send", token: "USDC", amount: { exact: "20" }, to: ADDR, memo: "fatura 12" });
    assert.deepEqual(readSentence("hepsini çek").actions, [{ verb: "withdraw", token: "USDC", amount: { all: true } }]);
    assert.equal(detectLang("hepsini çek"), "tr");
    assert.equal(stripSuffix("USDC'yi"), "USDC");
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
