import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_TEMPLATES, evaluateFence, DEFAULT_PROFILE, toWebProfile, fromWebProfile, mergeProfile, validateProfile } from "../dist/index.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";
const USDC = { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", listed: true, acquired: false };
const EURC = { symbol: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", listed: true, acquired: true };
const MONDAY_NOON_TR = Date.UTC(2026, 10, 2, 9);

// Each role's own starter intent, as the step kinds its venues actually produce.
const STARTERS = {
  orchestrator: [{ id: "s1", kind: "deposit", venue: "morpho-vaults", usd: "100", tokens: [USDC] }],
  treasurer: [{ id: "s1", kind: "supply", venue: "aave-v4", usd: "100", tokens: [USDC] }, { id: "s2", kind: "deposit", venue: "morpho-vaults", usd: "100", tokens: [USDC] }, { id: "s3", kind: "fx", venue: "uniswap-v3", usd: "100", tokens: [USDC, EURC], fxDeviationBps: 4, slippageBps: 10 }],
  payroll: [{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "200", tokens: [USDC], recipient: PAYEE }],
  "fx-hedger": [{ id: "s1", kind: "fx", venue: "uniswap-v3", usd: "100", tokens: [USDC, EURC], fxDeviationBps: 4, slippageBps: 20 }],
  "yield-keeper": [{ id: "s1", kind: "deposit", venue: "morpho-vaults", usd: "100", tokens: [USDC] }, { id: "s2", kind: "supply", venue: "aave-v4", usd: "100", tokens: [USDC] }],
  "bill-payer": [{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "50", tokens: [USDC], recipient: PAYEE }],
  sentinel: [],
  researcher: [{ id: "s1", kind: "deposit", venue: "morpho-vaults", usd: "10", tokens: [USDC] }],
};

test("every role can run its own starter intent", () => {
  for (const [role, template] of Object.entries(ROLE_TEMPLATES)) {
    const steps = STARTERS[role];
    assert.ok(steps, `starter for ${role}`);
    const fence = template.fence.recipients?.mode === "allowlist" ? { ...template.fence, recipients: { ...template.fence.recipients, allow: [PAYEE] } } : template.fence;
    const v = evaluateFence(fence, { environment: "mainnet", signer: (fence.signers ?? ["wallet"]).includes("agent") ? "agent" : "wallet", owner: OWNER, steps, spent: { dayUsd: "0", weekUsd: "0" }, now: MONDAY_NOON_TR });
    assert.notEqual(v.decision, "deny", `${role}: ${v.reasons.filter((r) => r.decision === "deny").map((r) => r.message).join("; ")}`);
  }
});

test("the web's flat profile round-trips into the core profile", () => {
  const web = { ...toWebProfile(DEFAULT_PROFILE), currency: "TRY", slippageBps: 900, favoriteVenues: ["aave-v4", "synthra"], blockedVenues: ["synthra"], tone: "formal", look: { collar: "#5F8A3A", coat: "sable", tag: "SHADOW" }, quietHours: { on: true, from: "23:00", to: "07:00" }, confirm: "every-step", retentionDays: 0, theme: "night" };
  const merged = mergeProfile(DEFAULT_PROFILE, fromWebProfile(web, DEFAULT_PROFILE));
  const r = validateProfile(merged);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  const p = r.profile;
  assert.equal(p.displayCurrency, "TRY");
  assert.equal(p.defaultSlippageBps, 500);
  assert.deepEqual(p.venues, { favorites: ["aave-v4"], blocked: ["synthra"] });
  assert.equal(p.look.coat, "sable");
  assert.equal(p.confirmation.mode, "always");
  assert.equal(p.memory.enabled, false);
  assert.equal(p.theme, "night");
  assert.equal(toWebProfile(p).look.tag, "SHADOW");
});
