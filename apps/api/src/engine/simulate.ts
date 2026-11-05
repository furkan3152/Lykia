/**
 * Self-check: run a whole route's prepared calldata in one eth_call before
 * it is proposed.
 *
 * Arc's RPC has no eth_simulateV1, so the steps are flattened into one
 * Multicall3From.aggregate3 call from the account: every step's approvals,
 * fee transfers and venue calls (the value-moving one wrapped in its Arc
 * Memo, exactly as `shape` builds it) run in order against the same state,
 * and msg.sender stays the account in every inner call (CallFrom). Calls
 * are marked allowFailure so the first failing call can be named with its
 * revert reason.
 *
 * An account that does not hold the route's inputs yet (a dry run) can be
 * funded for the check with state overrides: native USDC through the
 * account's balance (USDC's ERC-20 face reads it), other tokens through
 * their balance mapping slot, found by probing (cached per token).
 */
import { contractAddress, getToken, networkFor, tokenAddress, verdictTag, type Address, type ArcEnvironment, type LykiaMemo } from "@lykia/core";
import { decodeErrorResult, decodeFunctionResult, encodeFunctionData, erc20Abi, keccak256, numberToHex, pad, type Hex } from "viem";
import type { ArcChains } from "../chains/arc.js";
import { MULTICALL3_FROM_ABI } from "./abis.js";
import { buildCalls, type StepPlan } from "./adapters.js";
import { withMemo, type RawCall } from "./calls.js";

export interface SimulatedCall {
  readonly stepId: string;
  readonly label: string;
  readonly ok: boolean;
  readonly revert?: string;
}

export interface RouteSimulation {
  readonly ok: boolean;
  /** "batch": one aggregate3 eth_call over every step's calls. */
  readonly mode: "batch";
  readonly calls: readonly SimulatedCall[];
  readonly failedStep?: string;
  readonly reason?: string;
  /** Balances the check pretended the account had (dry runs). */
  readonly funded: readonly { readonly symbol: string; readonly amount: string; readonly how: string }[];
  readonly block: string | null;
}

export interface SimStep {
  readonly id: string;
  readonly plan: StepPlan;
}

type StateOverride = { address: Address; balance?: bigint; stateDiff?: { slot: Hex; value: Hex }[] }[];

const SLOT_CACHE = new Map<string, { slot: bigint; vyper: boolean } | null>();
/** OpenZeppelin v5 upgradeable ERC20 keeps `_balances` at its ERC-7201 namespace (keccak256("openzeppelin.storage.ERC20") - 1, masked). */
const OZ_ERC20_NAMESPACE = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n;
const ERROR_ABI = [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }, { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] }] as const;

/** Human revert reason from returned data ("" = unknown). */
export function revertReason(data: Hex | undefined): string {
  if (!data || data === "0x") return "reverted without a reason";
  try {
    const decoded = decodeErrorResult({ abi: ERROR_ABI, data });
    return decoded.errorName === "Error" ? String(decoded.args[0]) : `panic ${String(decoded.args[0])}`;
  } catch {
    return `custom error ${data.slice(0, 10)}`;
  }
}

function mappingSlot(holder: Address, slot: bigint, vyper: boolean): Hex {
  const a = pad(holder, { size: 32 });
  const s = pad(numberToHex(slot), { size: 32 });
  return keccak256(vyper ? (`${s}${a.slice(2)}` as Hex) : (`${a}${s.slice(2)}` as Hex));
}

/** The storage slot of `token`'s balance mapping (Solidity or Vyper layout), probed with state overrides. */
export async function findBalanceSlot(chains: ArcChains, environment: ArcEnvironment, token: Address, holder: Address): Promise<{ slot: bigint; vyper: boolean } | null> {
  const key = `${environment}:${token.toLowerCase()}`;
  if (SLOT_CACHE.has(key)) return SLOT_CACHE.get(key) ?? null;
  const client = chains.client(environment);
  const marker = 0x1234567890n;
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [holder] });
  const candidates = [OZ_ERC20_NAMESPACE, ...Array.from({ length: 64 }, (_, i) => BigInt(i))];
  for (const vyper of [false, true]) {
    for (const slot of candidates) {
      try {
        const result = await client.call({ to: token, data, stateOverride: [{ address: token, stateDiff: [{ slot: mappingSlot(holder, slot, vyper), value: pad(numberToHex(marker), { size: 32 }) }] }] });
        if (result.data && BigInt(result.data) === marker) {
          SLOT_CACHE.set(key, { slot, vyper });
          return { slot, vyper };
        }
      } catch {
        /* keep probing */
      }
    }
  }
  SLOT_CACHE.set(key, null);
  return null;
}

/** Flattens the steps exactly as `shape` would sign them for an EOA (approvals, calls, Memo on the last value-moving call). */
export async function routeCalls(chains: ArcChains, environment: ArcEnvironment, account: Address, intentId: string, verdictDigest: string, steps: readonly SimStep[]): Promise<{ stepId: string; call: RawCall }[]> {
  const out: { stepId: string; call: RawCall }[] = [];
  const network = networkFor(environment);
  for (const step of steps) {
    const built = await buildCalls(step.plan, { environment, chains, account });
    const memo: LykiaMemo = { intentId, stepId: step.id, verdict: verdictTag(verdictDigest), ...(step.plan.params.note ? { note: step.plan.params.note } : {}) };
    let target = built.calls.length - 1;
    while (target > 0 && built.calls[target]?.role === "fee") target -= 1;
    const options = { environment, chainId: network.chainId, from: account, memo, account: "eoa" as const };
    for (const a of built.approvals) out.push({ stepId: step.id, call: a });
    built.calls.forEach((c, i) => out.push({ stepId: step.id, call: i === target ? withMemo(c, options) : c }));
  }
  return out;
}

/**
 * Runs the route in one eth_call. `fund` lists the inputs the account
 * should be pretended to hold (symbol and base units); omitted = the real
 * state only.
 */
export async function simulateRoute(
  chains: ArcChains,
  environment: ArcEnvironment,
  account: Address,
  input: { readonly intentId: string; readonly verdictDigest: string; readonly steps: readonly SimStep[]; readonly fund?: readonly { readonly symbol: string; readonly units: bigint }[] },
): Promise<RouteSimulation> {
  const client = chains.client(environment);
  const funded: { symbol: string; amount: string; how: string }[] = [];
  const overrides: StateOverride = [];
  for (const need of input.fund ?? []) {
    const token = getToken(need.symbol);
    const address = token ? tokenAddress(token, environment) : null;
    if (!token || !address || need.units <= 0n) continue;
    if (token.symbol === "USDC") {
      const native = await client.getBalance({ address: account }).catch(() => 0n);
      overrides.push({ address: account, balance: native + need.units * 10n ** 12n + 10n ** 18n });
      funded.push({ symbol: "USDC", amount: need.units.toString(), how: "native balance override (USDC's ERC-20 face reads it)" });
      continue;
    }
    const slot = await findBalanceSlot(chains, environment, address, account);
    if (!slot) {
      funded.push({ symbol: token.symbol, amount: need.units.toString(), how: "not funded: balance slot not found (simulated with the real balance)" });
      continue;
    }
    const current = await client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [account] }).catch(() => 0n);
    overrides.push({ address, stateDiff: [{ slot: mappingSlot(account, slot.slot, slot.vyper), value: pad(numberToHex(current + need.units), { size: 32 }) }] });
    funded.push({ symbol: token.symbol, amount: need.units.toString(), how: `storage override (balance mapping slot ${slot.slot === OZ_ERC20_NAMESPACE ? "ERC-7201 OpenZeppelin ERC20" : slot.slot.toString()}${slot.vyper ? ", vyper" : ""})` });
  }
  // Gas is paid in native USDC on Arc; make sure the check is never about gas money.
  if (!overrides.some((o) => o.address.toLowerCase() === account.toLowerCase() && o.balance !== undefined)) {
    const native = await client.getBalance({ address: account }).catch(() => 0n);
    if (native < 10n ** 18n) overrides.push({ address: account, balance: native + 10n ** 18n });
  }

  let flat: { stepId: string; call: RawCall }[];
  try {
    flat = await routeCalls(chains, environment, account, input.intentId, input.verdictDigest, input.steps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, mode: "batch", calls: [], failedStep: input.steps[0]?.id, reason: `Could not build the calls: ${message}`, funded, block: null };
  }
  const multicall = contractAddress("multicall3From", environment) as Address;
  const data = encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [flat.map((f) => ({ target: f.call.to, allowFailure: true, callData: f.call.data }))] });
  const block: bigint | null = await client.getBlockNumber().catch(() => null);
  try {
    const result = await client.call({ account, to: multicall, data, ...(block !== null ? { blockNumber: block } : {}), ...(overrides.length > 0 ? { stateOverride: overrides } : {}) });
    const decoded = decodeFunctionResult({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", data: result.data as Hex }) as readonly { success: boolean; returnData: Hex }[];
    const calls: SimulatedCall[] = flat.map((f, i) => {
      const r = decoded[i];
      return r?.success ? { stepId: f.stepId, label: f.call.label, ok: true } : { stepId: f.stepId, label: f.call.label, ok: false, revert: revertReason(r?.returnData) };
    });
    const first = calls.find((c) => !c.ok);
    return { ok: !first, mode: "batch", calls, ...(first ? { failedStep: first.stepId, reason: `${first.label}: ${first.revert}` } : {}), funded, block: block?.toString() ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] ?? error.message : String(error);
    return { ok: false, mode: "batch", calls: [], failedStep: input.steps[0]?.id, reason: `eth_call failed: ${message}`, funded, block: block?.toString() ?? null };
  }
}
