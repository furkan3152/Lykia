/**
 * Deployment plan for Lykia's contracts on Arc. Hand-written (export.cjs never overwrites it).
 *
 * Every core contract is created by a plain CREATE transaction sent straight from the owner's
 * wallet (no `to`, data = bytecode ++ constructor args), so explorers list the owner's wallet as
 * the contract creator. With the wallet's current nonce the addresses are known in advance
 * (keccak256(rlp(sender, nonce))[12:]); without it the console reads them from the receipts and
 * fills later references with `resolveStep` / `resolveCall`. The plan is data: the repository
 * holds no keys and nothing broadcasts on its own. NOT AUDITED.
 *
 * LykiaAccountFactory, once deployed, creates each user's LykiaAccount as a clone: user accounts
 * are created by the factory on purpose, the core contracts are created by the owner's wallet.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { ARC_CONTRACTS, type Address } from "../contracts.js";
import { networkFor, type ArcEnvironment } from "../networks.js";
import { lykiaAccountFactoryArtifact } from "./LykiaAccountFactory.js";
import { lykiaRouterArtifact } from "./LykiaRouter.js";
import { practiceVaultArtifact } from "./PracticeVault.js";
import { practiceSwapArtifact } from "./PracticeSwap.js";
import { practiceLendingArtifact } from "./PracticeLending.js";

export type LykiaDeployable = "LykiaAccountFactory" | "LykiaRouter" | "PracticeVaultUSDC" | "PracticeVaultEURC" | "PracticeSwap" | "PracticeLending";

export type AbiArgType = "address" | "address[]" | "uint256" | "uint16" | "bytes32" | "string" | "bool";

/** An address argument that points at a contract deployed earlier in the same plan. */
export interface PlanRef {
  readonly ref: LykiaDeployable;
}

export interface PlanArg {
  readonly name: string;
  readonly type: AbiArgType;
  readonly value: string | boolean | readonly string[] | PlanRef;
}

/** Addresses of contracts already deployed from this plan, by step name. */
export type DeployedAddresses = Readonly<Partial<Record<LykiaDeployable, Address>>>;

/** A contract-creation transaction: no `to`, the data is the init code. */
export interface CreationTx {
  readonly to: null;
  readonly data: `0x${string}`;
  readonly value: "0";
}

export interface DeployStep {
  readonly step: number;
  readonly name: LykiaDeployable;
  readonly contract: string;
  /** Creation bytecode from the artifact, without constructor arguments. */
  readonly bytecode: `0x${string}`;
  readonly constructorArgs: readonly PlanArg[];
  /** Keccak of the runtime code the created contract must carry, immutables zeroed (see runtimeCodeHash). */
  readonly runtimeCodeHash: `0x${string}`;
  /** Wallet nonce this step uses when the plan was built with a starting nonce, else null. */
  readonly nonce: number | null;
  /** CREATE address from (owner, nonce), or null when no nonce was given. */
  readonly predictedAddress: Address | null;
  /** What the owner's wallet sends, or null while a constructor argument still refers to an undeployed step (see resolveStep). */
  readonly tx: CreationTx | null;
  readonly note?: string;
}

export interface PlanCall {
  readonly target: LykiaDeployable;
  /** The target's address when known in advance, else null (resolveCall fills it). */
  readonly address: Address | null;
  readonly signature: string;
  readonly args: readonly PlanArg[];
  /** Ready transaction when every address is known, else null. */
  readonly tx: { readonly to: Address; readonly data: `0x${string}`; readonly value: "0" } | null;
  readonly note: string;
}

export interface PostDeployCheck {
  readonly target: LykiaDeployable;
  readonly call: string;
  readonly expect: string;
}

export interface DeployPlan {
  readonly environment: ArcEnvironment;
  readonly chainId: number;
  readonly owner: Address;
  /** Who sends every creation transaction and shows as the contract creator: the owner's wallet. */
  readonly deployer: Address;
  readonly steps: readonly DeployStep[];
  /** Admin calls after deployment, signed by the owner. */
  readonly initCalls: readonly PlanCall[];
  readonly postDeployChecks: readonly PostDeployCheck[];
  readonly notes: readonly string[];
}

export interface PracticeParams {
  /** EURC per USDC, 1e18-scaled decimal string. Default 0.86. */
  readonly fxRate?: string;
  readonly fxSpreadBps?: number;
  /** BTC price in USDC, 1e8-scaled decimal string. Default 100,000. */
  readonly btcPrice?: string;
  readonly ltvBps?: number;
  readonly liquidationThresholdBps?: number;
  readonly liquidationBonusBps?: number;
}

/* ------------------------------------------------------------------ ABI encoding (constructor args) */

function hex(bytes: Uint8Array): `0x${string}` {
  return `0x${bytesToHex(bytes)}`;
}

function strip(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function word(value: bigint): string {
  if (value < 0n || value >= 1n << 256n) throw new Error("uint out of range");
  return value.toString(16).padStart(64, "0");
}

function addressWord(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) throw new Error(`not an address: ${value}`);
  return strip(value).toLowerCase().padStart(64, "0");
}

export function isRef(value: PlanArg["value"]): value is PlanRef {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "ref" in value;
}

function isDynamic(type: AbiArgType): boolean {
  return type === "string" || type === "address[]";
}

function encodeValue(arg: PlanArg): string {
  switch (arg.type) {
    case "address":
      if (isRef(arg.value)) throw new Error(`${arg.name} still refers to ${arg.value.ref}; resolve it first.`);
      return addressWord(arg.value as string);
    case "uint256":
    case "uint16":
      return word(BigInt(arg.value as string));
    case "bool":
      return word(arg.value === true ? 1n : 0n);
    case "bytes32": {
      const body = strip(arg.value as string);
      if (!/^[0-9a-fA-F]{64}$/u.test(body)) throw new Error("bytes32 must be 32 bytes");
      return body.toLowerCase();
    }
    case "string": {
      const bytes = bytesToHex(utf8ToBytes(arg.value as string));
      const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
      return word(BigInt(bytes.length / 2)) + padded;
    }
    case "address[]": {
      const list = arg.value as readonly string[];
      return word(BigInt(list.length)) + list.map(addressWord).join("");
    }
  }
}

/** Standard ABI encoding of a tuple of the supported types (head/tail layout). */
export function encodeArgs(args: readonly PlanArg[]): `0x${string}` {
  let head = "";
  let tail = "";
  const headSize = args.length * 32;
  for (const arg of args) {
    if (isDynamic(arg.type)) {
      head += word(BigInt(headSize + tail.length / 2));
      tail += encodeValue(arg);
    } else {
      head += encodeValue(arg);
    }
  }
  return `0x${head}${tail}`;
}

export function functionSelector(signature: string): `0x${string}` {
  return hex(keccak_256(utf8ToBytes(signature)).slice(0, 4));
}

export function encodeCall(signature: string, args: readonly PlanArg[]): `0x${string}` {
  return `0x${strip(functionSelector(signature))}${strip(encodeArgs(args))}`;
}

export function keccakHex(data: `0x${string}`): `0x${string}` {
  return hex(keccak_256(hexToBytes(strip(data))));
}

function rlpLength(length: number, offset: number): string {
  if (length < 56) return (offset + length).toString(16).padStart(2, "0");
  const len = length.toString(16);
  const lenHex = len.length % 2 ? `0${len}` : len;
  return (offset + 55 + lenHex.length / 2).toString(16) + lenHex;
}

function rlpBytes(bytesHex: string): string {
  if (bytesHex.length === 2 && parseInt(bytesHex, 16) < 0x80) return bytesHex;
  return rlpLength(bytesHex.length / 2, 0x80) + bytesHex;
}

/** CREATE address: keccak256(rlp([sender, nonce]))[12:]. */
export function predictCreate(sender: string, nonce: number | bigint): Address {
  const n = BigInt(nonce);
  if (n < 0n) throw new Error("nonce must be non-negative");
  let nonceHex = n === 0n ? "" : n.toString(16);
  if (nonceHex.length % 2) nonceHex = `0${nonceHex}`;
  const payload = rlpBytes(strip(sender).toLowerCase()) + rlpBytes(nonceHex);
  const encoded = rlpLength(payload.length / 2, 0xc0) + payload;
  return toChecksum(`0x${bytesToHex(keccak_256(hexToBytes(encoded))).slice(24)}`);
}

/** EIP-55 checksum. */
export function toChecksum(address: string): Address {
  const lower = strip(address).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) out += parseInt(hash[i] as string, 16) >= 8 ? (lower[i] as string).toUpperCase() : lower[i];
  return out as Address;
}

export interface CodeRange {
  readonly start: number;
  readonly length: number;
}

/** Zeroes the byte ranges a constructor fills with immutables, so deployed code compares with the artifact. */
export function maskImmutables(code: `0x${string}`, ranges: readonly CodeRange[]): `0x${string}` {
  let body = strip(code).toLowerCase();
  for (const r of ranges) {
    const from = r.start * 2;
    const to = from + r.length * 2;
    if (to > body.length) continue;
    body = body.slice(0, from) + "0".repeat(to - from) + body.slice(to);
  }
  return `0x${body}`;
}

/** Keccak of runtime code with its immutable ranges zeroed. */
export function runtimeCodeHash(code: `0x${string}`, ranges: readonly CodeRange[]): `0x${string}` {
  return keccakHex(maskImmutables(code, ranges));
}

interface DeployableArtifact {
  readonly bytecode: string;
  readonly deployedBytecode: string;
  readonly immutableReferences: readonly CodeRange[];
}

/** Artifacts of the contracts the owner deploys, by contract name. */
export const DEPLOYABLE_ARTIFACTS: Readonly<Record<string, DeployableArtifact>> = {
  LykiaAccountFactory: lykiaAccountFactoryArtifact,
  LykiaRouter: lykiaRouterArtifact,
  PracticeVault: practiceVaultArtifact,
  PracticeSwap: practiceSwapArtifact,
  PracticeLending: practiceLendingArtifact,
};

/** Whether code read from the chain is the given contract's runtime code (immutables ignored). */
export function codeMatchesArtifact(contract: string, onchainCode: `0x${string}`): boolean | null {
  const artifact = DEPLOYABLE_ARTIFACTS[contract];
  if (!artifact) return null;
  if (strip(onchainCode).length !== strip(artifact.deployedBytecode).length) return false;
  return runtimeCodeHash(onchainCode, artifact.immutableReferences) === runtimeCodeHash(artifact.deployedBytecode as `0x${string}`, artifact.immutableReferences);
}

/** Fills `{ ref }` arguments from already-deployed addresses; throws while a referenced step is missing. */
export function resolveArgs(args: readonly PlanArg[], deployed: DeployedAddresses): PlanArg[] {
  return args.map((arg) => {
    if (!isRef(arg.value)) return arg;
    const address = deployed[arg.value.ref];
    if (!address) throw new Error(`${arg.name} needs ${arg.value.ref}, which is not deployed yet.`);
    return { ...arg, value: address };
  });
}

/** The init code (bytecode ++ constructor args) for a step, with references resolved. */
export function resolveStep(step: DeployStep, deployed: DeployedAddresses = {}): CreationTx {
  return { to: null, data: `0x${strip(step.bytecode)}${strip(encodeArgs(resolveArgs(step.constructorArgs, deployed)))}`, value: "0" };
}

/** The admin call for a deployed target, with references resolved. */
export function resolveCall(call: PlanCall, deployed: DeployedAddresses = {}): { readonly to: Address; readonly data: `0x${string}`; readonly value: "0" } {
  const to = call.address ?? deployed[call.target];
  if (!to) throw new Error(`${call.target} is not deployed yet.`);
  return { to, data: encodeCall(call.signature, resolveArgs(call.args, deployed)), value: "0" };
}

/* ------------------------------------------------------------------ the plan */

function deployStep(step: number, name: LykiaDeployable, contract: string, artifact: DeployableArtifact, args: readonly PlanArg[], nonce: number | null, note?: string): DeployStep {
  const bytecode = `0x${strip(artifact.bytecode)}` as `0x${string}`;
  const draft: DeployStep = {
    step,
    name,
    contract,
    bytecode,
    constructorArgs: args,
    runtimeCodeHash: runtimeCodeHash(`0x${strip(artifact.deployedBytecode)}`, artifact.immutableReferences),
    nonce,
    predictedAddress: null,
    tx: null,
    ...(note ? { note } : {}),
  };
  const ready = args.every((a) => !isRef(a.value));
  return { ...draft, tx: ready ? resolveStep(draft) : null };
}

/**
 * The ordered deployment for `environment`, owned by `owner`. Testnet adds the practice venues
 * (Morpho and Uniswap are not on Arc testnet) and allowlists them on the router.
 */
export function deployPlan(environment: ArcEnvironment, owner: Address, options: { readonly nonce?: number; readonly practice?: PracticeParams } = {}): DeployPlan {
  const p = options.practice ?? {};
  const startNonce = options.nonce;
  if (startNonce !== undefined && (!Number.isInteger(startNonce) || startNonce < 0)) throw new Error("nonce must be a non-negative integer");
  const network = networkFor(environment);
  const steps: DeployStep[] = [];
  const initCalls: PlanCall[] = [];
  const nextNonce = (): number | null => (startNonce === undefined ? null : startNonce + steps.length);
  const add = (s: DeployStep) => {
    const placed: DeployStep = s.nonce === null ? s : { ...s, predictedAddress: predictCreate(owner, s.nonce) };
    steps.push(placed);
    return placed;
  };
  const ownerArg: PlanArg = { name: "owner", type: "address", value: owner };

  add(deployStep(1, "LykiaAccountFactory", "LykiaAccountFactory", lykiaAccountFactoryArtifact, [], nextNonce(), "Creates the LykiaAccount implementation in its constructor; later it creates each user's account as a clone."));
  const router = add(deployStep(2, "LykiaRouter", "LykiaRouter", lykiaRouterArtifact, [{ name: "initialOwner", type: "address", value: owner }, { name: "venues", type: "address[]", value: [] }], nextNonce()));

  const notes = [
    "Each step is a contract-creation transaction sent from the owner's wallet, so explorers show that wallet as the creator. The console checks each created contract's runtime code against the artifact.",
    "User accounts are the exception by design: LykiaAccountFactory creates each LykiaAccount as a clone, so the factory is their creator.",
    "Accounts are created later per user: LykiaAccountFactory.createAccount(owner, salt, guardian, 0x3600000000000000000000000000000000000000) so native spends are charged to the USDC face.",
    "The contracts are not audited. Use small amounts.",
  ];

  if (environment === "testnet") {
    const usdc = ARC_CONTRACTS.usdc.addresses.testnet as Address;
    const eurc = ARC_CONTRACTS.eurc.addresses.testnet as Address;
    const cirbtc = ARC_CONTRACTS.cirbtc.addresses.testnet as Address;
    const vaultUsdc = add(deployStep(3, "PracticeVaultUSDC", "PracticeVault", practiceVaultArtifact, [{ name: "asset", type: "address", value: usdc }, { name: "name", type: "string", value: "Lykia Practice USDC" }, { name: "symbol", type: "string", value: "lpUSDC" }, ownerArg], nextNonce(), "Practice venue. Fund its yield with fund(amount, dripPerSecond)."));
    const vaultEurc = add(deployStep(4, "PracticeVaultEURC", "PracticeVault", practiceVaultArtifact, [{ name: "asset", type: "address", value: eurc }, { name: "name", type: "string", value: "Lykia Practice EURC" }, { name: "symbol", type: "string", value: "lpEURC" }, ownerArg], nextNonce(), "Practice venue."));
    const swap = add(deployStep(5, "PracticeSwap", "PracticeSwap", practiceSwapArtifact, [
      { name: "base", type: "address", value: usdc },
      { name: "quote", type: "address", value: eurc },
      { name: "rate", type: "uint256", value: p.fxRate ?? "860000000000000000" },
      { name: "spreadBps", type: "uint16", value: String(p.fxSpreadBps ?? 10) },
      ownerArg,
    ], nextNonce(), "Practice venue. Seed reserves with addLiquidity(usdc, eurc)."));
    const lending = add(deployStep(6, "PracticeLending", "PracticeLending", practiceLendingArtifact, [
      { name: "collateral", type: "address", value: cirbtc },
      { name: "debtToken", type: "address", value: usdc },
      { name: "price", type: "uint256", value: p.btcPrice ?? "10000000000000" },
      { name: "ltvBps", type: "uint16", value: String(p.ltvBps ?? 7000) },
      { name: "liquidationThresholdBps", type: "uint16", value: String(p.liquidationThresholdBps ?? 8000) },
      { name: "liquidationBonusBps", type: "uint16", value: String(p.liquidationBonusBps ?? 500) },
      ownerArg,
    ], nextNonce(), "Practice venue. Provide borrowable USDC with fund(amount)."));
    for (const venue of [vaultUsdc, vaultEurc, swap, lending]) {
      const args: PlanArg[] = [{ name: "venue", type: "address", value: venue.predictedAddress ?? { ref: venue.name } }, { name: "allowed", type: "bool", value: true }];
      const call: PlanCall = { target: "LykiaRouter", address: router.predictedAddress, signature: "setVenue(address,bool)", args, tx: null, note: `Allowlist ${venue.name} on the router.` };
      const known = router.predictedAddress !== null && venue.predictedAddress !== null;
      initCalls.push(known ? { ...call, tx: resolveCall(call) } : call);
    }
    notes.push("Practice venues are Arc testnet stand-ins for Morpho, Uniswap/StableFX and Aave V4; they are not products.");
  } else {
    notes.push("On mainnet, add router venues from the registry (Morpho vaults, Uniswap SwapRouter02) with setVenue after review.");
  }

  const postDeployChecks: PostDeployCheck[] = [
    { target: "LykiaAccountFactory", call: "implementation()", expect: "nonzero" },
    { target: "LykiaRouter", call: "owner()", expect: owner },
    { target: "LykiaRouter", call: "paused()", expect: "false" },
    ...steps.filter((s) => s.name.startsWith("Practice")).map((s) => ({ target: s.name, call: "owner()", expect: owner })),
  ];
  return { environment, chainId: network.chainId, owner, deployer: owner, steps, initCalls, postDeployChecks, notes };
}
