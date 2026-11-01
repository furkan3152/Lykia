/**
 * Arc Network, both environments, and the facts Lykia leans on.
 *
 * Arc is an EVM L1 where USDC is the gas token, finality is deterministic
 * and sub-second (Malachite consensus), and Circle's rails (CCTP, Gateway,
 * StableFX) are first-class. Every figure below was read from the network
 * itself or from Arc's documentation; see `evidence`.
 */

export type ArcEnvironment = "mainnet" | "testnet";
export type ArcNetworkKey = "arc-mainnet" | "arc-testnet";

export interface ArcNetwork {
  readonly key: ArcNetworkKey;
  readonly environment: ArcEnvironment;
  readonly name: string;
  readonly chainId: number;
  /** `eip155:<chainId>`. */
  readonly caip2: `eip155:${number}`;
  /** CCTP domain of Arc (the same on both environments). */
  readonly cctpDomain: number;
  readonly rpcUrls: readonly string[];
  readonly explorerUrl: string;
  readonly faucetUrl: string | null;
  /** Gas is paid in native USDC (18 decimals). */
  readonly nativeCurrency: { readonly name: "USDC"; readonly symbol: "USDC"; readonly decimals: 18 };
  /** Mempool floor for maxFeePerGas, in gwei of native USDC. */
  readonly minMaxFeePerGasGwei: number;
  /** Public eth_getLogs window (blocks per call). */
  readonly logsBlockWindow: number;
  readonly finality: "deterministic";
  readonly evidence: string;
}

export const ARC_CCTP_DOMAIN = 26;

const NATIVE = { name: "USDC", symbol: "USDC", decimals: 18 } as const;

export const NETWORKS: Readonly<Record<ArcNetworkKey, ArcNetwork>> = {
  "arc-mainnet": {
    key: "arc-mainnet",
    environment: "mainnet",
    name: "Arc Mainnet",
    chainId: 5042,
    caip2: "eip155:5042",
    cctpDomain: ARC_CCTP_DOMAIN,
    rpcUrls: ["https://rpc.mainnet.arc.io"],
    explorerUrl: "https://explorer.arc.io",
    faucetUrl: null,
    nativeCurrency: NATIVE,
    minMaxFeePerGasGwei: 20,
    logsBlockWindow: 10_000,
    finality: "deterministic",
    evidence: "eth_chainId 0x13b2 on rpc.mainnet.arc.io (2026-11-01); docs.arc.io/arc/references/rpc-endpoints",
  },
  "arc-testnet": {
    key: "arc-testnet",
    environment: "testnet",
    name: "Arc Testnet",
    chainId: 5042002,
    caip2: "eip155:5042002",
    cctpDomain: ARC_CCTP_DOMAIN,
    rpcUrls: ["https://rpc.testnet.arc.io"],
    explorerUrl: "https://explorer.testnet.arc.io",
    faucetUrl: "https://faucet.circle.com",
    nativeCurrency: NATIVE,
    minMaxFeePerGasGwei: 20,
    logsBlockWindow: 10_000,
    finality: "deterministic",
    evidence: "eth_chainId 0x4cef52 on rpc.testnet.arc.io (2026-11-01); docs.arc.io/arc/references/rpc-endpoints",
  },
};

export const NETWORK_KEYS: readonly ArcNetworkKey[] = ["arc-mainnet", "arc-testnet"];

export function networkFor(environment: ArcEnvironment): ArcNetwork {
  return environment === "mainnet" ? NETWORKS["arc-mainnet"] : NETWORKS["arc-testnet"];
}

export function isNetworkKey(value: unknown): value is ArcNetworkKey {
  return value === "arc-mainnet" || value === "arc-testnet";
}

/**
 * Resolves a key, CAIP-2 id, chain id or alias ("arc", "mainnet",
 * "testnet") to a network. "arc" alone follows `environment`.
 */
export function resolveNetwork(input: string | number, environment: ArcEnvironment = "testnet"): ArcNetwork | null {
  if (typeof input === "number") return Object.values(NETWORKS).find((network) => network.chainId === input) ?? null;
  const text = input.trim().toLowerCase();
  if (isNetworkKey(text)) return NETWORKS[text];
  if (text === "arc") return networkFor(environment);
  if (text === "mainnet" || text === "arc mainnet") return NETWORKS["arc-mainnet"];
  if (text === "testnet" || text === "arc testnet") return NETWORKS["arc-testnet"];
  const caip = /^eip155:(\d+)$/u.exec(text);
  if (caip) return resolveNetwork(Number(caip[1]));
  if (/^\d+$/u.test(text)) return resolveNetwork(Number(text));
  return null;
}

export function explorerTx(network: ArcNetwork, hash: string): string {
  return `${network.explorerUrl}/tx/${hash}`;
}

export function explorerAddress(network: ArcNetwork, address: string): string {
  return `${network.explorerUrl}/address/${address}`;
}

/**
 * Where USDC can go from Arc over CCTP V2. Only domains Circle documents
 * as live CCTP V2 destinations are listed; anything else is refused rather
 * than guessed.
 */
export interface CctpDestination {
  readonly key: string;
  readonly name: string;
  readonly domain: number;
  readonly vm: "evm" | "solana";
  readonly chainIds: { readonly mainnet: number | null; readonly testnet: number | null };
  readonly aliases: readonly string[];
}

export const CCTP_DESTINATIONS: readonly CctpDestination[] = [
  { key: "ethereum", name: "Ethereum", domain: 0, vm: "evm", chainIds: { mainnet: 1, testnet: 11155111 }, aliases: ["eth", "mainnet ethereum", "sepolia"] },
  { key: "avalanche", name: "Avalanche", domain: 1, vm: "evm", chainIds: { mainnet: 43114, testnet: 43113 }, aliases: ["avax", "fuji"] },
  { key: "optimism", name: "OP Mainnet", domain: 2, vm: "evm", chainIds: { mainnet: 10, testnet: 11155420 }, aliases: ["op", "op mainnet"] },
  { key: "arbitrum", name: "Arbitrum", domain: 3, vm: "evm", chainIds: { mainnet: 42161, testnet: 421614 }, aliases: ["arb", "arbitrum one"] },
  { key: "solana", name: "Solana", domain: 5, vm: "solana", chainIds: { mainnet: null, testnet: null }, aliases: ["sol"] },
  { key: "base", name: "Base", domain: 6, vm: "evm", chainIds: { mainnet: 8453, testnet: 84532 }, aliases: ["base mainnet"] },
  { key: "polygon", name: "Polygon PoS", domain: 7, vm: "evm", chainIds: { mainnet: 137, testnet: 80002 }, aliases: ["matic", "pol"] },
  { key: "unichain", name: "Unichain", domain: 10, vm: "evm", chainIds: { mainnet: 130, testnet: 1301 }, aliases: ["uni"] },
  { key: "linea", name: "Linea", domain: 11, vm: "evm", chainIds: { mainnet: 59144, testnet: 59141 }, aliases: [] },
];

export function findCctpDestination(input: string): CctpDestination | null {
  const text = input.trim().toLowerCase();
  return CCTP_DESTINATIONS.find((d) => d.key === text || d.name.toLowerCase() === text || d.aliases.includes(text)) ?? null;
}
