/**
 * ERC-8354 (Confidential Agent Policy Verdicts, Draft, created 2026-07-16)
 * compatibility for Lykia's Fence verdicts.
 *
 * What the draft defines, and what Lykia does with each part:
 *
 *  - `Verdict` envelope (agentId, domainId, policyRoot, actionCommitment,
 *    executor, expiry, nullifier, decision, policyKind): Lykia fills every
 *    field from a Fence verdict and the prepared transaction, with the exact
 *    Solidity types, so a Guard or an indexer can decode it.
 *  - `actionCommitment = keccak256(abi.encode(chainid, domainId, agentId,
 *    target, value, keccak256(callData), actionNonce))`: computed exactly as
 *    specified (keccak256, strictly increasing actionNonce per agent).
 *  - `policyKind` (0 ALLOWED, 1 DENIED, 2 NOT_PERMITTED, 3 COULD_NOT_EVALUATE)
 *    and its agreement with `decision`: enforced here.
 *  - `VerdictAttestation` written to the ERC-8004 ValidationRegistry after a
 *    verdict (a SHOULD in the draft): Lykia produces the canonical struct,
 *    its ABI encoding and the unsigned registry calls.
 *
 * Where Lykia honestly differs from a full ERC-8354 Guard:
 *
 *  - No zero-knowledge proof. The Fence is evaluated by Lykia's policy
 *    engine, not proven in a circuit, so the attestation's `mechanism` is
 *    `keccak256("independent-mediator")` (or `"public-recomputable"` when the
 *    owner publishes the Fence document), never `"zk-secret-policy"`, which
 *    the draft reserves for ZK Guards. This keeps verdicts of different
 *    strength from being conflated in a shared registry, which is exactly
 *    why the draft introduced the tag.
 *  - `policyRoot` is a keccak256 commitment to the salted Fence hash, not an
 *    ERC-7812 EvidenceDB root, and `nullifier` uses keccak256 rather than
 *    Poseidon. Both are documented deviations; the field layout is unchanged
 *    so moving to ERC-7812 + a ZK interpreter later does not change readers.
 *  - Lykia does not deploy an `IConfidentialPolicyVerdict` Guard contract;
 *    the on-chain gate is LykiaAccount (sessions, the Whistle), and the
 *    attestation is the public record of each verdict.
 *
 * Pure: no I/O.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { isAddress, type Address } from "./contracts.js";
import type { FenceVerdict } from "./fenceEvaluate.js";
import type { Sha256Digest } from "./canonical.js";
import { networkFor, type ArcEnvironment } from "./networks.js";

type Hex = `0x${string}`;

export const ERC8354_EIP = "https://eips.ethereum.org/EIPS/eip-8354" as const;
/** ERC-8004 ValidationRegistry `tag` used for Lykia's ERC-8354 attestations. */
export const ERC8354_TAG = "erc-8354" as const;

export type Mechanism = "independent-mediator" | "public-recomputable" | "self-attested" | "zk-secret-policy";

export const POLICY_KIND = { ALLOWED: 0, DENIED: 1, NOT_PERMITTED: 2, COULD_NOT_EVALUATE: 3 } as const;
export type PolicyKind = (typeof POLICY_KIND)[keyof typeof POLICY_KIND];

export interface Erc8354Verdict {
  readonly agentId: bigint;
  readonly domainId: Hex;
  readonly policyRoot: Hex;
  readonly actionCommitment: Hex;
  readonly executor: Address;
  readonly expiry: bigint;
  readonly nullifier: Hex;
  readonly decision: 0 | 1;
  readonly policyKind: PolicyKind;
}

export interface VerdictAttestation {
  readonly agentId: bigint;
  /** == Verdict.actionCommitment */
  readonly artifactHash: Hex;
  readonly policyRoot: Hex;
  readonly domainId: Hex;
  readonly nullifier: Hex;
  readonly decision: 0 | 1;
  readonly mechanism: Hex;
  readonly expiry: bigint;
}

const hex = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`;

export function keccak(data: Hex | Uint8Array): Hex {
  return hex(keccak_256(typeof data === "string" ? hexToBytes(data.slice(2)) : data));
}

export function keccakText(text: string): Hex {
  return hex(keccak_256(utf8ToBytes(text)));
}

export function mechanismTag(mechanism: Mechanism): Hex {
  return keccakText(mechanism);
}

/* ---------------------------------------------------- ABI encoding (static) */

type StaticType = "uint256" | "uint64" | "uint8" | "bytes32" | "address";

function word(type: StaticType, value: bigint | number | string): string {
  if (type === "bytes32") {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) throw new Error(`bytes32 expected, got ${String(value)}`);
    return value.slice(2).toLowerCase();
  }
  if (type === "address") {
    if (typeof value !== "string" || !isAddress(value)) throw new Error(`address expected, got ${String(value)}`);
    return value.slice(2).toLowerCase().padStart(64, "0");
  }
  const bits = type === "uint256" ? 256n : type === "uint64" ? 64n : 8n;
  const n = BigInt(value);
  if (n < 0n || n >= 1n << bits) throw new Error(`${type} out of range: ${n}`);
  return n.toString(16).padStart(64, "0");
}

/** `abi.encode(...)` for static types only (every word 32 bytes, no offsets). */
export function encodeStatic(types: readonly StaticType[], values: readonly (bigint | number | string)[]): Hex {
  if (types.length !== values.length) throw new Error("types and values differ in length.");
  return `0x${types.map((t, i) => word(t, values[i] as bigint | number | string)).join("")}`;
}

/* ------------------------------------------------------------- the model */

/** Lykia's policy domain on one Arc environment: `keccak256("lykia.fence/v1:<chainId>")`. */
export function lykiaDomainId(environment: ArcEnvironment): Hex {
  return keccakText(`lykia.fence/v1:${networkFor(environment).chainId}`);
}

/**
 * Commitment to the Fence the decision used, without revealing it. Fence
 * documents are low entropy (templates), so the draft's padding rule applies:
 * the sha256 Fence hash is combined with a 32-byte salt kept by the owner.
 * Disclosing (Fence, salt) to an auditor lets them recompute the root.
 */
export function policyRootFor(fenceHash: Sha256Digest, salt: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(salt)) throw new Error("salt must be 32 bytes of hex.");
  return keccak(encodeStatic(["bytes32", "bytes32"], [`0x${fenceHash.slice(7)}`, salt]));
}

export interface ActionInput {
  readonly environment: ArcEnvironment;
  readonly domainId: Hex;
  readonly agentId: bigint;
  readonly target: Address;
  /** Native value, wei-like base units. */
  readonly value: bigint;
  readonly callData: Hex;
  readonly actionNonce: bigint;
}

/** Exactly the draft's definition, with `block.chainid` = the Arc chain id. */
export function actionCommitment(input: ActionInput): Hex {
  return keccak(
    encodeStatic(
      ["uint256", "bytes32", "uint256", "address", "uint256", "bytes32", "uint256"],
      [BigInt(networkFor(input.environment).chainId), input.domainId, input.agentId, input.target, input.value, keccak(input.callData), input.actionNonce],
    ),
  );
}

/** Single-use verdict id. The draft uses Poseidon over these inputs; Lykia uses keccak256 (documented deviation). */
export function nullifierFor(domainId: Hex, agentId: bigint, commitment: Hex, actionNonce: bigint): Hex {
  return keccak(encodeStatic(["bytes32", "uint256", "bytes32", "uint256"], [domainId, agentId, commitment, actionNonce]));
}

/**
 * Fence decision -> (decision, policyKind):
 *  - allow, or confirm that the owner confirmed -> 1 / ALLOWED
 *  - deny where every refusal is a missing fact -> 0 / COULD_NOT_EVALUATE
 *  - deny where a rule fired -> 0 / DENIED
 *  - confirm not (yet) confirmed -> 0 / NOT_PERMITTED (nothing authorized it)
 */
export function policyKindFor(verdict: Pick<FenceVerdict, "decision" | "reasons">, confirmed = false): { decision: 0 | 1; policyKind: PolicyKind } {
  if (verdict.decision === "allow" || (verdict.decision === "confirm" && confirmed)) return { decision: 1, policyKind: POLICY_KIND.ALLOWED };
  if (verdict.decision === "confirm") return { decision: 0, policyKind: POLICY_KIND.NOT_PERMITTED };
  const denies = verdict.reasons.filter((r) => r.decision === "deny");
  if (denies.length > 0 && denies.every((r) => r.rule === "facts.unavailable")) return { decision: 0, policyKind: POLICY_KIND.COULD_NOT_EVALUATE };
  return { decision: 0, policyKind: POLICY_KIND.DENIED };
}

/** The draft requires decision and policyKind to agree before anything else is checked. */
export function kindAgrees(decision: number, policyKind: number): boolean {
  return decision === 1 ? policyKind === POLICY_KIND.ALLOWED : decision === 0 && (policyKind === 1 || policyKind === 2 || policyKind === 3);
}

export interface VerdictInput {
  readonly environment: ArcEnvironment;
  readonly agentId: string;
  readonly verdict: Pick<FenceVerdict, "decision" | "reasons" | "fenceHash">;
  readonly confirmed?: boolean;
  readonly salt: Hex;
  readonly executor: Address;
  readonly target: Address;
  readonly value?: bigint;
  readonly callData: Hex;
  readonly actionNonce: bigint;
  /** Unix seconds, exclusive. */
  readonly expiry: bigint;
}

export function buildVerdict(input: VerdictInput): Erc8354Verdict {
  if (!/^\d{1,78}$/u.test(input.agentId)) throw new Error("agentId must be a decimal token id.");
  const agentId = BigInt(input.agentId);
  const domainId = lykiaDomainId(input.environment);
  const commitment = actionCommitment({ environment: input.environment, domainId, agentId, target: input.target, value: input.value ?? 0n, callData: input.callData, actionNonce: input.actionNonce });
  const { decision, policyKind } = policyKindFor(input.verdict, input.confirmed);
  return {
    agentId,
    domainId,
    policyRoot: policyRootFor(input.verdict.fenceHash, input.salt),
    actionCommitment: commitment,
    executor: input.executor,
    expiry: input.expiry,
    nullifier: nullifierFor(domainId, agentId, commitment, input.actionNonce),
    decision,
    policyKind,
  };
}

const VERDICT_TYPES: readonly StaticType[] = ["uint256", "bytes32", "bytes32", "bytes32", "address", "uint64", "bytes32", "uint8", "uint8"];
const ATTESTATION_TYPES: readonly StaticType[] = ["uint256", "bytes32", "bytes32", "bytes32", "bytes32", "uint8", "bytes32", "uint64"];

/** `abi.encode(Verdict)` (a static tuple, so identical to encoding its fields in order). */
export function encodeVerdict(v: Erc8354Verdict): Hex {
  if (!kindAgrees(v.decision, v.policyKind)) throw new Error(`decision ${v.decision} and policyKind ${v.policyKind} disagree.`);
  return encodeStatic(VERDICT_TYPES, [v.agentId, v.domainId, v.policyRoot, v.actionCommitment, v.executor, v.expiry, v.nullifier, v.decision, v.policyKind]);
}

export function attestationFor(v: Erc8354Verdict, mechanism: Mechanism = "independent-mediator"): VerdictAttestation {
  if (mechanism === "zk-secret-policy") throw new Error("Lykia verdicts are not zero-knowledge proofs; zk-secret-policy is reserved for ZK Guards.");
  return { agentId: v.agentId, artifactHash: v.actionCommitment, policyRoot: v.policyRoot, domainId: v.domainId, nullifier: v.nullifier, decision: v.decision, mechanism: mechanismTag(mechanism), expiry: v.expiry };
}

/** `abi.encode(VerdictAttestation)`. */
export function encodeAttestation(a: VerdictAttestation): Hex {
  return encodeStatic(ATTESTATION_TYPES, [a.agentId, a.artifactHash, a.policyRoot, a.domainId, a.nullifier, a.decision, a.mechanism, a.expiry]);
}

/** The ValidationRegistry request hash (the verdict envelope) and response hash (the attestation). */
export function registryHashes(v: Erc8354Verdict, a: VerdictAttestation): { readonly requestHash: Hex; readonly responseHash: Hex } {
  return { requestHash: keccak(encodeVerdict(v)), responseHash: keccak(encodeAttestation(a)) };
}

/** ERC-8004 response score: 100 for ALLOWED, 0 otherwise. */
export function responseScore(v: Pick<Erc8354Verdict, "decision">): number {
  return v.decision === 1 ? 100 : 0;
}

/** JSON-safe view (bigints as decimal strings) for request/response URIs and API answers. */
export function verdictJson(v: Erc8354Verdict): Record<string, string | number> {
  return { agentId: v.agentId.toString(), domainId: v.domainId, policyRoot: v.policyRoot, actionCommitment: v.actionCommitment, executor: v.executor, expiry: v.expiry.toString(), nullifier: v.nullifier, decision: v.decision, policyKind: v.policyKind };
}

export function attestationJson(a: VerdictAttestation): Record<string, string | number> {
  return { agentId: a.agentId.toString(), artifactHash: a.artifactHash, policyRoot: a.policyRoot, domainId: a.domainId, nullifier: a.nullifier, decision: a.decision, mechanism: a.mechanism, expiry: a.expiry.toString() };
}
