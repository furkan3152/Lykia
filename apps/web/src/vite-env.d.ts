/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the Lykia API (no path). Defaults to http://localhost:3002. */
  readonly VITE_API_URL?: string;
  /** Circle Modular Wallets client key (publishable). Passkey wallets are hidden without it. */
  readonly VITE_CIRCLE_CLIENT_KEY?: string;
  /** Circle Modular Wallets client URL (https). */
  readonly VITE_CIRCLE_CLIENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
