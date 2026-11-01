/**
 * The Tag: an agent's tag. On Arc it is an ERC-8004 identity (an NFT in
 * the IdentityRegistry) whose registration card and on-chain metadata pin
 * the hash of the Fence the agent obeys. Every plan the agent runs carries
 * a Fence verdict; the owner can file that verdict to the ERC-8004
 * ValidationRegistry, so "this agent stayed inside its Fence" becomes a
 * public, checkable record rather than a promise.
 *
 * Pure: builds documents and hashes; the API encodes the calls.
 */
import { canonicalDigest, type Sha256Digest } from "./canonical.js";
import { contractAddress, isAddress, type Address } from "./contracts.js";
import { FENCE_SCHEMA } from "./fence.js";
import { VERDICT_SCHEMA, type FenceVerdict } from "./fenceEvaluate.js";
import { networkFor, type ArcEnvironment } from "./networks.js";

/** Schema of a Lykia agent Tag card. */
export const TAG_SCHEMA = "lykia.tag/v1" as const;
/** @deprecated Cards written before the Tag rename; still readable. */
export const KUNYE_SCHEMA = "lykia.kunye/v1" as const;
export const VALIDATION_SCHEMA = "lykia.validation/v1" as const;
export const ERC8004_REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const;
/** IdentityRegistry metadata key holding the Fence hash (32 bytes). */
export const FENCE_METADATA_KEY = "lykia.fence" as const;
/** Validation tag Lykia uses in the ValidationRegistry. */
export const VALIDATION_TAG = "lykia-fence" as const;

export interface KunyeEndpoint {
  readonly name: string;
  readonly endpoint: string;
  readonly version?: string;
}

export interface KunyeCard {
  readonly type: typeof ERC8004_REGISTRATION_TYPE;
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly endpoints: readonly KunyeEndpoint[];
  readonly registrations: readonly { readonly agentId: number; readonly agentRegistry: string }[];
  readonly supportedTrust: readonly string[];
  readonly lykia: {
    readonly schema: typeof TAG_SCHEMA | typeof KUNYE_SCHEMA;
    readonly owner: Address;
    readonly fenceHash: Sha256Digest;
    readonly fenceSchema: typeof FENCE_SCHEMA;
    readonly verdictSchema: typeof VERDICT_SCHEMA;
    readonly validationTag: typeof VALIDATION_TAG;
    readonly environment: ArcEnvironment;
  };
}

export interface KunyeDraftInput {
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  /** The agent's own signing wallet, when it differs from the owner. */
  readonly agentWallet?: Address;
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly fenceHash: Sha256Digest;
  readonly endpoints?: readonly KunyeEndpoint[];
  readonly agentId?: number;
}

export function buildKunyeCard(input: KunyeDraftInput): KunyeCard {
  if (!isAddress(input.owner)) throw new Error("owner must be an address.");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 64) throw new Error("name must be 2 to 64 characters.");
  const description = input.description.trim();
  if (description.length > 500) throw new Error("description is at most 500 characters.");
  const network = networkFor(input.environment);
  const registry = contractAddress("identityRegistry", input.environment) as Address;
  const wallet = input.agentWallet ?? input.owner;
  const endpoints: KunyeEndpoint[] = [...(input.endpoints ?? []).slice(0, 8), { name: "agentWallet", endpoint: `${network.caip2}:${wallet}` }];
  return {
    type: ERC8004_REGISTRATION_TYPE,
    name,
    description,
    ...(input.image ? { image: input.image } : {}),
    endpoints,
    registrations: input.agentId === undefined ? [] : [{ agentId: input.agentId, agentRegistry: `${network.caip2}:${registry}` }],
    supportedTrust: ["reputation", "validation"],
    lykia: {
      schema: TAG_SCHEMA,
      owner: input.owner,
      fenceHash: input.fenceHash,
      fenceSchema: FENCE_SCHEMA,
      verdictSchema: VERDICT_SCHEMA,
      validationTag: VALIDATION_TAG,
      environment: input.environment,
    },
  };
}

export function kunyeCardDigest(card: KunyeCard): Sha256Digest {
  return canonicalDigest(card);
}

/** `sha256:abcd…` -> `0xabcd…` (the 32 bytes as a bytes32). */
export function digestToBytes32(digest: Sha256Digest): `0x${string}` {
  return `0x${digest.slice("sha256:".length)}`;
}

export interface ValidationRecord {
  readonly schema: typeof VALIDATION_SCHEMA;
  readonly environment: ArcEnvironment;
  readonly agentId: string;
  readonly intentId: string;
  readonly decision: FenceVerdict["decision"];
  readonly signable: boolean;
  readonly fenceHash: Sha256Digest;
  readonly factsDigest: Sha256Digest;
  readonly verdictDigest: Sha256Digest;
  readonly rules: readonly string[];
}

/** The record filed as an ERC-8004 validation request; its digest is the requestHash. */
export function validationRecord(input: { readonly environment: ArcEnvironment; readonly agentId: string; readonly intentId: string; readonly verdict: FenceVerdict }): ValidationRecord {
  if (!/^\d{1,78}$/u.test(input.agentId)) throw new Error("agentId must be a decimal token id.");
  return {
    schema: VALIDATION_SCHEMA,
    environment: input.environment,
    agentId: input.agentId,
    intentId: input.intentId,
    decision: input.verdict.decision,
    signable: input.verdict.signable,
    fenceHash: input.verdict.fenceHash,
    factsDigest: input.verdict.factsDigest,
    verdictDigest: input.verdict.digest,
    rules: input.verdict.reasons.map((r) => `${r.rule}:${r.decision}`),
  };
}

export function validationRequestHash(record: ValidationRecord): `0x${string}` {
  return digestToBytes32(canonicalDigest(record));
}

/** ERC-8004 response codes are 0-100; Lykia answers 100 when the verdict re-derives and allowed, 0 when it denied. */
export function validationScore(verdict: FenceVerdict): number {
  return verdict.decision === "deny" ? 0 : verdict.decision === "confirm" ? 80 : 100;
}

/* Tag names: the agent Tag is the product name; the Kunye* names stay as aliases for existing callers. */
export type TagEndpoint = KunyeEndpoint;
export type TagCard = KunyeCard;
export type TagDraftInput = KunyeDraftInput;
export const buildTagCard = buildKunyeCard;
export const tagCardDigest = kunyeCardDigest;
