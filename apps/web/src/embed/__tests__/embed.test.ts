import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { brandFromQuery, parentAllowed } from "../helpers";

describe("embed pages", () => {
  it("take only checked appearance values from the frame URL", () => {
    const brand = brandFromQuery(new URLSearchParams("primary=%230f766e&accent=red&scheme=dark&radius=40&mosaic=off"));
    assert.deepEqual(brand, { colors: { primary: "#0f766e" }, scheme: "dark", mosaic: false });
  });
  it("run only inside the project's verified origins (and local hosts)", () => {
    const view = { frameAncestors: ["https://shop.example"] };
    assert.equal(parentAllowed("https://shop.example", view), true);
    assert.equal(parentAllowed("https://evil.example", view), false);
    assert.equal(parentAllowed("http://localhost:5173", view), true);
    assert.equal(parentAllowed("http://localhost.evil.example", view), false);
  });
});
