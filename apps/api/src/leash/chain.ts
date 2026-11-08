/**
 * What a leash reads from and builds for a LykiaAccount on Arc. Reads are
 * authoritative: `spendable()` and `getLimit()` are what the account will
 * actually let the session key spend, whatever Lykia's own records say.
 *
 * Calls the leashed agent signs are wrapped here: a prepared step's plain
 * calls (from the account) become `agentTransfer` for ERC-20 transfers and
 * `agentExecute` for everything else, with an approval folded into the
 * call it was for (`spendToken` / `spendAmount`; the account approves and
 * resets the allowance itself). More than one call goes into one
 * Multicall3From batch from the session key, which keeps the key as
 * msg.sender for each call: one signature per step.
 */
import { contractAddress, decodeMemo, type Address, type ArcEnvironment, type UnsignedTransaction } from "@lykia/core";
import { decodeErrorResult, decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, parseAbi, toFunctionSelector, zeroAddress, type Hex, type Log } from "viem";
import type { AppContext } from "../context.js";
import { MULTICALL3_FROM_ABI } from "../engine/abis.js";

export const ACCOUNT_ABI = parseAbi([
  "struct Session { address key; bytes32 parent; uint64 validUntil; uint64 epoch; uint32 maxCalls; uint32 callsUsed; uint8 depth; bool revoked; bytes32 fenceHash; }",
  "struct Limit { bool allowed; uint128 perCall; uint128 daily; uint128 budget; }",
  "struct UsageView { uint128 dayAmount; uint128 consumed; }",
  "struct Rule { bool allowed; bool homeward; uint32 receiverWords; }",
  "struct AgentCallData { bytes32 sessionId; address target; uint256 value; bytes data; address spendToken; uint256 spendAmount; bytes memo; }",
  "function owner() view returns (address)",
  "function sessionNonce() view returns (uint64)",
  "function whistle() view returns (bool)",
  "function getSession(bytes32 id) view returns (Session)",
  "function getLimit(bytes32 id, address token) view returns (Limit limit, UsageView usage)",
  "function getRule(bytes32 id, address target, bytes4 selector) view returns (Rule)",
  "function isRecipient(bytes32 id, address recipient) view returns (bool)",
  "function isSessionValid(bytes32 id) view returns (bool)",
  "function spendable(bytes32 id, address token) view returns (uint256)",
  "function revokeSession(bytes32 id)",
  "function agentExecute(AgentCallData c) payable returns (bytes)",
  "function agentTransfer(bytes32 sessionId, address token, address to, uint256 amount, bytes memo)",
  "event SessionCreated(bytes32 indexed id, bytes32 indexed parent, address indexed key, uint64 validUntil, uint32 maxCalls, uint8 depth, bytes32 fenceHash)",
  "event SessionRevoked(bytes32 indexed id, address indexed by)",
  "event AgentCall(bytes32 indexed sessionId, address indexed target, bytes4 selector, uint256 value, bytes32 memoHash)",
  "event AgentTransfer(bytes32 indexed sessionId, address indexed token, address indexed to, uint256 amount, bytes32 memoHash)",
  "event AgentMemo(bytes32 indexed sessionId, bytes32 indexed memoHash, bytes memo)",
]);

export const ACCOUNT_ERRORS = parseAbi([
  "error NotOwner()",
  "error BadSpec(string reason)",
  "error SessionInvalid(bytes32 id)",
  "error NotSessionKey()",
  "error NotAncestor()",
  "error CallsExhausted(bytes32 id)",
  "error CallNotAllowed(address target, bytes4 selector)",
  "error WhistleBlownOnlyHomeward()",
  "error ReceiverMismatch(uint256 word)",
  "error TokenNotAllowed(address token)",
  "error PerCallCapExceeded(address token, uint256 amount, uint256 cap)",
  "error DailyCapExceeded(address token, uint256 amount, uint256 cap)",
  "error BudgetExceeded(address token, uint256 amount, uint256 cap)",
  "error RecipientNotAllowed(address to)",
]);

const SELECTOR_APPROVE = toFunctionSelector("approve(address,uint256)");
const SELECTOR_TRANSFER = toFunctionSelector("transfer(address,uint256)");

/** The id `_newSession` gives: keccak256(abi.encode(account, key, nonce)). */
export function sessionIdOf(account: Address, key: Address, nonce: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [account, key, nonce]));
}

/** A Fence hash (`sha256:…`) as the bytes32 a session carries. */
export function fenceBytes32(hash: string): Hex {
  return `0x${hash.replace(/^sha256:/u, "")}` as Hex;
}

export interface SessionToken {
  readonly symbol: string;
  readonly token: Address;
  readonly decimals: number;
}

export interface TokenState {
  readonly token: Address;
  readonly allowed: boolean;
  readonly perCall: bigint;
  readonly daily: bigint;
  readonly budget: bigint;
  readonly dayUsed: bigint;
  readonly consumed: bigint;
  readonly spendable: bigint;
}

export interface SessionState {
  readonly block: bigint | null;
  readonly valid: boolean;
  readonly key: Address;
  readonly parent: Hex;
  readonly validUntil: bigint;
  readonly maxCalls: number;
  readonly callsUsed: number;
  readonly revoked: boolean;
  readonly fenceHash: Hex;
  readonly tokens: readonly TokenState[];
}

/** One multicall: the session, its validity and, per token, getLimit and spendable. Throws when the chain cannot be read. */
export async function readSession(ctx: AppContext, environment: ArcEnvironment, account: Address, sessionId: Hex, tokens: readonly Address[]): Promise<SessionState> {
  const client = ctx.chains.client(environment);
  const contracts = [
    { address: account, abi: ACCOUNT_ABI, functionName: "getSession", args: [sessionId] },
    { address: account, abi: ACCOUNT_ABI, functionName: "isSessionValid", args: [sessionId] },
    ...tokens.flatMap((token) => [
      { address: account, abi: ACCOUNT_ABI, functionName: "getLimit", args: [sessionId, token] },
      { address: account, abi: ACCOUNT_ABI, functionName: "spendable", args: [sessionId, token] },
    ]),
  ] as const;
  const results = (await client.multicall({ contracts: contracts as never, allowFailure: true })) as readonly { status: string; result?: unknown }[];
  if (results.some((r) => r.status !== "success")) throw new Error("The LykiaAccount could not be read.");
  const s = results[0]!.result as { key: Address; parent: Hex; validUntil: bigint; maxCalls: number; callsUsed: number; revoked: boolean; fenceHash: Hex };
  const block = await client.getBlockNumber().catch(() => null);
  return {
    block,
    valid: results[1]!.result as boolean,
    key: s.key,
    parent: s.parent,
    validUntil: BigInt(s.validUntil),
    maxCalls: Number(s.maxCalls),
    callsUsed: Number(s.callsUsed),
    revoked: s.revoked,
    fenceHash: s.fenceHash,
    tokens: tokens.map((token, i) => {
      const [limit, usage] = results[2 + i * 2]!.result as readonly [{ allowed: boolean; perCall: bigint; daily: bigint; budget: bigint }, { dayAmount: bigint; consumed: bigint }];
      return { token, allowed: limit.allowed, perCall: limit.perCall, daily: limit.daily, budget: limit.budget, dayUsed: usage.dayAmount, consumed: usage.consumed, spendable: results[3 + i * 2]!.result as bigint };
    }),
  };
}

export async function readSessionNonce(ctx: AppContext, environment: ArcEnvironment, account: Address): Promise<bigint> {
  const client = ctx.chains.client(environment);
  const code = await client.getCode({ address: account }).catch(() => undefined);
  if (!code || code === "0x") return 0n;
  return BigInt((await client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "sessionNonce" })) as bigint);
}

/**
 * Finds the leash's session without a transaction hash: the ids for every
 * nonce issued since the leash was made, checked for the leash's key, Fence
 * hash and parent. At most 64 nonces are tried.
 */
export async function findSession(ctx: AppContext, environment: ArcEnvironment, input: { readonly account: Address; readonly key: Address; readonly fenceHash: Hex; readonly parent: Hex | null; readonly fromNonce: bigint }): Promise<Hex | null> {
  const client = ctx.chains.client(environment);
  const current = await readSessionNonce(ctx, environment, input.account);
  if (current <= input.fromNonce) return null;
  const from = current - input.fromNonce > 64n ? current - 63n : input.fromNonce + 1n;
  const ids: Hex[] = [];
  for (let n = from; n <= current; n++) ids.push(sessionIdOf(input.account, input.key, n));
  const results = (await client.multicall({ contracts: ids.map((id) => ({ address: input.account, abi: ACCOUNT_ABI, functionName: "getSession", args: [id] })) as never, allowFailure: true })) as readonly { status: string; result?: { key: Address; parent: Hex; fenceHash: Hex } }[];
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i]!;
    if (r.status !== "success" || !r.result) continue;
    if (r.result.key.toLowerCase() === input.key.toLowerCase() && r.result.fenceHash.toLowerCase() === input.fenceHash.toLowerCase() && r.result.parent.toLowerCase() === (input.parent ?? `0x${"0".repeat(64)}`).toLowerCase()) return ids[i]!;
  }
  return null;
}

/** The SessionCreated event in a receipt that matches the leash. */
export function sessionFromLogs(logs: readonly Log[], input: { readonly account: Address; readonly key: Address; readonly fenceHash: Hex }): { readonly id: Hex; readonly parent: Hex } | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== input.account.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: ACCOUNT_ABI, data: log.data, topics: log.topics as never });
      if (event.eventName !== "SessionCreated") continue;
      const args = event.args as { id: Hex; parent: Hex; key: Address; fenceHash: Hex };
      if (args.key.toLowerCase() === input.key.toLowerCase() && args.fenceHash.toLowerCase() === input.fenceHash.toLowerCase()) return { id: args.id, parent: args.parent };
    } catch {
      /* another event */
    }
  }
  return null;
}

export interface AgentEvent {
  readonly name: "AgentCall" | "AgentTransfer" | "AgentMemo";
  readonly txHash: Hex;
  readonly block: bigint;
  readonly detail: string;
  readonly memo?: string;
}

/** AgentCall / AgentTransfer / AgentMemo events of one session in a set of logs. */
export function agentEvents(logs: readonly Log[], account: Address, sessionId: Hex): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== account.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: ACCOUNT_ABI, data: log.data, topics: log.topics as never });
      const args = event.args as Record<string, unknown>;
      if (String(args.sessionId ?? "").toLowerCase() !== sessionId.toLowerCase()) continue;
      const base = { txHash: log.transactionHash as Hex, block: log.blockNumber ?? 0n };
      if (event.eventName === "AgentCall") out.push({ ...base, name: "AgentCall", detail: `${String(args.target)} ${String(args.selector)}` });
      else if (event.eventName === "AgentTransfer") out.push({ ...base, name: "AgentTransfer", detail: `${String(args.amount)} of ${String(args.token)} to ${String(args.to)}` });
      else if (event.eventName === "AgentMemo") {
        const memo = args.memo as Hex;
        const decoded = decodeMemo(memo);
        out.push({ ...base, name: "AgentMemo", detail: decoded ? `lykia:1:${decoded.intentId}:${decoded.stepId}:${decoded.verdict}` : "a memo that is not a Lykia memo", memo });
      }
    } catch {
      /* another event */
    }
  }
  return out;
}

/** AgentCall/AgentTransfer/AgentMemo logs of the account in the last `windows` × 9,999 blocks (Arc's public RPC caps one call at 10,000). */
export async function recentAgentLogs(ctx: AppContext, environment: ArcEnvironment, account: Address, fromBlock: bigint | null, windows = 3): Promise<{ logs: Log[]; from: bigint; to: bigint }> {
  const client = ctx.chains.client(environment);
  const to = await client.getBlockNumber();
  const span = 9_999n;
  const floor = fromBlock ?? 0n;
  const logs: Log[] = [];
  let end = to;
  let start = to;
  for (let i = 0; i < windows && end >= floor; i++) {
    start = end > span ? end - span : 0n;
    if (start < floor) start = floor;
    const part = await client.getLogs({ address: account, events: ACCOUNT_ABI.filter((x) => x.type === "event" && (x.name === "AgentCall" || x.name === "AgentTransfer" || x.name === "AgentMemo")) as never, fromBlock: start, toBlock: end });
    logs.push(...(part as unknown as Log[]));
    if (start === 0n || start === floor) break;
    end = start - 1n;
  }
  return { logs, from: start, to };
}

/* ------------------------------------------------------------ wrapping */

export interface WrappedCall {
  readonly kind: "agentTransfer" | "agentExecute";
  readonly target: Address;
  readonly selector?: Hex;
  readonly token?: Address;
  readonly to?: Address;
  readonly amount?: string;
  readonly spendToken?: Address;
  readonly spendAmount?: string;
  readonly data: Hex;
}

export class WrapError extends Error {}

/**
 * The calls the session key sends for a prepared step. `calls` are the
 * step's plain calls from the account, approvals first, as prepare builds
 * them for a smart account.
 */
export function wrapForSession(calls: readonly Pick<UnsignedTransaction, "to" | "data" | "value">[], input: { readonly account: Address; readonly sessionId: Hex; readonly memo: Hex }): WrappedCall[] {
  const pending = new Map<string, { token: Address; amount: bigint }>();
  const out: WrappedCall[] = [];
  for (const call of calls) {
    const selector = call.data.slice(0, 10).toLowerCase() as Hex;
    if (selector === SELECTOR_APPROVE) {
      const { args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
      const [spender, amount] = args as readonly [Address, bigint];
      pending.set(spender.toLowerCase(), { token: call.to, amount });
      continue;
    }
    if (selector === SELECTOR_TRANSFER && BigInt(call.value) === 0n) {
      const { args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
      const [to, amount] = args as readonly [Address, bigint];
      out.push({ kind: "agentTransfer", target: input.account, token: call.to, to, amount: amount.toString(), data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "agentTransfer", args: [input.sessionId, call.to, to, amount, input.memo] }) });
      continue;
    }
    const spend = pending.get(call.to.toLowerCase());
    pending.delete(call.to.toLowerCase());
    const value = BigInt(call.value);
    out.push({
      kind: "agentExecute",
      target: call.to,
      selector,
      ...(spend ? { spendToken: spend.token, spendAmount: spend.amount.toString() } : {}),
      data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "agentExecute", args: [{ sessionId: input.sessionId, target: call.to, value, data: call.data, spendToken: spend?.token ?? zeroAddress, spendAmount: spend?.amount ?? 0n, memo: input.memo }] }),
    });
  }
  if (pending.size > 0) throw new WrapError("An approval in this step has no call that uses it; a session cannot hold a standing allowance.");
  if (out.length === 0) throw new WrapError("This step has no call a session can make.");
  return out;
}

/** One transaction from the session key: the call itself, or a Multicall3From batch that keeps the key as msg.sender. */
export function sessionTransaction(wrapped: readonly WrappedCall[], input: { readonly environment: ArcEnvironment; readonly chainId: number; readonly key: Address; readonly account: Address; readonly label: string }): UnsignedTransaction {
  if (wrapped.length === 1) return { chainId: input.chainId, from: input.key, to: input.account, data: wrapped[0]!.data, value: "0", label: input.label };
  const data = encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [wrapped.map((w) => ({ target: input.account, allowFailure: false, callData: w.data }))] });
  return { chainId: input.chainId, from: input.key, to: contractAddress("multicall3From", input.environment) as Address, data, value: "0", label: input.label };
}

/** The account's error, decoded, from an eth_call revert; null when it is not one of the account's errors. */
export function accountError(error: unknown): string | null {
  const data = findRevertData(error);
  if (!data) return null;
  try {
    const { errorName, args } = decodeErrorResult({ abi: ACCOUNT_ERRORS, data });
    return `${errorName}(${(args ?? []).map((a) => String(a)).join(", ")})`;
  } catch {
    return null;
  }
}

function findRevertData(error: unknown): Hex | null {
  let e: unknown = error;
  for (let i = 0; i < 8 && e; i++) {
    const data = (e as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]{8,}$/u.test(data)) return data as Hex;
    if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") return (data as { data: Hex }).data;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** The unsigned revokeSession(id) from the owner. */
export function revokeTransaction(input: { readonly chainId: number; readonly owner: Address; readonly account: Address; readonly sessionId: Hex; readonly label: string }): UnsignedTransaction {
  return { chainId: input.chainId, from: input.owner, to: input.account, data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "revokeSession", args: [input.sessionId] }), value: "0", label: input.label };
}

/** A memo from an AgentMemo event, checked against the step it should belong to. */
export function memoMatches(memoHex: string | undefined, input: { readonly intentId: string; readonly stepId: string; readonly verdictDigest: string }): boolean {
  if (!memoHex) return false;
  const m = decodeMemo(memoHex);
  return m !== null && m.intentId === input.intentId && m.stepId === input.stepId && m.verdict === input.verdictDigest.replace(/^sha256:/u, "").slice(0, 16);
}
