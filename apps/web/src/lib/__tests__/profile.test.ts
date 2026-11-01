import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_PROFILE, moveWidget, sanitizeProfile, WIDGETS } from "../profile";
import { DEFAULT_LOOK, lookPalette } from "../../mosaic/sprites";

describe("profile", () => {
  it("fills gaps and drops junk", () => {
    const p = sanitizeProfile({ language: "xx", currency: "EUR", slippageBps: 5000, widgets: ["pulse", "nope"], look: { tag: "BOZ" } });
    assert.equal(p.language, DEFAULT_PROFILE.language);
    assert.equal(p.currency, "EUR");
    assert.equal(p.slippageBps, DEFAULT_PROFILE.slippageBps);
    assert.equal(p.widgets[0], "pulse");
    assert.equal(p.widgets.length, WIDGETS.length);
    assert.equal(p.look.tag, "BOZ");
    assert.equal(p.look.coat, DEFAULT_LOOK.coat);
  });

  it("reorders widgets by drag", () => {
    assert.deepEqual(moveWidget(["flock", "insights", "pack"], "pack", 0), ["pack", "flock", "insights"]);
    assert.deepEqual(moveWidget(["flock", "insights", "pack"], "flock", 9), ["insights", "pack", "flock"]);
  });

  it("paints Lyko's look into the palette", () => {
    const pal = lookPalette({ collar: "#1E8FA3", coat: "white", tag: "X" });
    assert.equal(pal.r, "#1E8FA3");
    assert.notEqual(pal.f, lookPalette(DEFAULT_LOOK).f);
    assert.equal(lookPalette({ collar: "nope", coat: "cream", tag: "" }).r, DEFAULT_LOOK.collar);
  });
});
