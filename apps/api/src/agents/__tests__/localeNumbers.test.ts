/** Figures written the way each interface language writes them are read, checked and dropped the same way. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withLocale } from "../../i18n/context.js";
import { readNumber } from "../../language/numbers.js";
import { newGround, numbersIn } from "../grounding.js";
import { guardNumbers } from "../numberGuard.js";

describe("numbers in every interface language", () => {
  it("reads 1.234,56, 1 234,56 and 1,234.56 as the same value", () => {
    assert.deepEqual(readNumber("1.234,56", "tr"), { value: 1234.56, decimals: 2 });
    assert.deepEqual(readNumber("1 234,56", "fr"), { value: 1234.56, decimals: 2 });
    assert.deepEqual(readNumber("1 234,56", "fr"), { value: 1234.56, decimals: 2 });
    assert.deepEqual(readNumber("1,234.56", "en"), { value: 1234.56, decimals: 2 });
    assert.deepEqual(readNumber("1,234.56", "tr"), { value: 1234.56, decimals: 2 });
    assert.deepEqual(readNumber("1.234.567", "es"), { value: 1234567, decimals: 0 });
  });

  it("reads a lone separator by the language", () => {
    assert.deepEqual(readNumber("4,5", "tr"), { value: 4.5, decimals: 1 });
    assert.deepEqual(readNumber("1.234", "pt-BR"), { value: 1234, decimals: 0 });
    assert.deepEqual(readNumber("1.234", "en"), { value: 1.234, decimals: 3 });
    assert.deepEqual(readNumber("1,234", "en"), { value: 1234, decimals: 0 });
    assert.deepEqual(readNumber("1,234", "fr"), { value: 1.234, decimals: 3 });
  });

  it("keeps a long decimal whole", () => {
    withLocale("en", () => assert.ok(numbersIn("176.875776 USDC").has("176.875776")));
    withLocale("tr", () => assert.ok(numbersIn("176,875776 USDC").has("176.875776")));
  });

  it("collects the owner's numbers in their language", () => {
    withLocale("tr", () => assert.ok(numbersIn("2.500,75 USDC gönder").has("2500.75")));
    withLocale("fr", () => assert.ok(numbersIn("envoie 2 500,75 USDC").has("2500.75")));
    withLocale("zh-CN", () => assert.ok(numbersIn("发送 2,500.75 USDC").has("2500.75")));
  });

  for (const [locale, sourced, made] of [
    ["tr", "Fiyat 1.234,56 $ ve ücret %0,25.", "Getiri 9.876,54 $ olur."],
    ["es", "El precio es 1.234,56 $ y la comisión 0,25 %.", "Ganarás 9.876,54 $."],
    ["pt-BR", "O preço é US$ 1.234,56 e a taxa 0,25%.", "Você ganha US$ 9.876,54."],
    ["fr", "Le prix est de 1 234,56 $ et les frais 0,25 %.", "Vous gagnez 9 876,54 $."],
    ["zh-CN", "价格为 $1,234.56，费用 0.25%。", "你会赚 $9,876.54。"],
  ] as const) {
    it(`keeps sourced figures and drops made-up ones in ${locale}`, () => {
      withLocale(locale, () => {
        const ground = newGround("");
        ground.toolNumbers.add("1234.56");
        ground.toolNumbers.add("0.25");
        assert.deepEqual(guardNumbers(sourced, ground, []).removed, []);
        assert.equal(guardNumbers(made, ground, []).removed.length, 1);
      });
    });
  }
});

describe("sentences in every interface language", () => {
  it("splits Chinese and Spanish sentences", async () => {
    const { sentencesOf } = await import("../numberGuard.js");
    assert.deepEqual(sentencesOf("价格为 $1.00。费用为零！好吗？"), ["价格为 $1.00。", "费用为零！", "好吗？"]);
    assert.deepEqual(sentencesOf("Listo. ¿Firmas ahora?"), ["Listo.", "¿Firmas ahora?"]);
  });
});
