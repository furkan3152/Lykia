/** Requests typed in Spanish, Portuguese, French or Chinese reach the reader as the English it parses (escaped like the Turkish tests). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inputLanguage, intentEnglish, readerEnglish } from "../vocabulary.js";

describe("multilingual reader vocabulary", () => {
  it("tells the languages apart", () => {
    assert.equal(inputLanguage("Convierte 200 USDC a EURC"), "es");
    assert.equal(inputLanguage("Qual é o meu saldo?"), "pt-BR");
    assert.equal(inputLanguage("Convertis 200 USDC en EURC"), "fr");
    assert.equal(inputLanguage("把 200 USDC 兑换成 EURC"), "zh-CN");
    assert.equal(inputLanguage("Convert 200 USDC to EURC"), null);
  });

  it("rewrites the common moves", () => {
    assert.match(readerEnglish("Convierte 200 USDC a EURC"), /^convert 200 USDC to EURC$/iu);
    assert.match(readerEnglish("Converta 200 USDC para EURC"), /^convert 200 USDC to EURC$/iu);
    assert.match(readerEnglish("Convertis 200 USDC en EURC"), /^convert 200 USDC to EURC$/iu);
    assert.match(readerEnglish("把 200 USDC 兑换成 EURC"), /^convert 200 USDC to EURC$/iu);
    assert.match(intentEnglish("Que peux-tu faire ?"), /what can you do/iu);
  });

  it("leaves English and Turkish to their own readers", () => {
    assert.equal(readerEnglish("Bridge 50 USDC to Base"), "Bridge 50 USDC to Base");
    assert.match(readerEnglish("200 USDC'yi EURC'ye çevir"), /convert/iu);
  });
});
