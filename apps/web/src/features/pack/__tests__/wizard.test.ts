import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupViolations, validateWizard, wizardFence, type WizardInput } from "../wizard";

const base: WizardInput = { name: "Payroll", role: "payroll", perIntentUsd: "", dailyUsd: "300", weeklyUsd: "", mission: "" };

describe("spawn-a-pup wizard", () => {
  it("accepts a sound pup and refuses bad input", () => {
    assert.deepEqual(validateWizard(base), []);
    const issues = validateWizard({ ...base, name: " ", dailyUsd: "3,00" });
    assert.ok(issues.some((i) => i.field === "name"));
    assert.ok(issues.some((i) => i.field === "dailyUsd"));
  });

  it("refuses caps above the parent's free budget", () => {
    const issues = validateWizard({ ...base, dailyUsd: "900" }, { dailyUsd: "500" });
    assert.equal(issues[0]!.field, "dailyUsd");
    assert.match(issues[0]!.message, /\$500/u);
  });

  it("builds the child fence from the role template", () => {
    const fence = wizardFence(base);
    assert.equal(fence?.schema, "lykia.fence/v1");
    assert.equal(fence?.caps?.dailyUsd, "300");
    assert.equal(wizardFence({ ...base, role: "custom" }), undefined);
  });

  it("groups API violations by field", () => {
    const g = groupViolations([{ path: "caps.dailyUsd", message: "too high" }, { path: "venues.allow.2", message: "not in parent" }, { path: "budget.weeklyUsd", message: "no room" }]);
    assert.deepEqual(g.dailyUsd, ["too high"]);
    assert.deepEqual(g.venues, ["not in parent"]);
    assert.deepEqual(g.weeklyUsd, ["no room"]);
  });
});
