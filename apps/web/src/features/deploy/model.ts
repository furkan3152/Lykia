/**
 * Owner-console deployment model (pure). Lykia's core contracts are created by
 * plain CREATE transactions from the owner's own wallet, so explorers show that
 * wallet as the creator. Recorded deployments drive resume: a step that is
 * already recorded is skipped, later steps resolve their references from it.
 */
import { lykiaContracts } from "@lykia/core";
import type { DeploymentRecord } from "@lykia/core/api/platform";

export type DeployedMap = lykiaContracts.DeployedAddresses;

/** Addresses already recorded for this environment, by plan step name. */
export function deployedFromRecords(records: readonly Pick<DeploymentRecord, "environment" | "contract" | "address" | "name">[], environment: "mainnet" | "testnet"): DeployedMap {
  const out: Partial<Record<lykiaContracts.LykiaDeployable, `0x${string}`>> = {};
  for (const r of records) {
    if (r.environment !== environment) continue;
    out[(r.name ?? r.contract) as lykiaContracts.LykiaDeployable] = r.address as `0x${string}`;
  }
  return out;
}

export type StepState = "done" | "next" | "waiting";

export function stepStates(plan: lykiaContracts.DeployPlan, deployed: DeployedMap): Record<string, StepState> {
  const states: Record<string, StepState> = {};
  let nextGiven = false;
  for (const step of plan.steps) {
    if (deployed[step.name]) states[step.name] = "done";
    else if (!nextGiven) {
      states[step.name] = "next";
      nextGiven = true;
    } else states[step.name] = "waiting";
  }
  return states;
}

/** True once every step is deployed: the admin calls (router allowlist) can go out. */
export function allDeployed(plan: lykiaContracts.DeployPlan, deployed: DeployedMap): boolean {
  return plan.steps.every((s) => Boolean(deployed[s.name]));
}

/** Contract creation needs an EOA: a smart account's creations are made by its own code, not the user's wallet. */
export function creationBlocker(kind: "browser" | "passkey" | null): string | null {
  if (kind === null) return "Connect a browser wallet to deploy.";
  if (kind === "passkey") return "Contracts must be created by a regular wallet (EOA) so explorers show your wallet as the creator. A passkey account is a smart contract, so its creations would show the account instead. Connect a browser wallet (MetaMask, Rabby, OKX…) for deployment.";
  return null;
}

/** Where the next contract will land: CREATE address from the wallet's pending nonce. */
export function nextAddress(owner: `0x${string}`, pendingNonce: number): `0x${string}` {
  return lykiaContracts.predictCreate(owner, pendingNonce);
}
