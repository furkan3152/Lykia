/**
 * viem chains for Arc, built from @lykia/core's registry. Arc pays gas in
 * USDC: the native currency is USDC with 18 decimals (the ERC-20 face at
 * 0x3600…0000 uses 6). Chain objects carry only the registry's public RPC.
 */
import { ARC_CONTRACTS, NETWORKS, type ArcEnvironment, type ArcNetwork, type ArcNetworkKey } from "@lykia/core";
import { defineChain, type Chain } from "viem";

function chainFromNetwork(network: ArcNetwork): Chain {
  const multicall = ARC_CONTRACTS.multicall3.addresses[network.environment];
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [...network.rpcUrls] } },
    blockExplorers: { default: { name: "Arcscan", url: network.explorerUrl } },
    contracts: multicall ? { multicall3: { address: multicall } } : undefined,
    testnet: network.environment === "testnet",
  });
}

const DEFINED_CHAINS: Readonly<Record<ArcNetworkKey, Chain>> = Object.freeze({
  "arc-testnet": chainFromNetwork(NETWORKS["arc-testnet"]),
  "arc-mainnet": chainFromNetwork(NETWORKS["arc-mainnet"]),
});

export function chainFor(environment: ArcEnvironment): Chain {
  return environment === "mainnet" ? DEFINED_CHAINS["arc-mainnet"] : DEFINED_CHAINS["arc-testnet"];
}

/** Chains offered to wallets in `mode`: the mode's Arc chain first, then the other. Never empty. */
export function walletChains(mode: ArcEnvironment): readonly [Chain, ...Chain[]] {
  const first = chainFor(mode);
  const other = chainFor(mode === "mainnet" ? "testnet" : "mainnet");
  return [first, other];
}
