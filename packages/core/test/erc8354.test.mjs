import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, keccak256, toHex } from "viem";
import { DEFAULT_FENCE, evaluateFence, buildVerdict, encodeVerdict, attestationFor, encodeAttestation, registryHashes, actionCommitment, lykiaDomainId, policyKindFor, kindAgrees, mechanismTag, POLICY_KIND, responseScore, policyRootFor } from "../dist/index.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const TARGET = "0x522fAf9A91c41c443c66765030741e4AaCe147D0";
const SALT = "0x" + "ab".repeat(32);

function allowVerdict() {
  return evaluateFence(DEFAULT_FENCE, { environment: "mainnet", signer: "agent", owner: OWNER, steps: [{ id: "s1", kind: "deposit", venue: "vault", usd: "10", tokens: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000", listed: true, acquired: false }] }], spent: { dayUsd: "0", weekUsd: "0" }, now: Date.UTC(2026, 10, 2, 10) });
}

test("actionCommitment matches the draft's abi.encode definition", () => {
  const domainId = lykiaDomainId("mainnet");
  const callData = "0xdeadbeef";
  const ours = actionCommitment({ environment: "mainnet", domainId, agentId: 412n, target: TARGET, value: 0n, callData, actionNonce: 7n });
  const ref = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }], [5042n, domainId, 412n, TARGET, 0n, keccak256(callData), 7n]));
  assert.equal(ours, ref);
  assert.equal(domainId, keccak256(toHex("lykia.fence/v1:5042")));
});

test("Verdict and VerdictAttestation encode exactly like the Solidity structs", () => {
  const v = buildVerdict({ environment: "mainnet", agentId: "412", verdict: allowVerdict(), salt: SALT, executor: OWNER, target: TARGET, callData: "0x1234", actionNonce: 1n, expiry: 1_900_000_000n });
  assert.equal(v.decision, 1);
  assert.equal(v.policyKind, POLICY_KIND.ALLOWED);
  const verdictTuple = [{ type: "tuple", components: [{ name: "agentId", type: "uint256" }, { name: "domainId", type: "bytes32" }, { name: "policyRoot", type: "bytes32" }, { name: "actionCommitment", type: "bytes32" }, { name: "executor", type: "address" }, { name: "expiry", type: "uint64" }, { name: "nullifier", type: "bytes32" }, { name: "decision", type: "uint8" }, { name: "policyKind", type: "uint8" }] }];
  assert.equal(encodeVerdict(v), encodeAbiParameters(verdictTuple, [{ ...v }]));
  const a = attestationFor(v);
  assert.equal(a.artifactHash, v.actionCommitment);
  assert.equal(a.mechanism, keccak256(toHex("independent-mediator")));
  const attTuple = [{ type: "tuple", components: [{ name: "agentId", type: "uint256" }, { name: "artifactHash", type: "bytes32" }, { name: "policyRoot", type: "bytes32" }, { name: "domainId", type: "bytes32" }, { name: "nullifier", type: "bytes32" }, { name: "decision", type: "uint8" }, { name: "mechanism", type: "bytes32" }, { name: "expiry", type: "uint64" }] }];
  assert.equal(encodeAttestation(a), encodeAbiParameters(attTuple, [{ ...a }]));
  const { requestHash, responseHash } = registryHashes(v, a);
  assert.equal(requestHash, keccak256(encodeVerdict(v)));
  assert.equal(responseHash, keccak256(encodeAttestation(a)));
  assert.equal(responseScore(v), 100);
});

test("policy root hides the Fence but is recomputable with the salt", () => {
  const verdict = allowVerdict();
  const root = policyRootFor(verdict.fenceHash, SALT);
  assert.notEqual(root.slice(2), verdict.fenceHash.slice(7));
  assert.equal(root, keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [`0x${verdict.fenceHash.slice(7)}`, SALT])));
  assert.notEqual(policyRootFor(verdict.fenceHash, "0x" + "cd".repeat(32)), root);
});

test("policyKind mapping and agreement rules", () => {
  assert.deepEqual(policyKindFor({ decision: "allow", reasons: [] }), { decision: 1, policyKind: 0 });
  assert.deepEqual(policyKindFor({ decision: "confirm", reasons: [] }), { decision: 0, policyKind: 2 });
  assert.deepEqual(policyKindFor({ decision: "confirm", reasons: [] }, true), { decision: 1, policyKind: 0 });
  assert.deepEqual(policyKindFor({ decision: "deny", reasons: [{ rule: "facts.unavailable", decision: "deny", message: "" }] }), { decision: 0, policyKind: 3 });
  assert.deepEqual(policyKindFor({ decision: "deny", reasons: [{ rule: "caps.step", decision: "deny", message: "" }, { rule: "facts.unavailable", decision: "deny", message: "" }] }), { decision: 0, policyKind: 1 });
  assert.equal(kindAgrees(1, 0), true);
  assert.equal(kindAgrees(1, 1), false);
  assert.equal(kindAgrees(0, 0), false);
  assert.equal(kindAgrees(0, 3), true);
});

test("zk-secret-policy is refused for Lykia verdicts", () => {
  const v = buildVerdict({ environment: "testnet", agentId: "1", verdict: allowVerdict(), salt: SALT, executor: OWNER, target: TARGET, callData: "0x", actionNonce: 1n, expiry: 1n });
  assert.throws(() => attestationFor(v, "zk-secret-policy"));
  assert.equal(attestationFor(v, "public-recomputable").mechanism, mechanismTag("public-recomputable"));
});
