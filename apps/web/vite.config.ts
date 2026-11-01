import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import { walletConnectBuildWarning } from "./src/app/wallet/walletConnectProjectId";

/**
 * Warns when VITE_WALLETCONNECT_PROJECT_ID is set to something that cannot be
 * a Reown project id: the app then hides WalletConnect (src/app/wallet/wallets.ts)
 * and the build log says why instead of shipping a button that cannot connect.
 */
function walletConnectCheck(): Plugin {
  return {
    name: "lykia-walletconnect-check",
    configResolved(config) {
      const warning = walletConnectBuildWarning(config.env.VITE_WALLETCONNECT_PROJECT_ID);
      if (warning) config.logger.warn(`\n${warning}\n`);
    },
  };
}

/** Package name of a module id inside node_modules (`@scope/name` or `name`), else null. */
function packageOf(id: string): string | null {
  const marker = "/node_modules/";
  const at = id.lastIndexOf(marker);
  if (at < 0) return null;
  const parts = id.slice(at + marker.length).split("/");
  const first = parts[0] ?? "";
  return first.startsWith("@") ? `${first}/${parts[1] ?? ""}` : first;
}

/*
 * Vendor chunks. A manual chunk also absorbs the dependencies of its modules,
 * so every library the entry shares with the wallet stack gets its own chunk
 * first (react, state, crypto); otherwise the landing page would import the
 * wallet chunk just to reach zustand or @noble/hashes. The wallet chunk then
 * holds only wagmi/viem, which only the lazily loaded app shell reaches.
 * RainbowKit is not grouped: its locales and wallet icons must stay lazy.
 */
const REACT_PACKAGES = new Set(["react", "react-dom", "scheduler", "use-sync-external-store"]);
const STATE_PACKAGES = new Set(["zustand", "@tanstack/react-query", "@tanstack/query-core"]);
const CRYPTO_PACKAGES = new Set(["@noble/hashes", "@noble/curves", "@scure/base", "@scure/bip32", "@scure/bip39"]);
const WALLET_PACKAGES = new Set(["wagmi", "@wagmi/core", "@wagmi/connectors", "viem", "ox", "abitype"]);


function manualChunks(id: string): string | undefined {
  // Build-runtime helpers (dynamic import preloading, CommonJS interop) are used everywhere:
  // left alone, the first manual chunk that needs them absorbs them and the entry imports it.
  if (id.includes("vite/preload-helper") || id.includes("commonjsHelpers") || id.includes("vite/modulepreload-polyfill")) return "vendor-react";
  const pkg = packageOf(id);
  if (!pkg) return undefined;
  if (REACT_PACKAGES.has(pkg)) return "vendor-react";
  if (STATE_PACKAGES.has(pkg)) return "vendor-state";
  if (CRYPTO_PACKAGES.has(pkg)) return "vendor-crypto";
  if (WALLET_PACKAGES.has(pkg)) return "vendor-wallet";
  return undefined;
}

export default defineConfig({
  plugins: [react(), walletConnectCheck()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // The wallet stack (WalletConnect, Coinbase, MetaMask SDKs) arrives lazily with /app.
    chunkSizeWarningLimit: 1_400,
    rollupOptions: {
      output: { manualChunks },
    },
  },
  server: {
    port: 5176,
    fs: {
      // @lykia/core is linked from ../../packages; fonts are hoisted to the root node_modules.
      allow: [".", "../../packages", "../../node_modules"],
    },
  },
  preview: {
    port: 4176,
  },
});
