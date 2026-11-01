import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FENCE, DEFAULT_FEE_BPS, DEFAULT_FEE_RECIPIENT, MAX_FEE_BPS, evaluateFence, feeLine, feeOf, feeTotals, isFeeBearing, outrunOf, splitFee } from "../dist/index.js";

test("fee rounds up by at most one base unit", () => {
  assert.equal(DEFAULT_FEE_BPS, 100);
  assert.equal(feeOf(200_000_000n, 100), 2_000_000n);
  assert.equal(feeOf(1n, 100), 1n);
  assert.equal(feeOf(101n, 100), 2n);
  for (const units of [1n, 99n, 12_345_678n, 999_999_999n]) {
    const fee = feeOf(units, 100);
    const exact = units * 100n;
    assert.ok(fee * 10_000n >= exact && fee * 10_000n - exact < 10_000n, `units ${units}`);
  }
  assert.equal(feeOf(0n, 100), 0n);
  assert.equal(feeOf(500n, 0), 0n);
  assert.throws(() => feeOf(1n, MAX_FEE_BPS + 1));
  assert.deepEqual(splitFee(199_000_000n, 100), { fee: 1_990_000n, net: 197_010_000n });
});

test("exempt kinds", () => {
  for (const k of ["repay", "withdraw", "approve", "register-agent", "attest"]) assert.equal(isFeeBearing(k), false, k);
  for (const k of ["transfer", "swap", "fx", "deposit", "supply", "borrow", "bridge", "gateway-deposit"]) assert.equal(isFeeBearing(k), true, k);
});

const fee = { bps: 100, recipient: DEFAULT_FEE_RECIPIENT, symbol: "USDC", token: "0x3600000000000000000000000000000000000000", decimals: 6, amount: "2000000", usd: "2", basis: "input" };

test("fee lines and totals", () => {
  assert.equal(feeLine(fee), "Lykia fee 1% · 2 USDC");
  assert.deepEqual(feeTotals([fee, undefined, { ...fee, amount: "1500000" }]), ["3.5 USDC"]);
});

test("the Fence counts the fee in caps and shows it as a line", () => {
  const OWNER = "0x1111111111111111111111111111111111111111";
  const usdc = { symbol: "USDC", address: fee.token, listed: true, acquired: false };
  const facts = (usd) => ({ environment: "mainnet", signer: "wallet", owner: OWNER, spent: { dayUsd: "0", weekUsd: "0" }, now: Date.UTC(2026, 10, 2, 10), steps: [{ id: "s1", kind: "deposit", venue: "morpho-vaults", usd, tokens: [usdc], fee: { line: "Lykia fee 1% · 10 USDC", usd: "10" } }] });
  const fence = { ...DEFAULT_FENCE, caps: { perStepUsd: "1000" }, confirm: undefined };
  const ok = evaluateFence(fence, facts("1000"));
  assert.equal(ok.decision, "allow");
  assert.ok(ok.reasons.some((r) => r.rule === "fee" && r.message.startsWith("Lykia fee 1%")));
  // 1000 USDC deposit + 10 USDC fee = 1010 USDC gross: over the 1000 cap.
  const over = evaluateFence(fence, facts("1010"));
  assert.equal(over.decision, "deny");
  assert.ok(over.reasons.some((r) => r.rule === "caps.step"));
});

test("the outrun shows fees per step and in total", () => {
  const graph = {
    spec: "lykia.intent/v1", id: "out_fee", environment: "mainnet", createdAt: "2026-11-01T00:00:00Z", source: "t", owner: "0x1111111111111111111111111111111111111111", warnings: [],
    verdict: { schema: "lykia.verdict/v1", decision: "allow", signable: true, reasons: [], waived: [], fenceHash: "sha256:00", factsDigest: "sha256:00", digest: "sha256:00" },
    steps: [{ id: "s1", kind: "fx", venue: "uniswap-v3", summary: "x", signer: "wallet", account: "0x1111111111111111111111111111111111111111", dependsOn: [], inputs: [], outputs: [], settlement: { kind: "receipt" }, status: "ready", fee }],
  };
  const o = outrunOf(graph);
  assert.equal(o.waypoints[0].fee, "Lykia fee 1% · 2 USDC");
  assert.deepEqual(o.fees, ["2 USDC"]);
});
