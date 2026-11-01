import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FENCE, FENCE_TEMPLATES, ROLE_TEMPLATES, isSubFence, subFenceViolations, intersectFence, carveBudget, freeBudget, budgetOf, addBudget, subtreeIds, ancestorIds, sessionLimitsOf, fenceHash, validateFence } from "../dist/index.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const base = { schema: "lykia.fence/v1" };
const paths = (p, c) => subFenceViolations(p, c).map((v) => v.path);

test("equal fences are sub-fences; every template validates", () => {
  for (const f of [DEFAULT_FENCE, ...Object.values(FENCE_TEMPLATES)]) assert.ok(isSubFence(f, f), f.label);
  for (const r of Object.values(ROLE_TEMPLATES)) assert.equal(validateFence(r.fence).ok, true, r.role);
});

test("mode can only tighten", () => {
  assert.ok(isSubFence({ ...base, mode: "live" }, { ...base, mode: "whistle" }));
  assert.ok(isSubFence({ ...base, mode: "live" }, { ...base, mode: "dry-run" }));
  assert.ok(isSubFence({ ...base, mode: "whistle" }, { ...base, mode: "dry-run" }));
  assert.deepEqual(paths({ ...base, mode: "whistle" }, { ...base, mode: "live" }), ["mode"]);
  assert.deepEqual(paths({ ...base, mode: "dry-run" }, { ...base, mode: "whistle" }), ["mode"]);
});

test("lists: child subset, omission only when the parent omits", () => {
  for (const [key, inner, good, bad] of [
    ["environments", null, ["testnet"], ["mainnet"]],
    ["kinds", "allow", ["transfer"], ["borrow"]],
    ["venues", "allow", ["cctp"], ["uniswap-v3"]],
    ["tokens", "allow", ["USDC"], ["cirBTC"]],
    ["bridges", "destinations", ["base"], ["ethereum"]],
  ]) {
    const wrap = (v) => (inner ? { [key]: { [inner]: v } } : { [key]: v });
    const parent = { ...base, ...wrap(key === "environments" ? ["testnet"] : key === "kinds" ? ["transfer", "fx"] : key === "venues" ? ["cctp", "gateway"] : key === "tokens" ? ["USDC", "EURC"] : ["base", "arbitrum"]) };
    assert.ok(isSubFence(parent, { ...base, ...wrap(good) }), key);
    assert.ok(paths(parent, { ...base, ...wrap(bad) }).length > 0, `${key} extra`);
    assert.ok(paths(parent, base).length > 0, `${key} omitted`);
    assert.ok(isSubFence(base, { ...base, ...wrap(bad) }), `${key} free parent`);
  }
});

test("deny lists and unlisted tokens must be kept", () => {
  assert.deepEqual(paths({ ...base, venues: { deny: ["argus"] } }, base), ["venues.deny"]);
  assert.ok(isSubFence({ ...base, venues: { deny: ["argus"] } }, { ...base, venues: { deny: ["argus", "x-dex"] } }));
  assert.deepEqual(paths({ ...base, tokens: { unlisted: "deny" } }, { ...base, tokens: { unlisted: "allow" } }), ["tokens.unlisted"]);
  assert.deepEqual(paths({ ...base, recipients: { mode: "any", deny: [B] } }, { ...base, recipients: { mode: "any" } }), ["recipients.deny"]);
});

test("recipients: mode rank and allowlist subset", () => {
  const parent = { ...base, recipients: { mode: "allowlist", allow: [A] } };
  assert.ok(isSubFence(parent, { ...base, recipients: { mode: "own" } }));
  assert.ok(isSubFence(parent, { ...base, recipients: { mode: "allowlist", allow: [A.toUpperCase().replace("0X", "0x")] } }));
  assert.deepEqual(paths(parent, { ...base, recipients: { mode: "allowlist", allow: [A, B] } }), ["recipients.allow"]);
  assert.deepEqual(paths(parent, { ...base, recipients: { mode: "any" } }), ["recipients.mode"]);
  assert.ok(isSubFence({ ...base, recipients: { mode: "any" } }, { ...base, recipients: { mode: "allowlist", allow: [B] } }));
});

test("caps and limits: equal or lower, required when the parent sets them", () => {
  for (const key of ["perStepUsd", "perIntentUsd", "dailyUsd", "weeklyUsd"]) {
    const parent = { ...base, caps: { [key]: "100" } };
    assert.ok(isSubFence(parent, { ...base, caps: { [key]: "100" } }));
    assert.ok(isSubFence(parent, { ...base, caps: { [key]: "99.99" } }));
    assert.deepEqual(paths(parent, { ...base, caps: { [key]: "100.01" } }), [`caps.${key}`]);
    assert.deepEqual(paths(parent, base), [`caps.${key}`]);
  }
  for (const key of ["maxSteps", "maxSlippageBps"]) {
    const parent = { ...base, limits: { [key]: 5 } };
    assert.ok(isSubFence(parent, { ...base, limits: { [key]: 4 } }));
    assert.deepEqual(paths(parent, { ...base, limits: { [key]: 6 } }), [`limits.${key}`]);
    assert.deepEqual(paths(parent, base), [`limits.${key}`]);
  }
});

test("health factor, fx band, scent and confirm only get stricter", () => {
  assert.ok(isSubFence({ ...base, lending: { minHealthFactor: "1.5" } }, { ...base, lending: { minHealthFactor: "2" } }));
  assert.deepEqual(paths({ ...base, lending: { minHealthFactor: "1.5" } }, { ...base, lending: { minHealthFactor: "1.4" } }), ["lending.minHealthFactor"]);
  assert.deepEqual(paths({ ...base, lending: { minHealthFactor: "1.5" } }, base), ["lending.minHealthFactor"]);
  assert.ok(isSubFence({ ...base, fx: { maxDeviationBps: 50 } }, { ...base, fx: { maxDeviationBps: 20 } }));
  assert.deepEqual(paths({ ...base, fx: { maxDeviationBps: 50 } }, { ...base, fx: { maxDeviationBps: 60 } }), ["fx.maxDeviationBps"]);
  assert.ok(isSubFence({ ...base, scent: { require: "no-red-flags" } }, { ...base, scent: { require: "verified" } }));
  assert.deepEqual(paths({ ...base, scent: { require: "verified" } }, { ...base, scent: { require: "no-red-flags" } }), ["scent.require"]);
  assert.deepEqual(paths({ ...base, scent: { require: "no-red-flags" } }, { ...base, scent: { require: "off" } }), ["scent.require"]);
  assert.deepEqual(paths({ ...base, confirm: { aboveUsd: "100" } }, { ...base, confirm: { aboveUsd: "200" } }), ["confirm.aboveUsd"]);
  assert.deepEqual(paths({ ...base, confirm: { when: ["cross-chain"] } }, { ...base, confirm: { when: ["external-recipient"] } }), ["confirm.when"]);
  assert.ok(isSubFence({ ...base, confirm: { aboveUsd: "100", when: ["cross-chain"] } }, { ...base, confirm: { aboveUsd: "50", when: ["cross-chain", "agent-proposal"] } }));
});

test("schedule windows must sit inside the parent's, same time zone", () => {
  const parent = { ...base, schedule: { timezone: "Europe/Istanbul", windows: [{ days: ["mon", "tue"], from: "09:00", to: "18:00" }] } };
  assert.ok(isSubFence(parent, { ...base, schedule: { timezone: "Europe/Istanbul", windows: [{ days: ["mon"], from: "10:00", to: "12:00" }] } }));
  assert.deepEqual(paths(parent, { ...base, schedule: { timezone: "Europe/Istanbul", windows: [{ days: ["mon", "wed"], from: "10:00", to: "12:00" }] } }), ["schedule.windows.0"]);
  assert.deepEqual(paths(parent, { ...base, schedule: { timezone: "Europe/Istanbul", windows: [{ days: ["mon"], from: "08:00", to: "12:00" }] } }), ["schedule.windows.0"]);
  assert.deepEqual(paths(parent, { ...base, schedule: { timezone: "UTC", windows: [{ days: ["mon"], from: "10:00", to: "12:00" }] } }), ["schedule.timezone"]);
  assert.deepEqual(paths(parent, base), ["schedule"]);
});

test("signers subset", () => {
  assert.ok(isSubFence({ ...base, signers: ["wallet", "agent"] }, { ...base, signers: ["agent"] }));
  assert.deepEqual(paths({ ...base, signers: ["agent"] }, { ...base, signers: ["wallet", "agent"] }), ["signers"]);
});

test("intersectFence lands inside both fences and validates", () => {
  for (const parent of [DEFAULT_FENCE, ...Object.values(FENCE_TEMPLATES)]) {
    for (const r of Object.values(ROLE_TEMPLATES)) {
      const child = intersectFence(parent, r.fence, r.role);
      assert.equal(validateFence(child).ok, true, `${parent.label} x ${r.role}: ${JSON.stringify(validateFence(child).issues)}`);
      assert.deepEqual(subFenceViolations(parent, child), [], `${parent.label} x ${r.role}`);
      assert.deepEqual(subFenceViolations(r.fence, child), [], `${r.role} under ${parent.label}`);
    }
  }
});

test("budgets are carved from the parent", () => {
  const ledger = { caps: { perIntentUsd: "1000", dailyUsd: "1000", weeklyUsd: "3000" }, allocated: { dailyUsd: "600" } };
  assert.deepEqual(freeBudget(ledger), { perIntentUsd: "1000", dailyUsd: "400.00", weeklyUsd: "3000.00" });
  const ok = carveBudget(ledger, { perIntentUsd: "200", dailyUsd: "400", weeklyUsd: "500" });
  assert.equal(ok.ok, true);
  assert.equal(ok.remaining.dailyUsd, "0.00");
  const over = carveBudget(ledger, { perIntentUsd: "200", dailyUsd: "400.01", weeklyUsd: "500" });
  assert.equal(over.ok, false);
  assert.deepEqual(over.violations.map((v) => v.path), ["caps.dailyUsd"]);
  const missing = carveBudget(ledger, { dailyUsd: "1" });
  assert.deepEqual(missing.violations.map((v) => v.path), ["caps.perIntentUsd", "caps.weeklyUsd"]);
  assert.ok(carveBudget({ caps: {}, allocated: {} }, {}).ok);
  assert.deepEqual(budgetOf(DEFAULT_FENCE), { perIntentUsd: "2500", dailyUsd: "5000" });
  assert.deepEqual(addBudget({ dailyUsd: "10" }, { dailyUsd: "15" }, -1), { dailyUsd: "0.00" });
});

test("tree helpers and session limits", () => {
  const agents = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: "a" },
    { id: "e", parentId: null },
  ];
  assert.deepEqual(subtreeIds(agents, "a"), ["a", "b", "d", "c"]);
  assert.deepEqual(ancestorIds(agents, "c"), ["b", "a"]);
  const limits = sessionLimitsOf(DEFAULT_FENCE, 1_900_000_000, fenceHash(DEFAULT_FENCE));
  assert.equal(limits.maxPerTxUnits, "1000000000");
  assert.equal(limits.maxPerDayUnits, "5000000000");
  assert.equal(limits.whistle, false);
});
