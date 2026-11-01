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
 * The transactions for a step: [approval?] + main call.
 *  - EOA, approval needed: one Multicall3From batch [approve, Memo(main)]
 *    (composition checked with eth_call on Arc testnet, 2026-11-01).
 *  - EOA, no approval: the main call wrapped in a Memo.
 *  - smart account: plain calls in order.
 */
export function shape(main: RawCall, approval: RawCall | null, options: ShapeOptions): UnsignedTransaction[] {
  const tx = (call: RawCall): UnsignedTransaction => ({ chainId: options.chainId, from: options.from, to: call.to, data: call.data, value: "0", label: call.label });
  if (options.account === "smart") return [...(approval ? [tx(approval)] : []), tx(main)];
  if (approval) return [tx(batched([approval, withMemo(main, options)], options.environment))];
  return [tx(withMemo(main, options))];
}
