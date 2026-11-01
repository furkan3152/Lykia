/**
 * Wallets. The widget signs through whatever the host already has:
 *
 *  - a viem WalletClient (`walletClient`),
 *  - any EIP-1193 provider (`provider`), for example window.ethereum or a
 *    Circle modular wallet,
 *  - a wagmi config (`wagmiConfig`): the active connection's provider,
 *  - or nothing: it discovers injected wallets (EIP-6963, then
 *    window.ethereum) and connects on its own when the user acts.
 *
 * Only structural types are used, so the widget has no wallet dependency.
 */
import type { Address, ArcEnvironment, UnsignedTransaction } from "@lykia/core";

export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | Record<string, unknown> }): Promise<unknown>;
}

/** The part of a viem WalletClient the widget uses. */
export interface WalletClientLike {
  readonly account?: { readonly address: Address } | undefined;
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

/** The part of a wagmi Config the widget uses (wagmi v2). */
export interface WagmiConfigLike {
  readonly state: {
    readonly current: string | null;
    readonly connections: ReadonlyMap<string, { readonly accounts: readonly Address[]; readonly connector: { getProvider(): Promise<unknown> } }>;
  };
}

export interface WalletOptions {
  readonly walletClient?: WalletClientLike;
  readonly provider?: Eip1193Provider;
  readonly wagmiConfig?: WagmiConfigLike;
}

/** What the widget needs from a wallet. */
export interface LykiaSigner {
  readonly source: "walletClient" | "provider" | "wagmi" | "injected";
  /** The connected address; asks to connect when `connect` is true. */
  address(connect?: boolean): Promise<Address | null>;
  /** Switches to the transaction's chain if needed, sends it and returns the hash. */
  send(tx: UnsignedTransaction): Promise<`0x${string}`>;
}

export const ARC_CHAIN_IDS: Readonly<Record<ArcEnvironment, number>> = Object.freeze({ mainnet: 5042, testnet: 5042002 });

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value);
}

function toHexQuantity(value: string | number | bigint): `0x${string}` {
  return `0x${BigInt(value).toString(16)}`;
}

function signerFrom(provider: Eip1193Provider, source: LykiaSigner["source"], fixed?: Address): LykiaSigner {
  const address = async (connect = false): Promise<Address | null> => {
    if (fixed) return fixed;
    const method = connect ? "eth_requestAccounts" : "eth_accounts";
    const accounts = (await provider.request({ method })) as unknown;
    const first = Array.isArray(accounts) ? accounts[0] : undefined;
    return isAddress(first) ? first : null;
  };
  return {
    source,
    address,
    async send(tx) {
      const from = (await address(true)) ?? tx.from;
      const current = Number(BigInt((await provider.request({ method: "eth_chainId" })) as string));
      if (current !== tx.chainId) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHexQuantity(tx.chainId) }] });
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from, to: tx.to, data: tx.data, value: toHexQuantity(tx.value || "0") }] });
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(hash)) throw new Error("The wallet returned no transaction hash.");
      return hash as `0x${string}`;
    },
  };
}

/** Finds an injected wallet: EIP-6963 announcements first, window.ethereum second. Browser only. */
export async function discoverInjected(timeoutMs = 150): Promise<Eip1193Provider | null> {
  if (typeof window === "undefined") return null;
  const found: Eip1193Provider[] = [];
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<{ provider?: Eip1193Provider }>).detail;
    if (detail?.provider) found.push(detail.provider);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, timeoutMs));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);
  const legacy = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return found[0] ?? legacy ?? null;
}

/** The signer for the host's wallet options, or an injected one; null when there is no wallet at all. */
export async function resolveSigner(options: WalletOptions = {}): Promise<LykiaSigner | null> {
  if (options.walletClient) return signerFrom(options.walletClient as Eip1193Provider, "walletClient", options.walletClient.account?.address);
  if (options.provider) return signerFrom(options.provider, "provider");
  if (options.wagmiConfig) {
    const id = options.wagmiConfig.state.current;
    const connection = id ? options.wagmiConfig.state.connections.get(id) : undefined;
    if (connection) {
      const provider = (await connection.connector.getProvider()) as Eip1193Provider;
      return signerFrom(provider, "wagmi", connection.accounts[0]);
    }
  }
  const injected = await discoverInjected();
  return injected ? signerFrom(injected, "injected") : null;
}
