/**
 * One transaction for many transfers. A planned intent's steps (each a
 * transfer with its fee and its own Arc Memo) are flattened exactly as the
 * simulator flattens them and wrapped in one Multicall3From.aggregate3
 * (allowFailure false, so the batch settles whole or not at all; CallFrom
 * keeps the payer as msg.sender in every inner call). The receipt's Memo
 * events then prove each row by its memo id.
 */
import { memoId, networkFor, type Address, type ArcEnvironment, type UnsignedTransaction } from "@lykia/core";
import { decodeEventLog, erc20Abi, type Hex } from "viem";
import type { ArcChains } from "../chains/arc.js";
import { MEMO_ABI } from "../engine/abis.js";
import type { StepPlan } from "../engine/adapters.js";
import { batched } from "../engine/calls.js";
import { bindingOf, matchesPrepared } from "../engine/service.js";
import { routeCalls, simulateRoute, type SimStep } from "../engine/simulate.js";

export interface BuiltBatch {
  readonly transaction: UnsignedTransaction;
  readonly binding: string;
  readonly calls: number;
}

export async function buildBatch(chains: ArcChains, environment: ArcEnvironment, payer: Address, intentId: string, verdictDigest: string, steps: readonly SimStep[]): Promise<BuiltBatch> {
  const flat = await routeCalls(chains, environment, payer, intentId, verdictDigest, steps);
  const call = batched(flat.map((f) => f.call), environment);
  const transaction: UnsignedTransaction = { chainId: networkFor(environment).chainId, from: payer, to: call.to, data: call.data, value: "0", label: `Payout batch: ${steps.length} transfer(s) with Arc memos` };
  return { transaction, binding: bindingOf([transaction]), calls: flat.length };
}

/**
 * The batch run as one eth_call from the payer against live state (no
 * funding). `ok: null` means the node could not run the check; a revert
 * means the batch cannot pass as built (short balance, blocklisted payee).
 */
export async function checkBatch(chains: ArcChains, environment: ArcEnvironment, payer: Address, intentId: string, verdictDigest: string, steps: readonly SimStep[]): Promise<{ ok: boolean | null; reason?: string; block?: string | null }> {
  const sim = await simulateRoute(chains, environment, payer, { intentId, verdictDigest, steps }).catch((error: unknown) => ({ ok: false, calls: [], reason: error instanceof Error ? error.message : String(error), block: null }));
  if (sim.ok) return { ok: true, block: sim.block };
  if (sim.calls.length === 0) return { ok: null, reason: `Simulation unavailable: ${sim.reason ?? "no answer"}`, block: sim.block };
  return { ok: false, ...(sim.reason ? { reason: sim.reason } : {}), block: sim.block };
}

export function memoIdFor(intentId: string, stepId: string): string {
  return memoId(intentId, stepId);
}

export interface ReceiptLog {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
}

export interface MemoEvent {
  readonly memoId: string;
  readonly memo: string;
  readonly sender: string;
}

/** Memo events in a receipt's logs. */
export function memoEvents(logs: readonly ReceiptLog[] | undefined): MemoEvent[] {
  const out: MemoEvent[] = [];
  for (const log of logs ?? []) {
    try {
      const decoded = decodeEventLog({ abi: MEMO_ABI, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] });
      if (decoded.eventName === "Memo") out.push({ memoId: String(decoded.args.memoId).toLowerCase(), memo: String(decoded.args.memo), sender: String(decoded.args.sender).toLowerCase() });
    } catch {
      /* not a Memo log */
    }
  }
  return out;
}

export interface TransferEvent {
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
}

export function transferEvents(logs: readonly ReceiptLog[] | undefined): TransferEvent[] {
  const out: TransferEvent[] = [];
  for (const log of logs ?? []) {
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] });
      out.push({ token: log.address.toLowerCase(), from: String(decoded.args.from).toLowerCase(), to: String(decoded.args.to).toLowerCase(), value: decoded.args.value as bigint });
    } catch {
      /* not a Transfer log */
    }
  }
  return out;
}

/** Fetches a transaction and checks it is exactly the prepared one. */
export async function verifySubmitted(chains: ArcChains, environment: ArcEnvironment, prepared: UnsignedTransaction, hash: string): Promise<"match" | "unknown" | "mismatch"> {
  const tx = await chains.getTransaction(environment, hash);
  if (!tx) return "unknown";
  return matchesPrepared(prepared, { from: tx.from, to: tx.to, input: tx.input, value: tx.value, ...(tx.chainId !== undefined ? { chainId: tx.chainId } : {}) }) ? "match" : "mismatch";
}

export type { StepPlan };
