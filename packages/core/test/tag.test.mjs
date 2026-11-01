import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTagCard, decodeMemo, DEFAULT_FENCE, digestToBytes32, evaluateFence, fenceHash, tagCardDigest, memoData, memoId, memoString, validationRecord, validationRequestHash, validationScore, verdictTag } from "../dist/index.js";

const OWNER = "0x1111111111111111111111111111111111111111";

test("memo strings round-trip through bytes and keep notes single-line", () => {
  const memo = { intentId: "out_abc123", stepId: "s2", verdict: "0123456789abcdef", note: "invoice\n4411 | paid" };
  const text = memoString(memo);
  assert.equal(text, "lykia:1:out_abc123:s2:0123456789abcdef|invoice 4411 paid");
  assert.deepEqual(decodeMemo(memoData(memo)), { ...memo, note: "invoice 4411 paid" });
  assert.equal(decodeMemo("hello"), null);
  assert.match(memoId("out_abc123", "s2"), /^0x[0-9a-f]{64}$/u);
  assert.notEqual(memoId("out_abc123", "s2"), memoId("out_abc123", "s1"));
  assert.throws(() => memoString({ ...memo, verdict: "xyz" }));
  assert.equal(verdictTag("sha256:abcdef0123456789ffff"), "abcdef0123456789");
});

test("a Tag card pins the Fence hash and the agent wallet", () => {
  const hash = fenceHash(DEFAULT_FENCE);
  const card = buildTagCard({ environment: "mainnet", owner: OWNER, name: "Payroll Shepherd", description: "Pays the team", fenceHash: hash });
  assert.equal(card.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  assert.equal(card.lykia.fenceHash, hash);
  assert.deepEqual(card.endpoints.at(-1), { name: "agentWallet", endpoint: `eip155:5042:${OWNER}` });
  assert.equal(tagCardDigest(card), tagCardDigest(JSON.parse(JSON.stringify(card))));
  assert.equal(digestToBytes32(hash), `0x${hash.slice(7)}`);
  assert.throws(() => buildTagCard({ environment: "mainnet", owner: OWNER, name: "x", description: "", fenceHash: hash }));
});

test("validation records bind the verdict and score it", () => {
  const verdict = evaluateFence(DEFAULT_FENCE, { environment: "testnet", signer: "agent", owner: OWNER, steps: [], spent: { dayUsd: "0", weekUsd: "0" }, now: Date.UTC(2026, 10, 2) });
  const record = validationRecord({ environment: "testnet", agentId: "42", intentId: "out_abc123", verdict });
  assert.equal(record.verdictDigest, verdict.digest);
  assert.match(validationRequestHash(record), /^0x[0-9a-f]{64}$/u);
  assert.equal(validationScore(verdict), 100);
  assert.throws(() => validationRecord({ environment: "testnet", agentId: "abc", intentId: "x", verdict }));
});
