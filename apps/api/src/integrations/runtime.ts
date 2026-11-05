/**
 * Adapter manifests at runtime: from a `lykia.adapter/v1` document to the
 * things the engine already understands.
 *
 *  - `adapterKnowledge`  a knowledge row (same model as knowledgeData.ts),
 *    merged into GET /v1/knowledge and the capability graph;
 *  - `manifestParams`    the step params of the engine's generic `manifest`
 *    adapter: the contract, the exact ABI fragment and the argument
 *    templates (`$amount`, `$minOut` and `$account` are filled at build time);
 *  - `encodeManifestCall` / `readAdapterValue`  encoding and reads.
 *
 * No I/O except the reads; nothing here signs.
 */
import { adapterFunctionName, getToken, tokenAddress, type AdapterCapability, type AdapterManifest, type AdapterRead, type Address, type ArcEnvironment, type Capability, type KnowledgeFunction, type KnowledgeRead, type StepKind, type VenueKnowledge } from "@lykia/core";
import { encodeFunctionData, parseAbi, type Abi, type AbiFunction, type AbiParameter, type Hex } from "viem";
import type { ArcChains } from "../chains/arc.js";

/** Parsed function fragments of a manifest, or the parse error. */
export function manifestAbi(manifest: Pick<AdapterManifest, "abi">): { abi: Abi; error: null } | { abi: null; error: string } {
  try {
    return { abi: parseAbi(manifest.abi as readonly string[]) as Abi, error: null };
  } catch (error) {
    return { abi: null, error: error instanceof Error ? error.message.split("\n")[0]! : String(error) };
  }
}

/** The ABI function a capability or read names (by name, or by full signature when overloaded). */
export function abiFunction(abi: Abi, ref: string): AbiFunction | null {
  const name = adapterFunctionName(ref);
  const fns = abi.filter((i): i is AbiFunction => i.type === "function" && i.name === name);
  if (fns.length <= 1) return fns[0] ?? null;
  const wanted = ref.replace(/\s+/gu, "");
  return fns.find((f) => fragmentOf(f).replace(/^function /u, "").replace(/\s+/gu, "").startsWith(wanted)) ?? fns[0] ?? null;
}

function paramText(p: AbiParameter, withName: boolean): string {
  const components = (p as { components?: readonly AbiParameter[] }).components;
  const type = p.type.startsWith("tuple") && components ? `(${components.map((c) => paramText(c, true)).join(", ")})${p.type.slice("tuple".length)}` : p.type;
  return withName && p.name ? `${type} ${p.name}` : type;
}

/** The human-readable fragment of a function ("function deposit(uint256 assets, address receiver) returns (uint256)"). */
function fragmentOf(fn: AbiFunction): string {
  const mutability = fn.stateMutability === "nonpayable" ? "" : ` ${fn.stateMutability}`;
  const outputs = fn.outputs.length > 0 ? ` returns (${fn.outputs.map((o) => paramText(o, true)).join(", ")})` : "";
  return `function ${fn.name}(${fn.inputs.map((i) => paramText(i, true)).join(", ")})${mutability}${outputs}`;
}

/** A literal or a resolved template, typed for the ABI parameter. */
export function coerceArg(param: AbiParameter, value: unknown): unknown {
  if (param.type.endsWith("]")) {
    if (!Array.isArray(value)) throw new Error(`${param.name ?? "argument"} must be an array.`);
    const inner = { ...param, type: param.type.replace(/\[\d*\]$/u, "") } as AbiParameter;
    return value.map((v) => coerceArg(inner, v));
  }
  if (param.type === "tuple") {
    const components = (param as { components?: readonly AbiParameter[] }).components ?? [];
    if (Array.isArray(value)) return components.map((c, i) => coerceArg(c, value[i]));
    if (value && typeof value === "object") return Object.fromEntries(components.map((c, i) => [c.name ?? String(i), coerceArg(c, (value as Record<string, unknown>)[c.name ?? String(i)])]));
    throw new Error(`${param.name ?? "argument"} must be an array or an object.`);
  }
  if (/^u?int\d*$/u.test(param.type)) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^-?\d{1,78}$/u.test(value)) return BigInt(value);
    throw new Error(`${param.name ?? "argument"} must be an integer (send it as a decimal string).`);
  }
  if (param.type === "bool") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "false") return value === "true";
    throw new Error(`${param.name ?? "argument"} must be true or false.`);
  }
  if (param.type === "address") {
    if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value)) return value;
    throw new Error(`${param.name ?? "argument"} must be an address.`);
  }
  if (param.type.startsWith("bytes")) {
    if (typeof value === "string" && /^0x[0-9a-fA-F]*$/u.test(value)) return value;
    throw new Error(`${param.name ?? "argument"} must be 0x-prefixed hex.`);
  }
  if (param.type === "string") return String(value);
  return value;
}

export interface TemplateValues {
  readonly amount?: bigint;
  readonly minOut?: bigint;
  readonly account?: Address;
  readonly tokenIn?: Address;
  readonly tokenOut?: Address;
  readonly deadline?: bigint;
  readonly contracts: Readonly<Record<string, Address>>;
}

/** Fills one template; literals pass through. Unfilled templates are an error. */
function fillTemplate(arg: string, values: TemplateValues): string {
  if (!arg.startsWith("$")) return arg;
  if (arg.startsWith("$contract:")) {
    const address = values.contracts[arg.slice("$contract:".length)];
    if (!address) throw new Error(`Unknown contract in ${arg}.`);
    return address;
  }
  const map: Record<string, bigint | string | undefined> = { $amount: values.amount, $minOut: values.minOut, $account: values.account, $tokenIn: values.tokenIn, $tokenOut: values.tokenOut, $deadline: values.deadline };
  const value = map[arg];
  if (value === undefined) throw new Error(`${arg} has no value here.`);
  return typeof value === "bigint" ? value.toString() : value;
}

function encodeWithFragment(fragment: string, args: readonly string[], values: TemplateValues): Hex {
  const abi = parseAbi([fragment.startsWith("function ") ? fragment : `function ${fragment}`]) as Abi;
  const fn = abi.find((i): i is AbiFunction => i.type === "function")!;
  if (fn.inputs.length !== args.length) throw new Error(`${fn.name} takes ${fn.inputs.length} arguments; the manifest passes ${args.length}.`);
  const typed = fn.inputs.map((p, i) => coerceArg(p, fillTemplate(args[i]!, values)));
  return encodeFunctionData({ abi, functionName: fn.name, args: typed as never });
}

export function contractsOf(manifest: AdapterManifest, environment: ArcEnvironment): Readonly<Record<string, Address>> | null {
  const list = manifest.contracts[environment];
  return list && Object.keys(list).length > 0 ? list : null;
}

function tokenAddr(symbol: string, environment: ArcEnvironment): Address | null {
  const token = getToken(symbol.split("@")[0]!);
  return token ? (tokenAddress(token, environment) as Address | null) : null;
}

/**
 * The params of the engine's `manifest` adapter for one capability: the
 * contract, the ABI fragment, the argument templates (tokens, contracts and
 * the deadline stay templates too, so the step re-encodes them fresh), and
 * the approvals with resolved addresses.
 */
export function manifestParams(manifest: AdapterManifest, environment: ArcEnvironment, cap: AdapterCapability): Record<string, string> | null {
  const contracts = contractsOf(manifest, environment);
  const parsed = manifestAbi(manifest);
  if (!contracts || !parsed.abi) return null;
  const target = contracts[cap.contract];
  const fn = abiFunction(parsed.abi, cap.function);
  const tokenIn = tokenAddr(cap.tokenIn, environment);
  if (!target || !fn || !tokenIn) return null;
  const tokenOut = cap.tokenOut.includes("@") ? null : tokenAddr(cap.tokenOut, environment);
  const approvals = cap.approvals.map((a) => ({ token: a.token === "$tokenIn" ? tokenIn : tokenAddr(a.token, environment), spender: contracts[a.spender] ?? null }));
  if (approvals.some((a) => !a.token || !a.spender)) return null;
  const token = getToken(cap.tokenIn)!;
  return {
    protocol: manifest.protocol.id,
    protocolName: manifest.protocol.name,
    capability: cap.id,
    verb: cap.verb,
    contract: target,
    fragment: fragmentOf(fn),
    args: JSON.stringify(cap.args),
    contracts: JSON.stringify(contracts),
    approvals: JSON.stringify(approvals),
    token: tokenIn,
    tokenIn,
    ...(tokenOut ? { tokenOut } : {}),
    symbol: token.symbol,
    decimals: String(token.decimals),
    label: `${manifest.protocol.name} (${cap.id})`,
  };
}

/** Encodes a `manifest` step at build time: `$account`, `$amount`, `$minOut` and `$deadline` are filled here. */
export function encodeManifestStep(params: Readonly<Record<string, string>>, account: Address, nowSeconds: number): { to: Address; data: Hex; approvals: { token: Address; spender: Address; amount: bigint }[] } {
  const amount = BigInt(params.amount ?? params.amountIn ?? "0");
  const values: TemplateValues = {
    amount,
    ...(params.minOut ? { minOut: BigInt(params.minOut) } : {}),
    account,
    ...(params.tokenIn ? { tokenIn: params.tokenIn as Address } : {}),
    ...(params.tokenOut ? { tokenOut: params.tokenOut as Address } : {}),
    deadline: BigInt(nowSeconds + 20 * 60),
    contracts: JSON.parse(params.contracts ?? "{}") as Record<string, Address>,
  };
  const data = encodeWithFragment(params.fragment!, JSON.parse(params.args ?? "[]") as string[], values);
  const approvals = (JSON.parse(params.approvals ?? "[]") as { token: Address; spender: Address }[]).map((a) => ({ token: a.token, spender: a.spender, amount }));
  return { to: params.contract as Address, data, approvals };
}

/** Reads a manifest read function; null when it reverts or the read is unknown. */
export async function readAdapterValue(chains: ArcChains, environment: ArcEnvironment, manifest: AdapterManifest, readId: string, values: Omit<TemplateValues, "contracts">): Promise<bigint | null> {
  const read = manifest.reads.find((r) => r.id === readId);
  const contracts = contractsOf(manifest, environment);
  const parsed = manifestAbi(manifest);
  if (!read || !contracts || !parsed.abi) return null;
  const fn = abiFunction(parsed.abi, read.function);
  const address = contracts[read.contract];
  if (!fn || !address) return null;
  try {
    const args = fn.inputs.map((p, i) => coerceArg(p, fillTemplate(read.args[i] ?? "", { ...values, contracts })));
    const result = await chains.client(environment).readContract({ address, abi: [fn], functionName: fn.name, args: args as never });
    const first = Array.isArray(result) ? result[0] : result;
    return typeof first === "bigint" ? first : null;
  } catch {
    return null;
  }
}

/** A read value as an APY fraction string ("0.0412"), by the read's scale. */
export function apyFraction(raw: bigint, scale: AdapterRead["scale"]): string | null {
  const denominators: Record<AdapterRead["scale"], bigint | null> = { bps: 10_000n, wad: 10n ** 18n, ray: 10n ** 27n, "1e6": 1_000_000n, raw: null };
  const d = denominators[scale];
  if (d === null || raw < 0n) return null;
  const micro = (raw * 1_000_000n) / d;
  const value = Number(micro) / 1_000_000;
  return Number.isFinite(value) && value < 10 ? value.toFixed(6) : null;
}

const ADAPTER_EVIDENCE = "(lykia.adapter/v1, validated with eth_getCode, read calls and a dry simulation)";

const kindOf = (verb: AdapterCapability["verb"]): StepKind => verb;

/** The capability's knowledge edges: deposit/supply into a position, withdraw out of it, swaps between tokens. */
function edges(manifest: AdapterManifest, cap: AdapterCapability): Capability[] {
  const pid = manifest.protocol.id;
  const position = cap.tokenOut.includes("@") ? cap.tokenOut : `${cap.tokenIn}@${pid}`;
  const [from, to] = cap.verb === "withdraw" ? [`${cap.tokenIn}@${pid}`, cap.tokenIn] : cap.verb === "deposit" || cap.verb === "supply" ? [cap.tokenIn, position] : cap.verb === "borrow" ? [cap.tokenIn, cap.tokenOut] : cap.verb === "repay" ? [cap.tokenIn, `debt:${cap.tokenIn}@${pid}`] : [cap.tokenIn, cap.tokenOut];
  return [{ id: `${pid}:${cap.verb}:${from}>${to}`, venue: pid, verb: kindOf(cap.verb), adapter: "manifest", from, to, settlement: cap.settlement, delaySeconds: cap.delaySeconds ?? 0, gas: cap.gas, venueFeeBps: cap.venueFeeBps, note: `adapter manifest capability ${cap.id}` }];
}

/** A manifest as a knowledge row. `executable` is true only once it is routable. */
export function adapterKnowledge(manifest: AdapterManifest, routable: boolean): VenueKnowledge {
  const parsed = manifestAbi(manifest);
  const pid = manifest.protocol.id;
  const keys = [...new Set(Object.values(manifest.contracts).flatMap((c) => Object.keys(c ?? {})))];
  const frag = (ref: string) => {
    const fn = parsed.abi ? abiFunction(parsed.abi, ref) : null;
    return fn ? fragmentOf(fn) : `function ${adapterFunctionName(ref)}()`;
  };
  const functions: KnowledgeFunction[] = manifest.capabilities.map((c) => ({
    id: `${pid}.${c.id}`,
    contract: c.contract,
    abi: frag(c.function),
    adapters: ["manifest"],
    verb: kindOf(c.verb),
    purpose: `${c.verb} ${c.tokenIn} -> ${c.tokenOut}`,
    inputs: [c.tokenIn],
    outputs: [c.tokenOut],
    units: "Token base units.",
    recipient: "The signer ($account).",
    approvals: c.approvals.map((a) => `${a.token === "$tokenIn" ? c.tokenIn : a.token} to ${a.spender}, exact amount`),
    preconditions: [...c.preconditions],
    failures: c.failures.map((f) => ({ reason: f.reason, meaning: f.meaning })),
    gas: c.gas,
    feeModel: `Lykia's fee (1% by default) is a separate transfer in the same batch; the venue takes ${c.venueFeeBps === null ? "a variable fee" : `${c.venueFeeBps} bps`}.`,
    settlement: c.settlement,
    evidence: `Adapter manifest ${ADAPTER_EVIDENCE}; ${manifest.evidence}`,
  }));
  const reads: KnowledgeRead[] = manifest.reads.map((r) => ({ id: `${pid}.${r.id}`, contract: r.contract, abi: frag(r.function), purpose: r.purpose, evidence: `Adapter manifest; ${manifest.evidence}` }));
  const seen = new Set<string>();
  const capabilities = manifest.capabilities.flatMap((c) => edges(manifest, c)).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return {
    venue: pid,
    purpose: manifest.protocol.summary,
    executable: routable,
    contracts: keys.map((key) => ({ key, role: `Contract of ${manifest.protocol.name} (adapter manifest).` })),
    functions,
    reads,
    risk: { tier: manifest.risk.tier, oracle: manifest.risk.oracle, admin: manifest.risk.admin, upgradeable: manifest.risk.upgradeable, tvlSource: "not tracked (adapter manifest)", audits: [...manifest.risk.audits], notes: [...manifest.risk.notes, "Listed through a Lykia adapter manifest: validated on chain and approved by a Lykia admin."] },
    capabilities,
    docs: manifest.protocol.docs ?? manifest.protocol.website ?? "",
    evidence: manifest.evidence,
  };
}

