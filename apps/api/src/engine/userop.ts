/**
 * Steps executed by a smart account through ERC-4337 (Circle Modular
 * Wallets with passkeys and similar). The account signs one UserOperation
 * whose callData runs the prepared calls; a bundler puts it in a
 * `handleOps` transaction on the EntryPoint. `submit` then receives the
 * userOpHash instead of a transaction hash.
 *
 * Resolution: the EntryPoint's `UserOperationEvent(userOpHash, sender,
 * paymaster, nonce, success, ...)` is found in recent Arc logs (EntryPoint
 * v0.6, v0.7 and v0.8 are all deployed on both Arc networks; eth_getCode
 * checked 2026-11-01). The bundle transaction is decoded as `handleOps`
 * (v0.7/v0.8 packed or v0.6 layout), the operation with the same sender and
 * nonce is taken, and every prepared call (target, value, data) must appear
 * in its callData. Matching is containment rather than decoding the
 * account's own execute ABI, so it works for ERC-7579, Kernel, Safe and
 * Circle accounts alike; the sender, nonce and success flag come from the
 * EntryPoint's event.
 *
 * Limitation: a bundle sent through a wrapper contract instead of a direct
 * `EntryPoint.handleOps` call cannot be decoded and is refused with a clear
 * message; the bundler's `eth_getUserOperationReceipt` is not used because
 * Circle's bundler endpoint needs credentials.
 */
import type { Address, ArcEnvironment, UnsignedTransaction } from "@lykia/core";
import { decodeFunctionData, parseAbi, parseAbiItem, type Hex } from "viem";
import type { ArcChains } from "../chains/arc.js";

export const ENTRY_POINTS: readonly Address[] = [
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032", // v0.7
  "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108", // v0.8
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", // v0.6
];

export const USER_OPERATION_EVENT = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
);

const HANDLE_OPS_ABIS = [
  parseAbi(["function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)"]),
  parseAbi(["function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)"]),
] as const;

/** Blocks scanned per eth_getLogs call (Arc's public RPC caps a call at 10,000) and windows tried. */
export const LOG_WINDOW = 9_999n;
export const LOG_WINDOWS = 4;

export interface ResolvedUserOp {
  readonly userOpHash: Hex;
  readonly transactionHash: Hex;
  readonly entryPoint: Address;
  readonly sender: Address;
  readonly nonce: bigint;
  readonly success: boolean;
  readonly callData: Hex;
}

export class UserOpError extends Error {
  constructor(readonly code: "NOT_FOUND" | "BINDING_MISMATCH", message: string) {
    super(message);
  }
}

type Client = {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: { address: readonly Address[]; event: typeof USER_OPERATION_EVENT; args: { userOpHash: Hex }; fromBlock: bigint; toBlock: bigint }): Promise<readonly { transactionHash: Hex | null; address: Address; args: { sender?: Address; nonce?: bigint; success?: boolean } }[]>;
  getTransaction(args: { hash: Hex }): Promise<{ input: Hex; to: Address | null }>;
};

export async function resolveUserOp(chains: ArcChains, environment: ArcEnvironment, userOpHash: Hex): Promise<ResolvedUserOp> {
  const client = chains.client(environment) as unknown as Client;
  const head = await client.getBlockNumber();
  for (let w = 0; w < LOG_WINDOWS; w++) {
    const toBlock = head - BigInt(w) * (LOG_WINDOW + 1n);
    if (toBlock < 0n) break;
    const fromBlock = toBlock > LOG_WINDOW ? toBlock - LOG_WINDOW : 0n;
    const logs = await client.getLogs({ address: ENTRY_POINTS, event: USER_OPERATION_EVENT, args: { userOpHash }, fromBlock, toBlock });
    const log = logs[0];
    if (!log || !log.transactionHash) continue;
    const { sender, nonce, success } = log.args;
    if (!sender || nonce === undefined || success === undefined) continue;
    const tx = await client.getTransaction({ hash: log.transactionHash });
    const op = findOp(tx.input, sender, nonce);
    if (!op) throw new UserOpError("BINDING_MISMATCH", "The bundle transaction is not a direct EntryPoint.handleOps call Lykia can read, so the executed calls cannot be checked.");
    return { userOpHash, transactionHash: log.transactionHash, entryPoint: log.address, sender, nonce, success, callData: op };
  }
  throw new UserOpError("NOT_FOUND", "Arc has no UserOperationEvent for that userOpHash in the last few hours. Submit again once the bundler has included it.");
}

function findOp(input: Hex, sender: Address, nonce: bigint): Hex | null {
  for (const abi of HANDLE_OPS_ABIS) {
    try {
      const { args } = decodeFunctionData({ abi, data: input });
      const ops = args[0] as readonly { sender: Address; nonce: bigint; callData: Hex }[];
      const op = ops.find((o) => o.sender.toLowerCase() === sender.toLowerCase() && o.nonce === nonce);
      if (op) return op.callData;
    } catch {
      // try the next layout
    }
  }
  return null;
}

/** Every prepared call must be in the operation's callData (target, data and, when non-zero, value). */
export function opRunsPrepared(op: Pick<ResolvedUserOp, "callData" | "sender">, prepared: readonly UnsignedTransaction[]): boolean {
  const body = op.callData.toLowerCase();
  return prepared.every((tx) => {
    if (tx.from.toLowerCase() !== op.sender.toLowerCase()) return false;
    const target = tx.to.toLowerCase().slice(2);
    const data = tx.data.toLowerCase().slice(2);
    const valueOk = BigInt(tx.value) === 0n || body.includes(BigInt(tx.value).toString(16).padStart(64, "0"));
    return body.includes(target) && (data.length === 0 || body.includes(data)) && valueOk;
  });
}
