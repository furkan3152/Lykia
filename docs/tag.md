# Tag and ERC-8354 policy verdicts

A Tag is an agent's ERC-8004 identity on Arc. Its card pins the hash of the
Fence the agent follows, under the `lykia.fence` metadata key. Each time the
Fence judges an action, the verdict can also be filed to the ERC-8004
Validation Registry in the shape that
[ERC-8354 (Confidential Agent Policy Verdicts)](https://eips.ethereum.org/EIPS/eip-8354)
proposes. Anyone can then see that an agent was checked against a policy,
without learning what the policy says.

ERC-8354 is a Draft, created on 2026-07-16. This page records what the draft
requires, what Lykia does, and where Lykia deliberately differs.

## What the draft defines

| Draft item | Level | Lykia |
|---|---|---|
| `Verdict` envelope: `agentId`, `domainId`, `policyRoot`, `actionCommitment`, `executor`, `expiry`, `nullifier`, `decision`, `policyKind` | MUST (normative core) | Built for every attested action with the exact Solidity types (`buildVerdict`, `encodeVerdict` in `packages/core/src/erc8354.ts`). |
| `actionCommitment = keccak256(abi.encode(chainid, domainId, agentId, target, value, keccak256(callData), actionNonce))` | MUST | Computed exactly as defined. The target, value and calldata come from the prepared step transaction. `actionNonce` strictly increases per agent and environment (a store counter). |
| `policyKind`, and its agreement with `decision` (1 → ALLOWED; 0 → DENIED, NOT_PERMITTED or COULD_NOT_EVALUATE) | MUST | Fence `allow`, or `confirm` once the owner has confirmed → ALLOWED. `deny` where every refusal is a missing fact → COULD_NOT_EVALUATE. Any other `deny` → DENIED. An unconfirmed `confirm` → NOT_PERMITTED. Encoding refuses a pair that disagrees. |
| `IConfidentialPolicyVerdict` Guard contract with `verify` / `consume` and the nine ordered checks | MUST for a compliant Guard | Not implemented. Lykia's on-chain gate is LykiaAccount: sessions, caps, allowlists and the Whistle. Lykia does not claim to be an ERC-8354 Guard. |
| Zero-knowledge proof that a fixed interpreter evaluated a committed ruleset | MUST for a compliant Guard | Not implemented. The Fence is evaluated by Lykia's policy engine. |
| Policy commitment registered in ERC-7812, `policyRoot` = EvidenceDB root, Poseidon hashing | MUST for a compliant Guard | Differs. `policyRoot = keccak256(abi.encode(fenceHash, salt))`. |
| Low-entropy rulesets padded with a high-entropy salt | MUST | Done. Each agent gets a random 32-byte salt. Fence templates are low entropy, so without the salt anyone could hash the templates and match them. |
| `nullifier = H(domainId, agentId, actionCommitment, actionNonce)` with Poseidon | MUST for a compliant Guard | Same inputs, but hashed with keccak256. The nullifier is only consumed by a Guard, and Lykia does not run one. |
| `VerdictAttestation` written to the ERC-8004 Validation Registry after a verdict, carrying no part of the ruleset | SHOULD | Done. The struct (`agentId`, `artifactHash` = `actionCommitment`, `policyRoot`, `domainId`, `nullifier`, `decision`, `mechanism`, `expiry`) is ABI-encoded, and its keccak256 is the registry `responseHash`. |
| `mechanism` source-class tag; a ZK Guard MUST use `keccak256("zk-secret-policy")` | MUST | Lykia uses `keccak256("independent-mediator")` by default, or `keccak256("public-recomputable")` when the owner publishes the Fence. It refuses to emit `zk-secret-policy`, so Lykia verdicts are never mixed up with zero-knowledge ones. |

In short: Lykia produces ERC-8354 attestations, using the same envelope,
action commitment, policy kinds and attestation struct. It labels them
honestly as mediated rather than zero-knowledge. A future move to an ERC-7812
commitment and a ZK interpreter would not change the fields that readers
already decode.

## How a verdict is filed

1. The planner evaluates the Fence and the step is prepared.
2. `POST /v1/tags/attest` with `erc8354: { executor, stepId }` (or a raw
   `action`) returns:
   - the encoded `Verdict` and `VerdictAttestation`;
   - `requestHash = keccak256(abi.encode(Verdict))` and
     `responseHash = keccak256(abi.encode(VerdictAttestation))`;
   - request and response documents at `/v1/tags/verdicts/<hash>`.
3. **The owner** signs
   `ValidationRegistry.validationRequest(guard, agentId, requestURI, requestHash)`.
4. **The guard** signs
   `ValidationRegistry.validationResponse(requestHash, 100 | 0, responseURI, responseHash, "erc-8354")`.
   - The score is 100 for ALLOWED and 0 for anything else.
   - The guard is the address in `LYKIA_GUARD_ADDRESS`. It signs with its own
     key. The Lykia server never holds or uses that key, and without the
     variable only the documents and hashes are produced.
5. `GET /v1/tags/:agentId` reads the count and average score for the
   `erc-8354` tag. The Tag page shows them as "ERC-8354 policy verdicts".

The older `lykia.verdict/v1` record is still produced (the `lykia-fence` tag)
and included in the request document, so existing readers keep working.

## Disclosure to auditors

The owner can read their agent's salt with
`GET /v1/tags/:agentId/policy-salt`. It needs a SIWE session from the
agent's owner, and the response is never cached. Giving an auditor the Fence
document and the salt lets them recompute `policyRoot` and confirm which
Fence was in force. No one else learns the rules.

## Domain

`domainId = keccak256("lykia.fence/v1:<chainId>")`, one per Arc environment.
It separates Lykia's commitments from other policy domains that share the
same registry.
