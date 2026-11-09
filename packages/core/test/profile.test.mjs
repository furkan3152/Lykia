import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE, DEFAULT_FENCE, validateProfile, mergeProfile, fenceForProfile, isQuietHours, displayAmount, evaluateFence } from "../dist/index.js";

test("default profile validates; bad fields are named", () => {
  assert.equal(validateProfile(DEFAULT_PROFILE).ok, true);
  const bad = validateProfile({ ...DEFAULT_PROFILE, risk: "yolo", look: { collar: "#000000", coat: "cream", nameTag: "LYKO" }, venues: { favorites: ["aave-v4"], blocked: ["aave-v4"] }, extra: 1 });
  assert.equal(bad.ok, false);
  const paths = bad.issues.map((i) => i.path);
  for (const p of ["risk", "look.collar", "venues", "extra"]) assert.ok(paths.includes(p), p);
});

test("merge is shallow per section", () => {
  const m = mergeProfile(DEFAULT_PROFILE, { persona: { tone: "playful" } });
  assert.equal(m.persona.tone, "playful");
  assert.equal(m.persona.verbosity, "normal");
});

test("a profile tightens the Fence, never loosens it", () => {
  const low = fenceForProfile({ ...DEFAULT_PROFILE, risk: "low", venues: { favorites: [], blocked: ["synthra"] }, confirmation: { mode: "above", aboveUsd: "100" } });
  assert.equal(low.limits.maxSlippageBps, 30);
  assert.deepEqual(low.venues.deny, ["synthra"]);
  assert.equal(low.confirm.aboveUsd, "100");
  assert.equal(low.scent.require, "verified");
  // The risk tier is the Fence preset (Bold allows 3%), and a slippage habit never loosens the preset.
  const high = fenceForProfile({ ...DEFAULT_PROFILE, risk: "high", defaultSlippageBps: 500 });
  assert.equal(high.label, "Bold");
  assert.equal(high.limits.maxSlippageBps, 300);
  // Applied to a Fence of the owner's own, a profile never loosens it.
  const own = fenceForProfile({ ...DEFAULT_PROFILE, risk: "high", defaultSlippageBps: 500 }, { ...DEFAULT_FENCE, label: "Mine" });
  assert.equal(own.limits.maxSlippageBps, DEFAULT_FENCE.limits.maxSlippageBps);
  assert.equal(fenceForProfile(DEFAULT_PROFILE).label, "Balanced");
  const loose = fenceForProfile({ ...DEFAULT_PROFILE, confirmation: { mode: "above", aboveUsd: "99999" } });
  assert.equal(loose.confirm.aboveUsd, DEFAULT_FENCE.confirm.aboveUsd);
  const always = fenceForProfile({ ...DEFAULT_PROFILE, confirmation: { mode: "always", aboveUsd: null } });
  const v = evaluateFence(always, { environment: "testnet", signer: "wallet", owner: "0x1111111111111111111111111111111111111111", steps: [{ id: "s1", kind: "deposit", venue: "vault", usd: "1", tokens: [] }], spent: { dayUsd: "0", weekUsd: "0" }, now: Date.UTC(2026, 10, 2, 10) });
  assert.equal(v.decision, "confirm");
});

test("quiet hours wrap midnight; display currency converts", () => {
  const p = { ...DEFAULT_PROFILE, quietHours: { timezone: "Europe/Istanbul", from: "23:00", to: "07:00" } };
  assert.equal(isQuietHours(p, Date.UTC(2026, 10, 2, 22)), true);
  assert.equal(isQuietHours(p, Date.UTC(2026, 10, 2, 10)), false);
  assert.equal(displayAmount("100", "USD", null), "$100.00");
  assert.equal(displayAmount("100", "EUR", "1.1154"), "€89.65");
  assert.equal(displayAmount("100", "TRY", null), null);
  assert.equal(displayAmount(null, "USD", null), null);
});
