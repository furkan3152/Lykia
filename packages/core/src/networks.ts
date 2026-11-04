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
  /**
   * Keyless node-provider endpoints Arc documents (docs.arc.io/arc/references/rpc-endpoints),
   * used after the primary: the primary is load-balanced and can answer -32014 for a block
   * at the head that one backend has not imported yet.
   */
  readonly fallbackRpcUrls: readonly string[];
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

/**
 * Emitter of Arc's EIP-7708 native `Transfer` logs (18 decimals): every
 * explicit USDC movement, native sends included. The ERC-20 face at 0x3600…
 * logs only ERC-20 calls (6 decimals), so a plain native send appears only
 * here; never count both for one movement.
 * https://docs.arc.io/arc/references/usdc-system-events
 */
export const ARC_NATIVE_TRANSFER_EMITTER = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE" as const;

/**
 * CCTP V2 with Arc as the source chain, per Circle's tables
 * (developers.circle.com/cctp/concepts/supported-chains-and-domains, /fees,
 * /finality-and-block-confirmations): Arc attests after 1 block (~0.5 s), so
 * Fast Transfer is "N/A" from Arc and a Standard Transfer costs 0 bps.
 * Upfront fees and the Forwarding Service are supported. Inbound transfers
 * from slow-finality chains (Ethereum, Base, Arbitrum, ...) can use Fast
 * Transfer; that fee is the source chain's.
 */
export const ARC_CCTP_SOURCE = { fastTransfer: false, standardFeeBps: 0, attestationSeconds: 0.5, upfrontFees: true, forwarding: true } as const;

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
    fallbackRpcUrls: ["https://rpc.drpc.mainnet.arc.io", "https://rpc.quicknode.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io"],
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
    fallbackRpcUrls: ["https://rpc.drpc.testnet.arc.io", "https://rpc.quicknode.testnet.arc.io", "https://rpc.blockdaemon.testnet.arc.io"],
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
  /** Circle's Forwarding Service delivers the destination mint (developers.circle.com/cctp/concepts/supported-chains-and-domains). */
  readonly forwarding: boolean;
}

export const CCTP_DESTINATIONS: readonly CctpDestination[] = [
  { key: "ethereum", name: "Ethereum", domain: 0, vm: "evm", chainIds: { mainnet: 1, testnet: 11155111 }, aliases: ["eth", "mainnet ethereum", "sepolia"], forwarding: true },
  { key: "avalanche", name: "Avalanche", domain: 1, vm: "evm", chainIds: { mainnet: 43114, testnet: 43113 }, aliases: ["avax", "fuji"], forwarding: true },
  { key: "optimism", name: "OP Mainnet", domain: 2, vm: "evm", chainIds: { mainnet: 10, testnet: 11155420 }, aliases: ["op", "op mainnet"], forwarding: true },
  { key: "arbitrum", name: "Arbitrum", domain: 3, vm: "evm", chainIds: { mainnet: 42161, testnet: 421614 }, aliases: ["arb", "arbitrum one"], forwarding: true },
  { key: "solana", name: "Solana", domain: 5, vm: "solana", chainIds: { mainnet: null, testnet: null }, aliases: ["sol"], forwarding: true },
  { key: "base", name: "Base", domain: 6, vm: "evm", chainIds: { mainnet: 8453, testnet: 84532 }, aliases: ["base mainnet"], forwarding: true },
  { key: "polygon", name: "Polygon PoS", domain: 7, vm: "evm", chainIds: { mainnet: 137, testnet: 80002 }, aliases: ["matic", "pol"], forwarding: true },
  { key: "unichain", name: "Unichain", domain: 10, vm: "evm", chainIds: { mainnet: 130, testnet: 1301 }, aliases: ["uni"], forwarding: true },
  { key: "linea", name: "Linea", domain: 11, vm: "evm", chainIds: { mainnet: 59144, testnet: 59141 }, aliases: [], forwarding: true },
  // Also Gateway chains: chain ids and USDC addresses match apps/api/src/circle/chains.ts (Circle's published tables).
  { key: "sonic", name: "Sonic", domain: 13, vm: "evm", chainIds: { mainnet: 146, testnet: 14601 }, aliases: [], forwarding: true },
  { key: "worldchain", name: "World Chain", domain: 14, vm: "evm", chainIds: { mainnet: 480, testnet: 4801 }, aliases: ["world chain"], forwarding: true },
  { key: "sei", name: "Sei", domain: 16, vm: "evm", chainIds: { mainnet: 1329, testnet: 1328 }, aliases: [], forwarding: true },
  { key: "hyperevm", name: "HyperEVM", domain: 19, vm: "evm", chainIds: { mainnet: 999, testnet: 998 }, aliases: ["hyperliquid evm"], forwarding: true },
];

export function findCctpDestination(input: string): CctpDestination | null {
  const text = input.trim().toLowerCase();
  return CCTP_DESTINATIONS.find((d) => d.key === text || d.name.toLowerCase() === text || d.aliases.includes(text)) ?? null;
}
