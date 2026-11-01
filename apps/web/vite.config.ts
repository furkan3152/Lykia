import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
 * The Circle Modular Wallets SDK (and the viem copy it carries) is never
 * grouped: it loads only when someone opens a passkey wallet.
 */
const REACT_PACKAGES = new Set(["react", "react-dom", "scheduler", "use-sync-external-store"]);
const STATE_PACKAGES = new Set(["zustand", "@tanstack/react-query", "@tanstack/query-core"]);
const CRYPTO_PACKAGES = new Set(["@noble/hashes", "@noble/curves", "@scure/base", "@scure/bip32", "@scure/bip39"]);
const WALLET_PACKAGES = new Set(["wagmi", "@wagmi/core", "@wagmi/connectors", "viem", "ox", "abitype"]);


function manualChunks(id: string): string | undefined {
  // Build-runtime helpers (dynamic import preloading, CommonJS interop) are used everywhere:
  // left alone, the first manual chunk that needs them absorbs them and the entry imports it.
  if (id.includes("vite/preload-helper") || id.includes("commonjsHelpers") || id.includes("vite/modulepreload-polyfill")) return "vendor-react";
  if (id.includes("/@circle-fin/")) return undefined;
  const pkg = packageOf(id);
  if (!pkg) return undefined;
  if (REACT_PACKAGES.has(pkg)) return "vendor-react";
  if (STATE_PACKAGES.has(pkg)) return "vendor-state";
  if (CRYPTO_PACKAGES.has(pkg)) return "vendor-crypto";
  if (WALLET_PACKAGES.has(pkg)) return "vendor-wallet";
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // The wallet stack (wagmi, viem) arrives lazily with /app; the passkey SDK later still.
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
