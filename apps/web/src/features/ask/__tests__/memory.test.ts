import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { insertMention, matchContacts, memoryBadges, mentionAt } from "../memoryRefs";

const contacts = [{ name: "ayse", address: "0x1", confirmed: true }, { name: "ali", address: "0x2", confirmed: false }, { name: "supplier", address: "0x3", confirmed: true }];

describe("memory references", () => {
  it("finds the @mention at the caret", () => {
    assert.deepEqual(mentionAt("send 20 USDC to @a", 18), { start: 16, query: "a" });
    assert.equal(mentionAt("email me@x", 10), null);
    assert.equal(mentionAt("send 20", 7), null);
  });

  it("matches confirmed contacts first and inserts the name", () => {
    assert.deepEqual(matchContacts(contacts, "a").map((c) => c.name), ["ayse", "ali"]);
    const r = insertMention("pay @ay now", 4, 7, "ayse");
    assert.equal(r.text, "pay @ayse  now");
    assert.equal(r.caret, 10);
  });

  it("reads memory badges from steps and proposals", () => {
    assert.deepEqual(memoryBadges({ memory: ["@ayse", { label: "same as last week" }, 3] }), ["@ayse", "same as last week"]);
    assert.deepEqual(memoryBadges({}), []);
  });
});
