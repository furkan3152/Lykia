/**
 * viem public clients for Arc mainnet and testnet. One fallback transport
 * per environment (RPC overrides first), batched reads through Multicall3,
 * and the few raw JSON-RPC calls viem does not wrap (eth_simulateV1).
 *
 * Arc reminders: gas is native USDC (18 decimals) while the USDC ERC-20 at
 * 0x3600…0000 has 6; finality is deterministic, so a receipt is final.
 */
import { contractAddress, type ArcEnvironment, type ArcNetwork, type ArcNetworkKey } from "@lykia/core";
import {
  createPublicClient,
  defineChain,
  erc20Abi,
  fallback,
  http,
  isAddress,
  parseAbi,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type Transaction,
  type TransactionReceipt,
  type Transport,
} from "viem";
import { LykiaHttpError } from "../http/errors.js";

export const MULTICALL3_READS_ABI = parseAbi([
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
]);

export const RPC_TIMEOUT_MS = 6_000;
export const RPC_RETRY_COUNT = 1;
export const MAX_BALANCE_TOKENS = 100;

export type BalanceToken = "native" | Address;

export interface TokenBalance {
  readonly token: BalanceToken;
  readonly balance: bigint | null;
}

export interface BalancesResult {
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  readonly blockNumber: bigint | null;
  readonly balances: readonly TokenBalance[];
}

export interface BlockHeader {
  readonly number: bigint;
  readonly hash: Hash;
  readonly timestamp: bigint;
  readonly gasUsed: bigint;
  readonly gasLimit: bigint;
  readonly baseFeePerGas: bigint | null;
  readonly transactionCount: number;
}

export function defineArcChain(network: ArcNetwork): Chain {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { ...network.nativeCurrency },
    rpcUrls: { default: { http: [...network.rpcUrls] } },
    blockExplorers: { default: { name: "ArcScan", url: network.explorerUrl } },
    contracts: { multicall3: { address: contractAddress("multicall3", network.environment) as Address } },
    testnet: network.environment === "testnet",
  });
}

export interface ArcChainsOptions {
  readonly timeoutMs?: number;
  readonly retryCount?: number;
  /** Replaces the HTTP transport (tests). */
  readonly transport?: (network: ArcNetwork) => Transport;
  /** Raw JSON-RPC (tests replace it). */
  readonly rawRpc?: (network: ArcNetwork, method: string, params: readonly unknown[]) => Promise<unknown>;
}

function keyOf(environment: ArcEnvironment): ArcNetworkKey {
  return environment === "mainnet" ? "arc-mainnet" : "arc-testnet";
}

export class ArcChains {
  private readonly clients = new Map<ArcEnvironment, PublicClient>();

  constructor(
    private readonly networks: Readonly<Record<ArcNetworkKey, ArcNetwork>>,
    private readonly options: ArcChainsOptions = {},
  ) {}

  network(environment: ArcEnvironment): ArcNetwork {
    return this.networks[keyOf(environment)];
  }

  client(environment: ArcEnvironment): PublicClient {
    const existing = this.clients.get(environment);
    if (existing) return existing;
    const network = this.network(environment);
    const transport =
      this.options.transport?.(network) ??
      fallback(
        // Configured endpoints first, then Arc's documented keyless providers (the primary can answer -32014 near the head).
        [...network.rpcUrls, ...(network.fallbackRpcUrls ?? []).filter((u) => !network.rpcUrls.includes(u))].map((url) => http(url, { timeout: this.options.timeoutMs ?? RPC_TIMEOUT_MS, retryCount: this.options.retryCount ?? RPC_RETRY_COUNT })),
        { retryCount: 0 },
      );
    const client = createPublicClient({ chain: defineArcChain(network), transport, batch: { multicall: { wait: 16 } } }) as PublicClient;
    this.clients.set(environment, client);
    return client;
  }

  /** A JSON-RPC call viem does not wrap. Tries each endpoint in order. */
  async rawRpc(environment: ArcEnvironment, method: string, params: readonly unknown[]): Promise<unknown> {
    const network = this.network(environment);
    if (this.options.rawRpc) return this.options.rawRpc(network, method, params);
    let lastError: unknown = null;
    for (const url of network.rpcUrls) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? RPC_TIMEOUT_MS),
        });
        const body = (await response.json()) as { result?: unknown; error?: { code?: number; message?: string } };
        if (body.error) throw new RpcError(body.error.code ?? -1, body.error.message ?? "RPC error");
        return body.result;
      } catch (error) {
        if (error instanceof RpcError) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error("No RPC endpoint answered.");
  }

  /** Native and ERC-20 balances of `owner` in one Multicall3 round trip. */
  async getBalances(environment: ArcEnvironment, owner: string, tokens: readonly BalanceToken[]): Promise<BalancesResult> {
    if (!isAddress(owner, { strict: false })) throw new LykiaHttpError("INVALID_ADDRESS", 400, "owner must be a 0x-prefixed 20-byte hex address.");
    if (tokens.length > MAX_BALANCE_TOKENS) throw new LykiaHttpError("INVALID_REQUEST", 400, `At most ${MAX_BALANCE_TOKENS} tokens per balance read.`);
    const client = this.client(environment);
    const multicall3 = contractAddress("multicall3", environment) as Address;
    const account = owner.toLowerCase() as Address;
    const contracts = [
      { address: multicall3, abi: MULTICALL3_READS_ABI, functionName: "getBlockNumber" } as const,
      ...tokens.map((token) =>
        token === "native"
          ? ({ address: multicall3, abi: MULTICALL3_READS_ABI, functionName: "getEthBalance", args: [account] } as const)
          : ({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] } as const),
      ),
    ];
    const results = await client.multicall({ contracts, allowFailure: true, multicallAddress: multicall3 });
    const [head, ...rest] = results;
    return {
      environment,
      owner: account,
      blockNumber: head?.status === "success" ? (head.result as bigint) : null,
      balances: tokens.map((token, index) => {
        const result = rest[index];
        return { token, balance: result?.status === "success" ? (result.result as bigint) : null };
      }),
    };
  }

  async getBlockHeader(environment: ArcEnvironment, block: bigint | "latest" = "latest"): Promise<BlockHeader> {
    const client = this.client(environment);
    const raw = block === "latest" ? await client.getBlock({ blockTag: "latest" }) : await client.getBlock({ blockNumber: block });
    if (raw.number === null || raw.hash === null) throw new LykiaHttpError("NOT_FOUND", 404, "That block is not available yet.");
    return {
      number: raw.number,
      hash: raw.hash,
      timestamp: raw.timestamp,
      gasUsed: raw.gasUsed,
      gasLimit: raw.gasLimit,
      baseFeePerGas: raw.baseFeePerGas ?? null,
      transactionCount: raw.transactions.length,
    };
  }

  /** Receipt, or null while unknown. On Arc a receipt is final. */
  async getTxReceipt(environment: ArcEnvironment, hash: string): Promise<TransactionReceipt | null> {
    try {
      return await this.client(environment).getTransactionReceipt({ hash: hash as Hash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  }

  async getTransaction(environment: ArcEnvironment, hash: string): Promise<Transaction | null> {
    try {
      return await this.client(environment).getTransaction({ hash: hash as Hash });
    } catch (error) {
      if (error instanceof TransactionNotFoundError) return null;
      throw error;
    }
  }

  async getCode(environment: ArcEnvironment, address: Address): Promise<`0x${string}`> {
    return (await this.client(environment).getCode({ address })) ?? "0x";
  }
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}
