/**
 * Admin console backend: the deployment registry and feature flags.
 *
 * A deployment is recorded only after the server checks it on Arc itself:
 * the transaction receipt exists and succeeded, the address it names was
 * created by that transaction (receipt.contractAddress, or a factory
 * deployment whose logs mention the address), and the runtime bytecode at
 * the address hashes to the expected artifact. The expected hash comes from
 * the compiled artifacts shipped in @lykia/core when they are present; a
 * mismatch is refused, an unknown contract is recorded as unverified.
 */
import { FEATURE_FLAGS, type DeploymentRecord, type FeatureFlag } from "@lykia/core/api/platform";
import type { ArcEnvironment } from "@lykia/core";
import { keccak256, type Address, type Hex } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "./typed.js";

/** Expected runtime code hashes by contract name, from core artifacts if the contracts package exported them. */
export type ExpectedCodeHashes = (contract: string, environment: ArcEnvironment) => Promise<Hex | null>;

export const coreExpectedCodeHashes: ExpectedCodeHashes = async (contract) => {
  try {
    const mod = (await import("@lykia/core/contracts/index")) as Record<string, unknown>;
    const hashes = mod.RUNTIME_CODE_HASHES as Record<string, string> | undefined;
    if (hashes?.[contract]) return hashes[contract] as Hex;
    const artifacts = (mod.CONTRACT_ARTIFACTS ?? mod.ARTIFACTS) as Record<string, { deployedBytecode?: string }> | undefined;
    const code = artifacts?.[contract]?.deployedBytecode;
    return code && code !== "0x" ? keccak256(code as Hex) : null;
  } catch {
    return null;
  }
};

export interface RecordDeploymentInput {
  readonly environment: ArcEnvironment;
  readonly contract: string;
  readonly address: Address;
  readonly txHash: Hex;
  readonly recordedBy: string;
}

export async function recordDeployment(ctx: AppContext, input: RecordDeploymentInput, expected: ExpectedCodeHashes = coreExpectedCodeHashes): Promise<DeploymentRecord> {
  const client = ctx.chains.client(input.environment);
  const receipt = await client.getTransactionReceipt({ hash: input.txHash }).catch(() => null);
  if (!receipt) throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "No receipt for that transaction on Arc.");
  if (receipt.status !== "success") throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "The deployment transaction reverted.");
  const target = input.address.toLowerCase();
  const created = receipt.contractAddress?.toLowerCase() === target || receipt.logs.some((log) => log.address.toLowerCase() === target || log.topics.some((t) => t && t.toLowerCase().endsWith(target.slice(2))));
  if (!created) throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "That transaction did not create this address.");
  const code = await client.getCode({ address: input.address });
  if (!code || code === "0x") throw new LykiaHttpError("DEPLOYMENT_UNVERIFIED", 422, "There is no code at that address.");
  const codeHash = keccak256(code);
  const expectedHash = await expected(input.contract, input.environment);
  if (expectedHash && expectedHash.toLowerCase() !== codeHash.toLowerCase()) throw new LykiaHttpError("DEPLOYMENT_MISMATCH", 422, `The code at ${input.address} does not match the ${input.contract} artifact.`, { codeHash, expectedCodeHash: expectedHash });
  const record: DeploymentRecord = {
    id: `${input.environment}:${input.contract}`,
    environment: input.environment,
    contract: input.contract,
    address: input.address,
    txHash: input.txHash,
    blockNumber: receipt.blockNumber.toString(),
    codeHash,
    expectedCodeHash: expectedHash,
    verified: expectedHash !== null,
    recordedBy: input.recordedBy.toLowerCase(),
    recordedAt: new Date(ctx.clock.now()).toISOString(),
  };
  await typedCollection<DeploymentRecord>(ctx, "deployments").put(record.id, record);
  return record;
}

export async function listDeployments(ctx: AppContext, environment?: ArcEnvironment): Promise<DeploymentRecord[]> {
  return (await typedCollection<DeploymentRecord>(ctx, "deployments").list({ limit: 1000 })).map((d) => d.value).filter((d) => !environment || d.environment === environment);
}

/** Address of a recorded deployment (used by the Pack to build session transactions). */
export async function deployedAddress(ctx: AppContext, environment: ArcEnvironment, contract: string): Promise<Address | null> {
  return ((await typedCollection<DeploymentRecord>(ctx, "deployments").get(`${environment}:${contract}`))?.value.address as Address | undefined) ?? null;
}

const DEFAULT_FLAGS: Readonly<Record<FeatureFlag, boolean>> = { "agents.llm": true, "agents.keeper": false, "pack.onchain": true, x402: true, "developer.signup": true };

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
