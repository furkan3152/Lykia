/**
 * Arc's system and Circle contracts, per environment. Each address was
 * checked with `eth_getCode` (non-empty) against Arc's public RPC on
 * 2026-11-01 and matches docs.arc.io/arc/references/contract-addresses.
 * Anything not listed here is not trusted by name.
 */
import type { ArcEnvironment } from "./networks.js";

export type Address = `0x${string}`;

export type ArcContractKey =
  | "usdc"
  | "eurc"
  | "usyc"
  | "cirbtc"
  | "weth"
  | "usycTeller"
  | "usycEntitlements"
  | "fxEscrow"
  | "permit2"
  | "tokenMessengerV2"
  | "messageTransmitterV2"
  | "tokenMinterV2"
  | "gatewayWallet"
  | "gatewayMinter"
  | "identityRegistry"
  | "reputationRegistry"
  | "validationRegistry"
  | "memo"
  | "multicall3From"
  | "multicall3"
  | "agenticCommerce";

export interface ArcContract {
  readonly key: ArcContractKey;
  readonly name: string;
  /** What Lykia uses it for, in one line. */
  readonly role: string;
  readonly standard?: string;
  readonly addresses: Readonly<Partial<Record<ArcEnvironment, Address>>>;
  readonly docs: string;
}

export const ARC_CONTRACTS: Readonly<Record<ArcContractKey, ArcContract>> = {
  usdc: {
    key: "usdc",
    name: "USDC",
    role: "Gas token and the unit of account. ERC-20 face uses 6 decimals, native face 18.",
    standard: "ERC-20 / EIP-3009 / EIP-2612",
    addresses: { mainnet: "0x3600000000000000000000000000000000000000", testnet: "0x3600000000000000000000000000000000000000" },
    docs: "https://docs.arc.io/arc/references/contract-addresses",
  },
  eurc: {
    key: "eurc",
    name: "EURC",
    role: "Euro stablecoin; the other side of StableFX.",
    standard: "ERC-20",
    addresses: { mainnet: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", testnet: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" },
    docs: "https://docs.arc.io/arc/references/contract-addresses",
  },
  usyc: {
    key: "usyc",
    name: "USYC",
    role: "Tokenized money-market yield (eligibility-restricted, non-US).",
    standard: "ERC-20",
    addresses: { mainnet: "0x8a5D989Bbb96929F689B0200f435f53dA42bF490", testnet: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" },
    docs: "https://docs.arc.io/arc/references/contract-addresses",
  },
  cirbtc: {
    key: "cirbtc",
    name: "cirBTC",
    role: "Circle Wrapped Bitcoin; collateral for App Kit Borrow.",
    standard: "ERC-20",
    addresses: { mainnet: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", testnet: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" },
    docs: "https://docs.arc.io/arc/references/contract-addresses",
  },
  weth: {
    key: "weth",
    name: "WETH",
    role: "Bridged WETH (lock on Ethereum, mint on Arc); App Kit Bridge asset.",
    standard: "ERC-20",
    addresses: { mainnet: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB", testnet: "0x2c4047028a72803939b6fb674D01bC059B5C4961" },
    docs: "https://docs.arc.io/arc/references/contract-addresses",
  },
  usycTeller: {
    key: "usycTeller",
    name: "USYC Teller",
    role: "Mints and redeems USYC from USDC for allowlisted wallets.",
    addresses: { mainnet: "0x51A8CE47dC08ba5CD19c7aa84EA6fD6664f60f9b", testnet: "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A" },
    docs: "https://docs.arc.io/arc/references/contract-addresses",
  },
  usycEntitlements: {
    key: "usycEntitlements",
    name: "USYC Entitlements",
    role: "Allowlist for USYC; Lykia reads it before offering a USYC move.",
    addresses: { mainnet: "0xb69ecb156Dc0028198028c501340d5367845ca72", testnet: "0xcc205224862c7641930c87679e98999d23c26113" },
    docs: "https://docs.arc.io/arc/references/contract-addresses",
  },
  fxEscrow: {
    key: "fxEscrow",
    name: "StableFX FxEscrow",
    role: "On-chain settlement of StableFX RFQ trades (USDC <-> EURC).",
    addresses: { mainnet: "0xe2E5F173576B513d994073CCbDaCBE027d43DFe6", testnet: "0xd68256f4D69C6BbEcB873D8588AE0Dc6B8E22E10" },
    docs: "https://developers.circle.com/stablefx",
  },
  permit2: {
    key: "permit2",
    name: "Permit2",
    role: "Allowance hub StableFX settles through.",
    addresses: { mainnet: "0x000000000022D473030F116dDEE9F6B43aC78BA3", testnet: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
    docs: "https://docs.arc.io/arc/references/contract-addresses",
  },
  tokenMessengerV2: {
    key: "tokenMessengerV2",
    name: "CCTP TokenMessengerV2",
    role: "Burns USDC on Arc for a native mint on another chain (depositForBurn).",
    addresses: { mainnet: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d", testnet: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" },
    docs: "https://developers.circle.com/cctp",
  },
  messageTransmitterV2: {
    key: "messageTransmitterV2",
    name: "CCTP MessageTransmitterV2",
    role: "Receives attested CCTP messages (mints USDC arriving on Arc).",
    addresses: { mainnet: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64", testnet: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" },
    docs: "https://developers.circle.com/cctp",
  },
  tokenMinterV2: {
    key: "tokenMinterV2",
    name: "CCTP TokenMinterV2",
    role: "CCTP minter (read-only for Lykia).",
    addresses: { mainnet: "0xfd78EE919681417d192449715b2594ab58f5D002", testnet: "0xb43db544E2c27092c107639Ad201b3dEfAbcF192" },
    docs: "https://developers.circle.com/cctp",
  },
  gatewayWallet: {
    key: "gatewayWallet",
    name: "Gateway Wallet",
    role: "Deposits into Circle Gateway: one unified USDC balance spendable on every Gateway chain.",
    addresses: { mainnet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", testnet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
    docs: "https://developers.circle.com/gateway",
  },
  gatewayMinter: {
    key: "gatewayMinter",
    name: "Gateway Minter",
    role: "Mints Gateway withdrawals on Arc from a signed attestation.",
    addresses: { mainnet: "0x2222222d7164433c4C09B0b0D809a9b52C04C205", testnet: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" },
    docs: "https://developers.circle.com/gateway",
  },
  identityRegistry: {
    key: "identityRegistry",
    name: "ERC-8004 IdentityRegistry",
    role: "Agent identities. A Tag is an ERC-8004 identity whose card pins a Fence hash.",
    standard: "ERC-8004",
    addresses: { mainnet: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", testnet: "0x8004A818BFB912233c491871b3d84c89A494BD9e" },
    docs: "https://docs.arc.io/arc/tutorials/register-your-first-ai-agent",
  },
  reputationRegistry: {
    key: "reputationRegistry",
    name: "ERC-8004 ReputationRegistry",
    role: "Feedback on agents; Lykia reads it into the Tag's standing.",
    standard: "ERC-8004",
    addresses: { mainnet: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63", testnet: "0x8004B663056A597Dffe9eCcC1965A193B7388713" },
    docs: "https://eips.ethereum.org/EIPS/eip-8004",
  },
  validationRegistry: {
    key: "validationRegistry",
    name: "ERC-8004 ValidationRegistry",
    role: "Validation requests and responses; Lykia files Fence verdicts here.",
    standard: "ERC-8004",
    addresses: { mainnet: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58", testnet: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" },
    docs: "https://eips.ethereum.org/EIPS/eip-8004",
  },
  memo: {
    key: "memo",
    name: "Arc Memo",
    role: "Attaches metadata to a call; every Lykia step carries its outrun id and verdict digest.",
    addresses: { mainnet: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505", testnet: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" },
    docs: "https://docs.arc.io/arc/concepts/transaction-memos",
  },
  multicall3From: {
    key: "multicall3From",
    name: "Multicall3From",
    role: "Batches calls while keeping msg.sender (CallFrom precompile): approve + act in one final transaction.",
    addresses: { mainnet: "0x522fAf9A91c41c443c66765030741e4AaCe147D0", testnet: "0x522fAf9A91c41c443c66765030741e4AaCe147D0" },
    docs: "https://docs.arc.io/arc/concepts/batched-transactions",
  },
  multicall3: {
    key: "multicall3",
    name: "Multicall3",
    role: "Batched reads (balances, allowances) in one round trip.",
    addresses: { mainnet: "0xcA11bde05977b3631167028862bE2a173976CA11", testnet: "0xcA11bde05977b3631167028862bE2a173976CA11" },
    docs: "https://www.multicall3.com",
  },
  agenticCommerce: {
    key: "agenticCommerce",
    name: "ERC-8183 AgenticCommerce (reference)",
    role: "USDC escrow for agent jobs. Testnet only.",
    standard: "ERC-8183",
    addresses: { testnet: "0x0747EEf0706327138c69792bF28Cd525089e4583" },
    docs: "https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job",
  },
};

export function contractAddress(key: ArcContractKey, environment: ArcEnvironment): Address | null {
  return ARC_CONTRACTS[key].addresses[environment] ?? null;
}

/** Throws when the contract is not deployed in `environment` (e.g. ERC-8183 on mainnet). */
export function requireContract(key: ArcContractKey, environment: ArcEnvironment): Address {
  const address = contractAddress(key, environment);
  if (!address) throw new Error(`${ARC_CONTRACTS[key].name} is not deployed on Arc ${environment}.`);
  return address;
}

/** Which known Arc contract lives at `address`, if any. */
export function contractAt(address: string, environment: ArcEnvironment): ArcContract | null {
  const lower = address.toLowerCase();
  return Object.values(ARC_CONTRACTS).find((c) => c.addresses[environment]?.toLowerCase() === lower) ?? null;
}

export function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value);
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
