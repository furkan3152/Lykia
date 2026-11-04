import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { budgetUsed, cityAccent, shellFor, usdc18 } from "../model";

const city = (category: string, state = "live", colors: Record<string, string> = {}) => ({ league: { category, state }, project: { brand: { colors } } }) as never;

describe("city shells", () => {
  it("picks a task-first shell per city", () => {
    assert.equal(shellFor(city("payments")), "pay");
    assert.equal(shellFor(city("agents")), "agents");
    assert.equal(shellFor(city("trading", "coming")), "coming");
    assert.equal(shellFor(city("payments", "coming")), "coming");
    assert.equal(shellFor(city("tools")), "generic");
  });

  it("takes the accent from the project brand", () => {
    assert.deepEqual(cityAccent(city("payments", "live", { primary: "#b9472e", accent: "#5f8a3a" })), { primary: "#b9472e", accent: "#5f8a3a" });
    assert.deepEqual(cityAccent(city("payments", "live", { primary: "red" })), { primary: "#1e8fa3", accent: "#d9a441" });
  });

  it("formats balances and budget meters without float surprises", () => {
    assert.equal(usdc18("0"), "0.00");
    assert.equal(usdc18("12500000000000000000"), "12.50");
    assert.equal(usdc18("1234567000000000000000000"), "1,234,567.00");
    assert.equal(budgetUsed("25", "100"), 0.25);
    assert.equal(budgetUsed("250", "100"), 1);
    assert.equal(budgetUsed(undefined, undefined), 0);
  });
});
