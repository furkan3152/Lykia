/**
 * Call shaping for Arc. A value-moving call is wrapped in Arc's Memo
 * contract (one transaction, the signer stays msg.sender through CallFrom).
 * When an approval is needed first, approve + call are batched through
 * Multicall3From.aggregate3 with the memo-wrapped call inside (also
 * CallFrom: one final transaction, the signer stays msg.sender). Both need an EOA signer; smart accounts
 * get plain calls.
 */
import { contractAddress, memoData, memoId, type Address, type ArcEnvironment, type LykiaMemo, type UnsignedTransaction } from "@lykia/core";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { MEMO_ABI, MULTICALL3_FROM_ABI } from "./abis.js";

export interface RawCall {
  readonly to: Address;
  readonly data: Hex;
  readonly label: string;
  /** "fee": Lykia's fee transfer; never the call that carries the memo. */
  readonly role?: "fee";
}

/** Lykia's protocol fee: a plain ERC-20 transfer from the signer to the fee recipient, inside the step's batch. */
export function feeCall(token: Address, recipient: Address, amount: bigint, label: string): RawCall {
  return { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }), label, role: "fee" };
}

export interface ShapeOptions {
  readonly environment: ArcEnvironment;
  readonly chainId: number;
  readonly from: Address;
  readonly memo: LykiaMemo;
  /** EOAs get Memo and Multicall3From; smart accounts get plain calls. */
  readonly account: "eoa" | "smart";
}

export function approveCall(token: Address, spender: Address, amount: bigint, label: string): RawCall {
  return { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }), label };
}

export function withMemo(call: RawCall, options: ShapeOptions): RawCall {
  return {
    to: contractAddress("memo", options.environment) as Address,
    data: encodeFunctionData({ abi: MEMO_ABI, functionName: "memo", args: [call.to, call.data, memoId(options.memo.intentId, options.memo.stepId), memoData(options.memo)] }),
    label: `${call.label} (with Arc memo)`,
  };
}

export function batched(calls: readonly RawCall[], environment: ArcEnvironment): RawCall {
  return {
    to: contractAddress("multicall3From", environment) as Address,
    data: encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [calls.map((c) => ({ target: c.to, allowFailure: false, callData: c.data }))] }),
    label: calls.map((c) => c.label).join(" + "),
  };
}

/**
 * The transactions for a step: [approvals…] + calls, the last call being
 * the value-moving one that carries the memo.
 *  - EOA, one call, no approval: the call wrapped in a Memo.
 *  - EOA otherwise: one Multicall3From batch [approvals…, calls…, Memo(last)]
 *    (composition checked with eth_call on Arc, 2026-11-01): one signature,
 *    one final transaction, the signer stays msg.sender throughout.
 *  - smart account: plain calls in order.
 */
export function shape(main: RawCall | readonly RawCall[], approval: RawCall | readonly RawCall[] | null, options: ShapeOptions): UnsignedTransaction[] {
  const calls = Array.isArray(main) ? (main as readonly RawCall[]) : [main as RawCall];
  const approvals = approval === null ? [] : Array.isArray(approval) ? (approval as readonly RawCall[]) : [approval as RawCall];
  if (calls.length === 0) throw new Error("A step needs at least one call.");
  const tx = (call: RawCall): UnsignedTransaction => ({ chainId: options.chainId, from: options.from, to: call.to, data: call.data, value: "0", label: call.label });
  if (options.account === "smart") return [...approvals, ...calls].map(tx);
  if (approvals.length === 0 && calls.length === 1) return [tx(withMemo(calls[0] as RawCall, options))];
  // The memo rides on the last value-moving call; a fee transfer after it (borrow) stays a plain call.
  let target = calls.length - 1;
  while (target > 0 && calls[target]?.role === "fee") target -= 1;
  const inner = calls.map((c, i) => (i === target ? withMemo(c, options) : c));
  return [tx(batched([...approvals, ...inner], options.environment))];
}
