/**
 * Generic contract integration: encode, read, simulate and decode any call
 * on Arc, with Lykia's knowledge and the security layer on top.
 *
 *  - encode    ABI + function + args -> calldata (args typed from the ABI; integers as decimal strings)
 *  - read      many view calls in one multicall
 *  - simulate  a call batch from an address in one Multicall3From eth_call:
 *              balance diff (balanceOf before and after, inside the same batch),
 *              decoded calls, events when the RPC offers eth_simulateV1, and a
 *              security verdict (layer 1 rules plus the address checks)
 *  - decode    calldata and logs -> plain English, using the engine's ABIs,
 *              routable adapter manifests, the caller's ABI and the knowledge model
 *
 * Nothing is signed or broadcast.
 */
import { contractAddress, KNOWLEDGE_ROWS, protocolsAt, tokenAddress, tokensFor, fromBaseUnits, type Address, type ArcEnvironment, type UnsignedTransaction } from "@lykia/core";
import { analyzeFlow, decisionOf, describeCall, type DecodedCall, type SecurityFinding } from "@lykia/core/security/index";
import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData, erc20Abi, parseAbi, toFunctionSelector, type Abi, type AbiFunction, type Hex } from "viem";
import { simulateCalls } from "viem/actions";
import type { AppContext } from "../context.js";
import { MEMO_ABI, MULTICALL3_FROM_ABI } from "../engine/abis.js";
import { revertReason } from "../engine/simulate.js";
import { LykiaHttpError } from "../http/errors.js";
import { decodeTransactions } from "../security/decode.js";
import { checkRecipient } from "../security/recipients.js";
import * as ENGINE_ABIS from "../engine/abis.js";
import { adapterContracts, routableManifests } from "./registry.js";
import { abiFunction, coerceArg, manifestAbi } from "./runtime.js";

export type AbiInput = readonly string[] | readonly Record<string, unknown>[];

/** Human-readable fragments or a JSON ABI, as viem's Abi. */
export function toAbi(input: AbiInput): Abi {
  try {
    if (input.length > 0 && typeof input[0] === "string") return parseAbi(input as readonly string[]) as Abi;
    return input as unknown as Abi;
  } catch (error) {
    throw new LykiaHttpError("INVALID_REQUEST", 400, `The ABI does not parse: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

/** JSON-safe values: bigints become decimal strings. */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

function fnOf(abi: Abi, ref: string): AbiFunction {
  const fn = abiFunction(abi, ref);
  if (!fn) throw new LykiaHttpError("INVALID_REQUEST", 400, `${ref} is not a function of the ABI.`);
  return fn;
}

function typedArgs(fn: AbiFunction, args: readonly unknown[]): unknown[] {
  if (args.length !== fn.inputs.length) throw new LykiaHttpError("INVALID_REQUEST", 400, `${fn.name} takes ${fn.inputs.length} arguments; ${args.length} were given.`);
  try {
    return fn.inputs.map((p, i) => coerceArg(p, args[i]));
  } catch (error) {
    throw new LykiaHttpError("INVALID_REQUEST", 400, error instanceof Error ? error.message : String(error));
  }
}

export function encodeCall(input: { readonly abi: AbiInput; readonly function: string; readonly args?: readonly unknown[] }): { data: Hex; selector: Hex; signature: string } {
  const abi = toAbi(input.abi);
  const fn = fnOf(abi, input.function);
  const data = encodeFunctionData({ abi: [fn], functionName: fn.name, args: typedArgs(fn, input.args ?? []) as never });
  return { data, selector: toFunctionSelector(fn), signature: `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})` };
}

export interface ReadCall {
  readonly address: Address;
  readonly abi: AbiInput;
  readonly function: string;
  readonly args?: readonly unknown[];
}

export async function readCalls(ctx: AppContext, environment: ArcEnvironment, calls: readonly ReadCall[]) {
  const prepared = calls.map((c) => {
    const abi = toAbi(c.abi);
    const fn = fnOf(abi, c.function);
    return { address: c.address, abi: [fn] as Abi, functionName: fn.name, args: typedArgs(fn, c.args ?? []) };
  });
  const client = ctx.chains.client(environment);
  const results = await client.multicall({ contracts: prepared as never, allowFailure: true });
  const block = await client.getBlockNumber().then((b) => b.toString()).catch(() => null);
  return {
    environment,
    block,
    results: (results as readonly { status: string; result?: unknown; error?: unknown }[]).map((r, i) => (r.status === "success" ? { ok: true, function: prepared[i]!.functionName, address: prepared[i]!.address, result: jsonSafe(r.result) } : { ok: false, function: prepared[i]!.functionName, address: prepared[i]!.address, error: (r.error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ?? "reverted" })),
  };
}

export interface SimCall {
  readonly to: Address;
  readonly data: Hex;
  readonly value?: string;
}

/** Every ABI Lykia can decode with: the engine's, ERC-20, routable manifests and the caller's own. */
async function decodingAbis(ctx: AppContext, environment: ArcEnvironment, extra?: AbiInput): Promise<Abi> {
  const manifests = await routableManifests(ctx, environment).catch(() => []);
  return [
    ...Object.values(ENGINE_ABIS).flatMap((abi) => (Array.isArray(abi) ? (abi as Abi) : [])),
    ...erc20Abi,
    ...manifests.flatMap((m) => manifestAbi(m).abi ?? []),
    ...(extra ? toAbi(extra) : []),
  ] as Abi;
}

/** What Lykia knows about an address: a registry token, a registry contract with its venue, or nothing. */
export function knownAt(address: string, environment: ArcEnvironment): string | null {
  const token = tokensFor(environment).find((t) => tokenAddress(t, environment)?.toLowerCase() === address.toLowerCase());
  if (token) return `${token.symbol} token`;
  const hit = protocolsAt(address, environment)[0];
  if (hit) {
    const row = KNOWLEDGE_ROWS.find((r) => r.venue === hit.protocol.id);
    const role = row?.contracts.find((c) => c.key === hit.name)?.role;
    return `${hit.protocol.name} ${hit.name}${role ? ` (${role.replace(/\.$/u, "")})` : ""}`;
  }
  if (address.toLowerCase() === (contractAddress("multicall3From", environment) ?? "").toLowerCase()) return "Arc Multicall3From";
  return null;
}

function symbolOf(environment: ArcEnvironment) {
  return (token: string) => tokensFor(environment).find((t) => tokenAddress(t, environment)?.toLowerCase() === token.toLowerCase())?.symbol ?? null;
}

/** Plain lines for decoded leaf calls, with the venue name of every known contract. */
export function explainCalls(calls: readonly DecodedCall[], environment: ArcEnvironment): string[] {
  const sym = symbolOf(environment);
  const token = (address: string) => tokensFor(environment).find((t) => tokenAddress(t, environment)?.toLowerCase() === address.toLowerCase());
  const amount = (address: string, units: string) => {
    const t = token(address);
    if (!t) return `${units} base units of ${address}`;
    return BigInt(units) >= 2n ** 255n ? `an unlimited amount of ${t.symbol}` : `${fromBaseUnits(units, t.decimals)} ${t.symbol}`;
  };
  return calls.map((c) => {
    if (c.kind === "erc20-transfer") return `Transfer ${amount(c.token, c.amount)} to ${knownAt(c.to, environment) ?? c.to}`;
    if (c.kind === "erc20-approve") return `Approve ${knownAt(c.spender, environment) ?? c.spender} to spend ${amount(c.token, c.amount)}`;
    if (c.kind === "erc20-transfer-from") return `Pull ${amount(c.token, c.amount)} from ${c.from} to ${c.to}`;
    const base = describeCall(c, sym);
    const target = c.kind === "call" ? c.target : c.kind === "native" ? c.to : "token" in c ? c.token : c.target;
    const known = knownAt(target, environment);
    return known && !base.includes(known) ? `${base} [${known}]` : base;
  });
}

export async function decodeData(ctx: AppContext, environment: ArcEnvironment, input: { readonly to?: Address; readonly data?: Hex; readonly value?: string; readonly logs?: readonly { address: Address; topics: readonly Hex[]; data: Hex }[]; readonly abi?: AbiInput }) {
  const out: { calls: unknown[]; lines: string[]; events: unknown[] } = { calls: [], lines: [], events: [] };
  const abi = await decodingAbis(ctx, environment, input.abi);
  if (input.data && input.data !== "0x") {
    const to = input.to ?? ("0x0000000000000000000000000000000000000000" as Address);
    const leaves = decodeTransactions([{ chainId: 0, from: to, to, data: input.data, value: input.value ?? "0", label: "" }]);
    // Leaves the engine's decoder could not name get a second try with the manifests' and the caller's ABIs.
    const named = leaves.map((leaf) => {
      if (leaf.kind !== "call" || leaf.fn) return leaf;
      const fn = (abi.filter((i) => i.type === "function") as AbiFunction[]).find((f) => toFunctionSelector(f) === leaf.selector);
      return fn ? { ...leaf, fn: `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})` } : leaf;
    });
    out.calls = named;
    out.lines = explainCalls(named, environment);
    if (named.length === 1 && named[0]!.kind === "call") {
      try {
        const decoded = decodeFunctionData({ abi, data: input.data });
        out.calls = [{ ...named[0]!, args: jsonSafe(decoded.args ?? []) }];
      } catch {
        /* the selector alone */
      }
    }
  }
  for (const log of input.logs ?? []) {
    try {
      // ERC-20 first: an ERC-721 Transfer has the same topic with a different layout.
      const topics = log.topics as [Hex, ...Hex[]];
      let ev: { eventName: string; args: unknown };
      try {
        ev = decodeEventLog({ abi: [...erc20Abi, ...MEMO_ABI], data: log.data, topics });
      } catch {
        ev = decodeEventLog({ abi, data: log.data, topics });
      }
      const args = ev.args as unknown as Record<string, unknown>;
      let line = `${ev.eventName} on ${knownAt(log.address, environment) ?? log.address}`;
      const token = tokensFor(environment).find((t) => tokenAddress(t, environment)?.toLowerCase() === log.address.toLowerCase());
      if (ev.eventName === "Transfer" && token) line = `${fromBaseUnits(args.value as bigint, token.decimals)} ${token.symbol} moved from ${String(args.from)} to ${String(args.to)}`;
      if (ev.eventName === "Approval" && token) line = `${String(args.owner)} approved ${String(args.spender)} for ${fromBaseUnits(args.value as bigint, token.decimals)} ${token.symbol}`;
      if (ev.eventName === "Memo") line = `Arc Memo from ${String(args.sender)} on a call to ${knownAt(String(args.target), environment) ?? String(args.target)}`;
      out.events.push({ address: log.address, event: ev.eventName, args: jsonSafe(args), line });
      out.lines.push(line);
    } catch {
      out.events.push({ address: log.address, event: null, topic: log.topics[0] ?? null, line: `Unknown event ${log.topics[0]?.slice(0, 10) ?? ""} on ${knownAt(log.address, environment) ?? log.address}` });
    }
  }
  return out;
}

/** A call batch from `from`, simulated in one Multicall3From eth_call with balance reads around it. */
export async function simulateBatch(ctx: AppContext, environment: ArcEnvironment, input: { readonly from: Address; readonly calls: readonly SimCall[]; readonly tokens?: readonly Address[]; readonly abi?: AbiInput }) {
  const client = ctx.chains.client(environment);
  const from = input.from;
  if (input.calls.some((c) => BigInt(c.value ?? "0") > 0n) && input.calls.length > 1) throw new LykiaHttpError("INVALID_REQUEST", 400, "Native value is only supported in a single call; Multicall3From batches move tokens, not value.");
  const tokens = [...new Set([...tokensFor(environment).map((t) => tokenAddress(t, environment)).filter((a): a is Address => a !== null), ...(input.tokens ?? [])].map((a) => a.toLowerCase()))] as Address[];
  const balanceCall = (token: Address) => ({ target: token, allowFailure: true, callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [from] }) });
  const block = await client.getBlockNumber().catch(() => null);
  const transactions: UnsignedTransaction[] = input.calls.map((c) => ({ chainId: 0, from, to: c.to, data: c.data, value: c.value ?? "0", label: "" }));
  const decoded = decodeTransactions(transactions);
  let results: { ok: boolean; revert?: string }[] = [];
  const diffs: { token: Address; symbol: string | null; before: string; after: string; diff: string }[] = [];
  let reverted: string | null = null;
  try {
    if (input.calls.length === 1 && BigInt(input.calls[0]!.value ?? "0") > 0n) {
      const c = input.calls[0]!;
      await client.call({ account: from, to: c.to, data: c.data, value: BigInt(c.value ?? "0"), ...(block !== null ? { blockNumber: block } : {}) });
      results = [{ ok: true }];
    } else {
      const batch = [...tokens.map(balanceCall), ...input.calls.map((c) => ({ target: c.to, allowFailure: true, callData: c.data })), ...tokens.map(balanceCall)];
      const data = encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [batch] });
      const raw = await client.call({ account: from, to: contractAddress("multicall3From", environment) as Address, data, ...(block !== null ? { blockNumber: block } : {}) });
      const out = decodeFunctionResult({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", data: raw.data as Hex }) as readonly { success: boolean; returnData: Hex }[];
      const n = tokens.length;
      results = input.calls.map((_, i) => {
        const r = out[n + i];
        return r?.success ? { ok: true } : { ok: false, revert: revertReason(r?.returnData) };
      });
      const sym = symbolOf(environment);
      const word = (r: { success: boolean; returnData: Hex } | undefined) => (r?.success && r.returnData.length >= 66 ? BigInt(r.returnData.slice(0, 66)) : null);
      tokens.forEach((token, i) => {
        const before = word(out[i]);
        const after = word(out[n + input.calls.length + i]);
        if (before !== null && after !== null && before !== after) diffs.push({ token, symbol: sym(token), before: before.toString(), after: after.toString(), diff: (after - before).toString() });
      });
    }
  } catch (error) {
    reverted = error instanceof Error ? (error as { shortMessage?: string }).shortMessage ?? error.message.split("\n")[0]! : String(error);
  }
  const firstFail = results.findIndex((r) => !r.ok);
  if (firstFail >= 0) reverted = `call ${firstFail + 1} reverts: ${results[firstFail]!.revert}`;

  // Events need eth_simulateV1; Arc's public RPC does not offer it today, so this is best effort.
  let events: unknown[] = [];
  let eventsSource = "unavailable: the RPC has no eth_simulateV1, so logs cannot be read from a simulation";
  try {
    const sim = await simulateCalls(client as never, { account: from, calls: input.calls.map((c) => ({ to: c.to, data: c.data, value: BigInt(c.value ?? "0") })) });
    const logs = sim.results.flatMap((r) => (r as { logs?: { address: Address; topics: Hex[]; data: Hex }[] }).logs ?? []);
    events = (await decodeData(ctx, environment, { logs, ...(input.abi ? { abi: input.abi } : {}) })).events;
    eventsSource = "eth_simulateV1";
  } catch {
    /* keep the note */
  }

  // Security verdict: layer 1 structure (approvals, transferFrom, unknown contracts) and the address checks on every recipient.
  const outflows = new Map<string, bigint>();
  for (const c of decoded) if (c.kind === "erc20-transfer" || c.kind === "erc20-approve") outflows.set(c.token.toLowerCase(), (outflows.get(c.token.toLowerCase()) ?? 0n) + BigInt(c.amount));
  const recipients = [...new Set(decoded.filter((c): c is Extract<DecodedCall, { kind: "erc20-transfer" }> => c.kind === "erc20-transfer").map((c) => c.to.toLowerCase()))] as Address[];
  const known = [...new Set([...tokens, ...(await adapterContracts(ctx, environment).catch(() => [])), ...input.calls.map((c) => c.to).filter((a) => knownAt(a, environment) !== null)].map((a) => a.toLowerCase()))] as Address[];
  const flow = analyzeFlow({ stepId: "s1", account: from, owner: from, kind: "call", inputs: [...outflows.entries()].map(([token, amount]) => ({ token: token as Address, symbol: symbolOf(environment)(token) ?? token, amount: amount.toString() })), fees: [], recipients, knownContracts: known }, decoded);
  // An integrator simulating its own contract: unknown contracts and receivers are warnings here, not blocks.
  const soften = new Set(["simulation.unknown-contract", "simulation.changed-recipient", "simulation.unknown-spender", "simulation.approval-exceeds-need"]);
  const findings: SecurityFinding[] = flow.findings.map((f) => (soften.has(f.rule) && f.severity === "block" ? { ...f, severity: "warn" as const } : f));
  if (reverted) findings.push({ layer: "simulation", rule: "simulation.reverts", severity: "block", message: `The batch would revert on Arc: ${reverted}` });
  for (const r of recipients) findings.push(...(await checkRecipient(ctx, { environment, owner: from, recipient: r, tokens: tokens.slice(0, 4) }).catch(() => ({ findings: [] as SecurityFinding[] }))).findings);
  return {
    environment,
    from,
    block: block?.toString() ?? null,
    ok: reverted === null,
    ...(reverted ? { reason: reverted } : {}),
    calls: results.map((r, i) => ({ index: i, to: input.calls[i]!.to, ...r })),
    decoded: jsonSafe(decoded),
    lines: explainCalls(decoded, environment),
    balanceChanges: diffs,
    events,
    eventsSource,
    security: { decision: decisionOf(findings), findings, approvals: flow.summary.approvals, contractsTouched: flow.summary.contractsTouched },
  };
}
