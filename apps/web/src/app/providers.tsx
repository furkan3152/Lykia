import "./wallet/polyfills";
import "@rainbow-me/rainbowkit/styles.css";

import { connectorsForWallets, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import React, { useMemo } from "react";
import { fallback, http, type Transport } from "viem";
import { createConfig, createStorage, WagmiProvider, type Config } from "wagmi";

import { readStorage, removeStorage, writeStorage } from "./state/storage";
import type { NetworkMode } from "./state/uiPrefs";
import { useUiStore } from "./state/uiStore";
import { useResolvedTheme } from "./state/useTheme";
import { walletChains } from "./wallet/chains";
import { lykiaRainbowTheme } from "./wallet/rainbowTheme";
import { walletConnectProjectId } from "./wallet/walletConnectProjectId";
import { walletList } from "./wallet/wallets";

/*
 * The wallet stack for the deck (/app). Loaded lazily with the app shell, so
 * marketing routes never download wagmi, viem or RainbowKit. The react-query
 * client lives at the root (src/app/queryClient.ts) and is shared.
 */

// A missing or malformed id hides WalletConnect instead of showing a button that cannot connect.
const projectId = walletConnectProjectId(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID);

/** One HTTP transport per public endpoint, tried in order. */
function transportFor(urls: readonly string[]): Transport {
  const transports = [...new Set(urls)].map((url) => http(url));
  if (transports.length === 0) return http();
  return transports.length > 1 ? fallback(transports) : transports[0]!;
}

const configs = new Map<NetworkMode, Config>();

/** wagmi config per network mode (the mode's Arc chain first). */
function configFor(mode: NetworkMode): Config {
  const existing = configs.get(mode);
  if (existing) return existing;
  const chains = walletChains(mode);
  const connectors = connectorsForWallets(walletList(projectId), { appName: "Lykia", appDescription: "The agent and stablecoin desk built on Arc Network", projectId: projectId ?? "" });
  const transports: Record<number, Transport> = {};
  for (const chain of chains) transports[chain.id] = transportFor(chain.rpcUrls.default.http);
  const config = createConfig({
    chains,
    connectors,
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

/** RainbowKit themed from the ui store; re-renders on a theme flip without touching WagmiProvider. */
function ThemedRainbowKit({ children }: { readonly children: React.ReactNode }) {
  const theme = useResolvedTheme();
  const rainbowTheme = useMemo(() => lykiaRainbowTheme(theme), [theme]);
  return (
    <RainbowKitProvider locale="en-US" theme={rainbowTheme} modalSize="compact" appInfo={{ appName: "Lykia", learnMoreUrl: "/developers" }}>
      {children}
    </RainbowKitProvider>
  );
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
 * this shell (a lesson from Kletia: otherwise connections flap).
 */
const ProviderShell = React.memo(function ProviderShell() {
  const mode = useUiStore((state) => state.mode);
  const config = configFor(mode);
  return (
    <WagmiProvider config={config} reconnectOnMount>
      <ThemedRainbowKit>
        <ProvidedChildrenSlot />
      </ThemedRainbowKit>
    </WagmiProvider>
  );
});

/** Wallet providers (wagmi + RainbowKit) for every route that talks to a wallet. */
export function WalletProviders({ children }: { readonly children: React.ReactNode }) {
  return (
    <ProvidedChildren.Provider value={children}>
      <ProviderShell />
    </ProvidedChildren.Provider>
  );
}
