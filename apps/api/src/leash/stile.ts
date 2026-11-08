/**
 * LykiaStile for Gateway leashes: what the API builds for and reads from
 * the owner's Stile on Arc, and the burn intents it reserves.
 *
 * The owner deploys a Stile from their own wallet (a plain creation; its
 * address is predicted from the wallet's nonce), adds it as a Gateway
 * delegate (`addDelegate(USDC, stile)` on Gateway Wallet) and issues a
 * session to the agent's key. Every transfer is then a reservation: the
 * agent's key calls `reserve(sessionId, intents, memo)` with the exact burn
 * intents, the Stile checks them and records their EIP-712 digest, and
 * Lykia posts them to Gateway's `/v1/transfer` with `contractSigner: true`
 * and `abi.encode(sessionId)` as the signature. Gateway validates by
 * simulating `isValidSignature(digest, signature)` on the Stile.
 *
 * Hashing follows circlefin/evm-gateway-contracts (src/lib/BurnIntentLib.sol,
 * TransferSpecLib.sol): EIP-712 typed data in the domain {name:
 * "GatewayWallet", version: "1"}; a burn intent set hashes as
 * BurnIntentSet(BurnIntent[] intents). The transferSpecHash is keccak256 of
 * Gateway's byte encoding of the spec.
 * https://developers.circle.com/gateway/references/erc-1271
 * https://developers.circle.com/gateway/references/technical-guide
 */
import { randomBytes } from "node:crypto";
import { contractAddress, lykiaContracts, STILE_BETA, type Address, type ArcEnvironment, type UnsignedTransaction } from "@lykia/core";
import { decodeErrorResult, decodeEventLog, encodeAbiParameters, encodeDeployData, encodeFunctionData, encodePacked, getContractAddress, hashTypedData, keccak256, maxUint256, pad, parseAbi, type Hex, type Log } from "viem";
import type { AppContext } from "../context.js";
import type { FetchLike } from "../health/dependencies.js";
import { GATEWAY_API } from "../flock/flock.js";
import { circleFetch, upstreamReason } from "../circle/http.js";
import { GATEWAY_CHAINS, GATEWAY_MINTER, GATEWAY_WALLET, gatewayChain, type GatewayChain } from "../circle/chains.js";
import { gatewayMaxFee } from "../circle/gateway.js";
import { LykiaHttpError } from "../http/errors.js";

export const STILE_ABI = lykiaContracts.lykiaStileArtifact.abi;
export const STILE_ARTIFACT = lykiaContracts.lykiaStileArtifact;

export const GATEWAY_WALLET_ABI = parseAbi([
  "function addDelegate(address token, address delegate)",
  "function removeDelegate(address token, address delegate)",
  "function isAuthorizedForBalance(address token, address depositor, address addr) view returns (bool)",
]);
export const GATEWAY_MINTER_EVENTS = parseAbi(["event AttestationUsed(address indexed token, address indexed recipient, bytes32 indexed transferSpecHash, uint32 sourceDomain, bytes32 sourceDepositor, bytes32 sourceSigner, uint256 value)"]);

/** Arc's Gateway domain: the only source a Stile on Arc can spend. */
export const ARC_DOMAIN = 26;
const TRANSFER_SPEC_MAGIC = "0xca85def7" as const;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;

const usdcUnits = (usd: string): bigint => {
  const [w = "0", f = ""] = usd.split(".");
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6) || "0");
};
export const fromUnits = (units: bigint): string => {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return frac ? `${whole}.${frac}` : whole.toString();
};
export { usdcUnits };

export const b32 = (a: string): Hex => pad(a.toLowerCase() as Hex, { size: 32 });

/* ------------------------------------------------------------ availability */

export interface StileAvailability {
  readonly available: boolean;
  readonly environment: ArcEnvironment;
  /** The owner's reference deployment the end-to-end check ran against. */
  readonly reference: Address | null;
  readonly reason: string | null;
}

/** The Gateway option exists only where LYKIA_STILE is on and a reference deployment is configured. */
export function stileAvailability(ctx: AppContext, environment: ArcEnvironment): StileAvailability {
  const on = ctx.config.stile.environments.includes(environment);
  const reference = (ctx.config.stile.reference[environment] ?? null) as Address | null;
  if (!on) return { available: false, environment, reference, reason: `Spending from a Gateway balance is not switched on for Arc ${environment} yet.` };
  if (!reference) return { available: false, environment, reference, reason: `No reference LykiaStile is configured for Arc ${environment} yet.` };
  return { available: true, environment, reference, reason: null };
}

/** Destinations a Gateway leash may name (EVM chains Gateway reaches from Arc). */
export function stileDestinations(): readonly { readonly key: string; readonly name: string; readonly domain: number }[] {
  return GATEWAY_CHAINS.map((c) => ({ key: c.key, name: c.name, domain: c.domain }));
}

/* ------------------------------------------------------------ deployment */

export interface StileImmutables {
  readonly owner: Address;
  readonly gatewayWallet: Address;
  readonly gatewayMinter: Address;
  readonly token: Address;
  readonly sourceDomain: number;
  readonly ceilingPerTransfer: bigint;
  readonly ceilingDaily: bigint;
  readonly feeBps: number;
  readonly feeRecipient: Address;
}

/** What a Stile for `owner` must carry: Arc's Gateway contracts, USDC, the beta ceilings and Lykia's fee. */
export function expectedImmutables(environment: ArcEnvironment, owner: Address, fee: { readonly bps: number; readonly recipient: Address }): StileImmutables {
  return {
    owner: owner.toLowerCase() as Address,
    gatewayWallet: GATEWAY_WALLET[environment].toLowerCase() as Address,
    gatewayMinter: GATEWAY_MINTER[environment].toLowerCase() as Address,
    token: (contractAddress("usdc", environment) as Address).toLowerCase() as Address,
    sourceDomain: ARC_DOMAIN,
    ceilingPerTransfer: usdcUnits(STILE_BETA.perStepUsd),
    ceilingDaily: usdcUnits(STILE_BETA.perDayUsd),
    feeBps: fee.bps,
    feeRecipient: (fee.bps > 0 ? fee.recipient : "0x0000000000000000000000000000000000000000").toLowerCase() as Address,
  };
}

/** A contract creation from the owner's own wallet: no `to`, data = bytecode and constructor arguments. */
export interface UnsignedCreation {
  readonly chainId: number;
  readonly from: Address;
  readonly data: Hex;
  readonly value: "0";
  readonly label: string;
  /** keccak256(rlp(from, nonce)), valid when nothing else is sent from the wallet first. */
  readonly predictedAddress: Address;
  readonly nonce: number;
}

export function stileCreation(chainId: number, imm: StileImmutables, nonce: number): UnsignedCreation {
  const data = encodeDeployData({ abi: STILE_ABI, bytecode: STILE_ARTIFACT.bytecode as Hex, args: [imm.owner, imm.gatewayWallet, imm.gatewayMinter, imm.token, imm.sourceDomain, imm.ceilingPerTransfer, imm.ceilingDaily, imm.feeBps, imm.feeRecipient] });
  const predictedAddress = getContractAddress({ from: imm.owner, nonce: BigInt(nonce) }).toLowerCase() as Address;
  return { chainId, from: imm.owner, data, value: "0", label: `Create your LykiaStile at ${predictedAddress}`, predictedAddress, nonce };
}

/** Runtime code equal to the artifact's, immutables and CBOR metadata ignored. */
export function stileCodeMatches(code: Hex): boolean {
  try {
    const ranges = STILE_ARTIFACT.immutableReferences;
    return lykiaContracts.runtimeCodeHash(code, ranges) === lykiaContracts.runtimeCodeHash(STILE_ARTIFACT.deployedBytecode as Hex, ranges) && strip(code).length === strip(STILE_ARTIFACT.deployedBytecode as Hex).length;
  } catch {
    return false;
  }
}
const strip = (h: string) => h.replace(/^0x/u, "");

export interface StileCheck {
  readonly deployed: boolean;
  /** Code and immutables as expected (null when not deployed). */
  readonly matches: boolean | null;
  readonly problems: readonly string[];
  readonly immutables: StileImmutables | null;
}

/** Reads a Stile's code and immutables and compares them with what Lykia expects for this owner. */
export async function checkStile(ctx: AppContext, environment: ArcEnvironment, address: Address, expected: StileImmutables): Promise<StileCheck> {
  const client = ctx.chains.client(environment);
  const code = (await client.getCode({ address })) as Hex | undefined;
  if (!code || code === "0x") return { deployed: false, matches: null, problems: [], immutables: null };
  const problems: string[] = [];
  if (!stileCodeMatches(code)) problems.push("The code at this address is not LykiaStile.");
  const names = ["owner", "gatewayWallet", "gatewayMinter", "token", "sourceDomain", "ceilingPerTransfer", "ceilingDaily", "feeBps", "feeRecipient"] as const;
  const results = (await client.multicall({ contracts: names.map((functionName) => ({ address, abi: STILE_ABI, functionName })) as never, allowFailure: true })) as readonly { status: string; result?: unknown }[];
  if (results.some((r) => r.status !== "success")) return { deployed: true, matches: false, problems: [...problems, "The Stile's settings could not be read."], immutables: null };
  const asAddr = (v: unknown) => String(v).toLowerCase() as Address;
  const minter = `0x${String(results[2]!.result).slice(-40)}`.toLowerCase() as Address;
  const feeTo = `0x${String(results[8]!.result).slice(-40)}`.toLowerCase() as Address;
  const imm: StileImmutables = { owner: asAddr(results[0]!.result), gatewayWallet: asAddr(results[1]!.result), gatewayMinter: minter, token: asAddr(results[3]!.result), sourceDomain: Number(results[4]!.result), ceilingPerTransfer: BigInt(results[5]!.result as bigint), ceilingDaily: BigInt(results[6]!.result as bigint), feeBps: Number(results[7]!.result), feeRecipient: feeTo };
  if (imm.owner !== expected.owner) problems.push("Its owner is not this wallet.");
  if (imm.gatewayWallet !== expected.gatewayWallet || imm.gatewayMinter !== expected.gatewayMinter || imm.token !== expected.token || imm.sourceDomain !== expected.sourceDomain) problems.push("It points at other Gateway contracts or another token.");
  if (imm.ceilingPerTransfer > expected.ceilingPerTransfer || imm.ceilingDaily > expected.ceilingDaily) problems.push("Its ceilings are above the beta ceilings.");
  if (imm.feeBps !== expected.feeBps || (imm.feeBps > 0 && imm.feeRecipient !== expected.feeRecipient)) problems.push("Its fee leg differs from Lykia's current fee.");
  return { deployed: true, matches: problems.length === 0, problems, immutables: imm };
}

/* ------------------------------------------------------------ owner calls */

export interface StileLimits {
  readonly validUntil: bigint;
  readonly perTransfer: bigint;
  readonly daily: bigint;
  readonly lifetime: bigint;
  readonly maxGatewayFee: bigint;
  readonly anyRecipient: boolean;
}

export function sessionIdOf(stile: Address, key: Address, nonce: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [stile, key, nonce]));
}

export function createSessionTx(input: { readonly chainId: number; readonly owner: Address; readonly stile: Address; readonly key: Address; readonly limits: StileLimits; readonly domains: readonly number[]; readonly recipients: readonly Address[]; readonly policyHash: Hex; readonly label: string }): UnsignedTransaction {
  return {
    chainId: input.chainId,
    from: input.owner,
    to: input.stile,
    data: encodeFunctionData({ abi: STILE_ABI, functionName: "createSession", args: [input.key, input.limits, input.domains, input.recipients.map(b32), input.policyHash] }),
    value: "0",
    label: input.label,
  };
}

export function addDelegateTx(chainId: number, environment: ArcEnvironment, owner: Address, stile: Address): UnsignedTransaction {
  return { chainId, from: owner, to: GATEWAY_WALLET[environment], data: encodeFunctionData({ abi: GATEWAY_WALLET_ABI, functionName: "addDelegate", args: [contractAddress("usdc", environment) as Address, stile] }), value: "0", label: `Let your LykiaStile sign Gateway transfers for your USDC deposit (addDelegate)` };
}

export function removeDelegateTx(chainId: number, environment: ArcEnvironment, owner: Address, stile: Address): UnsignedTransaction {
  return { chainId, from: owner, to: GATEWAY_WALLET[environment], data: encodeFunctionData({ abi: GATEWAY_WALLET_ABI, functionName: "removeDelegate", args: [contractAddress("usdc", environment) as Address, stile] }), value: "0", label: "Remove your LykiaStile as a Gateway delegate (removeDelegate)" };
}

export function stileCallTx(chainId: number, owner: Address, stile: Address, call: { readonly functionName: "revokeSession"; readonly args: readonly [Hex] } | { readonly functionName: "setPaused"; readonly args: readonly [boolean] }, label: string): UnsignedTransaction {
  return { chainId, from: owner, to: stile, data: encodeFunctionData({ abi: STILE_ABI, functionName: call.functionName, args: call.args as never }), value: "0", label };
}

/* ------------------------------------------------------------ reads */

export interface StileSessionState {
  readonly block: bigint | null;
  readonly valid: boolean;
  readonly key: Address;
  readonly validUntil: bigint;
  readonly revoked: boolean;
  readonly perTransfer: bigint;
  readonly daily: bigint;
  readonly lifetime: bigint;
  readonly maxGatewayFee: bigint;
  readonly policyHash: Hex;
  readonly dayUsed: bigint;
  readonly consumed: bigint;
  readonly spendable: bigint;
  readonly paused: boolean;
  readonly delegated: boolean | null;
}

/** One multicall on the Stile (and Gateway Wallet for the delegation). Throws when the Stile cannot be read. */
export async function readStileSession(ctx: AppContext, environment: ArcEnvironment, stile: Address, sessionId: Hex, owner: Address): Promise<StileSessionState> {
  const client = ctx.chains.client(environment);
  const results = (await client.multicall({
    contracts: [
      { address: stile, abi: STILE_ABI, functionName: "getSession", args: [sessionId] },
      { address: stile, abi: STILE_ABI, functionName: "isSessionValid", args: [sessionId] },
      { address: stile, abi: STILE_ABI, functionName: "getUsage", args: [sessionId] },
      { address: stile, abi: STILE_ABI, functionName: "spendable", args: [sessionId] },
      { address: stile, abi: STILE_ABI, functionName: "paused" },
      { address: GATEWAY_WALLET[environment], abi: GATEWAY_WALLET_ABI, functionName: "isAuthorizedForBalance", args: [contractAddress("usdc", environment) as Address, owner, stile] },
    ] as never,
    allowFailure: true,
  })) as readonly { status: string; result?: unknown }[];
  if (results.slice(0, 5).some((r) => r.status !== "success")) throw new Error("The LykiaStile could not be read.");
  const s = results[0]!.result as { key: Address; validUntil: bigint; revoked: boolean; perTransfer: bigint; daily: bigint; lifetime: bigint; maxGatewayFee: bigint; policyHash: Hex };
  const usage = results[2]!.result as readonly [bigint, bigint];
  const block = await client.getBlockNumber().catch(() => null);
  return {
    block,
    valid: Boolean(results[1]!.result),
    key: s.key,
    validUntil: BigInt(s.validUntil),
    revoked: s.revoked,
    perTransfer: BigInt(s.perTransfer),
    daily: BigInt(s.daily),
    lifetime: BigInt(s.lifetime),
    maxGatewayFee: BigInt(s.maxGatewayFee),
    policyHash: s.policyHash,
    dayUsed: BigInt(usage[0]),
    consumed: BigInt(usage[1]),
    spendable: BigInt(results[3]!.result as bigint),
    paused: Boolean(results[4]!.result),
    delegated: results[5]!.status === "success" ? Boolean(results[5]!.result) : null,
  };
}

/** Finds the leash's session among the ids issued since it was made. */
export async function findStileSession(ctx: AppContext, environment: ArcEnvironment, input: { readonly stile: Address; readonly key: Address; readonly policyHash: Hex; readonly fromNonce: bigint }): Promise<Hex | null> {
  const client = ctx.chains.client(environment);
  const nonce = BigInt((await client.readContract({ address: input.stile, abi: STILE_ABI, functionName: "sessionNonce" })) as bigint);
  for (let n = nonce; n > input.fromNonce && n > nonce - 20n; n -= 1n) {
    const id = sessionIdOf(input.stile, input.key, n);
    const s = (await client.readContract({ address: input.stile, abi: STILE_ABI, functionName: "getSession", args: [id] })) as { key: Address; policyHash: Hex };
    if (s.key.toLowerCase() === input.key.toLowerCase() && s.policyHash.toLowerCase() === input.policyHash.toLowerCase()) return id;
  }
  return null;
}

/** The owner's Gateway balance per domain (USDC strings), or null when Gateway did not answer. */
export async function gatewayBalances(fetchImpl: FetchLike, environment: ArcEnvironment, owner: Address): Promise<{ readonly domain: number; readonly balance: string }[] | null> {
  try {
    const response = await circleFetch(fetchImpl, `${GATEWAY_API[environment]}/v1/balances`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "USDC", sources: GATEWAY_CHAINS.map((c) => ({ domain: c.domain, depositor: owner })) }), signal: AbortSignal.timeout(6_000) }, "Circle Gateway");
    if (!response.ok) return null;
    const json = (await response.json()) as { balances?: { domain?: number; balance?: string }[] };
    if (!Array.isArray(json.balances)) return null;
    return json.balances.filter((b) => typeof b.domain === "number" && typeof b.balance === "string" && /^\d+(?:\.\d+)?$/u.test(b.balance)).map((b) => ({ domain: b.domain!, balance: b.balance! }));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ burn intents */

export interface SpecMessage {
  readonly version: number;
  readonly sourceDomain: number;
  readonly destinationDomain: number;
  readonly sourceContract: Hex;
  readonly destinationContract: Hex;
  readonly sourceToken: Hex;
  readonly destinationToken: Hex;
  readonly sourceDepositor: Hex;
  readonly destinationRecipient: Hex;
  readonly sourceSigner: Hex;
  readonly destinationCaller: Hex;
  readonly value: string;
  readonly salt: Hex;
  readonly hookData: Hex;
}

export interface BurnIntentMessage {
  readonly maxBlockHeight: string;
  readonly maxFee: string;
  readonly spec: SpecMessage;
}

export const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;
const SET_TYPES = { ...BURN_INTENT_TYPES, BurnIntentSet: [{ name: "intents", type: "BurnIntent[]" }] } as const;
const DOMAIN = { name: "GatewayWallet", version: "1" } as const;

export function specFor(input: { readonly environment: ArcEnvironment; readonly owner: Address; readonly stile: Address; readonly destination: GatewayChain; readonly recipient: Address; readonly units: bigint; readonly salt?: Hex }): SpecMessage {
  const source = GATEWAY_CHAINS.find((c) => c.domain === ARC_DOMAIN)!;
  const env = input.environment;
  return {
    version: 1,
    sourceDomain: ARC_DOMAIN,
    destinationDomain: input.destination.domain,
    sourceContract: b32(GATEWAY_WALLET[env]),
    destinationContract: b32(GATEWAY_MINTER[env]),
    sourceToken: b32(source.usdc[env]),
    destinationToken: b32(input.destination.usdc[env]),
    sourceDepositor: b32(input.owner),
    destinationRecipient: b32(input.recipient),
    sourceSigner: b32(input.stile),
    destinationCaller: ZERO32,
    value: input.units.toString(),
    salt: input.salt ?? (`0x${randomBytes(32).toString("hex")}` as Hex),
    hookData: "0x",
  };
}

const typedMessage = (b: BurnIntentMessage) => ({ maxBlockHeight: BigInt(b.maxBlockHeight), maxFee: BigInt(b.maxFee), spec: { ...b.spec, value: BigInt(b.spec.value) } });

/** Gateway's EIP-712 digest: of the single intent, or of the set [payment, fee]. */
export function intentsDigest(intents: readonly BurnIntentMessage[]): Hex {
  if (intents.length === 1) return hashTypedData({ domain: DOMAIN, types: BURN_INTENT_TYPES, primaryType: "BurnIntent", message: typedMessage(intents[0]!) as never });
  return hashTypedData({ domain: DOMAIN, types: SET_TYPES, primaryType: "BurnIntentSet", message: { intents: intents.map(typedMessage) } as never });
}

/** keccak256 of Gateway's byte encoding of a TransferSpec (what AttestationUsed and GatewayBurned carry). */
export function transferSpecHashOf(s: SpecMessage): Hex {
  const hookLength = (s.hookData.length - 2) / 2;
  return keccak256(
    encodePacked(
      ["bytes4", "uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "uint32", "bytes"],
      [TRANSFER_SPEC_MAGIC, s.version, s.sourceDomain, s.destinationDomain, s.sourceContract, s.destinationContract, s.sourceToken, s.destinationToken, s.sourceDepositor, s.destinationRecipient, s.sourceSigner, s.destinationCaller, BigInt(s.value), s.salt, hookLength, s.hookData],
    ),
  );
}

export function reserveCalldata(sessionId: Hex, intents: readonly BurnIntentMessage[], memo: Hex): Hex {
  return encodeFunctionData({ abi: STILE_ABI, functionName: "reserve", args: [sessionId, intents.map(typedMessage) as never, memo] });
}

export function signatureFor(sessionId: Hex): Hex {
  return encodeAbiParameters([{ type: "bytes32" }], [sessionId]);
}

/**
 * Gateway's POST /v1/estimate for the intents: maxFee and maxBlockHeight per
 * intent. Falls back to Circle's published formula (twice the source gas fee
 * plus the transfer fee) with no expiry when the estimate cannot be read; a
 * forwarded transfer needs the estimate.
 */
export async function estimateIntents(fetchImpl: FetchLike, environment: ArcEnvironment, specs: readonly SpecMessage[], forward: boolean): Promise<{ readonly intents: BurnIntentMessage[]; readonly source: "estimate" | "formula" }> {
  const arc = GATEWAY_CHAINS.find((c) => c.domain === ARC_DOMAIN)!;
  const formula = (s: SpecMessage) => gatewayMaxFee(BigInt(s.value), s.destinationDomain !== ARC_DOMAIN, arc.gasFeeUsdc);
  try {
    const url = `${GATEWAY_API[environment]}/v1/estimate${forward ? "?enableForwarder=true" : ""}`;
    const response = await circleFetch(fetchImpl, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(specs.map((spec) => ({ spec }))), signal: AbortSignal.timeout(8_000) }, "Circle Gateway");
    const text = await response.text();
    if (!response.ok) throw new Error(JSON.stringify(upstreamReason(text)));
    const json = JSON.parse(text) as { body?: { burnIntent?: { maxFee?: string; maxBlockHeight?: string } }[] } | { burnIntent?: { maxFee?: string; maxBlockHeight?: string } }[];
    const rows = Array.isArray(json) ? json : (json.body ?? []);
    if (rows.length !== specs.length) throw new Error("estimate rows");
    const intents = specs.map((spec, i) => {
      const est = rows[i]?.burnIntent;
      if (!est?.maxFee || !/^\d+$/u.test(est.maxFee) || !est.maxBlockHeight || !/^\d+$/u.test(est.maxBlockHeight)) throw new Error("estimate fields");
      const fee = BigInt(est.maxFee);
      const buffered = forward ? fee + formula({ ...spec, value: "0", destinationDomain: ARC_DOMAIN }) / 2n : fee > formula(spec) ? fee : formula(spec);
      return { maxBlockHeight: est.maxBlockHeight, maxFee: buffered.toString(), spec };
    });
    return { intents, source: "estimate" };
  } catch (error) {
    if (forward) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Gateway's fee estimate could not be read; a forwarded transfer needs it.", { gateway: error instanceof Error ? error.message : String(error) });
    return { intents: specs.map((spec) => ({ maxBlockHeight: maxUint256.toString(), maxFee: formula(spec).toString(), spec })), source: "formula" };
  }
}

export interface GatewaySubmitResult {
  readonly transferId: string | null;
  readonly attestation: Hex | null;
  readonly signature: Hex | null;
}

/**
 * POST /v1/transfer with the contract signer: one SignedBurnIntentSet (or a
 * single SignedBurnIntent without a fee leg), `contractSigner: true`.
 * Throws LykiaHttpError GATEWAY_REFUSED with Gateway's reason when it says no.
 */
export async function submitToGateway(fetchImpl: FetchLike, environment: ArcEnvironment, input: { readonly intents: readonly BurnIntentMessage[]; readonly signature: Hex; readonly forward: boolean }): Promise<GatewaySubmitResult> {
  const item = input.intents.length === 1 ? { burnIntent: input.intents[0], signature: input.signature, contractSigner: true } : { burnIntentSet: { intents: input.intents }, signature: input.signature, contractSigner: true };
  const url = `${GATEWAY_API[environment]}/v1/transfer${input.forward ? "?enableForwarder=true" : ""}`;
  const response = await circleFetch(fetchImpl, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([item]), signal: AbortSignal.timeout(15_000) }, "Circle Gateway");
  const text = await response.text();
  if (!response.ok) throw new LykiaHttpError("GATEWAY_REFUSED", 502, `Gateway refused the transfer (${response.status}).`, { gateway: upstreamReason(text), status: response.status });
  const json = JSON.parse(text) as { transferId?: string; id?: string; attestation?: Hex; signature?: Hex };
  return { transferId: json.transferId ?? json.id ?? null, attestation: json.attestation ?? null, signature: json.signature ?? null };
}

/** The Stile's own error, decoded, from an eth_call revert; null when it is not one. */
export function stileError(error: unknown): string | null {
  let e: unknown = error;
  for (let i = 0; i < 8 && e; i++) {
    const data = (e as { data?: unknown }).data;
    const hex = typeof data === "string" ? data : data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string" ? (data as { data: string }).data : null;
    if (hex && /^0x[0-9a-fA-F]{8,}$/u.test(hex)) {
      try {
        const { errorName, args } = decodeErrorResult({ abi: STILE_ABI, data: hex as Hex });
        return `${errorName}(${(args ?? []).map((a) => String(a)).join(", ")})`;
      } catch {
        return null;
      }
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/* ------------------------------------------------------------ events */

export interface StileEvent {
  readonly name: "Reserved" | "StileMemo";
  readonly detail: string;
  readonly digest: Hex;
  readonly txHash: Hex;
  readonly block: bigint;
  readonly memo?: Hex;
  readonly transferSpecHash?: Hex;
}

/** Reserved and StileMemo events of one session in a receipt or a log scan. */
export function stileEvents(logs: readonly Log[], stile: Address, sessionId: Hex): StileEvent[] {
  const out: StileEvent[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== stile.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: STILE_ABI, data: log.data, topics: log.topics as never }) as { eventName: string; args: Record<string, unknown> };
      if (String(ev.args.sessionId ?? "").toLowerCase() !== sessionId.toLowerCase()) continue;
      const base = { digest: ev.args.digest as Hex, txHash: log.transactionHash as Hex, block: log.blockNumber ?? 0n };
      if (ev.eventName === "Reserved") out.push({ ...base, name: "Reserved", detail: `${fromUnits(BigInt(ev.args.value as bigint))} USDC to ${String(ev.args.recipient).slice(-40)} on domain ${String(ev.args.destinationDomain)}, fee ${fromUnits(BigInt(ev.args.fee as bigint))}`, transferSpecHash: ev.args.transferSpecHash as Hex });
      else if (ev.eventName === "StileMemo") out.push({ ...base, name: "StileMemo", detail: String(ev.args.memo), memo: ev.args.memo as Hex });
    } catch {
      /* another event */
    }
  }
  return out;
}

/** True when a receipt's logs carry GatewayMinter's AttestationUsed for this transferSpecHash. */
export function attestationUsedIn(logs: readonly Log[], minter: Address, transferSpecHash: Hex): boolean {
  return logs.some((log) => {
    if (log.address.toLowerCase() !== minter.toLowerCase()) return false;
    try {
      const ev = decodeEventLog({ abi: GATEWAY_MINTER_EVENTS, data: log.data, topics: log.topics as never }) as { args: { transferSpecHash: Hex } };
      return ev.args.transferSpecHash.toLowerCase() === transferSpecHash.toLowerCase();
    } catch {
      return false;
    }
  });
}

/** Optional JSON-RPC endpoints for Gateway destinations other than Arc (LYKIA_GATEWAY_RPC_<KEY>), to read mints there. */
export function destinationRpc(key: string): string | null {
  const value = process.env[`LYKIA_GATEWAY_RPC_${key.toUpperCase()}`];
  return value && /^https:\/\/[^\s]+$/u.test(value) ? value : null;
}

/** eth_getTransactionReceipt over plain JSON-RPC (destinations other than Arc). */
export async function remoteReceiptLogs(fetchImpl: FetchLike, rpc: string, hash: Hex): Promise<Log[] | null> {
  try {
    const response = await fetchImpl(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }), signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    const json = (await response.json()) as { result?: { status?: string; logs?: { address: string; topics: Hex[]; data: Hex }[] } | null };
    if (!json.result || json.result.status !== "0x1") return null;
    return (json.result.logs ?? []).map((l) => ({ address: l.address, topics: l.topics, data: l.data }) as unknown as Log);
  } catch {
    return null;
  }
}

export { gatewayChain };
