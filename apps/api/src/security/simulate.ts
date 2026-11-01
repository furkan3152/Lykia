/**
 * Layer 1, the simulation. Runs a step's transactions against Arc before
 * anyone signs: `eth_simulateV1` when the RPC supports it (calls run in
 * order, so a smart account's approve-then-act works, and asset changes are
 * traced), otherwise `eth_call` for a single transaction. A revert blocks
 * the step: there is no reason to sign a transaction that fails. An RPC
 * that cannot simulate is reported as `unavailable` with a warning; the
 * decoded balance diff (diff.ts) still decides.
 */
import type { UnsignedTransaction } from "@lykia/core";
import type { SecurityFinding } from "@lykia/core/security/index";
import type { Address, Hex } from "viem";
import { simulateCalls } from "viem/actions";

export interface SimulationResult {
  readonly method: "eth_call" | "eth_simulateV1" | "unavailable" | "skipped";
  readonly findings: SecurityFinding[];
  /** Token deltas for the signer, when traced (negative = leaves the wallet). */
  readonly assetChanges: readonly { readonly token: Address; readonly symbol: string | null; readonly diff: string }[];
}

interface SimClient {
  call?: (args: { account: Address; to: Address; data: Hex; value?: bigint }) => Promise<unknown>;
  request?: unknown;
}

function isRevert(error: unknown): boolean {
  let e: unknown = error;
  for (let i = 0; i < 8 && e; i++) {
    const err = e as { name?: string; shortMessage?: string; message?: string; cause?: unknown };
    if (err.name === "ExecutionRevertedError" || err.name === "ContractFunctionRevertedError" || err.name === "CallExecutionError") return /revert/iu.test(`${err.shortMessage ?? ""} ${err.message ?? ""}`) || err.name !== "CallExecutionError";
    e = err.cause;
  }
  return false;
}

function reason(error: unknown): string {
  const err = error as { shortMessage?: string; message?: string };
  return (err.shortMessage ?? err.message ?? "reverted").split("\n")[0]!.slice(0, 200);
}

export async function simulateStep(client: unknown, stepId: string, transactions: readonly UnsignedTransaction[]): Promise<SimulationResult> {
  if (transactions.length === 0) return { method: "skipped", findings: [], assetChanges: [] };
  const from = transactions[0]!.from;
  const revert = (message: string): SimulationResult["findings"][number] => ({ layer: "simulation", rule: "simulation.reverts", severity: "block", message, stepId });
  const c = client as SimClient;
  if (typeof c.request === "function") {
    try {
      const sim = await simulateCalls(client as never, { account: from, calls: transactions.map((t) => ({ to: t.to, data: t.data, value: BigInt(t.value || "0") })), traceAssetChanges: true });
      const failed = sim.results.findIndex((r) => r.status === "failure");
      const findings = failed >= 0 ? [revert(`Transaction ${failed + 1} would revert on Arc: ${reason((sim.results[failed] as { error?: unknown }).error ?? {})}`)] : [];
      return { method: "eth_simulateV1", findings, assetChanges: sim.assetChanges.filter((a) => a.value.diff !== 0n).map((a) => ({ token: a.token.address, symbol: a.token.symbol ?? null, diff: a.value.diff.toString() })) };
    } catch {
      /* the RPC may not offer eth_simulateV1: fall back to eth_call */
    }
  }
  if (typeof c.call === "function" && transactions.length === 1) {
    const t = transactions[0]!;
    try {
      await c.call({ account: from, to: t.to, data: t.data, value: BigInt(t.value || "0") });
      return { method: "eth_call", findings: [], assetChanges: [] };
    } catch (error) {
      if (isRevert(error)) return { method: "eth_call", findings: [revert(`The transaction would revert on Arc: ${reason(error)}`)], assetChanges: [] };
    }
  }
  return { method: "unavailable", findings: [{ layer: "simulation", rule: "simulation.unavailable", severity: "warn", message: "Arc's RPC could not simulate this step; the decoded balance diff was checked instead.", stepId }], assetChanges: [] };
}
