/**
 * Admin console backend: the deployment registry and feature flags.
 *
 * Lykia's core contracts are created by plain CREATE transactions sent from an
 * admin's own wallet, so explorers show that wallet as the creator. A
 * deployment is recorded only after the server checks it on Arc itself: the
 * receipt exists and succeeded, the transaction is a contract creation (no
 * `to`) sent by an admin address, the receipt's contractAddress is the address
 * being recorded, and the runtime code there matches the artifact shipped in
 * @lykia/core (immutables and the CBOR metadata tail ignored). A mismatch is refused; a contract without
 * an artifact is recorded as unverified.
 */
import { FEATURE_FLAGS, type DeploymentRecord, type FeatureFlag } from "@lykia/core/api/platform";
import { lykiaContracts, type ArcEnvironment } from "@lykia/core";
import { keccak256, type Address, type Hex } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "./typed.js";

/** Whether `code` is `contract`'s runtime code: true, false, or null when there is no artifact to compare with. */
export type CodeCheck = (contract: string, code: Hex) => boolean | null;

export const coreCodeCheck: CodeCheck = (contract, code) => lykiaContracts.codeMatchesArtifact(contract, code);

function expectedHash(contract: string): Hex | null {
  const artifact = lykiaContracts.DEPLOYABLE_ARTIFACTS[contract];
  return artifact ? lykiaContracts.runtimeCodeHash(artifact.deployedBytecode as Hex, artifact.immutableReferences) : null;
}

export interface RecordDeploymentInput {
  readonly environment: ArcEnvironment;
  /** Artifact name (LykiaRouter, PracticeVault, …). */
  readonly contract: string;
  /** Plan step name when one artifact is deployed twice (PracticeVaultUSDC); defaults to the contract. */
  readonly name?: string;
  readonly address: Address;
  readonly txHash: Hex;
  readonly recordedBy: string;
}

export async function recordDeployment(ctx: AppContext, input: RecordDeploymentInput, check: CodeCheck = coreCodeCheck): Promise<DeploymentRecord> {
  const client = ctx.chains.client(input.environment);
  const receipt = await client.getTransactionReceipt({ hash: input.txHash }).catch(() => null);
  if (!receipt) throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "No receipt for that transaction on Arc.");
  if (receipt.status !== "success") throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "The deployment transaction reverted.");
  const tx = await client.getTransaction({ hash: input.txHash }).catch(() => null);
  if (!tx) throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "That transaction could not be read from Arc.");
  if (tx.to) throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "That transaction is not a contract creation: deploy straight from your wallet so it shows as the creator.");
  const from = tx.from.toLowerCase();
  if (!ctx.config.platform.adminAddresses.includes(from)) throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, `The deployment was sent by ${tx.from}, which is not an admin address.`);
  const target = input.address.toLowerCase();
  if (receipt.contractAddress?.toLowerCase() !== target) throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "That transaction did not create this address.");
  const code = await client.getCode({ address: input.address });
  if (!code || code === "0x") throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "There is no code at that address.");
  const matches = check(input.contract, code);
  const expected = expectedHash(input.contract);
  if (matches === false) throw new LykiaHttpError("DEPLOYMENT_MISMATCH", 422, `The code at ${input.address} does not match the ${input.contract} artifact.`, { codeHash: keccak256(code), expectedCodeHash: expected });
  const name = input.name ?? input.contract;
  const record: DeploymentRecord = {
    id: `${input.environment}:${name}`,
    environment: input.environment,
    contract: input.contract,
    name,
    address: input.address,
    txHash: input.txHash,
    blockNumber: receipt.blockNumber.toString(),
    creator: tx.from,
    codeHash: keccak256(code),
    expectedCodeHash: expected,
    verified: matches === true,
    recordedBy: input.recordedBy.toLowerCase(),
    recordedAt: new Date(ctx.clock.now()).toISOString(),
  };
  await typedCollection<DeploymentRecord>(ctx, "deployments").put(record.id, record);
  return record;
}

export async function listDeployments(ctx: AppContext, environment?: ArcEnvironment): Promise<DeploymentRecord[]> {
  return (await typedCollection<DeploymentRecord>(ctx, "deployments").list({ limit: 1000 })).map((d) => d.value).filter((d) => !environment || d.environment === environment);
}

/** Address of a recorded deployment by plan step name (used by the Pack to build session transactions). */
export async function deployedAddress(ctx: AppContext, environment: ArcEnvironment, name: string): Promise<Address | null> {
  return ((await typedCollection<DeploymentRecord>(ctx, "deployments").get(`${environment}:${name}`))?.value.address as Address | undefined) ?? null;
}

const DEFAULT_FLAGS: Readonly<Record<FeatureFlag, boolean>> = { "agents.llm": true, "agents.keeper": false, "pack.onchain": true, x402: true, "developer.signup": true, "routing.halt": false };

export async function flags(ctx: AppContext): Promise<Record<FeatureFlag, boolean>> {
  const stored = (await typedCollection<Record<string, boolean>>(ctx, "flags").get("global"))?.value ?? {};
  return Object.fromEntries(FEATURE_FLAGS.map((f) => [f, stored[f] ?? DEFAULT_FLAGS[f]])) as Record<FeatureFlag, boolean>;
}

export async function setFlags(ctx: AppContext, next: Partial<Record<FeatureFlag, boolean>>): Promise<Record<FeatureFlag, boolean>> {
  const current = await flags(ctx);
  const merged = { ...current, ...Object.fromEntries(Object.entries(next).filter(([k]) => (FEATURE_FLAGS as readonly string[]).includes(k))) };
  await typedCollection<Record<string, boolean>>(ctx, "flags").put("global", merged);
  return merged as Record<FeatureFlag, boolean>;
}
