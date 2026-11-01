import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FENCE, ERC8354_TAG, evaluateFence, POLICY_KIND, type Address } from "@lykia/core";
import { decodeFunctionData, keccak256 } from "viem";
import { MemoryStore } from "../../store/memory.js";
import { KunyeService } from "../kunye.js";
import { VALIDATION_REGISTRY_ABI } from "../../engine/abis.js";
import type { ArcChains } from "../../chains/arc.js";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const GUARD = "0x2222222222222222222222222222222222222222" as Address;
const ACTION = { to: "0x522fAf9A91c41c443c66765030741e4AaCe147D0" as Address, data: "0xabcdef" as const, value: "0" };

const verdict = evaluateFence(DEFAULT_FENCE, { environment: "mainnet", signer: "agent", owner: OWNER, steps: [{ id: "s1", kind: "deposit", venue: "vault", usd: "10", tokens: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000", listed: true, acquired: false }] }], spent: { dayUsd: "0", weekUsd: "0" }, now: Date.UTC(2026, 10, 2, 10) });

function service(guard: Address | null) {
  return new KunyeService({ chains: {} as ArcChains, store: new MemoryStore(), fetch: (async () => new Response("")) as never, guard });
}

test("attest8354 builds the envelope, attestation and both registry calls", async () => {
  const k = service(GUARD);
  const r = await k.attest8354({ environment: "mainnet", agentId: "412", intentId: "out_1", verdict, owner: OWNER, executor: OWNER, action: ACTION, publicBaseUrl: "https://api.example" });
  assert.equal(r.mechanism, "independent-mediator");
  assert.equal(r.verdict.decision, 1);
  assert.equal(r.verdict.policyKind, POLICY_KIND.ALLOWED);
  assert.equal(r.attestation.artifactHash, r.verdict.actionCommitment);
  assert.equal(r.requestHash, keccak256(r.encoded.verdict));
  assert.equal(r.responseHash, keccak256(r.encoded.attestation));
  assert.equal(r.requestURI, `https://api.example/v1/tags/verdicts/${r.requestHash}`);
  const req = decodeFunctionData({ abi: VALIDATION_REGISTRY_ABI, data: r.requestTransaction!.data });
  assert.equal(req.functionName, "validationRequest");
  assert.deepEqual(req.args, [GUARD, 412n, r.requestURI, r.requestHash]);
  assert.equal(r.requestTransaction!.from, OWNER);
  const resp = decodeFunctionData({ abi: VALIDATION_REGISTRY_ABI, data: r.responseTransaction!.data });
  assert.equal(resp.functionName, "validationResponse");
  assert.deepEqual(resp.args, [r.requestHash, 100, r.responseURI, r.responseHash, ERC8354_TAG]);
  assert.equal(r.responseTransaction!.from, GUARD);
  const doc = (await k.verdictDoc(r.responseHash)) as { attestation: { mechanism: string } };
  assert.equal(doc.attestation.mechanism, r.attestation.mechanism);
  assert.equal(JSON.stringify(await k.verdictDoc(r.requestHash)).includes("salt"), false);
});

test("action nonces increase per agent and the salt is stable", async () => {
  const k = service(GUARD);
  const a = await k.attest8354({ environment: "mainnet", agentId: "7", intentId: "out_1", verdict, owner: OWNER, executor: OWNER, action: ACTION });
  const b = await k.attest8354({ environment: "mainnet", agentId: "7", intentId: "out_1", verdict, owner: OWNER, executor: OWNER, action: ACTION });
  assert.equal(BigInt(b.actionNonce), BigInt(a.actionNonce) + 1n);
  assert.notEqual(a.verdict.actionCommitment, b.verdict.actionCommitment);
  assert.equal(a.verdict.policyRoot, b.verdict.policyRoot);
  assert.equal(await k.policySalt("mainnet", "7"), await k.policySalt("mainnet", "7"));
});

test("without a guard only documents and hashes are produced; zk mechanism refused", async () => {
  const k = service(null);
  const r = await k.attest8354({ environment: "testnet", agentId: "1", intentId: "out_1", verdict, owner: OWNER, executor: OWNER, action: ACTION });
  assert.equal(r.requestTransaction, null);
  assert.equal(r.responseTransaction, null);
  assert.ok(r.requestURI.startsWith("data:application/json;base64,"));
  await assert.rejects(k.attest8354({ environment: "testnet", agentId: "1", intentId: "out_1", verdict, owner: OWNER, executor: OWNER, action: ACTION, mechanism: "zk-secret-policy" }));
});
