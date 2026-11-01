import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CIRCLE_CATALOG, normalizeCircle } from "../model";

describe("circle status", () => {
  it("keeps the full catalogue when the API is silent", () => {
    const list = normalizeCircle(undefined);
    assert.equal(list.length, CIRCLE_CATALOG.length);
    assert.ok(list.every((p) => p.status === "unknown"));
  });

  it("merges API statuses and keeps unknown products", () => {
    const list = normalizeCircle({ products: [{ id: "gateway", name: "Gateway", status: "keyless" }, { id: "new-thing", name: "New", status: "live" }, { id: "cctp", status: "weird" }] });
    assert.equal(list.find((p) => p.id === "gateway")?.status, "keyless");
    assert.equal(list.find((p) => p.id === "cctp")?.status, "unknown");
    assert.ok(list.some((p) => p.id === "new-thing"));
    assert.equal(normalizeCircle([{ id: "usyc", status: "needs-key" }]).find((p) => p.id === "usyc")?.status, "needs-key");
  });
});
