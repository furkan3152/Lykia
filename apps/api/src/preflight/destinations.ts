/**
 * Native gas on a bridge's destination chain: the recipient's balance read
 * from the chain's own public RPC (eth_getBalance), so preflight can say
 * "the USDC lands, but there is no ETH there to move it". A chain without a
 * public endpoint run by its own team reads as unavailable, never as zero.
 */
import type { ArcEnvironment } from "@lykia/core";
import type { FetchLike } from "../health/dependencies.js";

interface DestinationRpc {
  readonly symbol: string;
  readonly mainnet: string | null;
  readonly testnet: string | null;
}

/** Public RPC endpoints published by each chain's own team. */
export const DESTINATION_RPCS: Readonly<Record<string, DestinationRpc>> = {
  base: { symbol: "ETH", mainnet: "https://mainnet.base.org", testnet: "https://sepolia.base.org" },
  optimism: { symbol: "ETH", mainnet: "https://mainnet.optimism.io", testnet: "https://sepolia.optimism.io" },
  arbitrum: { symbol: "ETH", mainnet: "https://arb1.arbitrum.io/rpc", testnet: "https://sepolia-rollup.arbitrum.io/rpc" },
  avalanche: { symbol: "AVAX", mainnet: "https://api.avax.network/ext/bc/C/rpc", testnet: "https://api.avax-test.network/ext/bc/C/rpc" },
  unichain: { symbol: "ETH", mainnet: "https://mainnet.unichain.org", testnet: "https://sepolia.unichain.org" },
  linea: { symbol: "ETH", mainnet: "https://rpc.linea.build", testnet: "https://rpc.sepolia.linea.build" },
  polygon: { symbol: "POL", mainnet: "https://polygon-rpc.com", testnet: "https://rpc-amoy.polygon.technology" },
};

export interface DestinationGas {
  readonly nativeWei: string | null;
  readonly nativeSymbol: string;
  readonly source: string;
}

export async function destinationGas(fetch: FetchLike, environment: ArcEnvironment, destination: string, recipient: string): Promise<DestinationGas | null> {
  const rpc = DESTINATION_RPCS[destination];
  if (!rpc) return null;
  const url = rpc[environment];
  if (!url) return { nativeWei: null, nativeSymbol: rpc.symbol, source: `${destination} RPC (none for ${environment})` };
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [recipient, "latest"] }), signal: AbortSignal.timeout(2_500) });
    if (!response.ok) return { nativeWei: null, nativeSymbol: rpc.symbol, source: new URL(url).host };
    const body = (await response.json()) as { result?: unknown };
    const wei = typeof body.result === "string" && /^0x[0-9a-f]+$/iu.test(body.result) ? BigInt(body.result).toString() : null;
    return { nativeWei: wei, nativeSymbol: rpc.symbol, source: `${new URL(url).host} · eth_getBalance` };
  } catch {
    return { nativeWei: null, nativeSymbol: rpc.symbol, source: new URL(url).host };
  }
}
