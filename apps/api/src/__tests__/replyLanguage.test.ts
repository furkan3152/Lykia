/**
 * Lyko replies in the owner's interface language whatever language the
 * owner writes in, and still understands the request. Turkish strings are
 * written as Unicode escapes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FOLD_PREFERENCES, DEFAULT_PROFILE, foldPreferenceEffects, mergeFoldPreferences, validateFoldPreferences, validateProfile, fromWebProfile } from "@lykia/core";
import { LYKO_SYSTEM } from "../agents/orchestrator.js";
import { ENGLISH_REPLY_RULE, REPLY_LANGUAGE, replyLanguageRule, withReplyLanguage } from "../language/replyLanguage.js";
import { readSentence } from "../language/reader.js";
import { looksTurkish, turkishToEnglish } from "../language/turkish.js";

const ADDR = "0x2222222222222222222222222222222222222222";
/** Letters Turkish uses and English does not. */
const TURKISH_LETTERS = /[\u00e7\u011f\u0131\u015f\u00f6\u00fc\u00c7\u011e\u0130\u015e\u00d6\u00dc]/u;

// "100 USDC'yi EURC'ye cevir" with its Turkish letters.
const CONVERT_TR = "100 USDC'yi EURC'ye \u00e7evir";
// "1 USDC ile EURC al ve en iyi getiriyle borc ver": buy EURC with 1 USDC and lend it at the best yield.
const BUY_AND_LEND_TR = "1 USDC ile EURC al ve en iyi getiriyle bor\u00e7 ver";
// "50 USDC'yi <address> ..." with the Turkish verb for send.
const SEND_TR = `50 USDC'yi ${ADDR} adres\u0069ne g\u00f6nder`;

describe("Replies in the interface language", () => {
  it("every model prompt carries the reply-language rule, filled in per request", () => {
    assert.ok(LYKO_SYSTEM.includes(REPLY_LANGUAGE));
    assert.doesNotMatch(LYKO_SYSTEM, /language the user writes in|reply in the language/iu);
    assert.ok(withReplyLanguage(LYKO_SYSTEM, "en").includes(ENGLISH_REPLY_RULE));
    const turkish = withReplyLanguage(LYKO_SYSTEM, "tr");
    assert.ok(turkish.includes(replyLanguageRule("tr")));
    assert.match(turkish, /whole reply in Turkish/u);
    assert.ok(!turkish.includes(REPLY_LANGUAGE));
    for (const locale of ["es", "pt-BR", "zh-CN", "fr"] as const) assert.match(withReplyLanguage(LYKO_SYSTEM, locale), /never mix in English/u);
  });

  it("reads common Turkish requests and answers in English", () => {
    assert.equal(looksTurkish(CONVERT_TR), true);
    assert.equal(looksTurkish("convert 100 USDC to EURC"), false);
    assert.deepEqual(readSentence(CONVERT_TR).actions, [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }]);
    assert.deepEqual(readSentence(SEND_TR).actions, [{ verb: "send", token: "USDC", amount: { exact: "50" }, to: ADDR }]);
    const chained = readSentence(BUY_AND_LEND_TR);
    assert.deepEqual(chained.actions, [
      { verb: "fx", from: "USDC", to: "EURC", amount: { exact: "1" } },
      { verb: "earn", token: "EURC", amount: { previous: true } },
    ]);
    assert.match(turkishToEnglish(BUY_AND_LEND_TR), /^buy EURC with 1 USDC and .*lend it$/u);
    for (const text of [CONVERT_TR, BUY_AND_LEND_TR, SEND_TR, "merhaba"]) {
      const reply = readSentence(text).reply;
      assert.doesNotMatch(reply, TURKISH_LETTERS, `${text} -> ${reply}`);
    }
  });

  it("reads 'buy X with Y' as spending Y for X", () => {
    assert.deepEqual(readSentence("buy EURC with 1 USDC and lend it at the best yield").actions, [
      { verb: "fx", from: "USDC", to: "EURC", amount: { exact: "1" } },
      { verb: "earn", token: "EURC", amount: { previous: true } },
    ]);
    assert.deepEqual(readSentence("buy cirBTC with 50 USDC").actions, [{ verb: "swap", from: "USDC", to: "cirBTC", amount: { exact: "50" } }]);
    assert.deepEqual(readSentence("buy 20 EURC").actions, [{ verb: "swap", from: "USDC", to: "EURC", amount: { exact: "20" } }]);
  });

  it("drops the reply-language preference and ignores a stored one", () => {
    assert.equal("replyLanguage" in DEFAULT_FOLD_PREFERENCES, false);
    assert.equal(foldPreferenceEffects(DEFAULT_FOLD_PREFERENCES).some((e) => /language/iu.test(e.text)), false);
    // An older document with a reply language still validates; the field is dropped.
    const old = { ...DEFAULT_FOLD_PREFERENCES, replyLanguage: "de" };
    const result = validateFoldPreferences(old);
    assert.equal(result.ok, true);
    assert.equal(result.ok && "replyLanguage" in result.preferences, false);
    const merged = mergeFoldPreferences(DEFAULT_FOLD_PREFERENCES, { replyLanguage: "tr", risk: "careful" }) as Record<string, unknown>;
    assert.equal("replyLanguage" in merged, false);
    assert.equal(merged.risk, "careful");
  });

  it("keeps the interface language in the profile: a supported one stays, anything else loads as English", () => {
    const stored = validateProfile({ ...DEFAULT_PROFILE, language: "tr" });
    assert.equal(stored.ok && stored.profile.language, "tr");
    const portuguese = validateProfile({ ...DEFAULT_PROFILE, language: "pt" });
    assert.equal(portuguese.ok && portuguese.profile.language, "pt-BR");
    const other = validateProfile({ ...DEFAULT_PROFILE, language: "de" });
    assert.equal(other.ok && other.profile.language, "en");
    assert.equal(fromWebProfile({ language: "fr", currency: "EUR" }, DEFAULT_PROFILE).language, "fr");
  });
});
