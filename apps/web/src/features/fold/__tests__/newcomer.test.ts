import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isNewcomer, NEWCOMER } from "../newcomer";

const base = { signedIn: true, sample: false, running: 0, waiting: 0, agents: 0, leashes: 0, autopilot: false, trail: 0 };

describe("the Fold for a newcomer", () => {
  it("is a newcomer only when signed in and nothing of theirs exists yet", () => {
    assert.equal(isNewcomer(base), true);
    assert.equal(isNewcomer({ ...base, running: 1 }), false);
    assert.equal(isNewcomer({ ...base, leashes: 2 }), false);
    assert.equal(isNewcomer({ ...base, autopilot: true }), false);
    assert.equal(isNewcomer({ ...base, trail: 3 }), false);
  });

  it("is never the sample, a signed-out visitor, or a page still loading", () => {
    assert.equal(isNewcomer({ ...base, sample: true }), false);
    assert.equal(isNewcomer({ ...base, signedIn: false }), false);
    assert.equal(isNewcomer({ ...base, running: undefined }), false);
    assert.equal(isNewcomer({ ...base, autopilot: undefined }), false);
  });

  it("gives each tab one action", () => {
    for (const tab of ["herding", "pack", "fence"] as const) assert.ok(NEWCOMER[tab].action.length > 0 && NEWCOMER[tab].ask.length > 0);
  });
});
