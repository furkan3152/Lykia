/**
 * Deployment plan for Lykia's contracts on Arc. Hand-written (export.cjs never overwrites it).
 *
 * Every contract is deployed through the deterministic CREATE2 deployer that exists on both Arc
 * environments (0x4e59…956c, code checked on 2026-11-01), so its address is known before the
 * owner's wallet signs anything. The plan is data: the owner console shows each step, the owner's
 * wallet sends `tx`, and the console checks `predictedAddress`. The repository holds no keys and
 * nothing broadcasts on its own. NOT AUDITED.
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

/** Arachnid's deterministic deployment proxy: `data = salt (32 bytes) ++ initCode`. */
export const CREATE2_DEPLOYER: Address = "0x4e59b44847b379578588920ca78fbf26c0b4956c";

export type LykiaDeployable = "LykiaAccountFactory" | "LykiaRouter" | "PracticeVaultUSDC" | "PracticeVaultEURC" | "PracticeSwap" | "PracticeLending";

export type AbiArgType = "address" | "address[]" | "uint256" | "uint16" | "bytes32" | "string" | "bool";

export interface PlanArg {
  readonly name: string;
  readonly type: AbiArgType;
  readonly value: string | boolean | readonly string[];
}

export interface DeployStep {
  readonly step: number;
  readonly name: LykiaDeployable;
  readonly contract: string;
  readonly salt: `0x${string}`;
  readonly constructorArgs: readonly PlanArg[];
  readonly initCodeHash: `0x${string}`;
  readonly predictedAddress: Address;
  /** What the owner's wallet sends. */
  readonly tx: { readonly to: Address; readonly data: `0x${string}`; readonly value: "0" };
  readonly note?: string;
}

export interface PlanCall {
  readonly target: LykiaDeployable;
  readonly address: Address;
  readonly signature: string;
  readonly args: readonly PlanArg[];
  readonly tx: { readonly to: Address; readonly data: `0x${string}`; readonly value: "0" };
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

function isDynamic(type: AbiArgType): boolean {
  return type === "string" || type === "address[]";
}

function encodeValue(arg: PlanArg): string {
  switch (arg.type) {
    case "address":
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

/** CREATE2 address: keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:]. */
export function predictCreate2(deployer: string, salt: `0x${string}`, initCodeHash: `0x${string}`): Address {
  const packed = `ff${strip(deployer).toLowerCase()}${strip(salt)}${strip(initCodeHash)}`;
  return toChecksum(`0x${bytesToHex(keccak_256(hexToBytes(packed))).slice(24)}`);
}

/** EIP-55 checksum. */
export function toChecksum(address: string): Address {
  const lower = strip(address).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) out += parseInt(hash[i] as string, 16) >= 8 ? (lower[i] as string).toUpperCase() : lower[i];
  return out as Address;
}

export function lykiaSalt(name: LykiaDeployable, label = "v1"): `0x${string}` {
  return hex(keccak_256(utf8ToBytes(`lykia:${label}:${name}`)));
}

/* ------------------------------------------------------------------ the plan */

function deployStep(step: number, name: LykiaDeployable, contract: string, bytecode: string, args: readonly PlanArg[], label: string, note?: string): DeployStep {
  const salt = lykiaSalt(name, label);
  const initCode = `0x${strip(bytecode)}${strip(encodeArgs(args))}` as `0x${string}`;
  const initCodeHash = keccakHex(initCode);
  return {
    step,
    name,
    contract,
    salt,
    constructorArgs: args,
    initCodeHash,
    predictedAddress: predictCreate2(CREATE2_DEPLOYER, salt, initCodeHash),
    tx: { to: CREATE2_DEPLOYER, data: `0x${strip(salt)}${strip(initCode)}`, value: "0" },
    ...(note ? { note } : {}),
  };
}

/**
 * The ordered deployment for `environment`, owned by `owner`. Testnet adds the practice venues
 * (Morpho and Uniswap are not on Arc testnet) and allowlists them on the router.
 */
export function deployPlan(environment: ArcEnvironment, owner: Address, options: { readonly label?: string; readonly practice?: PracticeParams } = {}): DeployPlan {
  const label = options.label ?? "v1";
  const p = options.practice ?? {};
  const network = networkFor(environment);
  const steps: DeployStep[] = [];
  const initCalls: PlanCall[] = [];
  const add = (s: DeployStep) => {
    steps.push(s);
    return s;
  };
  const ownerArg: PlanArg = { name: "owner", type: "address", value: owner };

  add(deployStep(1, "LykiaAccountFactory", "LykiaAccountFactory", lykiaAccountFactoryArtifact.bytecode, [], label, "Creates the LykiaAccount implementation in its constructor."));
  const router = add(deployStep(2, "LykiaRouter", "LykiaRouter", lykiaRouterArtifact.bytecode, [{ name: "initialOwner", type: "address", value: owner }, { name: "venues", type: "address[]", value: [] }], label));

  const notes = [
    "Each step is a plain transaction to the CREATE2 deployer; the console compares the created code with the artifact.",
    "Accounts are created later per user: LykiaAccountFactory.createAccount(owner, salt, guardian, 0x3600000000000000000000000000000000000000) so native spends are charged to the USDC face.",
    "The contracts are not audited. Use small amounts.",
  ];

  if (environment === "testnet") {
    const usdc = ARC_CONTRACTS.usdc.addresses.testnet as Address;
    const eurc = ARC_CONTRACTS.eurc.addresses.testnet as Address;
    const cirbtc = ARC_CONTRACTS.cirbtc.addresses.testnet as Address;
    const vaultUsdc = add(deployStep(3, "PracticeVaultUSDC", "PracticeVault", practiceVaultArtifact.bytecode, [{ name: "asset", type: "address", value: usdc }, { name: "name", type: "string", value: "Lykia Practice USDC" }, { name: "symbol", type: "string", value: "lpUSDC" }, ownerArg], label, "Practice venue. Fund its yield with fund(amount, dripPerSecond)."));
    const vaultEurc = add(deployStep(4, "PracticeVaultEURC", "PracticeVault", practiceVaultArtifact.bytecode, [{ name: "asset", type: "address", value: eurc }, { name: "name", type: "string", value: "Lykia Practice EURC" }, { name: "symbol", type: "string", value: "lpEURC" }, ownerArg], label, "Practice venue."));
    const swap = add(deployStep(5, "PracticeSwap", "PracticeSwap", practiceSwapArtifact.bytecode, [
      { name: "base", type: "address", value: usdc },
      { name: "quote", type: "address", value: eurc },
      { name: "rate", type: "uint256", value: p.fxRate ?? "860000000000000000" },
      { name: "spreadBps", type: "uint16", value: String(p.fxSpreadBps ?? 10) },
      ownerArg,
    ], label, "Practice venue. Seed reserves with addLiquidity(usdc, eurc)."));
    const lending = add(deployStep(6, "PracticeLending", "PracticeLending", practiceLendingArtifact.bytecode, [
      { name: "collateral", type: "address", value: cirbtc },
      { name: "debtToken", type: "address", value: usdc },
      { name: "price", type: "uint256", value: p.btcPrice ?? "10000000000000" },
      { name: "ltvBps", type: "uint16", value: String(p.ltvBps ?? 7000) },
      { name: "liquidationThresholdBps", type: "uint16", value: String(p.liquidationThresholdBps ?? 8000) },
      { name: "liquidationBonusBps", type: "uint16", value: String(p.liquidationBonusBps ?? 500) },
      ownerArg,
    ], label, "Practice venue. Provide borrowable USDC with fund(amount)."));
    for (const venue of [vaultUsdc, vaultEurc, swap, lending]) {
      const args: PlanArg[] = [{ name: "venue", type: "address", value: venue.predictedAddress }, { name: "allowed", type: "bool", value: true }];
      initCalls.push({
        target: "LykiaRouter",
        address: router.predictedAddress,
        signature: "setVenue(address,bool)",
        args,
        tx: { to: router.predictedAddress, data: encodeCall("setVenue(address,bool)", args), value: "0" },
        note: `Allowlist ${venue.name} on the router.`,
      });
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
  return { environment, chainId: network.chainId, owner, deployer: CREATE2_DEPLOYER, steps, initCalls, postDeployChecks, notes };
}
