import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { arcDirection, KONAMI, konamiStep, resolveInput } from "../commands";

describe("whistle box resolution", () => {
  it("knows the shepherd commands", () => {
    const r = resolveInput("Come bye");
    assert.equal(r.kind, "command");
    if (r.kind === "command") assert.equal(r.action, "rescan");
    const lie = resolveInput("lie down!");
    assert.equal(lie.kind === "command" && lie.action, "whistle");
    assert.equal(resolveInput("That'll do").kind, "command");
  });

  it("finds hidden words and opens Arcadia for the right ones", () => {
    const egg = resolveInput("Lykaion");
    assert.equal(egg.kind, "egg");
    if (egg.kind === "egg") assert.equal(egg.href, "/lykaion");
    const fire = resolveInput("chimaera");
    assert.equal(fire.kind === "egg" && fire.href, null);
  });

  it("routes pages (EN and TR), tokens, agents and sentences", () => {
    assert.deepEqual(resolveInput("sürü"), { kind: "page", destination: "flock" });
    assert.deepEqual(resolveInput("çit"), { kind: "page", destination: "fence" });
    assert.deepEqual(resolveInput("0x3600000000000000000000000000000000000000"), { kind: "token", address: "0x3600000000000000000000000000000000000000" });
    assert.deepEqual(resolveInput("agent 12"), { kind: "agent", agentId: "12" });
    assert.deepEqual(resolveInput("bridge 50 USDC to base"), { kind: "sentence", text: "bridge 50 USDC to base" });
    assert.deepEqual(resolveInput("   "), { kind: "empty" });
  });

  it("maps commands to Lyko's arc direction", () => {
    assert.equal(arcDirection("rescan"), "cw");
    assert.equal(arcDirection("resniff"), "ccw");
    assert.equal(arcDirection("whistle"), null);
  });

  it("matches the Konami code", () => {
    let progress = 0;
    let done = false;
    for (const key of KONAMI) ({ progress, done } = konamiStep(progress, key === "b" || key === "a" ? key.toUpperCase() : key));
    assert.equal(done, true);
    assert.equal(konamiStep(3, "x").progress, 0);
  });
});
