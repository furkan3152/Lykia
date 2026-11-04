import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { actionsFor } from "../model";

const base = { schema: "lykia.league/v1", status: "community", listed: false, state: "live", review: "requested", featured: false, slug: "acme", emblem: "lyre", tagline: "A city of the League", category: "tools" } as const;

describe("League council", () => {
  it("offers only the decisions that apply", () => {
    assert.deepEqual(actionsFor(base), ["approve", "reject", "pause"]);
    assert.deepEqual(actionsFor({ ...base, review: "approved", listed: true }), ["feature", "delist", "pause"]);
    assert.deepEqual(actionsFor({ ...base, review: "approved", listed: true, featured: true, state: "paused" }), ["unfeature", "delist", "resume"]);
    assert.deepEqual(actionsFor({ ...base, status: "official", review: "approved", listed: true, state: "coming" }), ["feature", "delist", "pause", "launch"]);
    assert.deepEqual(actionsFor({ ...base, status: "official", review: "approved", listed: false }), ["relist", "pause"]);
  });
});
