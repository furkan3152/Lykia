import "./wallet/polyfills";

import React from "react";
import { fallback, http, type Transport } from "viem";
import { createConfig, createStorage, WagmiProvider, type Config } from "wagmi";
import { injected } from "wagmi/connectors";

import { readStorage, removeStorage, writeStorage } from "./state/storage";
import type { NetworkMode } from "./state/uiPrefs";
import { useUiStore } from "./state/uiStore";
import { walletChains } from "./wallet/chains";

/*
 * The wallet stack for the deck (/app). Loaded lazily with the app shell, so
 * marketing routes never download wagmi or viem. Browser wallets are found
 * through EIP-6963 (wagmi's multi-injected discovery) with the generic
 * injected provider as a fallback; passkey smart accounts live in
 * features/wallet and load their SDK only when used. No WalletConnect.
 */

/** One HTTP transport per public endpoint, tried in order. */
function transportFor(urls: readonly string[]): Transport {
  const transports = [...new Set(urls)].map((url) => http(url));
  if (transports.length === 0) return http();
  return transports.length > 1 ? fallback(transports) : transports[0]!;
}

const configs = new Map<NetworkMode, Config>();

/** wagmi config per network mode (the mode's Arc chain first, so switching adds it to the wallet when missing). */
function configFor(mode: NetworkMode): Config {
  const existing = configs.get(mode);
  if (existing) return existing;
  const chains = walletChains(mode);
  const transports: Record<number, Transport> = {};
  for (const chain of chains) transports[chain.id] = transportFor(chain.rpcUrls.default.http);
  const config = createConfig({
    chains,
    connectors: [injected({ shimDisconnect: true })],
    multiInjectedProviderDiscovery: true,
    transports,
    ssr: false,
    // Arc finality is sub-second: poll receipts every second, not every four.
    pollingInterval: 1_000,
    // wagmi's default storage reads localStorage eagerly, which throws when site data is blocked.
    storage: createStorage({ key: "lykia.wagmi", storage: { getItem: readStorage, setItem: writeStorage, removeItem: removeStorage } }),
  });
  configs.set(mode, config);
  return config;
}

/** The subtree rendered inside the providers, read through context (see ProviderShell). */
const ProvidedChildren = React.createContext<React.ReactNode>(null);

function ProvidedChildrenSlot() {
  return <>{React.useContext(ProvidedChildren)}</>;
}

/**
 * The provider stack, rendered once per mode. WagmiProvider starts a
 * reconnect on every render; children arrive through context instead of
 * props, so a parent re-render only updates the slot and never re-renders
 * this shell (otherwise connections flap).
 */
const ProviderShell = React.memo(function ProviderShell() {
  const mode = useUiStore((state) => state.mode);
  const config = configFor(mode);
  return (
    <WagmiProvider config={config} reconnectOnMount>
      <ProvidedChildrenSlot />
    </WagmiProvider>
  );
});

/** Wallet providers for every route that talks to a wallet. */
export function WalletProviders({ children }: { readonly children: React.ReactNode }) {
  return (
    <ProvidedChildren.Provider value={children}>
      <ProviderShell />
    </ProvidedChildren.Provider>
  );
}
