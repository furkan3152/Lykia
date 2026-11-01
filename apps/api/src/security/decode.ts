/**
 * Calldata decoding for the security layer. Unwraps Multicall3From batches
 * and Arc Memo wrappers, then classifies every leaf call: ERC-20 moves and
 * approvals, Permit / Permit2, setApprovalForAll, native value, and venue
 * calls with the receivers their ABI names. The ABIs come from the engine,
 * so a venue the engine learns is decoded here without another list.
 */
import type { Address, UnsignedTransaction } from "@lykia/core";
import type { DecodedCall } from "@lykia/core/security/index";
import { decodeFunctionData, erc20Abi, parseAbi, toFunctionSelector, toFunctionSignature, type Abi, type AbiFunction, type AbiParameter, type Hex } from "viem";
import * as ENGINE_ABIS from "../engine/abis.js";

const MEMO = ENGINE_ABIS.MEMO_ABI;
const BATCH = ENGINE_ABIS.MULTICALL3_FROM_ABI;
const EXTRA = parseAbi([
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function setApprovalForAll(address operator, bool approved)",
  "function increaseAllowance(address spender, uint256 addedValue) returns (bool)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function mint(uint256 shares, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);
const PERMIT2_APPROVE = "0x87517c45";
const RECEIVER_NAMES = new Set(["receiver", "recipient", "onBehalfOf", "onBehalf", "mintRecipient", "to"]);

/** Every function ABI the engine encodes, plus the token and vault standards. */
const VENUE_ABI: Abi = [
  ...Object.values(ENGINE_ABIS).flatMap((abi) => (Array.isArray(abi) ? (abi as Abi) : [])),
  ...EXTRA,
].filter((item) => item.type === "function") as Abi;

function receiverPaths(params: readonly AbiParameter[], values: readonly unknown[], prefix = ""): { name: string; address: Address }[] {
  const out: { name: string; address: Address }[] = [];
  params.forEach((p, i) => {
    const value = values[i] ?? (p.name && typeof values === "object" ? (values as unknown as Record<string, unknown>)[p.name] : undefined);
    const name = `${prefix}${p.name ?? `arg${i}`}`;
    if ("components" in p && p.components && value && typeof value === "object") {
      const inner = Array.isArray(value) ? value : p.components.map((c) => (value as Record<string, unknown>)[c.name ?? ""]);
      out.push(...receiverPaths(p.components, inner, `${name}.`));
      return;
    }
    if (!p.name || !RECEIVER_NAMES.has(p.name)) return;
    if (p.type === "address" && typeof value === "string") out.push({ name, address: value as Address });
    if (p.type === "bytes32" && typeof value === "string") out.push({ name, address: `0x${value.slice(-40)}` as Address });
  });
  return out;
}

function leaf(target: Address, data: Hex, memo: boolean): DecodedCall[] {
  const selector = data.slice(0, 10).toLowerCase();
  if (selector === PERMIT2_APPROVE) {
    try {
      const { args } = decodeFunctionData({ abi: ENGINE_ABIS.PERMIT2_ABI, data });
      const [token, spender, amount] = args as unknown as [Address, Address, bigint];
      return [{ kind: "permit2-approve", token, spender, amount: amount.toString() }];
    } catch {
      /* fall through */
    }
  }
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data });
    const a = decoded.args as readonly unknown[];
    if (decoded.functionName === "transfer") return [{ kind: "erc20-transfer", token: target, to: a[0] as Address, amount: String(a[1]) }];
    if (decoded.functionName === "approve") return [{ kind: "erc20-approve", token: target, spender: a[0] as Address, amount: String(a[1]) }];
    if (decoded.functionName === "transferFrom") return [{ kind: "erc20-transfer-from", token: target, from: a[0] as Address, to: a[1] as Address, amount: String(a[2]) }];
  } catch {
    /* not ERC-20 */
  }
  try {
    const decoded = decodeFunctionData({ abi: EXTRA, data });
    const a = decoded.args as readonly unknown[];
    if (decoded.functionName === "permit") return [{ kind: "permit", token: target, spender: a[1] as Address, amount: String(a[2]) }];
    if (decoded.functionName === "setApprovalForAll") return [{ kind: "approval-for-all", target, operator: a[0] as Address, approved: a[1] as boolean }];
    if (decoded.functionName === "increaseAllowance") return [{ kind: "erc20-approve", token: target, spender: a[0] as Address, amount: String(a[1]) }];
  } catch {
    /* not a standard extra */
  }
  try {
    const decoded = decodeFunctionData({ abi: VENUE_ABI, data });
    const item = (VENUE_ABI as readonly AbiFunction[]).find((f) => f.type === "function" && toFunctionSelector(f) === selector);
    return [{ kind: "call", target, selector, fn: item ? toFunctionSignature(item) : decoded.functionName, receivers: item ? receiverPaths(item.inputs, (decoded.args ?? []) as readonly unknown[]) : [], ...(memo ? { memo: true } : {}) }];
  } catch {
    return [{ kind: "call", target, selector, fn: null, receivers: [], ...(memo ? { memo: true } : {}) }];
  }
}

function unwrap(target: Address, data: Hex, memo: boolean, depth: number): DecodedCall[] {
  if (depth > 4) return [{ kind: "call", target, selector: data.slice(0, 10), fn: null, receivers: [] }];
  try {
    const decoded = decodeFunctionData({ abi: MEMO, data });
    if (decoded.functionName === "memo") {
      const [inner, innerData] = decoded.args as unknown as [Address, Hex];
      return unwrap(inner, innerData, true, depth + 1);
    }
  } catch {
    /* not a memo */
  }
  try {
    const decoded = decodeFunctionData({ abi: BATCH, data });
    if (decoded.functionName === "aggregate3") {
      const calls = decoded.args[0] as readonly { target: Address; callData: Hex }[];
      return calls.flatMap((c) => unwrap(c.target, c.callData, false, depth + 1));
    }
  } catch {
    /* not a batch */
  }
  return leaf(target, data, memo);
}

/** The decoded leaf calls of a step's prepared transactions, in execution order. */
export function decodeTransactions(transactions: readonly UnsignedTransaction[]): DecodedCall[] {
  return transactions.flatMap((tx) => {
    const value = BigInt(tx.value || "0");
    const calls = tx.data === "0x" ? [] : unwrap(tx.to, tx.data, false, 0);
    return value > 0n ? [{ kind: "native", to: tx.to, value: value.toString() } as DecodedCall, ...calls] : calls;
  });
}
