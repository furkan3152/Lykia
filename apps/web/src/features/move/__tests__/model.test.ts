import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canReadContacts } from "../model";

describe("move model", () => {
  it("reads the address book only with a live session for the connected wallet", () => {
    const owner = "0x8c5281055b197443ff01dbbdfbf29fd63946ca1e";
    const live = { address: owner.toUpperCase().replace("0X", "0x"), expiresAt: "2999-01-01T00:00:00.000Z" };
    assert.equal(canReadContacts(owner, live), true);
    assert.equal(canReadContacts(owner, null), false, "a connected wallet without a session gets a 401");
    assert.equal(canReadContacts(owner, { ...live, address: "0x1111111111111111111111111111111111111111" }), false);
    assert.equal(canReadContacts(owner, { ...live, expiresAt: "2000-01-01T00:00:00.000Z" }), false);
    assert.equal(canReadContacts(null, live), false);
  });
});
