import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FENCE, FENCE_TEMPLATES, evaluateFence, fenceHash, loosenedRules, validateFence, isHomeward } from "../dist/index.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const STRANGER = "0x2222222222222222222222222222222222222222";
const USDC = "0x3600000000000000000000000000000000000000";
const NOW = Date.UTC(2026, 10, 2, 10, 0); // Monday 13:00 Istanbul

const usdcIn = { symbol: "USDC", address: USDC, listed: true, acquired: false };
const facts = (steps, extra = {}) => ({ environment: "testnet", signer: "wallet", owner: OWNER, steps, spent: { dayUsd: "0", weekUsd: "0" }, now: NOW, ...extra });

test("templates validate and hash stably", () => {
  for (const fence of Object.values(FENCE_TEMPLATES)) assert.equal(validateFence(fence).ok, true, fence.label);
  assert.equal(fenceHash(DEFAULT_FENCE), fenceHash(JSON.parse(JSON.stringify(DEFAULT_FENCE))));
  assert.match(fenceHash(DEFAULT_FENCE), /^sha256:[0-9a-f]{64}$/u);
});

test("validation rejects unknown fields and bad values", () => {
  const result = validateFence({ schema: "lykia.fence/v1", caps: { perStepUsd: 10 }, extra: 1, lending: { minHealthFactor: "0.9" } });
  assert.equal(result.ok, false);
  const paths = result.issues.map((i) => i.path);
  assert.ok(paths.includes("extra"));
  assert.ok(paths.includes("caps.perStepUsd"));
  assert.ok(paths.includes("lending.minHealthFactor"));
});

test("a small deposit passes the default fence", () => {
  const v = evaluateFence(DEFAULT_FENCE, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "100", tokens: [usdcIn] }]));
  assert.equal(v.decision, "allow");
  assert.equal(v.signable, true);
  assert.match(v.digest, /^sha256:/u);
});

test("caps deny, and unpriced fails closed", () => {
  const big = evaluateFence(DEFAULT_FENCE, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "1500", tokens: [usdcIn] }]));
  assert.equal(big.decision, "deny");
  assert.ok(big.reasons.some((r) => r.rule === "caps.step"));
  const unpriced = evaluateFence(DEFAULT_FENCE, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: null, tokens: [usdcIn] }]));
  assert.equal(unpriced.decision, "deny");
  assert.ok(unpriced.reasons.some((r) => r.rule === "facts.unavailable"));
});

test("unknown daily spend fails closed", () => {
  const v = evaluateFence(DEFAULT_FENCE, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "10", tokens: [usdcIn] }], { spent: { dayUsd: null, weekUsd: null } }));
  assert.equal(v.decision, "deny");
});

test("strangers are denied by default; agents need the allowlist", () => {
  const send = { id: "s1", kind: "transfer", venue: "arc-transfer", usd: "10", tokens: [usdcIn], recipient: STRANGER };
  assert.equal(evaluateFence(DEFAULT_FENCE, facts([send])).decision, "deny");
  const open = { ...DEFAULT_FENCE, recipients: { mode: "any" } };
  assert.equal(evaluateFence(open, facts([send])).decision, "confirm");
  assert.equal(evaluateFence(open, facts([send], { signer: "agent" })).decision, "deny");
  const listed = { ...DEFAULT_FENCE, recipients: { mode: "allowlist", allow: [STRANGER] } };
  assert.equal(evaluateFence(listed, facts([send], { signer: "agent" })).decision, "confirm");
});

test("scent: an unlisted token is a wolf unless sniffed clean", () => {
  const wolf = { symbol: "USDC", address: "0x9999999999999999999999999999999999999999", listed: false, acquired: true };
  const allowUnlisted = { ...DEFAULT_FENCE, tokens: { unlisted: "allow" } };
  const unsniffed = evaluateFence(allowUnlisted, facts([{ id: "s1", kind: "swap", venue: "dex", usd: "10", tokens: [usdcIn, wolf], slippageBps: 50 }]));
  assert.ok(unsniffed.reasons.some((r) => r.rule === "scent"));
  const danger = evaluateFence(allowUnlisted, facts([{ id: "s1", kind: "swap", venue: "dex", usd: "10", tokens: [usdcIn, { ...wolf, scent: "danger" }], slippageBps: 50 }]));
  assert.equal(danger.decision, "deny");
  const clean = evaluateFence(allowUnlisted, facts([{ id: "s1", kind: "swap", venue: "dex", usd: "10", tokens: [usdcIn, { ...wolf, scent: "no-red-flags" }], slippageBps: 50 }]));
  assert.equal(clean.decision, "allow");
  assert.equal(evaluateFence(DEFAULT_FENCE, facts([{ id: "s1", kind: "swap", venue: "dex", usd: "10", tokens: [usdcIn, { ...wolf, scent: "no-red-flags" }] }])).decision, "deny");
});

test("lending health and FX band", () => {
  const borrow = { id: "s1", kind: "borrow", venue: "lend", usd: "100", tokens: [usdcIn], healthFactorAfter: "1.2" };
  assert.ok(evaluateFence(DEFAULT_FENCE, facts([borrow])).reasons.some((r) => r.rule === "lending.health"));
  assert.ok(evaluateFence(DEFAULT_FENCE, facts([{ ...borrow, healthFactorAfter: null }])).reasons.some((r) => r.rule === "facts.unavailable"));
  assert.equal(evaluateFence(DEFAULT_FENCE, facts([{ ...borrow, healthFactorAfter: "2.1" }])).decision, "allow");
  const fx = { id: "s1", kind: "fx", venue: "stablefx", usd: "100", tokens: [usdcIn, { symbol: "EURC", address: USDC, listed: true, acquired: true }], fxDeviationBps: 80 };
  assert.ok(evaluateFence(DEFAULT_FENCE, facts([fx])).reasons.some((r) => r.rule === "fx.deviation"));
});

test("the whistle stops risk but lets the flock come home", () => {
  const whistle = { ...DEFAULT_FENCE, mode: "whistle", caps: { perStepUsd: "1" } };
  const risky = evaluateFence(whistle, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "100", tokens: [usdcIn] }]));
  assert.equal(risky.decision, "deny");
  const home = evaluateFence(whistle, facts([{ id: "s1", kind: "repay", venue: "lend", usd: "100", tokens: [usdcIn] }, { id: "s2", kind: "withdraw", venue: "vault", usd: "100", tokens: [usdcIn], recipient: OWNER }]));
  assert.equal(home.decision, "allow");
  assert.ok(home.waived.some((r) => r.rule === "mode.whistle"));
  assert.ok(home.waived.some((r) => r.rule === "caps.step"));
  assert.equal(isHomeward({ kind: "transfer", recipient: STRANGER }, OWNER), false);
});

test("dry-run never signs; schedule closes outside hours", () => {
  const lamb = evaluateFence(FENCE_TEMPLATES.lamb, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "1", tokens: [usdcIn] }]));
  assert.equal(lamb.signable, false);
  const sunday = Date.UTC(2026, 10, 1, 10, 0);
  const t = { ...FENCE_TEMPLATES.treasury };
  const v = evaluateFence(t, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "1", tokens: [usdcIn] }], { now: sunday }));
  assert.ok(v.reasons.some((r) => r.rule === "schedule"));
});

test("loosened rules are reported", () => {
  const next = { ...DEFAULT_FENCE, caps: { ...DEFAULT_FENCE.caps, perStepUsd: "5000" }, recipients: { mode: "any" }, scent: { require: "off" } };
  const lines = loosenedRules(DEFAULT_FENCE, next);
  assert.ok(lines.some((l) => l.startsWith("Per-step cap raised")));
  assert.ok(lines.some((l) => l.includes("Recipients opened")));
  assert.ok(lines.some((l) => l.includes("Scent requirement relaxed")));
  assert.deepEqual(loosenedRules(DEFAULT_FENCE, DEFAULT_FENCE), []);
});

test("the beta cap sits above every Fence on mainnet, and homeward moves pass", () => {
  const beta = { beta: { perStepUsd: "1000", perDayUsd: "5000" } };
  const loose = { ...DEFAULT_FENCE, caps: { perStepUsd: "1000000", perIntentUsd: "1000000", dailyUsd: "1000000", weeklyUsd: "1000000" }, confirm: { aboveUsd: "1000000", when: [] } };
  const big = evaluateFence(loose, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "1500", tokens: [usdcIn] }], { environment: "mainnet" }), beta);
  assert.equal(big.decision, "deny");
  assert.ok(big.reasons.some((r) => r.rule === "beta.cap"));
  const day = evaluateFence(loose, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "900", tokens: [usdcIn] }], { environment: "mainnet", spent: { dayUsd: "4500", weekUsd: "4500" } }), beta);
  assert.ok(day.reasons.some((r) => r.rule === "beta.cap"));
  const small = evaluateFence(loose, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "900", tokens: [usdcIn] }], { environment: "mainnet" }), beta);
  assert.equal(small.decision, "allow");
  const testnet = evaluateFence(loose, facts([{ id: "s1", kind: "deposit", venue: "vault", usd: "1500", tokens: [usdcIn] }]), beta);
  assert.ok(!testnet.reasons.some((r) => r.rule === "beta.cap"));
});

test("the beta cap never holds back a move that brings value home", () => {
  const home = evaluateFence(DEFAULT_FENCE, facts([{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "25000", tokens: [usdcIn], recipient: OWNER }], { environment: "mainnet" }), { beta: { perStepUsd: "1000", perDayUsd: "5000" } });
  assert.ok(!home.reasons.some((r) => r.rule === "beta.cap"));
});
